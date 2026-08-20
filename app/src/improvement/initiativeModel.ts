// Improvement — initiatives, the pure model (P5; design spec
// `leanboard-cascade-initiative-board-design.md` §1). An initiative is a
// header row: template SNAPSHOT (its resolved stages/gates/mandatory sets
// at creation — design 1.7's rule: only propagating fields read live),
// org by name, roles as {roleKey: people}, linked priorities with one
// primary, field values, metrics, the pending gate, stage target dates.
// History lives in ben_ltkinitiativeevent. Everything here is pure.

import type { InitiativeTemplate, RolePerson, TemplateMetric, TemplateStage, Gate } from "./templateModel";

export type InitiativeStatus = "active" | "completed" | "archived";
export type FlagLevel = "" | "flag" | "escalated";

export interface InitiativeSnapshot {
  stages: TemplateStage[];
  completeGate: Gate;
  /** Role keys → labels as they read at creation (labels propagate live
   *  from the template when it still exists; these are the fallback). */
  roleLabels: Record<string, string>;
  metrics: TemplateMetric[];
}

export interface PriorityLink {
  priorityId: string;
  primary: boolean;
}

export interface PendingGate {
  /** Stage ids either side of the boundary ("" → the complete gate). */
  from: string;
  to: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  /** Role key → decision. */
  decisions: Record<string, { by: string; byName: string; at: string; approved: boolean; comment: string }>;
  approverRoles: string[];
}

export interface Initiative {
  rowId?: string;
  id: string;
  title: string;
  templateId: string;
  method: string;
  description: string;
  singleAction: boolean;
  org: { company: string; site: string; department: string; area: string };
  stageId: string;
  status: InitiativeStatus;
  confidential: boolean;
  flag: FlagLevel;
  flagNote: string;
  endorsement: boolean;
  period: string;
  boardId: string;
  snapshot: InitiativeSnapshot;
  roles: Record<string, RolePerson[]>;
  priorities: PriorityLink[];
  fieldValues: Record<string, string>;
  metrics: TemplateMetric[];
  gate: PendingGate | null;
  /** stage id → target date (ISO), derived from target weeks at creation. */
  stageTargets: Record<string, string>;
}

/** The resolved copy an initiative keeps of its template (design 1.7). */
export function snapshotOf(t: InitiativeTemplate): InitiativeSnapshot {
  return {
    stages: t.stages.map((s) => ({ ...s, gate: { ...s.gate, approverRoles: [...s.gate.approverRoles] } })),
    completeGate: { ...t.completeGate, approverRoles: [...t.completeGate.approverRoles] },
    roleLabels: Object.fromEntries(t.roles.map((r) => [r.key, r.label])),
    metrics: t.metrics.map((m) => ({ ...m })),
  };
}

/** Stage target dates from the template's target-week hints, cumulative
 *  from the creation date; stages without a hint get no date. */
