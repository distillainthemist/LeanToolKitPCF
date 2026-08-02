// Standard Documents — the mapping model (Phase 1 of
// docs/leanboard-standard-documents-plan.md). Pure types and functions:
// how a SharePoint library and its columns are presented and which
// column plays which document-management role. No SDK imports, so the
// whole module is unit-testable.
//
// Nothing here is authoritative about a document — SharePoint columns
// are the record; this model only says how LeanBoard presents them.

export type LibraryType = "standard" | "record" | "working" | "revision" | "template";

export const LIBRARY_TYPES: { key: LibraryType; label: string }[] = [
  { key: "standard", label: "Controlled standards" },
  { key: "record", label: "Controlled records" },
  { key: "working", label: "Working documents" },
  { key: "revision", label: "Standards revision (checked-out copies)" },
  { key: "template", label: "Templates" },
];

/** The document-management purposes a column can serve (from the DMS
 *  requirements' column table). "" = no special role. */
export const COLUMN_ROLES: { key: string; label: string }[] = [
  { key: "", label: "—" },
  { key: "documentId", label: "Document ID" },
  { key: "docType", label: "Document type" },
  { key: "owner", label: "Owner" },
  { key: "approvers", label: "Approvers" },
  { key: "reviewers", label: "Reviewers" },
  { key: "importance", label: "Importance" },
  { key: "status", label: "Approval status" },
  { key: "effectiveDate", label: "Effective date" },
  { key: "nextReviewDate", label: "Next review date" },
  { key: "regulatorApproved", label: "Regulator-approved flag" },
  { key: "regulatorPdf", label: "Regulator-returned PDF" },
  { key: "tags", label: "Tags" },
  { key: "orgUnit", label: "Organisation unit" },
  { key: "process", label: "Process" },
  { key: "managementProcess", label: "Management process" },
  { key: "linkedDocuments", label: "Linked documents" },
  { key: "priorNames", label: "Prior names" },
  { key: "priorIds", label: "Prior IDs" },
  { key: "distribution", label: "Distribution audience" },
  { key: "ackRequired", label: "Acknowledgement required" },
  { key: "reviewCadence", label: "Review cadence (months)" },
  { key: "retainUntil", label: "Retain until" },
];

/** One library column as LeanBoard presents it. */
export interface ColumnConfig {
  /** SharePoint internal name — the stable identity. */
  internal: string;
  /** Display override; "" = use SharePoint's own title. */
  label: string;
  /** Offered in the view-column picker at all. */
  available: boolean;
  /** In the default view. */
  inDefault: boolean;
  /** Document-management role ("" = none). */
  role: string;
  /** Term set behind a taxonomy column ("" = not taxonomy / unknown).
   *  Persisted so the Documents area can group and filter by the column
   *  without re-reading the field schema (Phase 3a). */
  termSetId: string;
}

/** Per-library configuration (ben_configjson on a library row). */
export interface LibraryConfig {
  /** Display override; "" = the library's SharePoint title. */
  title: string;
  columns: ColumnConfig[];
  /** Status value → state-palette key (or freeform colour). */
  statusColors: Record<string, string>;
  /** Where approve-time PDF renditions live (Phase 5 consumes). */
  renditionPath: string;
}

// ---- the site dictionary (settings consolidation, C0) ------------------
// A library's columns are SITE columns: the internal name, what the
// column MEANS (its role) and how it is labelled belong to the site, not
// to each library that happens to carry it. Holding them per library
// meant three hand-kept copies free to disagree, and left the register
// unable to say what a column means when more than one library is in
// view (docs/leanboard-docs-settings-consolidation-plan.md, F1/F2).
//
// The dictionary is ABSOLUTE (Ben, 2026-08-02): no per-library
// overrides. What stays per library is which of these columns appear in
// its view.

/** One site column, as the whole site presents it. */
export interface SiteColumn {
  /** SharePoint internal name — the identity. */
  internal: string;
  /** Display override; "" = use SharePoint's own title. */
  label: string;
  /** Document-management role ("" = none). */
  role: string;
  /** Offered in the column picker at all. */
  available: boolean;
  /** Term set behind a taxonomy column ("" = not taxonomy / unknown). */
  termSetId: string;
}

