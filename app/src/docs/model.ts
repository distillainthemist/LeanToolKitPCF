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
  // 5G2: the edit-access GRANT — the authorization; editors-group
  // membership is only the physical ability (the locked 5G principle)
  { key: "revisionEditors", label: "Revision editors" },
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
/** A column's standing for one library type (consolidation Part II):
 *  key absent = hidden there; "on" = available (chooser, dialogs,
 *  filters); "default" = in the default view too. */
export type ColumnTypeState = "on" | "default";

/** The three types that get their own cells. Revision libraries mirror
 *  standard (they hold checked-out copies of standards); template
 *  libraries are fixed (name + modified) and take no cells. */
export type ConfigurableLibType = "standard" | "record" | "working";

export type TypeStates = Partial<Record<ConfigurableLibType, ColumnTypeState>>;

export const CONFIGURABLE_TYPES: ConfigurableLibType[] = ["standard", "record", "working"];

/** Which cell a library's type reads (null = template: fixed view). */
export function effectiveColumnType(libType: string): ConfigurableLibType | null {
  if (libType === "standard" || libType === "revision") return "standard";
  if (libType === "record") return "record";
  if (libType === "working") return "working";
  return null;
}

export interface SiteColumn {
  /** SharePoint internal name — the identity. */
  internal: string;
  /** Display override; "" = use SharePoint's own title. */
  label: string;
  /** Document-management role ("" = none). */
  role: string;
  /** Offered in the column picker at all. LEGACY since Part II —
   *  availability is derived from `types` (hidden everywhere =
   *  unavailable); kept parsed so pre-Part-II payloads migrate. */
  available: boolean;
  /** Term set behind a taxonomy column ("" = not taxonomy / unknown). */
  termSetId: string;
  /** A date column, from the live schema — what makes a from/to filter
   *  possible (Ben, 2026-08-03). */
  isDate: boolean;
  /**
   * Offered in the register's Filters pane. Filterable columns used to
   * be "every taxonomy column", which put sets nobody filters by in the
   * pane and left no way to say so; now the site chooses (Ben). Defaults
   * to true for the columns that CAN filter — taxonomy and dates — so
   * the pane starts where it always was.
   */
  filterable: boolean;
  /** The sub-heading this column sits under (Part II). Groups are
   *  DIALOG furniture (real section headers in the add form, quick
   *  edit and properties pane) and register ORDERING only — a table
   *  cannot render sub-headings. "" = the ungrouped tail. */
  group: string;
  /** Per-type standing (Part II). `undefined` = a dictionary that
   *  predates Part II — run deriveTypeStates over the per-library
   *  configs before resolving; the resolution helpers below expect a
   *  DERIVED dictionary. */
  types?: TypeStates;
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
  /** The term's label when it was configured. Kept beside the GUID key
   *  for two reasons: the settings editor can name a value without a
   *  term-store round trip, and a register that has not yet resolved
   *  labels → GUIDs can still match the row it is painting. */
  label: string;
}

export interface TermPalette {
  setId: string;
  setName: string;
  entries: Record<string, PaletteEntry>;
}

/**
 * The columns a library of each type opens with (C5). Held once for the
 * site so exposing a library and choosing "Controlled records" leaves it
 * configured, instead of every library being ticked out by hand.
 * Internal names, in view order; an absent type falls back to the roles.
 */
export type ViewTemplates = Partial<Record<LibraryType, string[]>>;

/** Everything one SharePoint site's libraries share. */
export interface SiteDictionary {
  columns: SiteColumn[];
  palettes: TermPalette[];
  templates: ViewTemplates;
  /** Ordered sub-headings (Part II). A column may name a group not
   *  listed here (an orphan) — it renders after the listed groups
   *  rather than being dropped. */
  groups: string[];
  /** Status term id → lifecycle stage (Phase 5A). Explicit — the stored
   *  mapping is the law, name suggestions only prefill it — and keyed
   *  by term ID so a rename cannot detach a stage. Optional so the many
   *  places that build dictionaries without a lifecycle stay honest. */
  lifecycle?: Record<string, LifecycleStage>;
}

export function emptySiteDictionary(): SiteDictionary {
  return { columns: [], palettes: [], templates: {}, groups: [] };
}

// ---- Part II resolution (consolidation plan, Ben 2026-08-10) -----------
// The site defines INTENT — which columns matter to which library type,
// in what order, under what headings. The library stays REALITY: feeds
// still intersect with what each list physically carries, and Health
// reports the gap. These helpers expect a DERIVED dictionary (every
// column carrying `types`); run deriveTypeStates first.

const stateFor = (col: SiteColumn, t: ConfigurableLibType): ColumnTypeState | undefined =>
  col.types?.[t];

/** Offered anywhere at all. On a derived dictionary this is the cells'
 *  verdict (hidden everywhere = unavailable); on a pre-Part-II column
 *  the legacy flag still answers, so nothing vanishes mid-migration. */
export function columnOffered(col: SiteColumn): boolean {
  return col.types !== undefined ? Object.keys(col.types).length > 0 : col.available;
}

/** The configurable types a set of libraries actually spans (revision
 *  mirrors standard; template contributes nothing). */
export function configurableTypesIn(libTypes: string[]): ConfigurableLibType[] {
  const out = new Set<ConfigurableLibType>();
  for (const lt of libTypes) {
    const t = effectiveColumnType(lt);
    if (t !== null) out.add(t);
  }
  return CONFIGURABLE_TYPES.filter((t) => out.has(t));
}

/** Ordered internals OFFERED (chooser, filters) for a mix of library
 *  types: any state at all for any type in view. */
export function columnsForTypes(dict: SiteDictionary, libTypes: string[]): string[] {
  const types = configurableTypesIn(libTypes);
  return dict.columns
    .filter((c) => types.some((t) => stateFor(c, t) !== undefined))
    .map((c) => c.internal);
}

/** Ordered internals in the DEFAULT view for a mix of library types:
 *  cells reading "default" for ANY type in view — Ben's cross-filter
 *  rule, with mixed views showing the union. "Modified" stays the
 *  consumer's appended passenger, as today. */
export function defaultColumnsFor(dict: SiteDictionary, libTypes: string[]): string[] {
  const types = configurableTypesIn(libTypes);
  return dict.columns
    .filter((c) => types.some((t) => stateFor(c, t) === "default"))
    .map((c) => c.internal);
}

/** Dialog sections for ONE library: its type's non-hidden columns
 *  under their sub-headings — listed groups first in dict.groups
 *  order, orphan groups after in first-appearance order, the
 *  ungrouped tail last under "" (the caller renders no header for
 *  it). Template libraries take no sections. */
export function dialogSections(
  dict: SiteDictionary,
  libType: string
): { heading: string; columns: string[] }[] {
  const t = effectiveColumnType(libType);
  if (t === null) return [];
  const visible = dict.columns.filter((c) => stateFor(c, t) !== undefined);
  const order: string[] = [...dict.groups];
  for (const c of visible) {
    if (c.group !== "" && !order.includes(c.group)) order.push(c.group);
  }
  const out: { heading: string; columns: string[] }[] = [];
  for (const heading of [...order, ""]) {
    const columns = visible.filter((c) => c.group === heading).map((c) => c.internal);
    if (columns.length > 0) out.push({ heading, columns });
  }
  return out;
}

/**
 * The Part II migration, pure and silent (Part I's rules: read-time
 * derive, deterministic, nothing lost silently — the manager shows
 * what it derived). Only columns WITHOUT `types` are touched. Per
 * column × type, across the libraries of that type (revision counting
 * toward standard): "default" if any ticks inDefault OR the C5 type
 * template lists the column; "on" if any ticks available; else hidden.
 * Union widens, never narrows. With NO library of any configurable
 * type to learn from, a legacy-available column reads "on" for all
 * three — nothing vanishes for lack of evidence.
 */
export function deriveTypeStates(
  dict: SiteDictionary,
  libraries: { libType: string; config: { columns: ColumnConfig[] } }[]
): SiteDictionary {
  if (dict.columns.every((c) => c.types !== undefined)) return dict;
  const byType = new Map<ConfigurableLibType, { columns: ColumnConfig[] }[]>();
  for (const t of CONFIGURABLE_TYPES) byType.set(t, []);
  let anyLib = false;
  for (const lib of libraries) {
    const t = effectiveColumnType(lib.libType);
    if (t === null) continue;
    anyLib = true;
    byType.get(t)!.push(lib.config);
  }
  const columns = dict.columns.map((c) => {
    if (c.types !== undefined) return c;
    const types: TypeStates = {};
    for (const t of CONFIGURABLE_TYPES) {
      const configs = byType.get(t)!;
      const inTemplate = (dict.templates[t] ?? []).includes(c.internal);
      const matches = configs.flatMap((cfg) =>
        cfg.columns.filter((x) => x.internal === c.internal)
      );
      if (inTemplate || matches.some((x) => x.inDefault)) types[t] = "default";
      else if (matches.some((x) => x.available)) types[t] = "on";
    }
    if (!anyLib && c.available) {
      for (const t of CONFIGURABLE_TYPES) types[t] = "on";
    }
    return { ...c, types };
  });
  return { ...dict, columns };
}

