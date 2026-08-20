// Improvement — initiative templates, the pure model (design review 11a;
// plan decision 3/5 + "model additions"). A template is: method · stages
// (each mapped to one of the four fixed PDCA tokens, optional target
// weeks, an optional GATE after it = approver roles) · the always-shown
// Complete gate · roles (the five standard + template-specific) · custom
// header fields · mandatory metrics · a template board (project kind,
// isTemplate) whose slots carry {stage, mandatory}. Everything here is
// pure and tested; the store maps it to ben_ltkinitiativetemplate.

export type Pdca = "plan" | "do" | "check" | "act";

/** Fixed app-wide PDCA tokens (design: Plan amber · Do blue · Check green
 *  · Act purple) — chips, stepper and stage tags all wear these. */
export const PDCA_TOKENS: Record<Pdca, { label: string; fg: string; bg: string }> = {
  plan: { label: "Plan", fg: "#7a4d00", bg: "#fff3d6" },
  do: { label: "Do", fg: "#1d4ed8", bg: "#dbe7ff" },
  check: { label: "Check", fg: "#1f7a3f", bg: "#dcf3e3" },
  act: { label: "Act", fg: "#6b21a8", bg: "#ecdcfb" },
};
export const PDCA_ORDER: Pdca[] = ["plan", "do", "check", "act"];

export interface Gate {
  enabled: boolean;
  /** Role keys that must approve the boundary (one or more). */
  approverRoles: string[];
}

export interface TemplateStage {
  id: string;
  name: string;
  pdca: Pdca;
  /** Target duration hint, weeks; null = none. */
  targetWeeks: number | null;
  /** The gate AFTER this stage (the boundary to the next one). */
  gate: Gate;
}

export interface TemplateRole {
  key: string;
  label: string;
  /** One of the five standard roles (locked key, editable label). */
  standard: boolean;
  multi: boolean;
  timeCommitment: boolean;
}

export type FieldKind = "text" | "longtext" | "number" | "date" | "picklist" | "person";

export interface TemplateField {
  key: string;
  label: string;
  kind: FieldKind;
  options: string[]; // picklist
  required: boolean;
}

export type GoodDirection = "up" | "down" | "range";
export type Tracking = "value" | "goodbad" | "picklist";

export interface TemplateMetric {
  key: string;
  name: string;
  unit: string;
  target: number | null;
  goodDirection: GoodDirection;
  tracking: Tracking;
}

export interface InitiativeTemplate {
  rowId?: string;
  id: string;
  name: string;
  method: string;
  description: string;
  singleAction: boolean;
  active: boolean;
  order: number;
  company: string;
  stages: TemplateStage[];
  /** The final boundary — always shown, gated or not. */
  completeGate: Gate;
  roles: TemplateRole[];
  fields: TemplateField[];
  metrics: TemplateMetric[];
  /** The template board's boardId ("" until the Cards step creates it). */
  boardId: string;
}

/** The default methods list — the app-level Settings → Improvement list
 *  starts from these and is fully editable (Ben, 2026-08-19: methods are
 *  configuration, so problem-solving types can be tracked across template
 *  versions). */
export const METHODS = ["A3", "DMAIC", "Kaizen", "8D", "Project", "Single action"];

export interface RolePerson {
  whoId: string;
  who: string;
}

/** A company-wide standard role, FILLED PER SITE (Ben, 2026-08-19): the
 *  people who hold it at each site. When an initiative on that site has
 *  an approval step assigned to this role, ANY of the site's people may
 *  complete it (the resolution rule P6's gates implement). */
export interface StandardRole extends TemplateRole {
  /** site → the people filling the role there. */
  people: Record<string, RolePerson[]>;
}

/** App-level improvement settings (ben_improvementsettings on the APP_ROW). */
export interface ImprovementSettings {
  methods: string[];
  standardRoles: StandardRole[];
  /** Header fields EVERY initiative carries, template regardless (Ben,
   *  2026-08-20) — the counterpart of standard roles. Templates add their
   *  own on top in the wizard's Fields step. */
  standardFields: TemplateField[];
}

/** The people who may act for a role on a SITE's initiative: the role's
 *  list for that site. Pure — P6's approval gates call this. */
export function roleFillersAt(role: StandardRole, site: string): RolePerson[] {
  return role.people[site] ?? [];
}