/**
 * Colour + glyph per value of one term set (or of one Choice column's
 * choices). Keyed by TERM GUID where there is one — labels rename and
 * collide, and this site already has two distinct "Maintenance" terms —
 * falling back to the exact choice text for Choice columns, which have
 * no GUIDs.
 *
 * `glyph` is deliberately part of the palette: status has to read from
 * glyph and word alone, never colour, so the site vocabulary and its
 * glyph must be configurable together ("" = fall back to the built-in
 * keyword matcher in shared/ui/format).
 */
export interface PaletteEntry {
  color: string;
  glyph: string;
}

export interface TermPalette {
  setId: string;
  setName: string;
  entries: Record<string, PaletteEntry>;
}

/** Everything one SharePoint site's libraries share. */
export interface SiteDictionary {
  columns: SiteColumn[];
  palettes: TermPalette[];
}

export function emptySiteDictionary(): SiteDictionary {
  return { columns: [], palettes: [] };
}

/** App-level docs config (ben_configjson on the "__app__" row). */
export interface AppDocsConfig {
  siteUrl: string;
  termGroupId: string;
  termGroupName: string;
  orgSetId: string;
  orgSetName: string;
  /** siteUrl → that site's shared column mapping and palettes. A map,
   *  so exposing a second site later adds a key rather than a schema. */
  sites: Record<string, SiteDictionary>;
}

export const APP_LIST_ID = "__app__";

const asStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function emptyLibraryConfig(): LibraryConfig {
  return { title: "", columns: [], statusColors: {}, renditionPath: "" };
}

export function emptyAppDocsConfig(): AppDocsConfig {
  return {
    siteUrl: "",
    termGroupId: "",
    termGroupName: "",
    orgSetId: "",
    orgSetName: "",
    sites: {},
  };
}

/** A site key that survives trailing slashes and casing. */
export function siteKey(siteUrl: string): string {
  return siteUrl.trim().replace(/\/$/, "").toLowerCase();
}

/** Tolerant parse — "", garbage or partial JSON never throws. */
export function parseLibraryConfig(raw: string | null | undefined): LibraryConfig {
  const out = emptyLibraryConfig();
  const t = (raw ?? "").trim();
  if (t === "") return out;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    out.title = asStr(o.title);
    out.renditionPath = asStr(o.renditionPath);
    if (Array.isArray(o.columns)) {
      for (const c of o.columns) {
        if (!c || typeof c !== "object") continue;
        const col = c as Record<string, unknown>;
        const internal = asStr(col.internal);
        if (internal === "") continue;
        out.columns.push({
          internal,
          label: asStr(col.label),
          available: col.available !== false,
          inDefault: col.inDefault === true,
          role: asStr(col.role),
          termSetId: asStr(col.termSetId),
        });
      }
    }
    if (o.statusColors && typeof o.statusColors === "object") {
      for (const [k, v] of Object.entries(o.statusColors as Record<string, unknown>)) {
        if (typeof v === "string" && k.trim() !== "" && v.trim() !== "") {
          out.statusColors[k.trim()] = v.trim();
        }
      }
    }
  } catch {
    /* tolerant */
  }
  return out;
}

/** Sparse serialize — defaults are omitted so rows stay small. */
export function serializeLibraryConfig(cfg: LibraryConfig): string {
  const o: Record<string, unknown> = {};
  if (cfg.title !== "") o.title = cfg.title;
  if (cfg.renditionPath !== "") o.renditionPath = cfg.renditionPath;
  const cols = cfg.columns.map((c) => {
    const col: Record<string, unknown> = { internal: c.internal };
    if (c.label !== "") col.label = c.label;
    if (!c.available) col.available = false;
    if (c.inDefault) col.inDefault = true;
    if (c.role !== "") col.role = c.role;
    if (c.termSetId !== "") col.termSetId = c.termSetId;
    return col;
  });
  if (cols.length > 0) o.columns = cols;
  if (Object.keys(cfg.statusColors).length > 0) o.statusColors = cfg.statusColors;
  return JSON.stringify(o);
}

