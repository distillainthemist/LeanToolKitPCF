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
  /** Who holds this document checked out — name and email, both empty
   *  when it is not checked out. Email is what identifies "me": display
   *  names collide, and two people called Ben would each be offered the
   *  other's check-in (Phase 4B). Only asked for in libraries that can
   *  be written to, so a read-only register carries no extra lookup. */
  checkoutName?: string;
  checkoutEmail?: string;
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

/** Server-side presentation options (Vault V3): sort and the Modified
 *  window apply at the source in BOTH modes — a client sort or filter
 *  over a partial page would lie about the corpus. */
export interface BrowseOpts {
  /** Sort by filename instead of Modified. */
  sortName?: boolean;
  asc?: boolean;
  /** Only documents modified on/after this ISO instant. */
  modifiedAfterIso?: string;
  /** Words that must EACH appear in the file name or Title — the
   *  index-free quick search (REST substringof). The contents-depth
   *  toggle stays on the search index, which is the only thing that
   *  can read inside documents. */
  nameWords?: string[];
}

/** The items page URI for a library (server-paged; folders excluded). */
export function buildBrowseUri(listId: string, top = 50, opts: BrowseOpts = {}): string {
  const dir = opts.asc ? "asc" : "desc";
  const orderBy = opts.sortName ? `FileLeafRef ${dir}` : `Modified ${dir}`;
  let filter =
    "FSObjType eq 0" +
    (opts.modifiedAfterIso ? ` and Modified ge datetime'${opts.modifiedAfterIso}'` : "");
  for (const raw of opts.nameWords ?? []) {
    const w = raw.replace(/'/g, "''").trim();
    if (w === "") continue;
    filter += ` and (substringof('${w}',FileLeafRef) or substringof('${w}',Title))`;
  }
  return (
    `_api/web/lists(guid'${listId}')/items` +
    `?$select=Id,UniqueId,FileRef,FileLeafRef,Modified,FSObjType` +
    `&$expand=FieldValuesAsText` +
    `&$filter=${filter}&$orderby=${orderBy}&$top=${top}`
  );
}

// ---- RenderListDataAsStream (the register's browse feed) ---------------
// The endpoint modern list views use: display-ready values for every
// field type (FieldValuesAsText renders taxonomy/person fields
// erratically depending on projection shape — measured on the dev DMS
// libraries 2026-08-02), and CAML pushes name search, the Modified
// window and taxonomy label filters SERVER-side per library.

const xmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** CAML And/Or take exactly two children — fold a list into a tree. */
function camlJoin(op: "And" | "Or", parts: string[]): string {
  if (parts.length === 0) return "";
  return parts.reduce((acc, p) => (acc === "" ? p : `<${op}>${acc}${p}</${op}>`), "");
}

export interface RenderQueryOpts {
  sortName?: boolean;
  asc?: boolean;
  modifiedAfterIso?: string;
  /** Words that must EACH appear in the file name or Title. */
  nameWords?: string[];
  /**
   * List item ids the search index says match INSIDE the documents —
   * OR'd with the name match, never ANDed. This is what makes "match
   * contents" a superset of the name search rather than a different
   * answer: CAML can only see field values, the index can only see text,
   * so a document qualifies if either engine likes it (Ben, 2026-08-02:
   * "heat" found 6 by name but 4 by contents, because the index matches
   * whole words by prefix and cannot see the "heat" inside "Preheat").
   */
  idIn?: number[];
  /** Per filter: OR of label Eqs across the given columns (a term and
   *  its subtree, matched by display label); filters AND together. */
  termFilters?: { cols: string[]; labels: string[] }[];
  /** From/to bounds on date columns (Ben, 2026-08-03). Either end may be
   *  blank — "everything since March" is as valid a question as a closed
   *  window. `to` is inclusive of the whole day: a date column holding
   *  midnight would otherwise drop documents dated ON the end date. */
  dateRanges?: { col: string; from: string; to: string }[];
  /** DMS internals to return beyond the core file fields. */
  fields?: string[];
  rowLimit?: number;
  // ---- My tasks (Phase 4D): questions about ME, answered server-side.
  // CAML's <UserID/> is the signed-in user, so no lookup id ever has to
  // be fetched or stored — the query itself says "me".
  /** Only documents checked out to the current user. */
  checkedOutToMe?: boolean;
  /** A person column that must be the current user (e.g. the owner). */
  personIsMe?: string;
  /** A date column due on or before today + days (days may be 0 for
   *  "already due", and the clause skips rows with no date at all). */
  dueWithinDays?: { col: string; days: number };
}

/** The ViewXml for one library's server-filtered, server-sorted page. */
export function buildRenderViewXml(opts: RenderQueryOpts = {}): string {
  const clauses: string[] = [];
  if (opts.modifiedAfterIso) {
    clauses.push(
      `<Geq><FieldRef Name="Modified"/><Value Type="DateTime" IncludeTimeValue="TRUE" StorageTZ="TRUE">${xmlEsc(opts.modifiedAfterIso)}</Value></Geq>`
    );
  }
  const nameParts: string[] = [];
  for (const raw of opts.nameWords ?? []) {
    const w = raw.trim();
    if (w === "") continue;
    nameParts.push(
      camlJoin("Or", [
        `<Contains><FieldRef Name="FileLeafRef"/><Value Type="File">${xmlEsc(w)}</Value></Contains>`,
        `<Contains><FieldRef Name="Title"/><Value Type="Text">${xmlEsc(w)}</Value></Contains>`,
      ])
    );
  }
  // every word must be in the name, OR the index found the words inside
  // the document — the two engines union, so turning contents matching
  // on can only ever ADD documents
  const nameTree = camlJoin("And", nameParts);
  const ids = (opts.idIn ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const idTree =
    ids.length === 0
      ? ""
      : `<In><FieldRef Name="ID"/><Values>` +
        ids.map((n) => `<Value Type="Counter">${n}</Value>`).join("") +
        `</Values></In>`;
  const match =
    nameTree !== "" && idTree !== "" ? camlJoin("Or", [nameTree, idTree]) : nameTree || idTree;
  if (match !== "") clauses.push(match);
  for (const dr of opts.dateRanges ?? []) {
    const col = dr.col.trim();
    if (col === "") continue;
    const bound = (op: "Geq" | "Leq", iso: string) =>
      `<${op}><FieldRef Name="${xmlEsc(col)}"/>` +
      `<Value Type="DateTime" IncludeTimeValue="TRUE" StorageTZ="TRUE">${xmlEsc(iso)}</Value></${op}>`;
    if (dr.from.trim() !== "") clauses.push(bound("Geq", `${dr.from.trim()}T00:00:00Z`));
    if (dr.to.trim() !== "") clauses.push(bound("Leq", `${dr.to.trim()}T23:59:59Z`));
  }
  for (const tf of opts.termFilters ?? []) {
    const eqs = tf.cols.flatMap((col) =>
      tf.labels.map(
        (l) => `<Eq><FieldRef Name="${xmlEsc(col)}"/><Value Type="Text">${xmlEsc(l)}</Value></Eq>`
      )
    );
    if (eqs.length > 0) clauses.push(camlJoin("Or", eqs));
  }
  if (opts.checkedOutToMe === true) {
    clauses.push(
      '<Eq><FieldRef Name="CheckoutUser" LookupId="TRUE"/><Value Type="Integer"><UserID/></Value></Eq>'
    );
  }
  if ((opts.personIsMe ?? "").trim() !== "") {
    clauses.push(
      `<Eq><FieldRef Name="${xmlEsc((opts.personIsMe ?? "").trim())}" LookupId="TRUE"/><Value Type="Integer"><UserID/></Value></Eq>`
    );
  }
  const due = opts.dueWithinDays;
  if (due !== undefined && due.col.trim() !== "") {
    clauses.push(
      `<Leq><FieldRef Name="${xmlEsc(due.col.trim())}"/><Value Type="DateTime"><Today OffsetDays="${Math.round(due.days)}"/></Value></Leq>`
    );
  }
  const where = clauses.length > 0 ? `<Where>${camlJoin("And", clauses)}</Where>` : "";
  const order = `<OrderBy><FieldRef Name="${opts.sortName ? "FileLeafRef" : "Modified"}" Ascending="${opts.asc ? "TRUE" : "FALSE"}"/></OrderBy>`;
  const core = ["FileLeafRef", "FileRef", "Modified", "UniqueId", "ID", "FSObjType"];
  const fields = [...core, ...(opts.fields ?? []).filter((f) => !core.includes(f))]
    .map((f) => `<FieldRef Name="${xmlEsc(f)}"/>`)
    .join("");
  return (
    `<View><Query>${where}${order}</Query>` +
    `<ViewFields>${fields}</ViewFields>` +
    `<RowLimit Paged="TRUE">${opts.rowLimit ?? 50}</RowLimit></View>`
  );
}

/** One RenderListDataAsStream value as display text: taxonomy comes as
 *  [{Label}], people as [{title}], the rest as strings. */
function renderText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    return v
      .map((e) => {
        if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          return String(o.Label ?? o.lookupValue ?? o.title ?? "");
        }
        return String(e);
      })
      .filter((s) => s !== "")
      .join("; ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.Label ?? o.lookupValue ?? o.title ?? "");
  }
  return String(v);
}

