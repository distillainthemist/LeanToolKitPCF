// Cascaded priorities — the PURE model (docs/leanboard-cascade-improvement-
// plan.md, P0). Org references, pillars, priorities, assignments, events,
// the period model, the R/A/G tally + roll-up rules, and the permission
// checks. No IO here (store/priorities.ts executes); everything is unit
// tested. Screens (P1+) read through these types only.

// ---- org references (the boards' org dictionary, by NAME) ----------------

/** An org node: company → site → department → area, blank levels = a
 *  higher node. Names, not ids — the app's org dictionary is name-keyed
 *  (site settings rows), and renames cascade by name. */
export interface OrgRef {
  company: string;
  site: string;
  department: string;
  area: string;
}

export type OrgLevel = "company" | "site" | "department" | "area";

export function orgRef(
  company = "",
  site = "",
  department = "",
  area = ""
): OrgRef {
  return { company, site, department, area };
}

export function orgLevel(o: OrgRef): OrgLevel {
  if (o.area !== "") return "area";
  if (o.department !== "") return "department";
  if (o.site !== "") return "site";
  return "company";
}

/** A stable string key for maps/sets ("company|site|dept|area"). */
export function orgKey(o: OrgRef): string {
  return [o.company, o.site, o.department, o.area].join("|");
}

export function orgFromKey(key: string): OrgRef {
  const [company = "", site = "", department = "", area = ""] = key.split("|");
  return { company, site, department, area };
}

/** The node's own name (the deepest non-blank level). */
export function orgName(o: OrgRef): string {
  return o.area || o.department || o.site || o.company;
}

export function orgParent(o: OrgRef): OrgRef | null {
  switch (orgLevel(o)) {
    case "area":
      return { ...o, area: "" };
    case "department":
      return { ...o, department: "" };
    case "site":
      return { ...o, site: "" };
    default:
      return null;
  }
}

export function sameOrg(a: OrgRef, b: OrgRef): boolean {
  return orgKey(a) === orgKey(b);
}

/** True when `node` sits under `ancestor` (strictly). */
export function isDescendant(node: OrgRef, ancestor: OrgRef): boolean {
  if (sameOrg(node, ancestor)) return false;
  const lv = orgLevel(ancestor);
  if (node.company !== ancestor.company) return false;
  if (lv === "company") return true;
  if (node.site !== ancestor.site) return false;
  if (lv === "site") return true;
  if (node.department !== ancestor.department) return false;
  return lv === "department";
}

/** Breadcrumb path from the company down to the node. */
export function orgPath(o: OrgRef): OrgRef[] {
  const path: OrgRef[] = [orgRef(o.company)];
  if (o.site !== "") path.push(orgRef(o.company, o.site));
  if (o.department !== "") path.push(orgRef(o.company, o.site, o.department));
  if (o.area !== "") path.push(o);
  return path;
}

// ---- pillars -----------------------------------------------------------------

export interface Pillar {
  /** Dataverse row GUID — set by the store, absent on fresh objects. */
  rowId?: string;
  id: string;
  name: string;
  /** 1 = pillar (filter chips above the matrix), 2 = sub-pillar (the
   *  matrix columns). The wall template calls these "medium-term
   *  strategy" and "strategic objectives"; the app says pillar /
   *  sub-pillar (Ben, 2026-08-19). */
  level: 1 | 2;
  parentId: string; // "" for level 1
  color: string;
  order: number;
  active: boolean;
  company: string;
}

/** Level-2 pillars in display order, optionally under one L1. */
/** Sub-pillar columns in the order Settings shows them: pillar by pillar,
 *  then each pillar's sub-pillars by their own order. Sub-pillars whose
 *  pillar is retired or missing trail at the end (still columns — their
 *  priorities must not vanish). */
export function objectiveColumns(pillars: Pillar[], l1: string | null): Pillar[] {
  const byOrder = (a: Pillar, b: Pillar) => a.order - b.order || a.name.localeCompare(b.name);
  const subs = pillars.filter((p) => p.level === 2 && p.active && (l1 === null || p.parentId === l1));
  const out: Pillar[] = [];
  for (const top of strategyChips(pillars)) {
    out.push(...subs.filter((s) => s.parentId === top.id).sort(byOrder));
  }
  const placed = new Set(out.map((s) => s.id));
  out.push(...subs.filter((s) => !placed.has(s.id)).sort(byOrder));
  return out;
}

/** The pillar row over the columns: one span per pillar covering its
 *  consecutive sub-pillar columns; orphan sub-pillars share a "—" span. */
