// A Priorities view as a link (Ben, 2026-10-07): the org, period, status,
// view mode, pillar filter / focus, roll-up rule and the two Show
// toggles, carried as compact JSON on the player URL (`prview=`) the way
// a Documents view travels. Tolerant decode: a mangled link opens the
// plain Priorities tab.

export interface PrioritiesViewLink {
  /** The org key ("company|site|department|area"); "" = the viewer's default. */
  org: string;
  period: string;
  status: "active" | "completed" | "all" | "";
  view: "simple" | "dynamic" | "";
  l1: string;
  focus: string[];
  rule: "strict" | "ratio" | "";
  showOther: boolean | null;
  groupByPillar: boolean | null;
}

export function emptyPrioritiesViewLink(): PrioritiesViewLink {
  return { org: "", period: "", status: "", view: "", l1: "", focus: [], rule: "", showOther: null, groupByPillar: null };
}

export function encodePrioritiesView(v: PrioritiesViewLink): string {
  const o: Record<string, unknown> = {};
  if (v.org !== "") o.o = v.org;
  if (v.period !== "") o.p = v.period;
  if (v.status !== "") o.s = v.status;
  if (v.view !== "") o.v = v.view;
  if (v.l1 !== "") o.l = v.l1;
  if (v.focus.length > 0) o.f = v.focus;
  if (v.rule !== "") o.r = v.rule;
  if (v.showOther !== null) o.so = v.showOther ? 1 : 0;
  if (v.groupByPillar !== null) o.g = v.groupByPillar ? 1 : 0;
  return JSON.stringify(o);
}

const str = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

export function decodePrioritiesView(raw: string): PrioritiesViewLink {
  const out = emptyPrioritiesViewLink();
  const t = (raw ?? "").trim();
  if (t === "") return out;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (!o || typeof o !== "object") return out;
    out.org = str(o.o);
    out.period = str(o.p);
    const s = str(o.s);
    out.status = s === "active" || s === "completed" || s === "all" ? s : "";
    const v = str(o.v);
    out.view = v === "simple" || v === "dynamic" ? v : "";
    out.l1 = str(o.l);
    out.focus = Array.isArray(o.f) ? (o.f as unknown[]).map(str).filter((x) => x !== "") : [];
    const r = str(o.r);
    out.rule = r === "strict" || r === "ratio" ? r : "";
    out.showOther = o.so === 1 || o.so === true ? true : o.so === 0 || o.so === false ? false : null;
    out.groupByPillar = o.g === 1 || o.g === true ? true : o.g === 0 || o.g === false ? false : null;
    return out;
  } catch {
    return out;
  }
}