export interface RenderPage {
  rows: DocRow[];
  /** Opaque paging query string ("?Paged=TRUE&..."), "" when done. */
  next: string;
}

/** Parse a RenderListDataAsStream response into DocRows. */
export function parseRenderPage(raw: unknown, listId: string): RenderPage {
  const data = (raw ?? {}) as Record<string, unknown>;
  const rowsIn = Array.isArray(data.Row) ? (data.Row as Record<string, unknown>[]) : [];
  const rows: DocRow[] = [];
  for (const r of rowsIn) {
    const name = typeof r.FileLeafRef === "string" ? r.FileLeafRef : "";
    if (name === "" || String(r.FSObjType ?? "0") !== "0") continue;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      // "Column." is RLDAS's ISO twin of a date column (DatesInUtc) —
      // kept under its dotted key, because the display text is in the
      // SITE's locale and re-parsing that is a guess (Phase 4D)
      if (!k.startsWith("_") && k.endsWith(".") && !k.slice(0, -1).includes(".")) {
        const iso = typeof v === "string" ? v : "";
        if (iso !== "" && !Number.isNaN(Date.parse(iso))) values[k] = iso;
        continue;
      }
      if (k.startsWith("_") || k.includes(".")) continue;
      const text = renderText(v);
      if (text !== "") values[k] = text;
      // person columns ALSO keep their emails, under "<col>#email" —
      // display names collide, and the approve gate compares the acting
      // user by address (Phase 5B), exactly as "checked out by me" does
      if (Array.isArray(v)) {
        const emails = v
          .map((e) =>
            e && typeof e === "object" ? asStr((e as Record<string, unknown>).email) : ""
          )
          .filter((s) => s !== "")
          .map((s) => s.toLowerCase());
        if (emails.length > 0) values[`${k}#email`] = emails.join(";");
      }
    }
    // "Modified." carries ISO when DatesInUtc is set; display otherwise
    const isoDot = typeof r["Modified."] === "string" ? (r["Modified."] as string) : "";
    let modified = "";
    if (isoDot !== "" && !Number.isNaN(Date.parse(isoDot))) {
      modified = isoDot;
    } else {
      const t = Date.parse(String(r.Modified ?? ""));
      if (!Number.isNaN(t)) modified = new Date(t).toISOString();
    }
    // a person field arrives as [{title, email, …}]; the collapsed text
    // in `values` loses the email, which is the half that identifies me
    const checkout = Array.isArray(r.CheckoutUser)
      ? ((r.CheckoutUser as unknown[])[0] as Record<string, unknown> | undefined)
      : undefined;
    rows.push({
      checkoutName: asStr(checkout?.title),
      checkoutEmail: asStr(checkout?.email).toLowerCase(),
      id: Number(r.ID ?? 0) || 0,
      uniqueId: String(r.UniqueId ?? "").replace(/^\{|\}$/g, "").toLowerCase(),
      name,
      ext: extOf(name),
      serverUrl: typeof r.FileRef === "string" ? r.FileRef : "",
      listId: listId.toLowerCase(),
      modified,
      values,
    });
  }
  const next = typeof data.NextHref === "string" ? data.NextHref : "";
  return { rows, next };
}