export function pillarSpans(pillars: Pillar[], columns: Pillar[]): { pillar: Pillar | null; span: number }[] {
  const out: { pillar: Pillar | null; span: number }[] = [];
  const tops = new Map(strategyChips(pillars).map((p) => [p.id, p]));
  for (const col of columns) {
    const top = tops.get(col.parentId) ?? null;
    const last = out[out.length - 1];
    if (last && last.pillar?.id === top?.id && (last.pillar !== null || top === null)) last.span += 1;
    else out.push({ pillar: top, span: 1 });
  }
  return out;
}

export function strategyChips(pillars: Pillar[]): Pillar[] {
  return pillars
    .filter((p) => p.level === 1 && p.active)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// ---- priorities ---------------------------------------------------------------

export type PriorityStatus = "active" | "completed" | "archived" | "retired";

export interface Priority {
  rowId?: string;
  id: string;
  statement: string;
  org: OrgRef;
  pillarId: string;
  ownerId: string;
  ownerName: string;
  period: string;
  status: PriorityStatus;
  statusReason: string;
  parentId: string; // "" = originated here
  primaryInitiativeId: string;
  order: number;
  notes: string;
}

export type AssignmentStatus = "proposed" | "accepted" | "rejected" | "onhold" | "completed";

/** priority × receiving org (decision 2). */
export interface PriorityAssignment {
  /** Assignments have no business id — `id` IS the row GUID ("" when new). */
  id: string;
  priorityId: string;
  org: OrgRef;
  status: AssignmentStatus;
  reason: string;
  decidedById: string;
  decidedByName: string;
  decidedAt: string; // ISO or ""
  /** The customised child row this org made from it ("" = adopted as-is). */
  childPriorityId: string;
}

export type PriorityEventKind =
  | "created"
  | "edited"
  | "cascaded"
  | "accepted"
  | "customised"
  | "held"
  | "rejected"
  | "completed"
  | "archived"
  | "retired"
  | "carriedForward"
  | "reopened"
  | "reordered";

export interface PriorityEvent {
  /** Row GUID ("" when new). */
  id: string;
  priorityId: string;
  kind: PriorityEventKind;
  detail: Record<string, unknown>;
  actorId: string;
  actorName: string;
  at: string;
}

export function isPriorityStatus(v: unknown): v is PriorityStatus {
  return v === "active" || v === "completed" || v === "archived" || v === "retired";
}

export function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return (
    v === "proposed" || v === "accepted" || v === "rejected" || v === "onhold" || v === "completed"
  );
}

/**
 * What an org's matrix shows in a column: its OWN priorities plus the
 * parent-org priorities it has ADOPTED as-is (accepted assignment, no
 * child) — decision 2. Customised ones are the org's own child rows and
 * come through the first set. Sorted by order then statement.
 */
export function prioritiesForOrg(
  org: OrgRef,
  all: Priority[],
  assignments: PriorityAssignment[]
): { own: Priority[]; adopted: Priority[] } {
  const key = orgKey(org);
  const own = all.filter((p) => orgKey(p.org) === key);
  const adoptedIds = new Set(
    assignments
      .filter((a) => orgKey(a.org) === key && a.status === "accepted" && a.childPriorityId === "")
      .map((a) => a.priorityId)
  );
  const adopted = all.filter((p) => adoptedIds.has(p.id));
  const byOrder = (a: Priority, b: Priority) =>
    a.order - b.order || a.statement.localeCompare(b.statement);
  return { own: own.sort(byOrder), adopted: adopted.sort(byOrder) };
}

/** Assignments awaiting this org's decision — the toolbar chip's count. */
export function pendingCascades(org: OrgRef, assignments: PriorityAssignment[]): PriorityAssignment[] {
  const key = orgKey(org);
  return assignments.filter((a) => orgKey(a.org) === key && a.status === "proposed");
}

/** Lineage summary for a priority card: what came in, what went out. */
export interface LineageSummary {
  /** The parent's org (received/adopted from), or null. */
  from: OrgRef | null;
  sent: number;
  accepted: number;
  pending: number;
  declined: number;
  held: number;
}

export function lineageFor(
  p: Priority,
  all: Priority[],
  assignments: PriorityAssignment[]
): LineageSummary {
  const parent = p.parentId !== "" ? all.find((x) => x.id === p.parentId) : undefined;
  const mine = assignments.filter((a) => a.priorityId === p.id);
  return {
    from: parent ? parent.org : null,
    sent: mine.length,
    accepted: mine.filter((a) => a.status === "accepted" || a.status === "completed").length,
    pending: mine.filter((a) => a.status === "proposed").length,
    declined: mine.filter((a) => a.status === "rejected").length,
    held: mine.filter((a) => a.status === "onhold").length,
  };
}