export function parseAppDocsConfig(raw: string | null | undefined): AppDocsConfig {
  const out = emptyAppDocsConfig();
  const t = (raw ?? "").trim();
  if (t === "") return out;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    out.siteUrl = asStr(o.siteUrl).replace(/\/$/, "");
    out.termGroupId = asStr(o.termGroupId);
    out.termGroupName = asStr(o.termGroupName);
    out.orgSetId = asStr(o.orgSetId);
    out.orgSetName = asStr(o.orgSetName);
    if (o.sites && typeof o.sites === "object") {
      for (const [key, val] of Object.entries(o.sites as Record<string, unknown>)) {
        const k = siteKey(key);
        if (k === "" || !val || typeof val !== "object") continue;
        out.sites[k] = parseSiteDictionary(val as Record<string, unknown>);
      }
    }
  } catch {
    /* tolerant */
  }
  return out;
}

function parseSiteDictionary(o: Record<string, unknown>): SiteDictionary {
  const dict = emptySiteDictionary();
  if (Array.isArray(o.columns)) {
    for (const c of o.columns) {
      if (!c || typeof c !== "object") continue;
      const col = c as Record<string, unknown>;
      const internal = asStr(col.internal);
      if (internal === "") continue;
      dict.columns.push({
        internal,
        label: asStr(col.label),
        role: asStr(col.role),
        available: col.available !== false,
        termSetId: asStr(col.termSetId),
      });
    }
  }
  if (Array.isArray(o.palettes)) {
    for (const p of o.palettes) {
      if (!p || typeof p !== "object") continue;
      const pal = p as Record<string, unknown>;
      const setId = asStr(pal.setId);
      if (setId === "") continue;
      const entries: Record<string, PaletteEntry> = {};
      if (pal.entries && typeof pal.entries === "object") {
        for (const [k, v] of Object.entries(pal.entries as Record<string, unknown>)) {
          const key = k.trim();
          if (key === "" || !v || typeof v !== "object") continue;
          const e = v as Record<string, unknown>;
          const color = asStr(e.color);
          const glyph = asStr(e.glyph);
          if (color === "" && glyph === "") continue;
          entries[key] = { color, glyph };
        }
      }
      dict.palettes.push({ setId, setName: asStr(pal.setName), entries });
    }
  }
  return dict;
}

function serializeSiteDictionary(dict: SiteDictionary): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const cols = dict.columns.map((c) => {
    const col: Record<string, unknown> = { internal: c.internal };
    if (c.label !== "") col.label = c.label;
    if (c.role !== "") col.role = c.role;
    if (!c.available) col.available = false;
    if (c.termSetId !== "") col.termSetId = c.termSetId;
    return col;
  });
  if (cols.length > 0) o.columns = cols;
  const pals = dict.palettes.filter((p) => Object.keys(p.entries).length > 0);
  if (pals.length > 0) {
    o.palettes = pals.map((p) => ({
      setId: p.setId,
      ...(p.setName !== "" ? { setName: p.setName } : {}),
      entries: p.entries,
    }));
  }
  return o;
}

export function serializeAppDocsConfig(cfg: AppDocsConfig): string {
  const o: Record<string, unknown> = {};
  if (cfg.siteUrl !== "") o.siteUrl = cfg.siteUrl;
  if (cfg.termGroupId !== "") o.termGroupId = cfg.termGroupId;
  if (cfg.termGroupName !== "") o.termGroupName = cfg.termGroupName;
  if (cfg.orgSetId !== "") o.orgSetId = cfg.orgSetId;
  if (cfg.orgSetName !== "") o.orgSetName = cfg.orgSetName;
  const sites: Record<string, unknown> = {};
  for (const [key, dict] of Object.entries(cfg.sites)) {
    const body = serializeSiteDictionary(dict);
    if (Object.keys(body).length > 0) sites[key] = body;
  }
  if (Object.keys(sites).length > 0) o.sites = sites;
  return JSON.stringify(o);
}