/** Row comparator for the multi-library browse union: server-side sort
 *  order per feed, replicated client-side for the merge. Modified holds
 *  ISO-ish strings, so string compare orders correctly. */
export function browseComparator(
  key: "name" | "modified",
  asc: boolean
): (a: DocRow, b: DocRow) => number {
  return (a, b) => {
    const c =
      key === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : (a.modified || "").localeCompare(b.modified || "");
    return asc ? c : -c;
  };
}

/** K-way merge pick: index of the buffer whose head sorts first, -1
 *  when every buffer is empty. Callers must refill any empty buffer
 *  that still has pages BEFORE picking, or its rows are skipped. */
export function pickBrowseHead(
  buffers: DocRow[][],
  cmp: (a: DocRow, b: DocRow) => number
): number {
  let best = -1;
  for (let i = 0; i < buffers.length; i++) {
    if (buffers[i].length === 0) continue;
    if (best === -1 || cmp(buffers[i][0], buffers[best][0]) < 0) best = i;
  }
  return best;
}

/** Loaded-row term counts (Vault V1, honest counts): how many of the
 *  loaded rows carry each term label in the given columns. Taxonomy
 *  display text is ";"-separated for multi-value; matching is
 *  case-insensitive on the exact label. Keyed by lowercased label. */
