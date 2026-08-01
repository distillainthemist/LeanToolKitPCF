// Standard Documents — saved views, the shareable view link payload, and
// favourites (plan Phase 3). Pure: no SDK imports, fully unit-tested.
//
// A shared link carries the view STATE, not a saved-view id — saved views
// are per person, so a link to "my" view would be dead for the recipient.

/** One taxonomy-column filter (Phase 3a): the column's internal name,
 *  the picked term, and the term's label path for display. Subtree ids
 *  are recomputed from the term walk at apply time — a link carries the
 *  pick, not the tenant's tree. */
export interface DocFilter {
  col: string;
  termId: string;
  path: string[];
}

export interface DocView {
  /** Display name ("" for the transient state a link carries). */
  name: string;
  /** Library list id, "" = all documents. */
  listId: string;
  query: string;
  /** "Search everything" toggle (contents and all fields). */
  contents: boolean;
  /** "Include drafts & superseded" toggle. */
  nonCurrent: boolean;
  /** Organisation term id ("" = no filter) + its label path for display.
   *  Kept as its own slot so pre-3a links keep opening; the screen folds
   *  it into the same filter list as `filters`. */
  orgTermId: string;
  orgPath: string[];
  /** Taxonomy filters beyond the organisation (Phase 3a). */
  filters: DocFilter[];
  /** Column internal names shown, in order; [] = the library default. */
  columns: string[];
  /** Column internal name driving the nav tree; "" = organisation. */
  groupBy: string;
}

export function emptyDocView(): DocView {
  return {
    name: "",
    listId: "",
    query: "",
    contents: false,
    nonCurrent: false,
    orgTermId: "",
    orgPath: [],
    filters: [],
    columns: [],
    groupBy: "",
  };
}

const asStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function viewToJson(v: DocView): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (v.name !== "") o.n = v.name;
  if (v.listId !== "") o.l = v.listId;
  if (v.query !== "") o.q = v.query;
  if (v.contents) o.c = 1;
  if (v.nonCurrent) o.d = 1;
  if (v.orgTermId !== "") o.o = v.orgTermId;
  if (v.orgPath.length > 0) o.p = v.orgPath;
  if (v.filters.length > 0) {
    o.f = v.filters.map((f) => ({ c: f.col, t: f.termId, p: f.path }));
  }
  if (v.columns.length > 0) o.k = v.columns;
  if (v.groupBy !== "") o.g = v.groupBy;
  return o;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).map(asStr).filter((s) => s !== "") : [];

function viewFromJson(raw: unknown): DocView {
  const out = emptyDocView();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  out.name = asStr(o.n);
  out.listId = asStr(o.l);
  out.query = asStr(o.q);
  out.contents = o.c === 1 || o.c === true;
  out.nonCurrent = o.d === 1 || o.d === true;
  out.orgTermId = asStr(o.o);
  out.orgPath = asStrings(o.p);
  if (Array.isArray(o.f)) {
    for (const item of o.f as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const fo = item as Record<string, unknown>;
      const col = asStr(fo.c);
      const termId = asStr(fo.t);
      if (col === "" || termId === "") continue;
      out.filters.push({ col, termId, path: asStrings(fo.p) });
    }
  }
  out.columns = asStrings(o.k);
  out.groupBy = asStr(o.g);
  return out;
}

/** The launch-param payload (compact JSON; the player passes it through
 *  as an opaque string). */
export function encodeDocView(v: DocView): string {
  return JSON.stringify(viewToJson({ ...v, name: "" }));
}

/** Tolerant decode — a mangled link opens the plain Documents area. */
export function decodeDocView(raw: string): DocView {
  try {
    return viewFromJson(JSON.parse(raw));
  } catch {
    return emptyDocView();
  }
}

// ---- the per-user saved lists (ben_ltkuserprefs columns) ---------------

export function parseDocViews(raw: string | null | undefined): DocView[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map(viewFromJson)
      .filter((v) => v.name !== ""); // a saved view without a name is noise
  } catch {
    return [];
  }
}

export function serializeDocViews(views: DocView[]): string {
  return JSON.stringify(views.map(viewToJson));
}

/** A favourited document — enough to render and open without a lookup. */
export interface FavDoc {
  uniqueId: string;
  name: string;
  ext: string;
  serverUrl: string;
  listId: string;
}

export function parseFavDocs(raw: string | null | undefined): FavDoc[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: FavDoc[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const uniqueId = asStr(o.uniqueId);
      const name = asStr(o.name);
      if (uniqueId === "" || name === "") continue;
      out.push({
        uniqueId,
        name,
        ext: asStr(o.ext),
        serverUrl: asStr(o.serverUrl),
        listId: asStr(o.listId),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeFavDocs(favs: FavDoc[]): string {
  return JSON.stringify(favs);
}

// ---- Documents UI state (Vault V1, ben_docuijson) ----------------------
// Presentation-only state that follows the person across devices (Ben's
// call, 2026-08-01: Dataverse over localStorage). Everything is optional
// and tolerantly parsed — a mangled row must never break the screen.

export interface DocUiPrefs {
  /** Ticked library list ids ([] = never saved → all libraries). */
  libraries: string[];
  /** Register presentation ("" = default; consumed from V3). */
  viewMode: string;
  density: string;
  /** Collapsed tree keys per term-set id. */
  collapsed: Record<string, string[]>;
}

export function emptyDocUiPrefs(): DocUiPrefs {
  return { libraries: [], viewMode: "", density: "", collapsed: {} };
}

export function parseDocUiPrefs(raw: string | null | undefined): DocUiPrefs {
  const out = emptyDocUiPrefs();
  const t = (raw ?? "").trim();
  if (t === "") return out;
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== "object") return out;
    const r = o as Record<string, unknown>;
    out.libraries = asStrings(r.libs);
    out.viewMode = asStr(r.view);
    out.density = asStr(r.density);
    if (r.collapsed && typeof r.collapsed === "object" && !Array.isArray(r.collapsed)) {
      for (const [k, v] of Object.entries(r.collapsed as Record<string, unknown>)) {
        const keys = asStrings(v);
        if (k !== "" && keys.length > 0) out.collapsed[k] = keys;
      }
    }
    return out;
  } catch {
    return out;
  }
}

export function serializeDocUiPrefs(ui: DocUiPrefs): string {
  const o: Record<string, unknown> = {};
  if (ui.libraries.length > 0) o.libs = ui.libraries;
  if (ui.viewMode !== "") o.view = ui.viewMode;
  if (ui.density !== "") o.density = ui.density;
  if (Object.keys(ui.collapsed).length > 0) o.collapsed = ui.collapsed;
  return JSON.stringify(o);
}

// ---- the register export (FR-RP-008) -----------------------------------

/** RFC-4180-ish CSV: quote when needed, double embedded quotes. */
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (s: string): string =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