// ---- migration: build the dictionary from what libraries already say ---

/** A column where the libraries disagreed, kept for the Health section
 *  (the migration is silent, so nothing may be lost quietly). */
export interface DictionaryConflict {
  internal: string;
  field: "role" | "label";
  /** Every distinct non-empty value seen, with how many libraries said it. */
  values: { value: string; count: number }[];
  /** What the migration chose. */
  chosen: string;
}

/** Majority wins; a tie resolves to the alphabetically-first value so
 *  the same libraries always migrate to the same answer. */
function pickWinner(values: string[]): { chosen: string; tally: { value: string; count: number }[] } {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === "") continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const tally = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
  return { chosen: tally[0]?.value ?? "", tally };
}

/**
 * Union every library's column config into one site dictionary, and
 * fold each library's statusColors into a palette for the term set
 * behind its status column.
 *
 * Colours arrive keyed by LABEL (that is how they were stored). A label
 * is a valid key for a Choice column and a poor one for taxonomy, so
 * they are carried across as-is here and re-keyed to term GUIDs in C2,
 * where the term store is actually read. Nothing is invented.
 */
export function buildSiteDictionary(
  libraries: { config: LibraryConfig }[]
): { dictionary: SiteDictionary; conflicts: DictionaryConflict[] } {
  const dict = emptySiteDictionary();
  const conflicts: DictionaryConflict[] = [];
  const seen = new Map<string, { roles: string[]; labels: string[]; termSetIds: string[]; available: boolean[] }>();
  const order: string[] = [];
  for (const lib of libraries) {
    for (const c of lib.config.columns) {
      let bucket = seen.get(c.internal);
      if (bucket === undefined) {
        bucket = { roles: [], labels: [], termSetIds: [], available: [] };
        seen.set(c.internal, bucket);
        order.push(c.internal);
      }
      bucket.roles.push(c.role);
      bucket.labels.push(c.label);
      bucket.termSetIds.push(c.termSetId);
      bucket.available.push(c.available);
    }
  }
  for (const internal of order) {
    const b = seen.get(internal)!;
    const role = pickWinner(b.roles);
    const label = pickWinner(b.labels);
    for (const [field, pick] of [["role", role], ["label", label]] as const) {
      if (pick.tally.length > 1) {
        conflicts.push({ internal, field, values: pick.tally, chosen: pick.chosen });
      }
    }
    dict.columns.push({
      internal,
      label: label.chosen,
      role: role.chosen,
      // available is a floor, not a vote: a column any library offered
      // stays offerable, since hiding it is a per-library view decision
      available: b.available.some((a) => a),
      termSetId: pickWinner(b.termSetIds).chosen,
    });
  }
  // status colours → a palette per term set (labels as keys for now)
  const bySet = new Map<string, Record<string, PaletteEntry>>();
  for (const lib of libraries) {
    const statusCol = lib.config.columns.find((c) => c.role === "status");
    const setId = statusCol?.termSetId ?? "";
    const key = setId !== "" ? setId : `choice:${statusCol?.internal ?? ""}`;
    if (statusCol === undefined) continue;
    const entries = bySet.get(key) ?? {};
    for (const [value, color] of Object.entries(lib.config.statusColors)) {
      // first library to colour a value wins; later ones do not overwrite
      entries[value] ??= { color, glyph: "" };
    }
    if (Object.keys(entries).length > 0) bySet.set(key, entries);
  }
  for (const [setId, entries] of bySet) {
    dict.palettes.push({ setId, setName: "", entries });
  }
  return { dictionary: dict, conflicts };
}

/**
 * The dictionary projected back onto one library — today's
 * LibraryConfig shape, so every consumer keeps its interface.
 *
 * The dictionary decides label, role, available and term set; the
 * library decides only which columns its view shows. A dictionary column
 * the library does not carry is dropped (SharePoint is the record); a
 * column the library carries that the dictionary has not heard of is
 * kept, unmapped, so nothing disappears from a view mid-upgrade.
 */