/**
 * Loaded-row counts per tree node, INCLUDING everything below it (Ben,
 * 2026-08-03): a site shows what its departments and areas hold, not
 * just documents pinned at site level, which is what "Pacific 6" looked
 * like when its areas held forty.
 *
 * Counted by row membership, not by summing children: a document tagged
 * both "Bell Bay" and "Casting" is ONE document in Bell Bay's count, and
 * summing would have said two.
 *
 * The known limit: rows carry term LABELS, not ids, so two terms sharing
 * a label in different branches (this site has two "Maintenance") cannot
 * be told apart, and a row under either counts for both. That ambiguity
 * already existed in the per-node counts; it is not made worse by
 * including descendants, and the counts stay scoped as "loaded so far".
 */
export function tallySubtreeCounts(
  rows: DocRow[],
  cols: string[],
  nodes: { id: string; labels: string[] }[]
): Map<string, number> {
  const SEP = "\u0000"; // labels contain spaces; a NUL cannot appear in one
  const path = (labels: string[]) => labels.map((l) => l.trim().toLowerCase()).join(SEP);
  // each row's labels, once
  const rowLabels = rows.map((r) => {
    const set = new Set<string>();
    for (const col of cols) {
      for (const part of (r.values[col] ?? "").split(";")) {
        const label = part.trim().toLowerCase();
        if (label !== "") set.add(label);
      }
    }
    return set;
  });
  const out = new Map<string, number>();
  for (const node of nodes) {
    const prefix = path(node.labels);
    const wanted = new Set<string>();
    for (const other of nodes) {
      const p = path(other.labels);
      if (p === prefix || p.startsWith(prefix + SEP)) {
        wanted.add(other.labels[other.labels.length - 1].trim().toLowerCase());
      }
    }
    let n = 0;
    for (const labels of rowLabels) {
      for (const w of wanted) {
        if (labels.has(w)) {
          n++;
          break;
        }
      }
    }
    out.set(node.id, n);
  }
  return out;
}