// ---- lifecycle (Phase 5A) ----------------------------------------------
// The approval engine's vocabulary. Seven stages, fixed: commands move a
// document BETWEEN stages; which term expresses a stage is this site's
// choice, made once in Settings → Documents → Lifecycle.

export type LifecycleStage =
  | "draft"
  | "inReview"
  | "inApproval"
  | "inOwnerApproval"
  | "approved"
  | "superseded"
  | "obsolete";

export const LIFECYCLE_STAGES: { key: LifecycleStage; label: string }[] = [
  { key: "draft", label: "Draft" },
  // two distinct circulations (Ben, 2026-08-04): review is CONTENT work
  // — reviewers reviewing and editing — approval is SIGN-OFF. Approval
  // itself is TWO steps: named approvers endorse first, then the owner
  // gives the final word (a distinct stage, so it is queryable — the
  // site adds a term like "Awaiting Owner Approval" for it).
  { key: "inReview", label: "In review" },
  { key: "inApproval", label: "Awaiting approval" },
  { key: "inOwnerApproval", label: "Awaiting owner approval" },
  { key: "approved", label: "Approved" },
  { key: "superseded", label: "Superseded" },
  { key: "obsolete", label: "Obsolete" },
];

const STAGE_KEYS = new Set(LIFECYCLE_STAGES.map((s) => s.key));

/**
 * The stage a term's NAME suggests — the same vocabulary the register's
 * "Show only Approved" filter has matched since v0.28.0
 * (isNonCurrentStatus), so the prefill and the filter can never
 * disagree about what a term sounds like. "" = no opinion; the admin
 * decides in settings.
 */
export function suggestStageForLabel(label: string): LifecycleStage | "" {
  const l = label.trim().toLowerCase();
  if (l === "") return "";
  if (/\bsuperseded\b/.test(l)) return "superseded";
  if (/\b(obsolete|retired)\b/.test(l)) return "obsolete";
  // "approval" (word-bounded, so never "approved") outranks the review
  // check: "Awaiting Approval" is sign-off, "Awaiting Review" is not —
  // and "owner" alongside it is the final-sign-off stage
  if (/\bowner\b/.test(l) && /\bapproval\b/.test(l)) return "inOwnerApproval";
  if (/\bapproval\b/.test(l)) return "inApproval";
  if (/\b(in review|awaiting|review)\b/.test(l)) return "inReview";
  if (/\bdraft\b/.test(l)) return "draft";
  if (/\b(approved|current)\b/.test(l)) return "approved";
  return "";
}

/** The stage a term is mapped to ("" = unmapped). */
export function stageOfTerm(dict: SiteDictionary, termId: string): LifecycleStage | "" {
  const stage = (dict.lifecycle ?? {})[termId.trim().toLowerCase()];
  return stage !== undefined && STAGE_KEYS.has(stage) ? stage : "";
}

/** Every term id mapped to a stage — what a command writes (first) and
 *  what a stage-scoped query matches (all). */
export function termsForStage(dict: SiteDictionary, stage: LifecycleStage): string[] {
  return Object.entries(dict.lifecycle ?? {})
    .filter(([, s]) => s === stage)
    .map(([id]) => id);
}

// ---- lifecycle commands (Phase 5B, retirement 5D) -----------------------
// The moves between the stages. Pure: WHICH commands a document offers
// is decided here from its stage and the acting user's standing; the
// screen only paints and the write layer only executes.

export type LifecycleCommandKey =
  | "submitReview"
  | "submitApproval"
  | "approve"
  | "requestRevision"
  | "revise"
  | "markSuperseded"
  | "markObsolete"
  | "reinstate";

export interface LifecycleCommandDef {
  key: LifecycleCommandKey;
  label: string;
  /** The stage the command moves the document TO. */
  to: LifecycleStage;
  /** Approve is the one MAJOR check-in — the version an auditor reads. */
  major: boolean;
  /** The default check-in comment; a typed reason appends to it. */
  comment: string;
  /** requestRevision demands its reason — a rejection that explains
   *  nothing teaches nothing. */
  needsReason: boolean;
  /** Rendered as the primary (filled) button. */
  primary: boolean;
  /** Start revision only: the status write stays inside the check-out
   *  and NOTHING is checked in — drafting is solo, and everyone else
   *  keeps seeing the approved version until a submit checks in
   *  (Ben, 2026-08-04). Discarding the check-out reverts everything. */
  staysCheckedOut?: boolean;
}

export const LIFECYCLE_COMMANDS: LifecycleCommandDef[] = [
  {
    key: "submitReview",
    label: "Submit for review",
    to: "inReview",
    major: false,
    comment: "Submitted for review",
    needsReason: false,
    primary: true,
  },
  {
    key: "submitApproval",
    label: "Submit for approval",
    to: "inApproval",
    major: false,
    comment: "Submitted for approval",
    needsReason: false,
    primary: true,
  },
  {
    key: "approve",
    label: "Approve",
    to: "approved",
    major: true,
    comment: "Approved",
    needsReason: false,
    primary: true,
  },
  {
    key: "requestRevision",
    label: "Request revision",
    to: "draft",
    major: false,
    comment: "Revision requested",
    needsReason: true,
    primary: false,
  },
  {
    // the road back into work: an APPROVED standard re-enters draft to
    // begin its next version (Ben, 2026-08-04 — "how do I initiate a
    // version update?"). Checks OUT to the reviser and stays that way:
    // the draft status and every edit live inside the check-out, others
    // keep seeing the approved version, and Discard check-out reverts
    // the lot. The approved majors stay in history.
    key: "revise",
    label: "Start revision",
    to: "draft",
    major: false,
    comment: "Revision started",
    needsReason: false,
    primary: false,
    staysCheckedOut: true,
  },
  {
    // retirement (5D): superseded = replaced by another document — the
    // reason NAMES the successor, which is the whole audit trail v1
    // keeps (no linked-documents column yet)
    key: "markSuperseded",
    label: "Mark superseded",
    to: "superseded",
    major: false,
    comment: "Superseded",
    needsReason: true,
    primary: false,
  },
  {
    key: "markObsolete",
    label: "Mark obsolete",
    to: "obsolete",
    major: false,
    comment: "Marked obsolete",
    needsReason: true,
    primary: false,
  },
  {
    // the mistake-recovery road back: retirement is minor check-ins all
    // the way, so the approved MAJOR was never disturbed — reinstating
    // is a status write, not a re-approval
    key: "reinstate",
    label: "Reinstate",
    to: "approved",
    major: false,
    comment: "Reinstated",
    needsReason: true,
    primary: false,
  },
];

export interface LifecycleGates {
  /** The acting user is named in the approvers column. */
  isApprover: boolean;
  /** The document names an approver OTHER than the owner. The owner's
   *  sign-off is already the mandatory last step, so an owner listed as
   *  their own (sole) approver adds no second step — only an OUTSIDE
   *  approver creates the endorse round (Ben, 2026-08-04). */
  hasApprovers: boolean;
  /** The document names ANY reviewer — which makes the review round
   *  MANDATORY before approval (Ben, 2026-08-04). */
  hasReviewers: boolean;
  /** The acting user is the owner. */
  isOwner: boolean;
  /** Site or super admin — the fallback that prevents deadlock. */
  isAdmin: boolean;
  /** Named in the Revision editors column (5G3): a granted outsider
   *  who may DRIVE one revision — start it, check out, edit, submit —
   *  but never approve and never retire. */
  isEditor: boolean;
}

/**
 * The commands a document at `stage` offers this user (Ben, 2026-08-04,
 * the settled workflow):
 * - review is MANDATORY before approval when the document names
 *   reviewers — a draft with reviewers cannot skip to approval;
 * - approval is TWO steps when approvers are named: their endorsement
 *   (minor) moves it to the owner, whose Approve is the one MAJOR
 *   check-in; with no approvers named, submission goes straight to the
 *   owner's stage;
 * - admins can stand in at either approval step (deadlock-breaker);
 * - starting the next revision of an approved document is as gated as
 *   approving it was;
 * - retirement (5D): the owner or an admin marks an approved document
 *   superseded (the reason names the successor) or obsolete, and can
 *   reinstate either — all minor status writes, the approved major
 *   stays untouched in history.
 * Submissions are otherwise open to anyone who can write — SharePoint's
 * permissions are the real gate there. Returned defs are CLONES with
 * `to`/`major` resolved for this context; run them as given.
 */