export function parseImprovementSettings(raw: string): ImprovementSettings {
  try {
    const o = JSON.parse(raw || "{}") as { methods?: unknown; standardRoles?: unknown };
    const methods = Array.isArray(o.methods) ? o.methods.filter((m): m is string => typeof m === "string" && m.trim() !== "") : [];
    const roles: StandardRole[] = Array.isArray(o.standardRoles)
      ? o.standardRoles
          .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
          .map((x) => {
            const people: Record<string, RolePerson[]> = {};
            if (x.people && typeof x.people === "object" && !Array.isArray(x.people)) {
              for (const [site, list] of Object.entries(x.people as Record<string, unknown>)) {
                if (!Array.isArray(list)) continue;
                const clean = list
                  .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
                  .map((p) => ({ whoId: typeof p.whoId === "string" ? p.whoId : "", who: typeof p.who === "string" ? p.who : "" }))
                  .filter((p) => p.whoId !== "" && p.who !== "");
                if (clean.length > 0) people[site] = clean;
              }
            }
            return {
              key: typeof x.key === "string" ? x.key : "",
              label: typeof x.label === "string" ? x.label : "",
              standard: true,
              multi: x.multi !== false,
              timeCommitment: x.timeCommitment === true,
              people,
            };
          })
          .filter((r) => r.key !== "" && r.label !== "")
      : [];
    const fields = Array.isArray((o as { standardFields?: unknown }).standardFields)
      ? parseFields(JSON.stringify((o as { standardFields?: unknown }).standardFields))
      : [];
    return { methods: methods.length > 0 ? methods : [...METHODS], standardRoles: roles, standardFields: fields };
  } catch {
    return { methods: [...METHODS], standardRoles: [], standardFields: [] };
  }
}

export function serializeImprovementSettings(s: ImprovementSettings): string {
  return JSON.stringify({
    methods: s.methods,
    standardRoles: s.standardRoles.map((r) => ({ key: r.key, label: r.label, multi: r.multi, timeCommitment: r.timeCommitment, people: r.people })),
    standardFields: s.standardFields,
  });
}

/** Standard stage sets per method — offered as a starting point when the
 *  method is chosen (design 1.1b), never forced. */
export const METHOD_PRESETS: Record<string, { name: string; pdca: Pdca }[]> = {
  A3: [
    { name: "Understand", pdca: "plan" },
    { name: "Trial", pdca: "do" },
    { name: "Confirm", pdca: "check" },
    { name: "Embed", pdca: "act" },
  ],
  DMAIC: [
    { name: "Define", pdca: "plan" },
    { name: "Measure", pdca: "plan" },
    { name: "Analyse", pdca: "plan" },
    { name: "Improve", pdca: "do" },
    { name: "Control", pdca: "check" },
  ],
  Kaizen: [
    { name: "Prepare", pdca: "plan" },
    { name: "Event", pdca: "do" },
    { name: "Follow-up", pdca: "check" },
    { name: "Sustain", pdca: "act" },
  ],
  "8D": [
    { name: "Team & describe", pdca: "plan" },
    { name: "Contain", pdca: "do" },
    { name: "Root cause", pdca: "plan" },
    { name: "Corrective action", pdca: "do" },
    { name: "Verify", pdca: "check" },
    { name: "Prevent", pdca: "act" },
  ],
  Project: [
    { name: "Initiate", pdca: "plan" },
    { name: "Plan", pdca: "plan" },
    { name: "Execute", pdca: "do" },
    { name: "Close", pdca: "check" },
  ],
};

export function presetStages(method: string): TemplateStage[] {
  const rows = METHOD_PRESETS[method] ?? [];
  const taken: string[] = [];
  return rows.map((r) => {
    const id = keyFor("st_" + r.name, taken);
    taken.push(id);
    return { id, name: r.name, pdca: r.pdca, targetWeeks: null, gate: { enabled: false, approverRoles: [] } };
  });
}

export const STANDARD_ROLES: TemplateRole[] = [
  { key: "sponsor", label: "Sponsor", standard: true, multi: false, timeCommitment: false },
  { key: "owner", label: "Owner", standard: true, multi: false, timeCommitment: false },
  { key: "lead", label: "Improvement lead", standard: true, multi: false, timeCommitment: false },
  { key: "team", label: "Team", standard: true, multi: true, timeCommitment: true },
  { key: "support", label: "Support", standard: true, multi: true, timeCommitment: false },
];