export function tallyTermCounts(rows: DocRow[], cols: string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const r of rows) {
    for (const col of cols) {
      for (const part of (r.values[col] ?? "").split(";")) {
        const label = part.trim().toLowerCase();
        if (label !== "") tally.set(label, (tally.get(label) ?? 0) + 1);
      }
    }
  }
  return tally;
}

/** Split a filename so the extension can survive any width: the stem
 *  end-ellipsizes in CSS, the extension never shrinks (finding 6). */
export function splitNameForEllipsis(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
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
  /**
   * The libraries the search may see — the corpus is ALWAYS what a super
   * admin exposed, never the whole site. Unscoped, this site's index
   * answers with 4,543 items (OneDrive files, .loop, .one, site pages)
   * against 2 in the configured library; the scope clause is what makes
   * a result list mean anything.
   */
  listIds: string[];
  rowLimit?: number;
  startRow?: number;
  /** Sort by Modified instead of by relevance (the browse-ish default). */
  byModified?: boolean;
  /** With byModified: oldest-first instead of newest-first. */
  sortAsc?: boolean;
  /** Only documents modified on/after this ISO date (KQL range). */
  modifiedAfterIso?: string;
  /**
   * Match the text of the documents themselves, not just their names and
   * titles. Off by default: SharePoint's free-text search is full-text
   * and ranked rather than filtered, so "pump" returns every procedure
   * that so much as mentions a pump. Someone hunting a phrase inside a
   * procedure turns this on deliberately.
   */
  searchContents?: boolean;
  /**
   * Taxonomy filters, ANDed — each entry restricts to documents tagged
   * with any of its terms (the node the user picked plus its
   * descendants — a GUID matches only its exact term, so subtree
   * filtering ORs the subtree's ids, which the term store walk already
   * yields). One entry per filtered column (Phase 3a generalised the
   * single organisation filter).
   */
  termFilters?: { properties: string[]; termIds: string[] }[];
}

/**
 * Rebuild depth-first (render) order from a level-by-level walk: each
 * node directly under its parent, siblings keeping their term-store
 * order. The parallel BFS term walk returns nodes level by level, which
 * painted every grandchild after the LAST top-level term (Ben's
 * screenshot: Bell Bay's areas indented under Boyne).
 */
export function termTreeOrder<T extends { labels: string[] }>(nodes: T[]): T[] {
  const SEP = "\u0000"; // labels contain spaces; a NUL cannot appear in one
  const byParent = new Map<string, T[]>();
  for (const n of nodes) {
    const key = n.labels.slice(0, -1).join(SEP);
    const siblings = byParent.get(key) ?? [];
    siblings.push(n);
    byParent.set(key, siblings);
  }
  const out: T[] = [];
  const emit = (parentKey: string) => {
    for (const n of byParent.get(parentKey) ?? []) {
      out.push(n);
      emit(n.labels.join(SEP));
    }
  };
  emit("");
  return out;
}

/**
 * The auto-created managed property behind a taxonomy column: `owstaxId`
 * + the column's internal name. Verified on the dev tenant 2026-07-28:
 * `owstaxIdOrganisation:<termGuid>` filtered correctly with NO tenant
 * admin mapping (label matching worked too, but labels collide across
 * term sets — GUIDs don't). A tenant where this answers nothing needs
 * the RefinableString mapping; the settings diagnostic tests it.
 */
export function taxonomySearchProperty(internalName: string): string {
  return `owstaxId${internalName}`;
}