export function stageTargetsFrom(stages: TemplateStage[], createdIso: string): Record<string, string> {
  const out: Record<string, string> = {};
  const base = new Date(`${createdIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return out;
  let weeks = 0;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (const s of stages) {
    if (s.targetWeeks === null) continue;
    weeks += s.targetWeeks;
    // local date arithmetic — toISOString would shift across the UTC line
    out[s.id] = iso(new Date(base.getTime() + weeks * 7 * 86_400_000));
  }
  return out;
}

/** "Do → Check, 28 Aug" — the next boundary and its target ("" parts when
 *  unknown). null when the initiative is done or has no stages. */
export function nextGateFor(i: Pick<Initiative, "snapshot" | "stageId" | "stageTargets" | "status">): {
  fromName: string;
  toName: string;
  gated: boolean;
  approverRoles: string[];
  target: string;
} | null {
  if (i.status !== "active") return null;
  const stages = i.snapshot.stages;
  if (stages.length === 0) return null;
  const idx = Math.max(0, stages.findIndex((s) => s.id === i.stageId));
  const cur = stages[idx];
  const next = stages[idx + 1] ?? null;
  const gate = cur.gate.enabled ? cur.gate : next === null && i.snapshot.completeGate.enabled ? i.snapshot.completeGate : null;
  return {
    fromName: cur.name,
    toName: next ? next.name : "Complete",
    gated: gate !== null,
    approverRoles: gate?.approverRoles ?? [],
    target: i.stageTargets[cur.id] ?? "",
  };
}

// ---- the Improvement tab's three groups (design 1.1) --------------------------------

export interface ImprovementViewer {
  whoId: string;
  /** Org keys (company|site|department|area, blanks for depth) the viewer OWNS. */
  ownedOrgKeys: string[];
  isAdmin: boolean;
}

export function orgKeyOf(o: Initiative["org"]): string {
  return [o.company, o.site, o.department, o.area].join("|");
}

/** Is `org` at or under an owned key ("Pechey|Mine||" owns "Pechey|Mine|Ops|"). */
function underKey(orgKey: string, ownedKey: string): boolean {
  const a = orgKey.split("|");
  const b = ownedKey.split("|");
  for (let i = 0; i < 4; i++) {
    if (b[i] !== "" && b[i] !== a[i]) return false;
  }
  return true;
}

/** The role keys the viewer holds on an initiative. */
export function myRoles(i: Initiative, whoId: string): string[] {
  return Object.entries(i.roles)
    .filter(([, people]) => people.some((p) => p.whoId === whoId))
    .map(([key]) => key);
}

/** Confidentiality (§5 decision 11): role-holders + org owners + admins. */
export function canSee(i: Initiative, v: ImprovementViewer): boolean {
  if (!i.confidential) return true;
  if (v.isAdmin) return true;
  if (myRoles(i, v.whoId).length > 0) return true;
  return v.ownedOrgKeys.some((k) => underKey(orgKeyOf(i.org), k));
}

export interface ImprovementGroups {
  mine: Initiative[];
  team: Initiative[];
  all: Initiative[];
  hiddenConfidential: number;
}

export function groupInitiatives(list: Initiative[], v: ImprovementViewer): ImprovementGroups {
  const visible = list.filter((i) => canSee(i, v));
  return {
    mine: visible.filter((i) => myRoles(i, v.whoId).length > 0),
    team: visible.filter((i) => v.ownedOrgKeys.some((k) => underKey(orgKeyOf(i.org), k))),
    all: visible,
    hiddenConfidential: list.length - visible.length,
  };
}

// ---- parse / serialize ------------------------------------------------------------

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSnapshot(raw: string): InitiativeSnapshot {
  try {
    const o = obj(JSON.parse(raw || "{}"));
    const stages = arr(o.stages)
      .map((x) => obj(x))
      .map((x, i) => ({
        id: str(x.id) || `st-${i + 1}`,
        name: str(x.name),
        pdca: (["plan", "do", "check", "act"].includes(str(x.pdca)) ? str(x.pdca) : "plan") as TemplateStage["pdca"],
        targetWeeks: typeof x.targetWeeks === "number" ? x.targetWeeks : null,
        gate: { enabled: bool(obj(x.gate).enabled), approverRoles: arr(obj(x.gate).approverRoles).map((r) => str(r)).filter((r) => r !== "") },
      }))
      .filter((s) => s.name !== "");
    const cg = obj(o.completeGate);
    const roleLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(o.roleLabels))) if (typeof v === "string") roleLabels[k] = v;
    return {
      stages,
      completeGate: { enabled: bool(cg.enabled), approverRoles: arr(cg.approverRoles).map((r) => str(r)).filter((r) => r !== "") },
      roleLabels,
      metrics: arr(o.metrics)
        .map((x) => obj(x))
        .map((x) => ({
          key: str(x.key),
          name: str(x.name),
          unit: str(x.unit),
          target: typeof x.target === "number" ? x.target : null,
          goodDirection: (["up", "down", "range"].includes(str(x.goodDirection)) ? str(x.goodDirection) : "up") as TemplateMetric["goodDirection"],
          tracking: (["value", "goodbad", "picklist"].includes(str(x.tracking)) ? str(x.tracking) : "value") as TemplateMetric["tracking"],
        }))
        .filter((m) => m.key !== ""),
    };
  } catch {
    return { stages: [], completeGate: { enabled: false, approverRoles: [] }, roleLabels: {}, metrics: [] };
  }
}

export function parseRolesJson(raw: string): Record<string, RolePerson[]> {
  try {
    const out: Record<string, RolePerson[]> = {};
    for (const [k, v] of Object.entries(obj(JSON.parse(raw || "{}")))) {
      const people = arr(v)
        .map((p) => obj(p))
        .map((p) => ({ whoId: str(p.whoId), who: str(p.who) }))
        .filter((p) => p.whoId !== "" && p.who !== "");
      if (people.length > 0) out[k] = people;
    }
    return out;
  } catch {
    return {};
  }
}

export function parsePriorityLinks(raw: string): PriorityLink[] {
  try {
    return arr(JSON.parse(raw || "[]"))
      .map((x) => obj(x))
      .map((x) => ({ priorityId: str(x.priorityId), primary: bool(x.primary) }))
      .filter((x) => x.priorityId !== "");
  } catch {
    return [];
  }
}

export function parseStringMap(raw: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(JSON.parse(raw || "{}")))) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function parsePendingGate(raw: string): PendingGate | null {
  try {
    const o = obj(JSON.parse(raw || "null"));
    if (str(o.to) === "" && str(o.from) === "") return null;
    const decisions: PendingGate["decisions"] = {};
    for (const [k, v] of Object.entries(obj(o.decisions))) {
      const d = obj(v);
      decisions[k] = { by: str(d.by), byName: str(d.byName), at: str(d.at), approved: bool(d.approved), comment: str(d.comment) };
    }
    return {
      from: str(o.from),
      to: str(o.to),
      requestedById: str(o.requestedById),
      requestedByName: str(o.requestedByName),
      requestedAt: str(o.requestedAt),
      decisions,
      approverRoles: arr(o.approverRoles).map((r) => str(r)).filter((r) => r !== ""),
    };
  } catch {
    return null;
  }
}

/** What blocks creating an initiative from a header form. */
export function validateNewInitiative(i: Pick<Initiative, "title" | "org" | "metrics" | "singleAction" | "roles">): string[] {
  const errs: string[] = [];
  if (i.title.trim() === "") errs.push("A title is needed.");
  if (i.org.site === "" && i.org.company === "") errs.push("Pick the org this initiative belongs to.");
  if (!(i.roles.owner ?? []).length) errs.push("An owner is needed.");
  for (const m of i.metrics) if (m.tracking === "value" && m.target === null) errs.push(`Metric "${m.name}" needs a target.`);
  return errs;
}