/** Every priority beneath `p` in the cascade (children of children…). */
export function descendantPriorities(p: Priority, all: Priority[]): Priority[] {
  const out: Priority[] = [];
  const walk = (id: string) => {
    for (const c of all) {
      if (c.parentId === id) {
        out.push(c);
        walk(c.id);
      }
    }
  };
  walk(p.id);
  return out;
}

// ---- R/A/G tallies + roll-up (decisions 9 + the initiative-RAG answer) ------

export type Rag = "green" | "amber" | "red" | "grey";

export interface Tally {
  green: number;
  amber: number;
  red: number;
  /** grey = no data: counted in total, not in the three. */
  grey: number;
  total: number;
}

export function tally(states: Rag[]): Tally {
  const t: Tally = { green: 0, amber: 0, red: 0, grey: 0, total: states.length };
  for (const s of states) t[s]++;
  return t;
}

export type RollupRule = "strict" | "ratio";

/**
 * The priority's own state from its initiatives' tallies:
 *  - strict: any red → red; else any amber → amber; else green if any
 *    green; else grey.
 *  - ratio: red when red > X% of the coloured (non-grey) count; else amber
 *    when amber+red > X%; else green; grey when nothing coloured.
 */
export function rollup(t: Tally, rule: RollupRule, ratioPct: number): Rag {
  const coloured = t.green + t.amber + t.red;
  if (coloured === 0) return "grey";
  if (rule === "strict") {
    if (t.red > 0) return "red";
    if (t.amber > 0) return "amber";
    return "green";
  }
  const x = Math.max(0, Math.min(100, ratioPct)) / 100;
  if (t.red / coloured > x) return "red";
  if ((t.red + t.amber) / coloured > x) return "amber";
  return "green";
}

/** The worded rule for the rail ("Red — strict rule (any red)"). */
export function rollupWords(rag: Rag, rule: RollupRule, ratioPct: number): string {
  const label = rag === "grey" ? "No data" : rag[0].toUpperCase() + rag.slice(1);
  return rule === "strict"
    ? `${label} — strict rule (any red)`
    : `${label} — ratio rule (red above ${ratioPct}%)`;
}

/**
 * An initiative's own state = worst of metric AND actions (Ben,
 * 2026-08-19): red if the primary metric is red OR escalated; amber if
 * the metric is amber OR any action overdue OR needs support; green
 * otherwise; grey when there is neither a metric state nor any action.
 */
export function initiativeRag(input: {
  metric: Rag | null;
  escalated: boolean;
  needsSupport: boolean;
  overdueActions: number;
  openActions: number;
}): Rag {
  if (input.metric === "red" || input.escalated) return "red";
  if (input.metric === "amber" || input.needsSupport || input.overdueActions > 0) return "amber";
  if (input.metric === "green" || input.openActions > 0) return "green";
  return "grey";
}

// ---- periods (decision 10) --------------------------------------------------

export interface PeriodSettings {
  /** fy = financial year starting `startMonth`; calendar = Jan–Dec;
   *  custom = free labels, `currentPeriod` typed by the admin. */
  mode: "fy" | "calendar" | "custom";
  /** 1–12; fy only. */
  startMonth: number;
  /** Label prefix, e.g. "FY" → "FY26". */
  prefix: string;
  /** custom mode: the current label; other modes derive it. */
  currentPeriod: string;
}

export interface PrioritySettings {
  ragRatioPct: number;
  period: PeriodSettings;
}

export const DEFAULT_PRIORITY_SETTINGS: PrioritySettings = {
  ragRatioPct: 30,
  period: { mode: "fy", startMonth: 7, prefix: "FY", currentPeriod: "" },
};

export function parsePrioritySettings(raw: string | null | undefined): PrioritySettings {
  const d = DEFAULT_PRIORITY_SETTINGS;
  const t = (raw ?? "").trim();
  if (t === "") return { ragRatioPct: d.ragRatioPct, period: { ...d.period } };
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const p = (o.period ?? {}) as Record<string, unknown>;
    const mode = p.mode === "calendar" || p.mode === "custom" ? p.mode : "fy";
    const sm = typeof p.startMonth === "number" ? Math.round(p.startMonth) : d.period.startMonth;
    return {
      ragRatioPct:
        typeof o.ragRatioPct === "number" && Number.isFinite(o.ragRatioPct)
          ? Math.max(0, Math.min(100, Math.round(o.ragRatioPct)))
          : d.ragRatioPct,
      period: {
        mode,
        startMonth: Math.max(1, Math.min(12, sm)),
        prefix: typeof p.prefix === "string" ? p.prefix : d.period.prefix,
        currentPeriod: typeof p.currentPeriod === "string" ? p.currentPeriod : "",
      },
    };
  } catch {
    return { ragRatioPct: d.ragRatioPct, period: { ...d.period } };
  }
}