/** KQL-safe: quotes and brackets change the meaning of a query. */
function sanitizeTerm(word: string): string {
  return word.replace(/["'()[\]{}]/g, "").trim();
}

/** The postquery body. Empty text means "everything in scope" (recent). */
export function buildSearchBody(text: string, opts: SearchOpts): string {
  const terms: string[] = [];
  const words = text.split(/\s+/).map(sanitizeTerm).filter((w) => w !== "");
  if (words.length > 0) {
    if (opts.searchContents) {
      // every word must appear somewhere in the document or its metadata
      terms.push(words.map((w) => `${w}*`).join(" "));
    } else {
      // every word must appear in the name or the title — the default,
      // because that is how people look for a document they know exists
      for (const w of words) terms.push(`(Title:${w}* OR Filename:${w}*)`);
    }
  }
  terms.push("IsDocument:1");
  const ids = opts.listIds.filter((id) => id.trim() !== "");
  if (ids.length === 1) terms.push(`ListID:${ids[0]}`);
  else if (ids.length > 1) {
    terms.push(`(${ids.map((id) => `ListID:${id}`).join(" OR ")})`);
  }
  // date bounds are NOT sent to the index: since the contents union, the
  // index only nominates ids and CAML does every bit of the filtering,
  // so a KQL range here would narrow the nominations for no gain
  for (const tf of opts.termFilters ?? []) {
    if (tf.properties.length === 0 || tf.termIds.length === 0) continue;
    const parts = tf.properties.flatMap((p) => tf.termIds.map((t) => `${p}:${t}`));
    terms.push(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`);
  }
  if (opts.modifiedAfterIso) {
    terms.push(`LastModifiedTime>=${opts.modifiedAfterIso.slice(0, 10)}`);
  }
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
  if (opts.byModified || words.length === 0) {
    request.SortList = {
      results: [{ Property: "LastModifiedTime", Direction: opts.sortAsc ? 0 : 1 }],
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

/** Origin of the configured site ("https://tenant.sharepoint.com"). */
export function originOf(site: string): string {
  try {
    return new URL(site).origin;
  } catch {
    return "";
  }
}

/**
 * The reader's URL — always a PDF rendering, never the editable source
 * (FR-DI-005/006). Used by the Open / Copy / Email actions (top-level,
 * first-party navigations, where cookie auth is reliable) and as the
 * preview frame's LAST-RESORT fallback — the frame itself prefers the
 * presigned URLs below, because cookie auth inside a third-party iframe
 * is at the mercy of the browser's cookie policy.
 *
 * MUST be drive-scoped. `_api/v2.0/drive/…` (no id) addresses only the
 * site's DEFAULT library, so it answered `itemNotFound` for every
 * purpose-made document library — i.e. for exactly the libraries this
 * feature exists to serve. Reproduced against a non-default library and
 * fixed by naming the drive.
 *
 * A file that is ALREADY a PDF cannot be converted — both SharePoint's
 * `format=pdf` and the media transform answer 406 "no conversion
 * available" — and its own content URL is served as an attachment, so it
 * would download rather than render. Those go through SharePoint's
 * viewer page. Everything else streams converted PDF bytes straight
 * into the browser's own viewer, which is what makes this ~an order of
 * magnitude lighter than `embed.aspx` (226 kB of HTML that then loads
 * the document inside itself).
 */
export function pdfViewUrlFor(site: string, driveId: string, row: DocRow): string {
  if (row.ext === "pdf" || driveId === "") {
    return `${site}/_layouts/15/embed.aspx?UniqueId=${row.uniqueId}`;
  }
  return driveItemUrl(site, driveId, row) + "/content?format=pdf";
}

function driveItemUrl(site: string, driveId: string, row: DocRow): string {
  return `${site}/_api/v2.0/drives/${driveId}/items/${row.uniqueId}`;
}

/**
 * Presigned, cookie-free URLs pulled from a drive item fetched with
 * `?expand=thumbnails`. The preview FRAME must use these: an iframe on
 * apps.powerapps.com reaches SharePoint as a THIRD party, and browsers
 * now withhold third-party cookies — so a cookie-authenticated frame
 * (embed.aspx, /content?format=pdf) silently becomes an anonymous
 * request, bounces to the AAD sign-in page, and that page's
 * `X-Frame-Options: DENY` is the "content is blocked" panel. Presigned
 * URLs carry their auth in the URL, so no cookie policy can break them.
 * (Top-level links are first-party navigations and stay on the cookie
 * paths. Probed 2026-07-29 against the Dev site.)
 */
export interface PresignedUrls {
  /** tempauth download URL — CORS `*`, attachment disposition (so it is
   *  fetch-to-blob material, not an iframe src). */
  downloadUrl: string;
  /** page-one image on the media-transform service. */
  thumbUrl: string;
  /** the same image at tile size — a register of 50 tiles must not pull
   *  50 full-size renders (medium, falling back to small then large). */
  tileThumbUrl: string;
}

export function presignedFromItem(data: unknown): PresignedUrls {
  const o = (data ?? {}) as Record<string, unknown>;
  const dl = o["@content.downloadUrl"];
  const thumbs = Array.isArray(o.thumbnails)
    ? (o.thumbnails as Record<string, unknown>[])
    : [];
  const sized = (key: string): string => {
    const s = (thumbs[0]?.[key] ?? null) as { url?: unknown } | null;
    return s !== null && typeof s.url === "string" ? s.url : "";
  };
  const large = sized("large");
  return {
    downloadUrl: typeof dl === "string" ? dl : "",
    thumbUrl: large,
    tileThumbUrl: sized("medium") || sized("small") || large,
  };
}

/**
 * The presigned PDF rendering of an OFFICE document: the thumbnail URL
 * with `/transform/thumbnail` swapped for `/transform/pdf` — same
 * service, same signature, converted bytes served inline with no
 * framing headers at all. (The trick from the Canvas apps era, now the
 * mechanism of record — it is also what made previews faster there.)
 * "" for a PDF (the transform answers 406 "no conversion available" for
 * pdf input) and for thumbnails not on the transform service.
 */
export function transformPdfUrl(thumbUrl: string, ext: string): string {
  if (ext === "pdf" || !thumbUrl.includes("/transform/thumbnail")) return "";
  return thumbUrl.replace("/transform/thumbnail", "/transform/pdf");
}

/**
 * Page-one preview image. An <img>, so no framing policy can block it —
 * the fallback when the preview frame will not paint, and what the draft
 * asked for ("as a pdf via thumbnail").
 *
 * `path` (the absolute file URL, singly encoded) — NOT `guidFile`, which
 * answers 400. Probed 2026-07-27 against the Dev site: real PNG bytes
 * back for both a .pdf and a .docx.
 */
export function thumbnailUrlFor(site: string, row: DocRow): string {
  const abs = `${originOf(site)}${row.serverUrl}`;
  return `${site}/_layouts/15/getpreview.ashx?path=${encodeURIComponent(abs)}`;
}

/** The same rendering as a file. An existing PDF's content URL already
 *  carries an attachment disposition (so it saves); a converted one does
 *  not, so it may open in the browser's PDF viewer instead — either way
 *  the reader never receives the editable source. Falls back to the
 *  site-scoped download when the drive could not be resolved. */
export function pdfDownloadUrlFor(site: string, driveId: string, row: DocRow): string {
  if (driveId === "") {
    return `${site}/_layouts/15/download.aspx?UniqueId=${row.uniqueId}`;
  }
  const base = driveItemUrl(site, driveId, row) + "/content";
  return row.ext === "pdf" ? base : `${base}?format=pdf`;
}

/** The editable source. ONLY for the work-on-it path on a working
 *  document — never offered to a reader. */
export function sourceUrlFor(site: string, row: DocRow): string {
  return `${originOf(site)}${row.serverUrl}?web=1`;
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

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** dd-MMM-yyyy (Ben, 2026-08-04) — built by hand from LOCAL date parts,
 *  so it reads identically whatever the viewer's or the site's locale,
 *  and a UTC-midnight date never shifts a day for an AEST viewer. */
export function formatDayMonthYear(iso: string): string {
  const t = Date.parse(iso);
  if (iso === "" || Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`;
}

