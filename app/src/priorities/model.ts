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
  /** 1 = medium-term strategy (chips), 2 = strategic objective (columns). */
  level: 1 | 2;
  parentId: string; // "" for level 1
  color: string;
  order: number;
  active: boolean;
  company: string;
}

/** Level-2 pillars in display order, optionally under one L1. */
export function objectiveColumns(pillars: Pillar[], l1: string | null): Pillar[] {
  return pillars
    .filter((p) => p.level === 2 && p.active && (l1 === null || p.parentId === l1))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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