/** A fresh template: the standard roles, a Plan→Do→Check→Act skeleton,
 *  Complete gated by the sponsor. */
export function newTemplate(id: string): InitiativeTemplate {
  return {
    id,
    name: "",
    method: "A3",
    description: "",
    singleAction: false,
    active: true,
    order: 0,
    company: "",
    stages: [
      { id: "st-plan", name: "Understand", pdca: "plan", targetWeeks: null, gate: { enabled: false, approverRoles: [] } },
      { id: "st-do", name: "Trial", pdca: "do", targetWeeks: null, gate: { enabled: false, approverRoles: [] } },
      { id: "st-check", name: "Confirm", pdca: "check", targetWeeks: null, gate: { enabled: false, approverRoles: [] } },
      { id: "st-act", name: "Embed", pdca: "act", targetWeeks: null, gate: { enabled: false, approverRoles: [] } },
    ],
    completeGate: { enabled: true, approverRoles: ["sponsor"] },
    roles: STANDARD_ROLES.map((r) => ({ ...r })),
    fields: [],
    metrics: [],
    boardId: "",
  };
}

// ---- parse / serialize (the JSON columns) -------------------------------------

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function parseGate(v: unknown): Gate {
  const o = obj(v);
  return { enabled: bool(o.enabled), approverRoles: arr(o.approverRoles).map((x) => str(x)).filter((x) => x !== "") };
}

function isPdca(v: unknown): v is Pdca {
  return v === "plan" || v === "do" || v === "check" || v === "act";
}

/** stagesjson = {stages:[…], completeGate:{…}} (one column, two parts). */
export function parseStages(raw: string): { stages: TemplateStage[]; completeGate: Gate } {
  try {
    const o = obj(JSON.parse(raw || "{}"));
    const stages = arr(o.stages)
      .map((x) => obj(x))
      .map((x, i) => ({
        id: str(x.id) || `st-${i + 1}`,
        name: str(x.name),
        pdca: isPdca(x.pdca) ? x.pdca : ("plan" as Pdca),
        targetWeeks: num(x.targetWeeks),
        gate: parseGate(x.gate),
      }))
      .filter((s) => s.name !== "");
    return { stages, completeGate: o.completeGate ? parseGate(o.completeGate) : { enabled: true, approverRoles: ["sponsor"] } };
  } catch {
    return { stages: [], completeGate: { enabled: true, approverRoles: ["sponsor"] } };
  }
}

export function serializeStages(stages: TemplateStage[], completeGate: Gate): string {
  return JSON.stringify({ stages, completeGate });
}

export function parseRoles(raw: string): TemplateRole[] {
  try {
    const list = arr(JSON.parse(raw || "[]"))
      .map((x) => obj(x))
      .map((x) => ({
        key: str(x.key),
        label: str(x.label),
        standard: bool(x.standard),
        multi: bool(x.multi),
        timeCommitment: bool(x.timeCommitment),
      }))
      .filter((r) => r.key !== "" && r.label !== "");
    // the five standard roles always exist (labels may be edited)
    for (const s of STANDARD_ROLES) if (!list.some((r) => r.key === s.key)) list.push({ ...s });
    return list;
  } catch {
    return STANDARD_ROLES.map((r) => ({ ...r }));
  }
}

export function parseFields(raw: string): TemplateField[] {
  try {
    return arr(JSON.parse(raw || "[]"))
      .map((x) => obj(x))
      .map((x) => ({
        key: str(x.key),
        label: str(x.label),
        kind: (["text", "longtext", "number", "date", "picklist", "person"].includes(str(x.kind)) ? str(x.kind) : "text") as FieldKind,
        options: arr(x.options).map((o) => str(o)).filter((o) => o !== ""),
        required: bool(x.required),
      }))
      .filter((f) => f.key !== "" && f.label !== "");
  } catch {
    return [];
  }
}

