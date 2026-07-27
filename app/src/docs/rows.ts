// Standard Documents — pure row and query logic for the read experience
// (plan Phase 2). No SDK imports; unit-tested end to end. Browse mode
// reads list REST pages (FieldValuesAsText projects every column as
// display text — one call, no per-type handling); search mode reads
// postquery's verbose table shape. Both normalise to DocRow.

export interface DocRow {
  /** List item id (0 when unknown — some search rows). */
  id: number;
  /** File unique id, braces stripped — viewer/download identity. */
  uniqueId: string;
  name: string;
  ext: string;
  /** Server-relative path to the file. */
  serverUrl: string;
  /** Owning library's list id, lowercase, "" when unknown. */
  listId: string;
  /** Modified timestamp (ISO-ish source string, "" unknown). */
  modified: string;
  /** FieldValuesAsText projection (browse mode; {} in search mode). */
  values: Record<string, string>;
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const stripBraces = (v: string): string => v.replace(/^\{|\}$/g, "").toLowerCase();

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** A small glyph per file family — decoration, not information. */
export function extGlyph(ext: string): string {
  if (["docx", "doc", "dotx"].includes(ext)) return "📄";
  if (["xlsx", "xls", "csv"].includes(ext)) return "📊";
  if (["pptx", "ppt"].includes(ext)) return "📽";
  if (ext === "pdf") return "📕";
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext)) return "🖼";
  if (["msg", "eml"].includes(ext)) return "✉";
  return "📎";
}

// ---- browse mode (list REST) -------------------------------------------

/** The items page URI for a library (server-paged; folders excluded). */
export function buildBrowseUri(listId: string, top = 50): string {
  return (
    `_api/web/lists(guid'${listId}')/items` +
    `?$select=Id,UniqueId,FileRef,FileLeafRef,Modified,FSObjType` +
    `&$expand=FieldValuesAsText` +
    `&$filter=FSObjType eq 0&$orderby=Modified desc&$top=${top}`
  );
}

export interface ItemsPage {
  rows: DocRow[];
  /** Site-relative next-page URI, "" when done. */
  next: string;
}

/** Parse one nometadata items page; `site` de-absolutises the nextLink. */
export function parseItemsPage(raw: unknown, site: string, listId: string): ItemsPage {
  const o = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.value) ? (o.value as Record<string, unknown>[]) : [];
  const rows: DocRow[] = [];
  for (const it of items) {
    const name = asStr(it.FileLeafRef);
    if (name === "") continue;
    const fv =
      it.FieldValuesAsText && typeof it.FieldValuesAsText === "object"
        ? (it.FieldValuesAsText as Record<string, unknown>)
        : {};
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(fv)) {
      if (typeof v === "string" && !k.startsWith("odata")) values[k] = v;
    }
    rows.push({
      id: typeof it.Id === "number" ? it.Id : 0,
      uniqueId: stripBraces(asStr(it.UniqueId)),
      name,
      ext: extOf(name),
      serverUrl: asStr(it.FileRef),
      listId: listId.toLowerCase(),
      modified: asStr(it.Modified),
      values,
    });
  }
  const nextAbs = asStr(o["odata.nextLink"]);
  return { rows, next: nextAbs === "" ? "" : toSiteRelative(nextAbs, site) };
}

/** An absolute URL on the site → site-relative URI for spRequest. */
export function toSiteRelative(url: string, site: string): string {
  const clean = site.replace(/\/$/, "");
  if (url.startsWith(clean + "/")) return url.slice(clean.length + 1);
  return url;
}

// ---- search mode (postquery) -------------------------------------------

export interface SearchOpts {
  /** Restrict to one library ("" = whole site). */
  listId?: string;
  rowLimit?: number;
  startRow?: number;
  /** Sort newest-first instead of by relevance (the browse-ish default). */
  byModified?: boolean;
}

