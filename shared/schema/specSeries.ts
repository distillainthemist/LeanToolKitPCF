// Per-bucket spec (grid entry, 2026-09-08; rows 2026-09-09): a KPI's plan
// (= target — one thing, Ben), forecast, lower and upper limits as DATED
// series that carry forward — a bucket's (or a reading's) value is the
// latest point at or before its date, else the single level value held
// on the metric / card settings. Which ROWS a KPI has is configured on
// it (SpecRows); Actual is always present. Shared so the KPI card
// (controls/) and the app's grid agree on the rule.

export interface SpecPoint {
  date: string; // yyyy-mm-dd
  value: number;
}

export type SpecKind = "plan" | "forecast" | "lsl" | "usl";
export const SPEC_KINDS: SpecKind[] = ["plan", "forecast", "lsl", "usl"];
export const SPEC_LABELS: Record<SpecKind, string> = { plan: "Plan", forecast: "Forecast", lsl: "Lower limit", usl: "Upper limit" };

export type SpecSeries = Record<SpecKind, SpecPoint[]>;

export const EMPTY_SPEC_SERIES: SpecSeries = { plan: [], forecast: [], lsl: [], usl: [] };

/** Which rows a KPI carries (Actual always). */
export type SpecRows = Record<SpecKind, boolean>;
/** A value driver: finance's plan and forecast; limits opt-in. */
export const DEFAULT_ROWS_DRIVER: SpecRows = { plan: true, forecast: true, lsl: false, usl: false };
/** An own metric / a standalone KPI card: plan and limits; forecast opt-in. */
export const DEFAULT_ROWS_CARD: SpecRows = { plan: true, forecast: false, lsl: true, usl: true };

export function parseSpecRows(raw: unknown, defaults: SpecRows): SpecRows {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: SpecKind) => (typeof o[k] === "boolean" ? (o[k] as boolean) : defaults[k]);
  return { plan: pick("plan"), forecast: pick("forecast"), lsl: pick("lsl"), usl: pick("usl") };
}

/** The latest point dated at or before `date`; null when none. */
export function specAtDate(points: SpecPoint[], date: string): SpecPoint | null {
  let best: SpecPoint | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.value) || p.date > date) continue;
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

/** Resolve the spec in force at a date over the level values. `target`
 *  is the plan (the two are one thing; the name survives in card
 *  settings and metric definitions). */
export function specFor(
  series: SpecSeries,
  date: string,
  level: { target: number | null; lsl: number | null; usl: number | null }
): { target: number | null; forecast: number | null; lsl: number | null; usl: number | null } {
  return {
    target: specAtDate(series.plan, date)?.value ?? level.target,
    forecast: specAtDate(series.forecast, date)?.value ?? null,
    lsl: specAtDate(series.lsl, date)?.value ?? level.lsl,
    usl: specAtDate(series.usl, date)?.value ?? level.usl,
  };
}

/** Series keys of the spec cells in the card-series table — the `spec:`
 *  prefix keeps them out of an own card's points (whose keys are ids).
 *  `spec:target` is the legacy key of the plan row (read as plan). */
export const SPEC_SERIES_KEYS: Record<SpecKind, string> = { plan: "spec:plan", forecast: "spec:forecast", lsl: "spec:lsl", usl: "spec:usl" };
export const SPEC_SERIES_PREFIX = "spec:";
const LEGACY_PLAN_KEY = "spec:target";

export function isSpecSeriesKey(key: string): boolean {
  return key.startsWith(SPEC_SERIES_PREFIX);
}

export function specKindOfKey(key: string): SpecKind | null {
  if (key === LEGACY_PLAN_KEY) return "plan";
  return SPEC_KINDS.find((k) => SPEC_SERIES_KEYS[k] === key) ?? null;
}

/** Cells (any location) → the spec series; non-spec cells ignored. A
 *  `spec:plan` point beats a legacy `spec:target` one on the same date. */
export function specSeriesFromCells(cells: { key: string; date: string; value: string }[]): SpecSeries {
  const out: SpecSeries = { plan: [], forecast: [], lsl: [], usl: [] };
  const legacyPlan: SpecPoint[] = [];
  for (const c of cells) {
    const v = Number(c.value);
    if (c.value === "" || !Number.isFinite(v)) continue;
    const kind = specKindOfKey(c.key);
    if (!kind) continue;
    if (c.key === LEGACY_PLAN_KEY) legacyPlan.push({ date: c.date.slice(0, 10), value: v });
    else out[kind].push({ date: c.date.slice(0, 10), value: v });
  }
  const dates = new Set(out.plan.map((p) => p.date));
  for (const p of legacyPlan) if (!dates.has(p.date)) out.plan.push(p);
  for (const k of SPEC_KINDS) out[k].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** Spread a PERIOD value over its buckets (a finance-pack plan for a
 *  monthly driver): a sum aggregate splits it evenly; any other repeats
 *  it in every bucket, so folding the buckets back gives the value. */
export function spreadOverBuckets(value: number, aggregate: "sum" | "avg" | "last" | "min" | "max", buckets: number): number[] {
  if (buckets <= 0) return [];
  const each = aggregate === "sum" ? value / buckets : value;
  return Array.from({ length: buckets }, () => each);
}