export function resolveLibraryConfig(
  cfg: LibraryConfig,
  dict: SiteDictionary
): LibraryConfig {
  if (dict.columns.length === 0) return cfg;
  const byInternal = new Map(dict.columns.map((c) => [c.internal, c]));
  const columns = cfg.columns.map((c) => {
    const site = byInternal.get(c.internal);
    if (site === undefined) return c;
    return {
      internal: c.internal,
      label: site.label,
      role: site.role,
      available: site.available,
      termSetId: site.termSetId !== "" ? site.termSetId : c.termSetId,
      // the ONE per-library decision
      inDefault: c.inDefault,
    };
  });
  return { ...cfg, columns };
}

/** Colour + glyph for one value of a column, from the site palettes.
 *  `setId` is the column's term set, or "" for a Choice column, in which
 *  case the palette keyed `choice:<internal>` answers. */
export function paletteEntryFor(
  dict: SiteDictionary,
  setId: string,
  internal: string,
  value: string
): PaletteEntry | null {
  const key = setId !== "" ? setId : `choice:${internal}`;
  const pal = dict.palettes.find((p) => p.setId === key);
  return pal?.entries[value.trim()] ?? null;
}

// ---- SharePoint response mapping ---------------------------------------

export interface SpLibrary {
  id: string;
  title: string;
  itemCount: number;
}

/** `_api/web/lists?$filter=BaseTemplate eq 101…` → libraries. */
export function librariesFromLists(raw: unknown): SpLibrary[] {
  const rows = Array.isArray((raw as { value?: unknown[] })?.value)
    ? ((raw as { value: unknown[] }).value as Record<string, unknown>[])
    : [];
  const out: SpLibrary[] = [];
  for (const r of rows) {
    const id = asStr(r.Id);
    if (id === "") continue;
    out.push({
      id,
      title: asStr(r.Title),
      itemCount: typeof r.ItemCount === "number" ? r.ItemCount : 0,
    });
  }
  return out;
}

export interface SpField {
  internal: string;
  title: string;
  type: string;
  choices: string[];
  /** A managed-metadata column: its allowed values live in a term set,
   *  not in the column. Detected from the field type, so a maker never
   *  has to declare it. */
  isTaxonomy: boolean;
  /** The term set behind a taxonomy column, when SharePoint reports it —
   *  this is what makes the colour mapping automatic rather than typed. */
  termSetId: string;
}

/** Field types SharePoint uses for managed metadata (single and multi). */
const TAXONOMY_TYPES = new Set(["TaxonomyFieldType", "TaxonomyFieldTypeMulti"]);

/** A field's term set id, wherever this SharePoint chose to report it:
 *  as a property on the field, or only inside its SchemaXml. */
function termSetOf(r: Record<string, unknown>): string {
  const direct = typeof r.TermSetId === "string" ? r.TermSetId : "";
  if (direct !== "" && !/^0{8}-/.test(direct)) return direct;
  const xml = typeof r.SchemaXml === "string" ? r.SchemaXml : "";
  // SharePoint writes the property either as <Name>TermSetId</Name>
  // followed by <Value>, or as a Name="TermSetId" attribute
  const m =
    /<Name>TermSetId<\/Name>\s*<Value[^>]*>\s*([0-9a-fA-F-]{36})/.exec(xml) ??
    /Name="TermSetId"[^>]*>\s*([0-9a-fA-F-]{36})/.exec(xml);
  return m ? m[1] : "";
}

/** Internal names that carry no user meaning even though not Hidden. */
const FIELD_EXCLUDE = new Set([
  "ContentType",
  "Attachments",
  "Edit",
  "DocIcon",
  "ItemChildCount",
  "FolderChildCount",
  "AppAuthor",
  "AppEditor",
  "ComplianceAssetId",
  "_UIVersionString",
]);