export function lifecycleCommandsFor(
  stage: LifecycleStage | "",
  g: LifecycleGates
): LifecycleCommandDef[] {
  const by = (
    k: LifecycleCommandKey,
    over: Partial<LifecycleCommandDef> = {}
  ): LifecycleCommandDef => ({ ...LIFECYCLE_COMMANDS.find((c) => c.key === k)!, ...over });
  // where a submission for approval lands: the approvers' step when any
  // are named, else directly at the owner's
  const approvalEntry: LifecycleStage = g.hasApprovers ? "inApproval" : "inOwnerApproval";
  // with no approvers named the submission lands at the OWNER — say so
  // on the button, or "for approval" promises a round that won't happen
  const submitApproval = by("submitApproval", {
    to: approvalEntry,
    ...(g.hasApprovers ? {} : { label: "Submit for owner approval" }),
  });
  switch (stage) {
    case "draft":
      return g.hasReviewers
        ? [by("submitReview")]
        : [by("submitReview"), submitApproval];
    case "inReview":
      return [submitApproval, by("requestRevision")];
    case "inApproval":
      // the approvers' step: an endorsement, minor — the owner's word
      // is the major
      return g.isApprover || g.isAdmin
        ? [by("approve", { to: "inOwnerApproval", major: false }), by("requestRevision")]
        : [by("requestRevision")];
    case "inOwnerApproval":
      return g.isOwner || g.isAdmin
        ? [by("approve"), by("requestRevision")]
        : [by("requestRevision")];
    case "approved": {
      // revision is open to anyone gated into approval — and to a
      // granted revision editor (5G3), which is the whole point of the
      // grant; RETIRING a document is the owner's call (or an admin's)
      // — approvers endorse content, they don't decide a document's
      // end of life
      const out: LifecycleCommandDef[] = [];
      if (g.isOwner || g.isApprover || g.isAdmin || g.isEditor) out.push(by("revise"));
      if (g.isOwner || g.isAdmin) out.push(by("markSuperseded"), by("markObsolete"));
      return out;
    }
    case "superseded":
    case "obsolete":
      // retirement's undo (5D): the approved major is intact underneath
      return g.isOwner || g.isAdmin ? [by("reinstate")] : [];
    default:
      return []; // unmapped
  }
}

/** The TERM a command writes for its target stage: the first mapped
 *  term that actually exists in the set (label + id — the connector's
 *  term object needs both). Null = the stage is unmapped, and the
 *  command must not be offered. */
export function termForStage(
  dict: SiteDictionary,
  stage: LifecycleStage,
  terms: { id: string; label: string }[]
): { id: string; label: string } | null {
  const mapped = new Set(termsForStage(dict, stage));
  const hit = terms.find((t) => mapped.has(t.id.trim().toLowerCase()));
  return hit ?? null;
}

/**
 * The findings the Lifecycle section reports into Health: terms with no
 * stage (a command cannot move what it cannot name), and a mapping with
 * no approved stage at all (the register's approval filter would show
 * nothing). Pure; the settings tab paints it.
 */
export function lifecycleHealth(
  dict: SiteDictionary,
  statusTerms: { id: string; label: string }[]
): HealthFinding[] {
  if (statusTerms.length === 0) return [];
  const out: HealthFinding[] = [];
  const unmapped = statusTerms.filter((t) => stageOfTerm(dict, t.id) === "");
  if (unmapped.length > 0) {
    out.push({
      level: "warn",
      title: `${unmapped.length} status term${unmapped.length === 1 ? "" : "s"} without a lifecycle stage`,
      detail:
        `${unmapped.map((t) => t.label).join(", ")} — map them under Lifecycle, or the ` +
        "approval commands cannot move documents there.",
    });
  }
  // every stage the WORKFLOW moves through needs a term, or the command
  // that targets it is silently withheld — "no Approve button" with no
  // explanation anywhere (Ben, 2026-08-04). The approval road warns;
  // retirement (superseded/obsolete, 5D) is optional, so its gaps are
  // info — visible, not nagging.
  if (Object.keys(dict.lifecycle ?? {}).length > 0) {
    const demanded = new Set<LifecycleStage>([
      "draft",
      "inReview",
      "inApproval",
      "inOwnerApproval",
      "approved",
    ]);
    for (const { key: stage, label } of LIFECYCLE_STAGES) {
      if (statusTerms.some((t) => stageOfTerm(dict, t.id) === stage)) continue;
      out.push({
        level: demanded.has(stage) ? "warn" : "info",
        title: `No status term is mapped as ${label}`,
        detail:
          `Commands that move documents to “${label}” are withheld until a term maps ` +
          "to it — add the term to the status set if needed, then map it under Lifecycle.",
      });
    }
  }
  return out;
}

/** App-level docs config (ben_configjson on the "__app__" row). */
export interface AppDocsConfig {
  siteUrl: string;
  termGroupId: string;
  termGroupName: string;
  orgSetId: string;
  orgSetName: string;
  /** The 5G access-model groups (Ben, 2026-08-05), all plain Entra
   *  security groups, each carrying its SharePoint permission level.
   *  "" = not configured. Controllers = full document admin;
   *  owners/approvers = the ELIGIBILITY POOL the owner/approver/
   *  reviewer pickers select from (rights on a document come from
   *  being NAMED on it); editors = the TEMPORARY group people join
   *  while an approved edit-access grant is live. */
  controllersGroupId: string;
  controllersGroupName: string;
  ownersGroupId: string;
  ownersGroupName: string;
  editorsGroupId: string;
  editorsGroupName: string;
  /** The SHAREPOINT site group grants enforce through (5G3b) — its
   *  membership takes effect immediately, unlike an Entra group's
   *  claim-cached one. Named, not id'd: names are what the sitegroups
   *  REST resolves and what an admin reads in SharePoint. */
  spEditorsGroup: string;
  /** The upload STAGING library's title (5H2) — bytes cannot cross the
   *  connector, so uploads happen in SharePoint's own UI here, and the
   *  app copies server-side into the target. Never exposed in the nav;
   *  "" = upload-add not offered. */
  stagingLibrary: string;
  /** siteUrl → that site's shared column mapping and palettes. A map,
   *  so exposing a second site later adds a key rather than a schema. */
  sites: Record<string, SiteDictionary>;
}

export const APP_LIST_ID = "__app__";
/** The access-requests ledger row (5G2) — same table, NOT a library. */
export const REQUESTS_LIST_ID = "__requests__";
/** Rows in the doc-libraries table that are storage, not libraries —
 *  every library read must skip them (the ledger painted as a
 *  "library" called Access requests ledger, Ben 2026-08-06). */