/** The postquery body. Empty text means "everything" (recent documents). */
export function buildSearchBody(text: string, opts: SearchOpts = {}): string {
  const t = text.trim();
  const terms: string[] = [];
  if (t !== "") terms.push(`${t.replace(/["']/g, " ").trim()}*`);
  terms.push("IsDocument:1");
  if ((opts.listId ?? "") !== "") terms.push(`ListID:${opts.listId}`);
  const request: Record<string, unknown> = {
    Querytext: terms.join(" "),
    RowLimit: opts.rowLimit ?? 50,
    StartRow: opts.startRow ?? 0,
    TrimDuplicates: false,
    SelectProperties: {
      results: [
        "Title",
        "Path",
        "FileType",
        "LastModifiedTime",
        "UniqueId",
        "ListID",
        "ListItemID",
      ],
    },
  };
  if (opts.byModified || t === "") {
    request.SortList = {
      results: [{ Property: "LastModifiedTime", Direction: 1 }],
    };
  }
  return JSON.stringify({ request });
}

export interface SearchPage {
  rows: DocRow[];
  total: number;
}

/** Parse the verbose postquery result table into rows. */
export function rowsFromSearch(raw: unknown): SearchPage {
  const rel = (((raw as Record<string, never>)?.["d"] as Record<string, never>)?.[
    "postquery"
  ] as Record<string, never>)?.["PrimaryQueryResult"] as Record<string, unknown> | undefined;
  const relevant = rel?.RelevantResults as Record<string, unknown> | undefined;
  const total = typeof relevant?.TotalRows === "number" ? relevant.TotalRows : 0;
  const tableRows = (
    ((relevant?.Table as Record<string, unknown>)?.Rows as Record<string, unknown>)
      ?.results ?? []
  ) as Record<string, unknown>[];
  const rows: DocRow[] = [];
  for (const r of tableRows) {
    const cells = (
      ((r.Cells as Record<string, unknown>)?.results ?? []) as {
        Key?: string;
        Value?: unknown;
      }[]
    ).reduce<Record<string, string>>((acc, c) => {
      if (typeof c.Key === "string" && typeof c.Value === "string") acc[c.Key] = c.Value;
      return acc;
    }, {});
    const path = cells.Path ?? "";
    const name = path.split("/").pop() ?? "";
    if (name === "") continue;
    let serverUrl = path;
    try {
      // pathname is percent-encoded; decode so it matches FileRef form
      serverUrl = decodeURIComponent(new URL(path).pathname);
    } catch {
      /* already relative */
    }
    rows.push({
      id: Number(cells.ListItemID ?? "0") || 0,
      uniqueId: stripBraces(cells.UniqueId ?? ""),
      name,
      ext: (cells.FileType ?? extOf(name)).toLowerCase(),
      serverUrl,
      listId: stripBraces(cells.ListID ?? ""),
      modified: cells.LastModifiedTime ?? "",
      values: {},
    });
  }
  return { rows, total };
}

// ---- shared presentation helpers ---------------------------------------

const OFFICE_EXTS = new Set(["docx", "doc", "dotx", "xlsx", "xls", "pptx", "ppt"]);

/** Origin of the configured site ("https://tenant.sharepoint.com"). */
export function originOf(site: string): string {
  try {
    return new URL(site).origin;
  } catch {
    return "";
  }
}

/** In-app preview URL: WOPI embed for office formats, the file itself
 *  for browser-native ones (pdf, images). */
export function embedUrlFor(site: string, row: DocRow): string {
  if (OFFICE_EXTS.has(row.ext)) {
    return `${site}/_layouts/15/Doc.aspx?sourcedoc={${row.uniqueId}}&action=embedview`;
  }
  return `${originOf(site)}${row.serverUrl}`;
}

/** The open-in-SharePoint URL (new tab; ?web=1 keeps office docs in the
 *  browser instead of nagging for the desktop app). */
export function openUrlFor(site: string, row: DocRow): string {
  return `${originOf(site)}${row.serverUrl}?web=1`;
}

export function downloadUrlFor(site: string, row: DocRow): string {
  return `${site}/_layouts/15/download.aspx?UniqueId=${row.uniqueId}`;
}

/** FR-SE-005 heuristic until status semantics are configurable: these
 *  status texts read as non-current. */
export function isNonCurrentStatus(value: string): boolean {
  return /\b(draft|in review|awaiting|superseded|obsolete|retired)\b/i.test(value);
}

export function formatWhen(iso: string): string {
  if (iso === "") return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