/** `_api/web/lists(guid'…')/fields?$filter=Hidden eq false` → columns. */
export function fieldsFromResponse(raw: unknown): SpField[] {
  const rows = Array.isArray((raw as { value?: unknown[] })?.value)
    ? ((raw as { value: unknown[] }).value as Record<string, unknown>[])
    : [];
  const out: SpField[] = [];
  for (const r of rows) {
    const internal = asStr(r.InternalName);
    if (internal === "" || internal.startsWith("_") || FIELD_EXCLUDE.has(internal)) continue;
    if (r.Hidden === true) continue;
    const choices = Array.isArray(r.Choices)
      ? (r.Choices as unknown[]).map(asStr).filter((c) => c !== "")
      : Array.isArray((r.Choices as { results?: unknown[] })?.results)
        ? ((r.Choices as { results: unknown[] }).results as unknown[])
            .map(asStr)
            .filter((c) => c !== "")
        : [];
    const type = asStr(r.TypeAsString);
    out.push({
      internal,
      title: asStr(r.Title) || internal,
      type,
      choices,
      isTaxonomy: TAXONOMY_TYPES.has(type),
      termSetId: TAXONOMY_TYPES.has(type) ? termSetOf(r) : "",
    });
  }
  return out;
}

/** Merge live SharePoint fields with stored column config: stored order
 *  and settings win; new fields append as available/non-default; stored
 *  entries whose field vanished are dropped (SharePoint is the record). */
export function mergeColumns(stored: ColumnConfig[], live: SpField[]): ColumnConfig[] {
  const liveByName = new Map(live.map((f) => [f.internal, f]));
  const out: ColumnConfig[] = [];
  for (const c of stored) {
    const f = liveByName.get(c.internal);
    if (f !== undefined) {
      // the live schema wins on termSetId (SharePoint is the record);
      // keep the stored value only when the live read could not see one
      out.push({ ...c, termSetId: f.termSetId !== "" ? f.termSetId : c.termSetId });
      liveByName.delete(c.internal);
    }
  }
  for (const f of liveByName.values()) {
    out.push({
      internal: f.internal,
      label: "",
      available: true,
      inDefault: false,
      role: "",
      termSetId: f.termSetId,
    });
  }
  return out;
}

/** The spec's column table, by internal name — exact matches fill a
 *  role the super admin has not set. Suggestion only: an assigned role
 *  is never overwritten, and any name can be re-mapped by hand. */
const ROLE_BY_INTERNAL: Record<string, string> = {
  DMSDocumentID: "documentId",
  DMSDocumentType: "docType",
  DMSOwner: "owner",
  DMSApprovers: "approvers",
  DMSReviewers: "reviewers",
  DMSImportance: "importance",
  DMSStatus: "status",
  DMSEffectiveDate: "effectiveDate",
  DMSNextReviewDate: "nextReviewDate",
  DMSRegulatorApproved: "regulatorApproved",
  DMSRegulatorReturnedPDF: "regulatorPdf",
  DMSTags: "tags",
  DMSOrgUnit: "orgUnit",
  DMSProcess: "process",
  DMSManagementProcess: "managementProcess",
  DMSLinkedDocuments: "linkedDocuments",
  DMSPriorNames: "priorNames",
  DMSPriorID: "priorIds",
  DMSDistributionAudience: "distribution",
  DMSAcknowledgementRequired: "ackRequired",
  DMSReviewCadenceMonths: "reviewCadence",
  DMSRetainUntil: "retainUntil",
};

export function suggestRoles(cols: ColumnConfig[]): ColumnConfig[] {
  return cols.map((c) =>
    c.role === "" && ROLE_BY_INTERNAL[c.internal] !== undefined
      ? { ...c, role: ROLE_BY_INTERNAL[c.internal] }
      : c
  );
}

/** One library's live schema, for the dictionary sync. */
export interface LibrarySchema {
  listId: string;
  /** Display name, for "carried by" in the settings table. */
  name: string;
  fields: SpField[];
}