export function serializePrioritySettings(s: PrioritySettings): string {
  return JSON.stringify(s);
}

/**
 * The period label for a date. FY: a year starting `startMonth` is named
 * for the calendar year it ENDS in ("FY26" = Jul 2025 – Jun 2026 when
 * startMonth = 7). Calendar: "2026" (prefix applied if set). Custom: the
 * admin's current label.
 */
export function periodFor(settings: PeriodSettings, dateIso: string): string {
  if (settings.mode === "custom") return settings.currentPeriod;
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return settings.currentPeriod;
  if (settings.mode === "calendar") return `${settings.prefix}${settings.prefix === "" ? y : String(y).slice(-2)}`;
  const endYear = settings.startMonth === 1 ? y : m >= settings.startMonth ? y + 1 : y;
  return `${settings.prefix}${String(endYear).slice(-2)}`;
}

/** The label after `period` (carry-forward target). Custom → "" (admin sets). */
export function nextPeriod(settings: PeriodSettings, period: string): string {
  if (settings.mode === "custom") return "";
  const digits = period.replace(/\D/g, "");
  if (digits === "") return "";
  const n = Number(digits);
  const width = digits.length;
  return `${settings.prefix}${String(n + 1).padStart(width, "0").slice(-width)}`;
}

// ---- permissions (decision 7) ---------------------------------------------

export interface OwnerRef {
  whoId: string;
  who: string;
}

/** Owners per org key ("company|site|department|area"), site + department
 *  levels only (areas are managed by their department's owners). */
export type OrgOwnersMap = Record<string, OwnerRef[]>;

export interface Viewer {
  whoId: string;
  role: "user" | "siteadmin" | "superadmin";
  site: string;
}

/** The org node whose owners govern `org`: itself for site/department,
 *  the department for an area, the company for the company. */
export function governingOrg(org: OrgRef): OrgRef {
  return orgLevel(org) === "area" ? { ...org, area: "" } : org;
}

/**
 * Can this viewer create/edit priorities, accept cascades and set the
 * vision for `org`? Superadmins: yes. Siteadmins: anything in their site.
 * Otherwise: an owner of the governing node, OR of any node above it
 * (a site owner governs its departments).
 */
export function canManageOrg(viewer: Viewer, org: OrgRef, owners: OrgOwnersMap): boolean {
  if (viewer.role === "superadmin") return true;
  if (viewer.role === "siteadmin" && org.site !== "" && org.site === viewer.site) return true;
  let node: OrgRef | null = governingOrg(org);
  while (node) {
    const list = owners[orgKey(node)] ?? [];
    if (list.some((o) => o.whoId === viewer.whoId)) return true;
    node = orgParent(node);
  }
  return false;
}

export function canEditPillars(viewer: Viewer): boolean {
  return viewer.role === "superadmin";
}

// ---- the matrix (screen-shaped, still pure) ---------------------------------

/** Priorities of an org's matrix grouped under each sub-pillar column;
 *  a priority whose pillar is not a shown column goes to `unplaced`
 *  (retired pillar / no pillar) so nothing silently disappears. */
export function groupByColumn(
  columns: Pillar[],
  priorities: Priority[]
): { byColumn: Map<string, Priority[]>; unplaced: Priority[] } {
  const byColumn = new Map<string, Priority[]>(columns.map((c) => [c.id, []]));
  const unplaced: Priority[] = [];
  for (const p of priorities) {
    const list = byColumn.get(p.pillarId);
    if (list) list.push(p);
    else unplaced.push(p);
  }
  return { byColumn, unplaced };
}

export type Density = "comfortable" | "compact" | "scroll";

/** Design spec §14: ≤4 columns comfortable, 5–6 compact, 7+ scroll. */
export function densityFor(columns: number): Density {
  if (columns <= 4) return "comfortable";
  if (columns <= 6) return "compact";
  return "scroll";
}

/** The site palette KEY a RAG state paints with (defaults: good / atrisk
 *  / issue / neutral). Palettes are site-configured; never a hex here. */
export function ragPaletteKey(rag: Rag): string {
  switch (rag) {
    case "green":
      return "good";
    case "amber":
      return "atrisk";
    case "red":
      return "issue";
    default:
      return "neutral";
  }
}

/** The tally line's parts: [glyph, count, rag] triplets + the total —
 *  symbols not letters, always all three (design spec §3). */
