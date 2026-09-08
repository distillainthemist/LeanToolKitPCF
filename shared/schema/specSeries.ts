// Per-bucket spec (grid entry, 2026-09-08): a KPI's target / lower / upper
// as DATED series that carry forward — a column's (or a reading's) spec is
// the latest spec point at or before its date, else the single level value
// held on the metric / card settings. Shared so the KPI card (controls/)
// and the app's grid agree on the rule.

export interface SpecPoint {
  date: string; // yyyy-mm-dd
  value: number;
}

export interface SpecSeries {
  target: SpecPoint[];
  lsl: SpecPoint[];
  usl: SpecPoint[];
}

export const EMPTY_SPEC_SERIES: SpecSeries = { target: [], lsl: [], usl: [] };

/** The latest point dated at or before `date`; null when none. */
export function specAtDate(points: SpecPoint[], date: string): SpecPoint | null {
  let best: SpecPoint | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.value) || p.date > date) continue;
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

/** Resolve all three at a date over the level values. */
export function specFor(
  series: SpecSeries,
  date: string,
  level: { target: number | null; lsl: number | null; usl: number | null }
): { target: number | null; lsl: number | null; usl: number | null } {
  return {
    target: specAtDate(series.target, date)?.value ?? level.target,
    lsl: specAtDate(series.lsl, date)?.value ?? level.lsl,
    usl: specAtDate(series.usl, date)?.value ?? level.usl,
  };
}

/** Series keys of the spec cells in the card-series table — the `spec:`
 *  prefix keeps them out of an own card's points (whose keys are ids). */
export const SPEC_SERIES_KEYS = { target: "spec:target", lsl: "spec:lsl", usl: "spec:usl" } as const;
export const SPEC_SERIES_PREFIX = "spec:";

export function isSpecSeriesKey(key: string): boolean {
  return key.startsWith(SPEC_SERIES_PREFIX);
}

/** Cells (any location) → the spec series; non-spec cells ignored. */
export function specSeriesFromCells(cells: { key: string; date: string; value: string }[]): SpecSeries {
  const out: SpecSeries = { target: [], lsl: [], usl: [] };
  for (const c of cells) {
    const v = Number(c.value);
    if (c.value === "" || !Number.isFinite(v)) continue;
    const kind = (Object.keys(SPEC_SERIES_KEYS) as (keyof SpecSeries)[]).find((k) => SPEC_SERIES_KEYS[k] === c.key);
    if (kind) out[kind].push({ date: c.date.slice(0, 10), value: v });
  }
  for (const k of Object.keys(out) as (keyof SpecSeries)[]) out[k].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