/**
 * Reconcile the site dictionary with what SharePoint actually reports
 * across EVERY exposed library — the dictionary's equivalent of
 * mergeColumns. Stored entries win on label and role (someone chose
 * them); the live schema wins on term set (SharePoint is the record);
 * columns no library carries any more are dropped; new ones append with
 * a suggested role.
 *
 * Also answers which libraries carry each column, so the settings table
 * can say "in 2 of 3 libraries" — the quiet way a missing column in one
 * library becomes visible.
 */
export function syncSiteDictionary(
  dict: SiteDictionary,
  schemas: LibrarySchema[]
): { dictionary: SiteDictionary; carriers: Map<string, string[]> } {
  const carriers = new Map<string, string[]>();
  const liveByName = new Map<string, SpField>();
  for (const s of schemas) {
    for (const f of s.fields) {
      liveByName.set(f.internal, f);
      const who = carriers.get(f.internal) ?? [];
      who.push(s.name);
      carriers.set(f.internal, who);
    }
  }
  const out: SiteColumn[] = [];
  const taken = new Set<string>();
  for (const c of dict.columns) {
    const f = liveByName.get(c.internal);
    if (f === undefined) continue; // no library carries it any more
    taken.add(c.internal);
    out.push({ ...c, termSetId: f.termSetId !== "" ? f.termSetId : c.termSetId });
  }
  for (const [internal, f] of liveByName) {
    if (taken.has(internal)) continue;
    out.push({
      internal,
      label: "",
      role: ROLE_BY_INTERNAL[internal] ?? "",
      available: true,
      termSetId: f.termSetId,
    });
  }
  return { dictionary: { ...dict, columns: out }, carriers };
}

/** The spec's core register view, seeded from column roles when a
 *  library has no default ticks at all (first configure, or a type
 *  change before anyone chose columns): document type, owner, status —
 *  plus the effective date for standards and records ("date of approval
 *  / addition"). Working documents lean on the built-in Modified column
 *  the list appends anyway. Never touches a config someone has ticked. */
export function seedDefaultColumns(cfg: LibraryConfig, libType: string): LibraryConfig {
  if (cfg.columns.some((c) => c.inDefault)) return cfg;
  const roles = new Set(["docType", "owner", "status"]);
  if (libType === "standard" || libType === "record") roles.add("effectiveDate");
  return {
    ...cfg,
    columns: cfg.columns.map((c) =>
      roles.has(c.role) ? { ...c, inDefault: true } : c
    ),
  };
}

// ---- org ↔ term set drift ----------------------------------------------

export interface DriftReport {
  onlyApp: string[][];
  onlyTerms: string[][];
  matched: number;
}

/** Compare the LeanBoard org tree (paths of [site, department, area…])
 *  with Organisation term-set paths, case-insensitively by label.
 *  `termOffset` skips leading term levels (a 4-level company→site→…
 *  set compares from level 1 against a site-rooted app tree). */
export function orgDrift(
  appPaths: string[][],
  termPaths: string[][],
  termOffset = 0
): DriftReport {
  const norm = (p: string[]) => p.map((s) => s.trim().toLowerCase()).join("¦");
  const terms = new Map<string, string[]>();
  for (const p of termPaths) {
    const sliced = p.slice(termOffset);
    if (sliced.length > 0) terms.set(norm(sliced), sliced);
  }
  const onlyApp: string[][] = [];
  let matched = 0;
  for (const p of appPaths) {
    const key = norm(p);
    if (terms.has(key)) {
      terms.delete(key);
      matched++;
    } else {
      onlyApp.push(p);
    }
  }
  return { onlyApp, onlyTerms: [...terms.values()], matched };
}

/** The org tree flattened to comparable paths (site / dept / area). */
export function orgTreePaths(
  tree: { site: string; departments: { department: string; areas: string[] }[] }[]
): string[][] {
  const out: string[][] = [];
  for (const s of tree) {
    if (s.site === "") continue;
    out.push([s.site]);
    for (const d of s.departments) {
      if (d.department === "") continue;
      out.push([s.site, d.department]);
      for (const a of d.areas) {
        if (a !== "") out.push([s.site, d.department, a]);
      }
    }
  }
  return out;
}