export function parseMetrics(raw: string): TemplateMetric[] {
  try {
    return arr(JSON.parse(raw || "[]"))
      .map((x) => obj(x))
      .map((x) => ({
        key: str(x.key),
        name: str(x.name),
        unit: str(x.unit),
        target: num(x.target),
        goodDirection: (["up", "down", "range"].includes(str(x.goodDirection)) ? str(x.goodDirection) : "up") as GoodDirection,
        tracking: (["value", "goodbad", "picklist"].includes(str(x.tracking)) ? str(x.tracking) : "value") as Tracking,
      }))
      .filter((m) => m.key !== "" && m.name !== "");
  } catch {
    return [];
  }
}

// ---- helpers -----------------------------------------------------------------------

/** A stable key from a label ("Finance lead" → "finance_lead"), unique among taken. */
export function keyFor(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  let k = base;
  let i = 2;
  while (taken.includes(k)) k = `${base}_${i++}`;
  return k;
}

/** The boundaries the stepper renders: each stage, then Complete — with
 *  a ⚑ where the boundary AFTER it is gated (the Complete chip carries
 *  the complete gate). */
export function stepperChips(t: Pick<InitiativeTemplate, "stages" | "completeGate">): { label: string; pdca: Pdca | null; gated: boolean }[] {
  const out: { label: string; pdca: Pdca | null; gated: boolean }[] = t.stages.map((s, i) => ({
    label: s.name,
    pdca: s.pdca as Pdca | null,
    // a ⚑ marks the chip you move INTO through a gate: stage i+1 is gated
    // when stage i's gate is on
    gated: i > 0 && t.stages[i - 1].gate.enabled,
  }));
  out.push({
    label: "Complete",
    pdca: null,
    gated: t.completeGate.enabled || (t.stages.length > 0 && t.stages[t.stages.length - 1].gate.enabled),
  });
  return out;
}

/** What stops a template being usable. */
export function validateTemplate(t: InitiativeTemplate): string[] {
  const errs: string[] = [];
  if (t.name.trim() === "") errs.push("A name is needed.");
  if (!t.singleAction && t.stages.length === 0) errs.push("At least one stage (single-action templates have none).");
  const roleKeys = new Set(t.roles.map((r) => r.key));
  const gates = [...t.stages.map((s) => s.gate), t.completeGate];
  for (const g of gates) {
    if (g.enabled && g.approverRoles.length === 0) errs.push("Every gate that is on needs at least one approver role.");
    for (const r of g.approverRoles) if (!roleKeys.has(r)) errs.push(`Gate approver "${r}" is not a role on this template.`);
  }
  const names = t.stages.map((s) => s.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) errs.push("Stage names must be unique.");
  if (t.stages.some((s) => s.name.trim() === "")) errs.push("Every stage needs a name.");
  // every mandatory metric needs a target and a direction before save (design 1.4)
  for (const m of t.metrics) if (m.tracking === "value" && m.target === null) errs.push(`Metric "${m.name}" needs a target.`);
  if (!t.singleAction && t.boardId === "" ) errs.push("The initiative board has not been laid out yet (step 6).");
  return [...new Set(errs)];
}

/**
 * Propagation rule for editing a template that live initiatives use
 * (design 11a's amber note): renamed stages, new roles and new optional
 * cards REACH running initiatives; changes to stage order, gates,
 * mandatory cards and mandatory metrics apply to NEW initiatives only.
 * Returns the two lists as words for the note.
 */
export function propagationNote(usage: number): { reach: string; newOnly: string; headline: string } {
  return {
    headline: usage === 0 ? "No initiatives are running on this template yet." : `${usage} initiative${usage === 1 ? " is" : "s are"} running on this template.`,
    reach: "Renamed stages, new roles and new optional cards reach them.",
    newOnly: "Changes to stage order, gates, mandatory cards and mandatory metrics apply to new initiatives only.",
  };
}

/** Slot flags on the template board manifest (per-slot settings). */
export interface SlotTemplateFlags {
  stage: string; // stage id; "" = every stage
  mandatory: boolean;
}

export function slotFlags(settings: Record<string, unknown>): SlotTemplateFlags {
  const tpl = obj(settings.template);
  return { stage: str(tpl.stage), mandatory: bool(tpl.mandatory) };
}

export function withSlotFlags(settings: Record<string, unknown>, flags: SlotTemplateFlags): Record<string, unknown> {
  const next = { ...settings };
  if (flags.stage === "" && !flags.mandatory) delete next.template;
  else next.template = { stage: flags.stage, mandatory: flags.mandatory };
  return next;
}