export const RESERVED_LIST_IDS = new Set([APP_LIST_ID, REQUESTS_LIST_ID]);

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
    controllersGroupId: "",
    controllersGroupName: "",
    ownersGroupId: "",
    ownersGroupName: "",
    editorsGroupId: "",
    editorsGroupName: "",
    spEditorsGroup: "",
    stagingLibrary: "",
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
    out.controllersGroupId = asStr(o.controllersGroupId);
    out.controllersGroupName = asStr(o.controllersGroupName);
    out.ownersGroupId = asStr(o.ownersGroupId);
    out.ownersGroupName = asStr(o.ownersGroupName);
    out.editorsGroupId = asStr(o.editorsGroupId);
    out.editorsGroupName = asStr(o.editorsGroupName);
    out.spEditorsGroup = asStr(o.spEditorsGroup);
    out.stagingLibrary = asStr(o.stagingLibrary);
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
      // per-type states (Part II): only known types and known states
      // survive the parse; an empty object reads as undefined so a
      // pre-Part-II payload still triggers the migration derive
      let types: TypeStates | undefined;
      if (col.types && typeof col.types === "object") {
        const t: TypeStates = {};
        for (const key of CONFIGURABLE_TYPES) {
          const v = (col.types as Record<string, unknown>)[key];
          if (v === "on" || v === "default") t[key] = v;
        }
        if (Object.keys(t).length > 0) types = t;
      }
      dict.columns.push({
        internal,
        label: asStr(col.label),
        role: asStr(col.role),
        available: col.available !== false,
        termSetId: asStr(col.termSetId),
        isDate: col.isDate === true,
        filterable: col.filterable !== false,
        group: asStr(col.group),
        ...(types !== undefined ? { types } : {}),
      });
    }
  }
  if (Array.isArray(o.groups)) {
    dict.groups = o.groups.map(asStr).filter((g) => g !== "");
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
          entries[key] = { color, glyph, label: asStr(e.label) };
        }
      }
      dict.palettes.push({ setId, setName: asStr(pal.setName), entries });
    }
  }
  if (o.templates && typeof o.templates === "object") {
    for (const [type, list] of Object.entries(o.templates as Record<string, unknown>)) {
      if (!LIBRARY_TYPES.some((t) => t.key === type) || !Array.isArray(list)) continue;
      const internals = list.map(asStr).filter((v) => v !== "");
      if (internals.length > 0) dict.templates[type as LibraryType] = internals;
    }
  }
  if (o.lifecycle && typeof o.lifecycle === "object") {
    const lifecycle: Record<string, LifecycleStage> = {};
    for (const [id, stage] of Object.entries(o.lifecycle as Record<string, unknown>)) {
      const key = id.trim().toLowerCase();
      const s = asStr(stage) as LifecycleStage;
      if (key !== "" && LIFECYCLE_STAGES.some((x) => x.key === s)) lifecycle[key] = s;
    }
    if (Object.keys(lifecycle).length > 0) dict.lifecycle = lifecycle;
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
    if (c.isDate) col.isDate = true;
    if (!c.filterable) col.filterable = false;
    if (c.group !== "") col.group = c.group;
    if (c.types !== undefined && Object.keys(c.types).length > 0) col.types = c.types;
    return col;
  });
  if (cols.length > 0) o.columns = cols;
  if (dict.groups.length > 0) o.groups = dict.groups;
  const pals = dict.palettes.filter((p) => Object.keys(p.entries).length > 0);
  if (pals.length > 0) {
    o.palettes = pals.map((p) => ({
      setId: p.setId,
      ...(p.setName !== "" ? { setName: p.setName } : {}),
      entries: p.entries,
    }));
  }
  const templates: Record<string, string[]> = {};
  for (const [type, list] of Object.entries(dict.templates)) {
    if (Array.isArray(list) && list.length > 0) templates[type] = list;
  }
  if (Object.keys(templates).length > 0) o.templates = templates;
  if (dict.lifecycle !== undefined && Object.keys(dict.lifecycle).length > 0) {
    o.lifecycle = dict.lifecycle;
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
  if (cfg.controllersGroupId !== "") o.controllersGroupId = cfg.controllersGroupId;
  if (cfg.controllersGroupName !== "") o.controllersGroupName = cfg.controllersGroupName;
  if (cfg.ownersGroupId !== "") o.ownersGroupId = cfg.ownersGroupId;
  if (cfg.ownersGroupName !== "") o.ownersGroupName = cfg.ownersGroupName;
  if (cfg.editorsGroupId !== "") o.editorsGroupId = cfg.editorsGroupId;
  if (cfg.editorsGroupName !== "") o.editorsGroupName = cfg.editorsGroupName;
  if (cfg.spEditorsGroup !== "") o.spEditorsGroup = cfg.spEditorsGroup;
  if (cfg.stagingLibrary !== "") o.stagingLibrary = cfg.stagingLibrary;
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
      // the old per-library config knew nothing of either; the live
      // schema fills isDate on the next settings visit
      isDate: false,
      filterable: true,
      // ungrouped; Part II's deriveTypeStates fills the type cells
      group: "",
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
      // first library to colour a value wins; later ones do not overwrite.
      // The key is the LABEL, because that is how colours were stored —
      // C2 re-keys to term GUIDs once the term store has been read, and
      // the label rides along so the lookup works either way.
      entries[value] ??= { color, glyph: "", label: value };
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

/** The palette a column draws on: its term set, or — for a Choice
 *  column, which has no GUIDs — one keyed by the column itself. */
export function paletteKeyFor(setId: string, internal: string): string {
  return setId !== "" ? setId : `choice:${internal}`;
}

export function paletteFor(
  dict: SiteDictionary,
  setId: string,
  internal: string
): TermPalette | null {
  const key = paletteKeyFor(setId, internal);
  return dict.palettes.find((p) => p.setId === key) ?? null;
}

/**
 * Colour + glyph for one value of a column.
 *
 * The register paints LABELS ("Approved") while a taxonomy palette is
 * keyed by term GUID, so the lookup bridges the two: an exact key hit
 * first (a Choice value, or a GUID handed in directly), then the
 * label → GUID map when the term store has been read, and finally the
 * label stored beside the entry. That last step is what keeps colours
 * painting before — or without — a term-store round trip.
 */
export function paletteEntryFor(
  dict: SiteDictionary,
  setId: string,
  internal: string,
  value: string,
  labelToId?: Map<string, string>
): PaletteEntry | null {
  const pal = paletteFor(dict, setId, internal);
  if (pal === null) return null;
  const v = value.trim();
  if (v === "") return null;
  const direct = pal.entries[v];
  if (direct !== undefined) return direct;
  const id = labelToId?.get(v.toLowerCase());
  if (id !== undefined && pal.entries[id] !== undefined) return pal.entries[id];
  const lower = v.toLowerCase();
  for (const e of Object.values(pal.entries)) {
    if (e.label !== "" && e.label.trim().toLowerCase() === lower) return e;
  }
  return null;
}

/** The columns worth colouring, grouped by the palette they share —
 *  what the settings editor lists. Two columns on the same term set are
 *  one palette, which is the whole point of doing this once. */
export interface ColourableSet {
  /** Palette key (term set id, or choice:<internal>). */
  key: string;
  /** "" for a Choice column. */
  setId: string;
  /** Every dictionary column that draws on it. */
  columns: SiteColumn[];
}

/**
 * Re-key one palette from labels to term GUIDs, now that the term store
 * has been read. Colours migrated from the old per-library maps arrive
 * keyed by label — fine for a Choice column, brittle for taxonomy,
 * where a rename detaches the colour and two sets can share a label
 * (this site has two distinct "Maintenance" terms). Entries whose label
 * matches no term are left exactly as they are: they may belong to a
 * value the column no longer offers, which is Health's business to
 * report, not this function's to delete.
 */
export function rekeyPaletteToTerms(
  pal: TermPalette,
  terms: { id: string; label: string }[]
): TermPalette {
  const byLabel = new Map(terms.map((t) => [t.label.trim().toLowerCase(), t.id]));
  const entries: Record<string, PaletteEntry> = {};
  for (const [key, entry] of Object.entries(pal.entries)) {
    const isId = byLabel.has(key.trim().toLowerCase()) === false && /^[0-9a-f-]{36}$/i.test(key);
    if (isId) {
      entries[key] = entry;
      continue;
    }
    const id = byLabel.get(key.trim().toLowerCase());
    if (id === undefined) {
      entries[key] = entry; // no such term — keep, do not guess
      continue;
    }
    entries[id] = { ...entry, label: entry.label !== "" ? entry.label : key };
  }
  return { ...pal, entries };
}

export function colourableSets(dict: SiteDictionary): ColourableSet[] {
  const out = new Map<string, ColourableSet>();
  for (const c of dict.columns) {
    if (!c.available) continue;
    // a column with no term set is colourable only if it is a Choice
    // column, and only the live schema knows that — the caller filters
    // those in; here, a term set is the qualifier
    if (c.termSetId === "") continue;
    const key = paletteKeyFor(c.termSetId, c.internal);
    const hit = out.get(key);
    if (hit) hit.columns.push(c);
    else out.set(key, { key, setId: c.termSetId, columns: [c] });
  }
  return [...out.values()];
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
  /** SharePoint's own Required flag — what the add-a-document form
   *  enforces before submit (Phase 4C). */
  required: boolean;
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
      required: r.Required === true,
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
    out.push({
      ...c,
      termSetId: f.termSetId !== "" ? f.termSetId : c.termSetId,
      isDate: isDateField(f),
    });
  }
  for (const [internal, f] of liveByName) {
    if (taken.has(internal)) continue;
    out.push({
      internal,
      label: "",
      role: ROLE_BY_INTERNAL[internal] ?? "",
      available: true,
      termSetId: f.termSetId,
      isDate: isDateField(f),
      // a column that cannot filter is not offered as one
      filterable: f.termSetId !== "" || isDateField(f),
      // a NEW live-schema column arrives ungrouped and typeless — the
      // manager is where it gets its standing (deriveTypeStates only
      // fills columns on dictionaries that predate Part II)
      group: "",
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
  const roles = new Set(rolesForType(libType));
  return {
    ...cfg,
    columns: cfg.columns.map((c) =>
      roles.has(c.role) ? { ...c, inDefault: true } : c
    ),
  };
}

/** The roles a type's register opens with, absent a template. */
function rolesForType(libType: string): string[] {
  const roles = ["docType", "owner", "status"];
  if (libType === "standard" || libType === "record") roles.push("effectiveDate");
  return roles;
}

/**
 * A type's view template (C5): what was configured for it, or — when
 * nothing has been — the columns its roles imply, in dictionary order.
 * Returning the implied set rather than nothing is what lets the editor
 * show a type's starting point without first making someone invent one.
 */
export function templateFor(dict: SiteDictionary, libType: LibraryType): string[] {
  const stored = dict.templates[libType];
  if (stored !== undefined && stored.length > 0) {
    // a template naming a column the site dropped would silently tick
    // nothing, so it is filtered against the dictionary on the way out
    const known = new Set(dict.columns.filter((c) => c.available).map((c) => c.internal));
    const kept = stored.filter((i) => i === "Modified" || known.has(i));
    if (kept.length > 0) return kept;
  }
  const roles = new Set(rolesForType(libType));
  return dict.columns.filter((c) => c.available && roles.has(c.role)).map((c) => c.internal);
}

/**
 * Set a library's view to exactly these columns. Unlike
 * seedDefaultColumns this REPLACES the ticks — it runs when someone
 * applies a template on purpose, so leaving old ticks behind would make
 * the result neither the template nor what was there before.
 */
export function applyViewTemplate(cfg: LibraryConfig, internals: string[]): LibraryConfig {
  const want = new Set(internals);
  return {
    ...cfg,
    columns: cfg.columns.map((c) => ({ ...c, inDefault: want.has(c.internal) })),
  };
}

/** Does this library already open with exactly the template's columns?
 *  Order is a view detail; membership is what "matches" means here. */
export function matchesTemplate(cfg: LibraryConfig, internals: string[]): boolean {
  const want = new Set(internals.filter((i) => i !== "Modified"));
  const have = new Set(cfg.columns.filter((c) => c.inDefault).map((c) => c.internal));
  if (want.size !== have.size) return false;
  for (const i of want) if (!have.has(i)) return false;
  return true;
}

// ---- configuration health (C4) -----------------------------------------
// The consolidation makes divergence FINDABLE, which only helps if
// something looks. These checks answer the questions the old per-library
// settings could not even ask: is a role mapped twice, or not at all; is
// a column missing from one library; is a colour attached to a value its
// column no longer offers; and what did the silent migration decide on
// its own. Pure, so the settings tab only has to paint them.

export interface HealthFinding {
  /** "warn" = something is wrong or was decided for you; "info" = worth
   *  knowing, not broken. */
  level: "warn" | "info";
  title: string;
  detail: string;
}

export interface HealthInput {
  dict: SiteDictionary;
  /** What the migration resolved without asking. */
  conflicts: DictionaryConflict[];
  /** internal → the libraries that carry it. */
  carriers: Map<string, string[]>;
  libraries: { name: string; columns: ColumnConfig[] }[];
  /** internal → a Choice column's current choices. */
  choicesBy: Map<string, string[]>;
  /** internal → what a taxonomy column's cells hold against what its
   *  term set offers. Absent = not probed, and the check stays quiet. */
  taxProbe?: Map<string, TaxProbe>;
}

/** A sample of one taxonomy column's live values, and the labels it is
 *  supposed to draw on. */
export interface TaxProbe {
  /** Cell texts as the register renders them (`renderText`), any number
   *  of rows; empty means nothing is tagged yet. */
  samples: string[];
  /** Every label the term set offers, at every level walked. */
  labels: string[];
  /** The term walk hit its limit, so an unrecognised value might simply
   *  be a term we never read — only the path SHAPE can be concluded. */
  partial?: boolean;
}

/**
 * Separators seen when SharePoint renders a term PATH instead of a term.
 * `;` is deliberately absent: the register splits on it already, so a
 * `;`-joined path arrives as ordinary labels and nothing breaks.
 */
const PATH_SEPARATORS = [":", "|", "/", "\\", ">", "›", "»"];

const normLabel = (s: string) => s.trim().toLowerCase();

/** Does `value` end in one of `labels`, behind a separator? That is the
 *  signature of a full path: the leaf is right, the rest is prefix. */
function endsWithLabel(value: string, labels: Set<string>): boolean {
  for (const l of labels) {
    if (l === "" || value.length <= l.length || !value.endsWith(l)) continue;
    const before = value.charAt(value.length - l.length - 1);
    if (PATH_SEPARATORS.includes(before) || before === " ") return true;
  }
  return false;
}

/**
 * The check that would have saved a production deployment (Ben, another
 * tenant, 2026-08-03): its folders pane did nothing at all, because the
 * managed metadata columns were set to *Display the entire path to the
 * term in the field*. LeanBoard matches a term's own LABEL — the folder
 * tally splits a cell on `;` and compares leaf labels, and picking a
 * folder filters with CAML `<Eq>` on that label — so against path text
 * every folder counts zero and every folder click returns nothing, with
 * no error anywhere to say why.
 *
 * So: if NOTHING a column holds is a term the set offers, something is
 * wrong. Which thing it is, the shape tells us — a value ending in a
 * real label behind a separator is a path; anything else points at the
 * column being mapped to the wrong set.
 *
 * Deliberately silent when even one value matches: a partly-tagged
 * library is normal, and the failure this catches matches nothing.
 */
export function taxProbeFinding(
  internal: string,
  probe: TaxProbe,
  displayName = ""
): HealthFinding | null {
  const shown = displayName !== "" ? displayName : internal;
  const labels = new Set(probe.labels.map(normLabel).filter((l) => l !== ""));
  if (labels.size === 0) return null; // nothing to compare against
  const values = probe.samples
    .flatMap((s) => s.split(";"))
    .map((raw) => ({ raw: raw.trim(), key: normLabel(raw) }))
    .filter((v) => v.key !== "");
  if (values.length === 0) return null; // nothing tagged yet
  if (values.some((v) => labels.has(v.key))) return null; // matching as expected

  const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;
  const pathish = values.find((v) => endsWithLabel(v.key, labels));
  if (pathish !== undefined) {
    return {
      level: "warn",
      title: `${shown} shows the whole term path, not the term`,
      detail:
        `Values read like ${quote(pathish.raw)}. Folders built on this column count ` +
        "zero and picking one returns nothing, because LeanBoard matches a term's own " +
        `label. Fix it in SharePoint: Site settings → Site columns → ${internal} → ` +
        "Display value → “Display term label in the field”.",
    };
  }
  if (probe.partial === true) return null; // the walk was truncated; cannot say
  return {
    level: "warn",
    title: `${shown}: no value matches its term set`,
    detail:
      `Sampled ${quote(values[0].raw)}, which is not one of the ${labels.size} terms in ` +
      "the set mapped to this column. Either the column points at the wrong term set " +
      "under Document columns, or its values are written some other way — either way " +
      "its folders and filters come back empty.",
  };
}

/** Roles the register and the document overlay actually lean on. */
const KEY_ROLES = ["status", "owner", "docType"];

export function dictionaryHealth(input: HealthInput): HealthFinding[] {
  const { dict, conflicts, carriers, libraries, choicesBy, taxProbe } = input;
  const out: HealthFinding[] = [];
  const roleLabel = (key: string) =>
    COLUMN_ROLES.find((r) => r.key === key)?.label ?? key;

  // a role means one column; two is ambiguous and the register just
  // takes the first, which is not a decision anyone made
  const byRole = new Map<string, SiteColumn[]>();
  for (const c of dict.columns) {
    if (c.role === "") continue;
    byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
  }
  for (const [role, cols] of byRole) {
    if (cols.length > 1) {
      out.push({
        level: "warn",
        title: `${roleLabel(role)} is mapped to ${cols.length} columns`,
        detail: `${cols.map((c) => c.internal).join(", ")} — the register uses the first, so map the others to something else.`,
      });
    }
  }
  for (const role of KEY_ROLES) {
    if (!byRole.has(role) && dict.columns.length > 0) {
      out.push({
        level: "info",
        title: `No column is mapped as ${roleLabel(role)}`,
        detail: "Set it under Document columns; the register uses it for this site.",
      });
    }
  }

  // a column in some libraries but not others — the drift that used to
  // be invisible because every library kept its own mapping
  for (const c of dict.columns) {
    const who = carriers.get(c.internal) ?? [];
    if (who.length === 0 || who.length === libraries.length) continue;
    // only worth saying for columns that carry meaning
    if (c.role === "") continue;
    const missing = libraries.filter((l) => !who.includes(l.name)).map((l) => l.name);
    out.push({
      level: "info",
      title: `${c.internal} is missing from ${missing.length} librar${missing.length === 1 ? "y" : "ies"}`,
      detail: `Not in ${missing.join(", ")} — rows from there will show nothing in that column.`,
    });
  }

  for (const c of conflicts) {
    out.push({
      level: "warn",
      title: `${c.internal}: libraries disagreed on ${c.field}`,
      detail:
        c.values.map((v) => `${v.value === "" ? "—" : v.value} ×${v.count}`).join(", ") +
        ` — kept “${c.chosen === "" ? "—" : c.chosen}”.`,
    });
  }

  // colours pointing at values that cannot appear
  for (const p of dict.palettes) {
    const isChoice = p.setId.startsWith("choice:");
    if (isChoice) {
      const internal = p.setId.slice("choice:".length);
      const choices = new Set(choicesBy.get(internal) ?? []);
      if (choices.size === 0) continue; // cannot judge without the schema
      const stale = Object.keys(p.entries).filter((k) => !choices.has(k));
      if (stale.length > 0) {
        out.push({
          level: "warn",
          title: `${internal} has ${stale.length} colour${stale.length === 1 ? "" : "s"} for values it no longer offers`,
          detail: `${stale.join(", ")} — open its palette to clear them.`,
        });
      }
      continue;
    }
    const byLabel = Object.keys(p.entries).filter((k) => !/^[0-9a-f-]{36}$/i.test(k));
    if (byLabel.length > 0) {
      out.push({
        level: "info",
        title: `A palette is still keyed by label (${byLabel.length} value${byLabel.length === 1 ? "" : "s"})`,
        detail:
          `${byLabel.join(", ")} — open the palette under Term sets & colours once and ` +
          "they move onto term ids, which survive a rename.",
      });
    }
  }

  // values that no term set recognises — first among the warnings when
  // it fires, because everything else here is drift and this one is a
  // whole pane silently doing nothing
  for (const c of dict.columns) {
    const probe = taxProbe?.get(c.internal);
    if (probe === undefined) continue;
    const finding = taxProbeFinding(c.internal, probe, c.label);
    if (finding !== null) out.unshift(finding);
  }

  for (const lib of libraries) {
    if (lib.columns.length > 0 && !lib.columns.some((c) => c.inDefault)) {
      out.push({
        level: "info",
        title: `${lib.name} opens with no columns`,
        detail: "Tick its view columns under Libraries.",
      });
    }
  }

  return out;
}

// ---- writes: what came back (Phase 4A) ---------------------------------
// Parsing only. The calls live in sp.ts; these turn their answers into
// something the UI can act on, and are the part worth testing.

/** 5H1: one column's starting value for the edit-properties form. */
export interface PrefillValue {
  text?: string;
  term?: { label: string; termId: string };
}

/**
 * Starting values from ONE list-REST item read (5H1). Taxonomy keeps
 * its TermGuid (multi takes the FIRST — the editor is single-pick,
 * matching the add form); dates cut to the date input's yyyy-mm-dd;
 * person fields are NOT here — the item read carries lookup ids only,
 * so emails ride the RLDAS row instead.
 */
export function prefillFromItem(
  item: Record<string, unknown>,
  fields: SpField[]
): Map<string, PrefillValue> {
  const out = new Map<string, PrefillValue>();
  for (const f of fields) {
    const raw = item[f.internal];
    if (raw == null) continue;
    if (f.isTaxonomy) {
      const one = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
      if (one && typeof one === "object") {
        const o = one as { Label?: unknown; TermGuid?: unknown };
        const label = typeof o.Label === "string" ? o.Label : "";
        const termId = typeof o.TermGuid === "string" ? o.TermGuid : "";
        if (termId !== "") out.set(f.internal, { term: { label, termId } });
      }
      continue;
    }
    if (f.type === "DateTime") {
      if (typeof raw === "string" && raw.length >= 10) {
        out.set(f.internal, { text: raw.slice(0, 10) });
      }
      continue;
    }
    if (typeof raw === "string") out.set(f.internal, { text: raw });
    else if (typeof raw === "number" || typeof raw === "boolean") {
      out.set(f.internal, { text: String(raw) });
    }
  }
  return out;
}

export interface BasePermissions {
  add: boolean;
  edit: boolean;
  /** Deleting a document is recycling it — recoverable, but still the
   *  permission SharePoint checks for a discard. */
  remove: boolean;
}

/**
 * SharePoint's effective permissions arrive as a 64-bit mask split in
 * two decimal strings. Everything Phase 4 needs sits in the low word:
 * AddListItems 0x2, EditListItems 0x4, DeleteListItems 0x8. The `| 0`
 * that JS applies to a bitwise operand is safe here precisely because
 * the bits we test are the low ones — a full-control mask arriving as
 * -1 still answers every question correctly.
 */
export function parseBasePermissions(raw: unknown): BasePermissions {
  const o = (raw ?? {}) as Record<string, unknown>;
  const inner = (o.EffectiveBasePermissions ?? o.d ?? o) as Record<string, unknown>;
  const low = Number((inner as { Low?: unknown }).Low ?? 0);
  if (!Number.isFinite(low)) return { add: false, edit: false, remove: false };
  return {
    add: (low & 0x2) !== 0,
    edit: (low & 0x4) !== 0,
    remove: (low & 0x8) !== 0,
  };
}

/** The fields ValidateUpdateListItem refused, with SharePoint's own
 *  reason. An empty list means every value was accepted. */
export function validateItemErrors(raw: unknown): { field: string; message: string }[] {
  const rows = Array.isArray((raw as { value?: unknown[] })?.value)
    ? ((raw as { value: unknown[] }).value as Record<string, unknown>[])
    : [];
  const out: { field: string; message: string }[] = [];
  for (const r of rows) {
    const message = asStr(r.ErrorMessage);
    if (r.HasException !== true && message === "") continue;
    out.push({ field: asStr(r.FieldName), message: message || "rejected" });
  }
  return out;
}

/**
 * The sentence inside a SharePoint failure. Errors arrive as JSON
 * wrapped in JSON — the connector's envelope carrying SharePoint's
 * odata.error as an escaped string — and showing that raw to a user is
 * showing them nothing. Digs to the deepest human message it can find
 * and gives up gracefully, because an unreadable error is still better
 * than a blank one.
 */
export function spErrorText(raw: string): string {
  const deepest = (value: unknown, depth: number): string => {
    // a real refusal nests connector envelope → message string → JSON →
    // odata.error → message → value, so the ceiling has to clear six
    if (depth > 8) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{")) {
        try {
          return deepest(JSON.parse(trimmed), depth + 1) || trimmed;
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }
    if (value === null || typeof value !== "object") return "";
    const o = value as Record<string, unknown>;
    // odata.error.message.value is the sentence SharePoint wrote.
    // innerError outranks message: the connector's envelope says
    // message:"BadGateway" at every level while the actual refusal sits
    // nested inside innerError (measured 2026-08-03, probe run four).
    for (const key of ["odata.error", "error", "innerError", "message", "value"]) {
      const hit = deepest(o[key], depth + 1);
      if (hit !== "") return hit;
    }
    return "";
  };
  const text = deepest(raw, 0);
  return text === "" ? raw.slice(0, 300) : text.slice(0, 300);
}

/**
 * The hidden note field behind a taxonomy column, from the column's own
 * SchemaXml: `TextField="{guid}"`. It CANNOT be guessed — a UI-created
 * column's note field carries a generated name, and guessing
 * `<internal>_0` bought an ArgumentException and nothing else (measured
 * 2026-08-03). Empty when the column declares none.
 */
export function textFieldGuidFromSchema(schemaXml: string): string {
  const m = /TextField="\{?([0-9a-fA-F-]{36})\}?"/.exec(schemaXml);
  return m ? m[1].toLowerCase() : "";
}

/** A single-quoted OData string. SharePoint's own escape is doubling,
 *  and real document names carry apostrophes. Pure, so it lives here
 *  rather than in the transport — quoting is where injection would get
 *  in, and it is worth a test that runs without the SDK. */
export const spQuote = (s: string): string => s.replace(/'/g, "''");

/**
 * Bytes as a string the JSON transport can carry: one character per
 * byte, no code point above 0xFF. This is the whole question 4A's
 * binary step asks — if the connector re-encodes it as UTF-8, every
 * byte above 0x7F becomes two and the file lands the wrong length,
 * which is why the probe checks Length rather than trusting a 200.
 */
export function bytesToBinaryString(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * The same bytes, base64'd. Power Platform's own envelope for binary
 * inside a JSON body is `{"$content-type":…, "$content": <base64>}` —
 * which is the one carriage a JSON transport cannot damage, because
 * every character in it is already ASCII. Measured on this tenant
 * 2026-08-03: a plain string body arrives UTF-8 re-encoded (16 bytes
 * sent, 21 stored), so base64 is not an optimisation here, it is the
 * only route bytes could survive.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

// ---- add a document: the write recipe (Phase 4C) -----------------------
// Six probe runs bought this split, so it is pure and tested rather
// than inlined in a dialog. Text and choice go through
// ValidateUpdateListItem (proven; display-text coercion is its job).
// Terms and dates go through the connector's typed item surface —
// terms because {Value, TermGuid, WssId:-1} is the one accepted shape,
// dates because ISO through the tabular surface beats guessing the
// site's display locale in a form value.

/** One filled-in editor from the add form. */
export interface AddFieldValue {
  internal: string;
  kind: "text" | "choice" | "date" | "taxonomy" | "person";
  /** text/choice/date payload (date is YYYY-MM-DD). */
  text?: string;
  /** taxonomy payload. */
  label?: string;
  termId?: string;
  /** taxonomy only: a multi-value column takes an ARRAY of one. */
  multi?: boolean;
  /** person payload — emails resolve through the claims key. */
  people?: { email: string; name: string }[];
}

export function splitAddWrites(values: AddFieldValue[]): {
  formValues: { FieldName: string; FieldValue: string }[];
  patch: Record<string, unknown>;
} {
  const formValues: { FieldName: string; FieldValue: string }[] = [];
  const patch: Record<string, unknown> = {};
  for (const v of values) {
    if (v.kind === "taxonomy") {
      if ((v.label ?? "") === "" || (v.termId ?? "") === "") continue;
      const term = { Value: v.label, TermGuid: v.termId, WssId: -1 };
      patch[v.internal] = v.multi === true ? [term] : term;
      continue;
    }
    if (v.kind === "person") {
      // the forms engine's own person format: a JSON array of claims
      // keys, resolved server-side — single and multi are the same
      // shape, just more entries
      const people = (v.people ?? []).filter((p) => p.email.trim() !== "");
      if (people.length === 0) continue;
      formValues.push({
        FieldName: v.internal,
        FieldValue: JSON.stringify(
          people.map((p) => ({ Key: `i:0#.f|membership|${p.email.trim().toLowerCase()}` }))
        ),
      });
      continue;
    }
    const text = (v.text ?? "").trim();
    if (text === "") continue; // an empty editor writes nothing
    if (v.kind === "date") patch[v.internal] = text;
    else formValues.push({ FieldName: v.internal, FieldValue: text });
  }
  return { formValues, patch };
}

/**
 * Everything the add form captured, as ONE ValidateUpdateListItem call
 * with bNewDocumentUpdate: true — SharePoint's own "document
 * information panel" path for a just-created document. It bypasses a
 * require-check-out rule (probe run four: the bare text write went
 * through while every other route demanded a check-out) and completes
 * the document without a separate check-in — which is what lets a new
 * document be finished WITHOUT ever calling through the file door that
 * stalls on fresh copies (five runs, 2026-08-04).
 *
 * Taxonomy rides as the flow-standard "Label|guid" form value; dates as
 * ISO text; person as claims JSON. `taxInternals` and `patch` exist for
 * the fallback: if the tagging validator refuses the taxonomy form
 * values, those columns alone retry through the connector's term-object
 * route under a held check-out — the route probe run six proved.
 */
/** LCID → BCP 47, for the locales a Pechey deployment is likely to
 *  meet. Anything unmapped falls back to en-US — which is also what a
 *  fresh SharePoint site ships with. */
const LCID_TAGS: Record<number, string> = {
  1033: "en-US",
  2057: "en-GB",
  3081: "en-AU",
  5129: "en-NZ",
  4105: "en-CA",
  1031: "de-DE",
  1036: "fr-FR",
  3082: "es-ES",
  1040: "it-IT",
  1043: "nl-NL",
  1046: "pt-BR",
  1041: "ja-JP",
  2052: "zh-CN",
};

/**
 * An ISO date (YYYY-MM-DD) in the SITE's short date format — the only
 * shape the forms engine validates ("Enter a date like this: 2/23/2012",
 * measured 2026-08-04; the refusal also aborted the whole write, so one
 * wrong date cost every other column). Parsed by parts, never through
 * Date.parse, so no timezone can shift the day.
 */
export function formatDateForLocale(iso: string, localeId: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return iso.trim();
  const tag = LCID_TAGS[localeId] ?? "en-US";
  return new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function newDocumentWrites(
  values: AddFieldValue[],
  localeId = 1033
): {
  formValues: { FieldName: string; FieldValue: string }[];
  taxInternals: string[];
  patch: Record<string, unknown>;
} {
  const base = splitAddWrites(values);
  const formValues = [...base.formValues];
  const taxInternals: string[] = [];
  const patch: Record<string, unknown> = {};
  for (const v of values) {
    if (v.kind === "date" && (v.text ?? "").trim() !== "") {
      formValues.push({
        FieldName: v.internal,
        FieldValue: formatDateForLocale((v.text ?? "").trim(), localeId),
      });
    }
    if (v.kind === "taxonomy" && (v.label ?? "") !== "" && (v.termId ?? "") !== "") {
      taxInternals.push(v.internal);
      formValues.push({ FieldName: v.internal, FieldValue: `${v.label}|${v.termId}` });
      const term = { Value: v.label, TermGuid: v.termId, WssId: -1 };
      patch[v.internal] = v.multi === true ? [term] : term;
    }
  }
  return { formValues, taxInternals, patch };
}

/**
 * Internals in the SITE DICTIONARY's order — the one ordering the add
 * form and the viewer's properties pane share (Ben, 2026-08-04). The
 * dictionary's row order is the site's word for "how properties read";
 * anything the dictionary does not know keeps its relative place at the
 * end (stable sort).
 */
export function sortByDictionary(internals: string[], dictOrder: string[]): string[] {
  const idx = new Map(dictOrder.map((n, i) => [n, i]));
  return [...internals].sort(
    (a, b) => (idx.get(a) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

/** How library types read in the nav, top to bottom (Ben, 2026-08-04:
 *  Standards, Working Documents, Records, Templates). Revision sits
 *  with working — it holds checked-out copies of standards mid-edit. */
const LIBRARY_DISPLAY_RANK: Record<string, number> = {
  standard: 0,
  working: 1,
  revision: 2,
  record: 3,
  template: 4,
};

/** Libraries in display order: by type rank, then by display name —
 *  the one order the nav pane, scope pickers and the add form share. */
export function sortLibrariesForDisplay<
  T extends { libType: string; name: string; config: { title: string } },
>(libs: T[]): T[] {
  return [...libs].sort((a, b) => {
    const rank =
      (LIBRARY_DISPLAY_RANK[a.libType] ?? 9) - (LIBRARY_DISPLAY_RANK[b.libType] ?? 9);
    if (rank !== 0) return rank;
    return (a.config.title || a.name)
      .toLowerCase()
      .localeCompare((b.config.title || b.name).toLowerCase());
  });
}

/** A file name SharePoint will take: forbidden characters dropped,
 *  leading/trailing dots and spaces trimmed. Empty means "not a name". */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[~"#%&*:<>?/\\{|}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "");
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

/**
 * Is anyone named as an approver who is NOT the owner? That question
 * decides whether an endorsement round exists at all, so it has to be
 * asked carefully.
 *
 * The trap (Ben, 2026-08-08): a person column reaches us as display
 * text plus an OPTIONAL email projection, and RLDAS does not always
 * carry the email. Comparing an approver's email against an owner's
 * NAME never matches, so a sole owner-approver looked like an outside
 * approver — which inserted an approval step nobody asked for and,
 * because an endorsement is a MINOR check-in, cost the document the
 * major version its approval was supposed to record.
 *
 * So: compare like with like. Emails when BOTH sides have them (exact),
 * display names otherwise (imprecise, but at least the same question).
 */
export function hasOutsideApprovers(
  owner: { emails: string[]; names: string[] },
  approvers: { emails: string[]; names: string[] }
): boolean {
  const norm = (xs: string[]) =>
    xs.map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  const oEmails = norm(owner.emails);
  const aEmails = norm(approvers.emails);
  const byEmail = oEmails.length > 0 && aEmails.length > 0;
  const ownerKeys = new Set(byEmail ? oEmails : norm(owner.names));
  const approverKeys = byEmail ? aEmails : norm(approvers.names);
  return approverKeys.some((k) => !ownerKeys.has(k));
}

// ---- document control health (the controllers' corpus report) ----------
// Docs Health (settings) answers "is the CONFIGURATION consistent?".
// This answers the other half: "are the DOCUMENTS themselves in a state
// the control system can actually work with?" — which is a controller's
// job, not a super-admin's, so it lives in the register's kebab.
//
// Every check is grounded in a mapped ROLE: the app can only judge what
// it has been told means something. A check whose role is unmapped is
// REPORTED AS SKIPPED, never silently passed — a report that quietly
// omits a check reads as a clean bill of health.

export interface ControlDoc {
  listId: string;
  itemId: number;
  name: string;
  libName: string;
  /** Does this document live in a CONTROLLED (standards) library? The
   *  report scans every library except templates (Ben, 2026-08-08), but
   *  only a controlled document owes the lifecycle anything — a working
   *  draft has no approval status by design, and flagging every one of
   *  them would bury the findings that matter. */
  controlled: boolean;
  /** Owner display text ("" = nobody named). */
  owner: string;
  /** The stage its status value maps to ("" = no value, or a value the
   *  lifecycle mapping does not know). */
  stage: LifecycleStage | "";
  /** Organisation term text ("" = untagged). */
  org: string;
  docType: string;
  documentId: string;
  /** Next review date, ISO ("" = none recorded). */
  reviewIso: string;
  /** Who holds the check-out ("" = free). */
  checkedOutTo: string;
}

export interface ControlIssue {
  key: string;
  title: string;
  /** Why it matters and what to do — the report is for someone who has
   *  to fix it, not someone admiring it. */
  detail: string;
  level: "warn" | "info";
  docs: ControlDoc[];
}

export interface ControlHealthReport {
  issues: ControlIssue[];
  scanned: number;
  /** Documents with no WARN-level issue. */
  clean: number;
  /** Checks that could not run, named for the report. */
  skipped: string[];
}

/** Which column roles this site has mapped — an unmapped role's check
 *  cannot run, and says so. */
export interface ControlRoles {
  owner: boolean;
  status: boolean;
  org: boolean;
  docType: boolean;
  documentId: boolean;
  review: boolean;
}

export function controlHealth(
  docs: ControlDoc[],
  roles: ControlRoles,
  now: number = Date.now()
): ControlHealthReport {
  const issues: ControlIssue[] = [];
  const skipped: string[] = [];
  const add = (
    key: string,
    level: "warn" | "info",
    title: string,
    detail: string,
    hits: ControlDoc[]
  ) => {
    if (hits.length > 0) issues.push({ key, level, title, detail, docs: hits });
  };
  // the lifecycle checks answer only for CONTROLLED documents
  const controlled = docs.filter((d) => d.controlled);
  const approved = controlled.filter((d) => d.stage === "approved");

  if (controlled.length > 0 && roles.status) {
    add(
      "noStatus",
      "warn",
      "No approval status the lifecycle recognises",
      "The approval commands cannot move these documents, and the register's " +
        "approved-only view hides them. Set a status, or map the term under " +
        "Settings → Documents → Lifecycle.",
      controlled.filter((d) => d.stage === "")
    );
  } else if (controlled.length > 0) {
    skipped.push("Approval status is not mapped — status and review checks cannot run.");
  }

  if (roles.owner) {
    add(
      "noOwner",
      "warn",
      "No owner named",
      "Nobody can give final approval, retire the document, or answer an " +
        "edit-access request for it.",
      docs.filter((d) => d.owner.trim() === "")
    );
  } else {
    skipped.push("Owner is not mapped — ownership checks cannot run.");
  }

  if (controlled.length > 0 && roles.review && roles.status) {
    add(
      "reviewOverdue",
      "warn",
      "Review overdue",
      "Approved documents past their next review date — the register still " +
        "presents them as current.",
      approved.filter((d) => {
        const t = Date.parse(d.reviewIso);
        return !Number.isNaN(t) && t < now;
      })
    );
    add(
      "reviewMissing",
      "warn",
      "No next review date",
      "Approved documents with no review date never come up for review — they " +
        "age quietly.",
      approved.filter((d) => d.reviewIso.trim() === "")
    );
  } else if (controlled.length > 0 && !roles.review) {
    skipped.push("Next review date is not mapped — review checks cannot run.");
  }

  if (roles.org) {
    add(
      "untagged",
      "warn",
      "Not tagged to the organisation",
      "These documents are invisible to folder navigation — findable only by " +
        "search.",
      docs.filter((d) => d.org.trim() === "")
    );
  } else {
    skipped.push("Organisation unit is not mapped — tagging checks cannot run.");
  }

  if (roles.docType) {
    add(
      "noDocType",
      "info",
      "No document type",
      "The type drives templates, tiles and filtering.",
      docs.filter((d) => d.docType.trim() === "")
    );
  }
  if (roles.documentId) {
    add(
      "noDocumentId",
      "info",
      "No document ID",
      "A controlled document that cannot be cited by number is hard to " +
        "reference from other documents and records.",
      docs.filter((d) => d.documentId.trim() === "")
    );
  }

  add(
    "inRevision",
    "info",
    "Checked out right now",
    "Work in progress — listed so a stalled revision is visible, not because " +
      "anything is wrong.",
    docs.filter((d) => d.checkedOutTo.trim() !== "")
  );

  // warnings first, then the biggest piles — a controller works down
  issues.sort((a, b) =>
    a.level === b.level ? b.docs.length - a.docs.length : a.level === "warn" ? -1 : 1
  );

  const flagged = new Set<string>();
  for (const i of issues) {
    if (i.level !== "warn") continue;
    for (const d of i.docs) flagged.add(`${d.listId.toLowerCase()}:${d.itemId}`);
  }
  return { issues, scanned: docs.length, clean: docs.length - flagged.size, skipped };
}

/** Overdue-by-owner, biggest first — the backlog's "whose reviews are
 *  late?" question, answered without leaving the report. */
export function tallyByOwner(docs: ControlDoc[]): { owner: string; count: number }[] {
  const by = new Map<string, number>();
  for (const d of docs) {
    const who = d.owner.trim() === "" ? "(nobody named)" : d.owner.split(";")[0].trim();
    by.set(who, (by.get(who) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
}

// ---- org → term set push sync (5F) -------------------------------------
// The drift report's write half. The app's org tree is the source of
// truth; the plan only ever ADDS terms or renames existing ones IN
// PLACE on their GUID — documents tagged with a term and the lifecycle
// stage mapping are both keyed by term id, so an in-place rename keeps
// every tag and mapping alive where a delete-and-recreate would orphan
// them. Terms with no app counterpart are reported and left alone.

export interface OrgSyncPlan {
  /** App paths absent from the term set, parent-first — the create order. */
  creates: string[][];
  /** In-place label changes: the term keeps its GUID, tags survive. */
  renames: { id: string; from: string[]; to: string[] }[];
  /** Term-set-only paths — never touched, listed so nothing is silent. */
  orphans: string[][];
  matched: number;
  /** Non-empty when the comparison itself cannot be trusted. */
  error: string;
}

/**
 * What a sync would do, computed shallow-to-deep. Matching is by label
 * path, case-insensitive (same rule as orgDrift). A rename is inferred
 * ONLY when a parent scope has exactly one unmatched app node and
 * exactly one unmatched term — the unambiguous case. Two siblings
 * renamed at once cannot be paired safely, so they become creates and
 * the old terms stay as reported orphans (never deleted).
 */
export function orgSyncPlan(
  appPaths: string[][],
  termNodes: { id: string; labels: string[] }[],
  termOffset = 0
): OrgSyncPlan {
  const norm = (p: string[]) => p.map((s) => s.trim().toLowerCase()).join("¦");
  if (termOffset > 0) {
    const roots = new Set(
      termNodes.filter((n) => n.labels.length === 1).map((n) => norm(n.labels))
    );
    if (roots.size !== 1) {
      return {
        creates: [],
        renames: [],
        orphans: [],
        matched: 0,
        error:
          `the company-level comparison needs exactly one top-level term to sync under ` +
          `(found ${roots.size})`,
      };
    }
  }
  // unclaimed terms, keyed by their (offset-sliced) label path
  const terms = new Map<string, { id: string; labels: string[] }>();
  for (const n of termNodes) {
    const sliced = n.labels.slice(termOffset);
    if (sliced.length > 0) terms.set(norm(sliced), { id: n.id, labels: sliced });
  }
  const parentKey = (p: string[]) => norm(p.slice(0, -1));
  const maxDepth = Math.max(0, ...appPaths.map((p) => p.length));
  const creates: string[][] = [];
  const renames: OrgSyncPlan["renames"] = [];
  let matched = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    // claim exact matches first, so a spare term is genuinely spare
    const missing: string[][] = [];
    for (const p of appPaths.filter((q) => q.length === depth)) {
      const key = norm(p);
      if (terms.has(key)) {
        terms.delete(key);
        matched++;
      } else {
        missing.push(p);
      }
    }
    const missingByParent = new Map<string, string[][]>();
    for (const p of missing) {
      const k = parentKey(p);
      missingByParent.set(k, [...(missingByParent.get(k) ?? []), p]);
    }
    const spareByParent = new Map<string, { id: string; labels: string[] }[]>();
    for (const t of terms.values()) {
      if (t.labels.length !== depth) continue;
      const k = parentKey(t.labels);
      spareByParent.set(k, [...(spareByParent.get(k) ?? []), t]);
    }
    for (const [parent, apps] of missingByParent) {
      const spares = spareByParent.get(parent) ?? [];
      if (apps.length === 1 && spares.length === 1) {
        const t = spares[0];
        const to = apps[0];
        renames.push({ id: t.id, from: t.labels, to });
        terms.delete(norm(t.labels));
        // descendants of a renamed term now live under the new label —
        // re-key them so deeper levels compare against the FUTURE tree
        const oldPrefix = `${norm(t.labels)}¦`;
        const rekeyed: [string, { id: string; labels: string[] }][] = [];
        for (const [k, v] of terms) {
          if (!k.startsWith(oldPrefix)) continue;
          terms.delete(k);
          const labels = [...to, ...v.labels.slice(to.length)];
          rekeyed.push([norm(labels), { id: v.id, labels }]);
        }
        for (const [k, v] of rekeyed) terms.set(k, v);
      } else {
        creates.push(...apps);
      }
    }
  }
  return {
    creates,
    renames,
    orphans: [...terms.values()].map((t) => t.labels),
    matched,
    error: "",
  };
}

/** SharePoint's date column types — what a from/to filter can bind to. */
export function isDateField(f: SpField): boolean {
  return f.type === "DateTime";
}

/** Roles that ARE dates by definition. The live schema stamps isDate on
 *  the next settings visit, but a role already says as much — so a site
 *  that mapped its effective date gets date filters without waiting to
 *  re-save the dictionary. */
const DATE_ROLES = new Set(["effectiveDate", "nextReviewDate", "retainUntil"]);

export function isDateColumn(c: SiteColumn): boolean {
  return c.isDate || DATE_ROLES.has(c.role);
}