export function tallyLine(t: Tally): { glyph: string; count: number; rag: Rag }[] {
  return [
    { glyph: "✓", count: t.green, rag: "green" },
    { glyph: "!", count: t.amber, rag: "amber" },
    { glyph: "✕", count: t.red, rag: "red" },
  ];
}

/** Lineage glyph line copy (design spec §3): "↑ Pacific" · "↓ 3 areas" ·
 *  "↓ 2 areas · 1 pending" · "↓ 3 areas · 1 declined". */
export function lineageWords(l: LineageSummary, unit = "org"): string[] {
  const out: string[] = [];
  if (l.from) out.push(`↑ ${orgName(l.from)}`);
  if (l.sent > 0) {
    const noun = l.sent === 1 ? unit : `${unit}s`;
    let s = `↓ ${l.sent} ${noun}`;
    const tails: string[] = [];
    if (l.pending > 0) tails.push(`${l.pending} pending`);
    if (l.declined > 0) tails.push(`${l.declined} declined`);
    if (l.held > 0) tails.push(`${l.held} on hold`);
    if (tails.length > 0) s += ` · ${tails.join(" · ")}`;
    out.push(s);
  }
  return out;
}

// ---- lifecycle (P2) ----------------------------------------------------------------

/** "Why is this closing?" — the design's fixed picklist (§10). */
export const CLOSE_REASONS = ["Achieved", "Superseded", "No longer relevant", "Carried to next period"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

/** A carry-forward copy: same statement, pillar, owner, org and order in
 *  the next period, linked back by `carriedFromId` in the caller's event.
 *  The copy has no parent — cascades are re-sent in the new period. */
export function carryForwardCopy(p: Priority, nextPeriodName: string, newId: string): Priority {
  return {
    ...p,
    rowId: undefined,
    id: newId,
    period: nextPeriodName,
    status: "active",
    statusReason: "",
    parentId: "",
    primaryInitiativeId: "",
  };
}

/** Children still active under a parent that has closed — the ones the
 *  "parent completed" prompt is for (§10). */
export function parentClosed(p: Priority, all: Priority[]): Priority | null {
  if (p.parentId === "" || p.status !== "active") return null;
  const parent = all.find((x) => x.id === p.parentId);
  return parent && parent.status !== "active" ? parent : null;
}

/** Sender's-view flags for a priority: who declined or parked it, with
 *  their reason (§10 copy). */
export function senderFlags(
  p: Priority,
  assignments: PriorityAssignment[]
): { kind: "declined" | "parked"; org: OrgRef; reason: string }[] {
  return assignments
    .filter((a) => a.priorityId === p.id && (a.status === "rejected" || a.status === "onhold"))
    .map((a) => ({ kind: a.status === "rejected" ? ("declined" as const) : ("parked" as const), org: a.org, reason: a.reason }));
}

/** Everything waiting on an org's decision: proposed first, then parked. */
export function reviewQueue(org: OrgRef, assignments: PriorityAssignment[]): PriorityAssignment[] {
  const key = orgKey(org);
  const mine = assignments.filter((a) => orgKey(a.org) === key);
  return [...mine.filter((a) => a.status === "proposed"), ...mine.filter((a) => a.status === "onhold")];
}

// ---- per-user presentation prefs (P3) -----------------------------------------------

export type ViewMode = "simple" | "dynamic";

export interface PriorityPrefs {
  /** orgKey → view mode (absent = simple). */
  viewByOrg: Record<string, ViewMode>;
  /** Last org visited (orgKey), restored on next open. */
  lastOrg: string;
  rule: RollupRule;
  showOther: boolean;
  groupByPillar: boolean;
}

/** Reads the `priorities` key of the person's ben_preferences JSON (the
 *  hub's own keys ride at the top level and are ignored here). */
export function parsePriorityPrefs(raw: string): PriorityPrefs {
  const d: PriorityPrefs = { viewByOrg: {}, lastOrg: "", rule: "strict", showOther: false, groupByPillar: false };
  try {
    const o = JSON.parse(raw || "{}") as { priorities?: unknown };
    const p = o && typeof o === "object" ? (o.priorities as Record<string, unknown> | undefined) : undefined;
    if (!p || typeof p !== "object") return d;
    const v = p.viewByOrg;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
        if (m === "simple" || m === "dynamic") d.viewByOrg[k] = m;
      }
    }
    if (typeof p.lastOrg === "string") d.lastOrg = p.lastOrg;
    if (p.rule === "ratio") d.rule = "ratio";
    d.showOther = p.showOther === true;
    d.groupByPillar = p.groupByPillar === true;
  } catch {
    /* defaults */
  }
  return d;
}
