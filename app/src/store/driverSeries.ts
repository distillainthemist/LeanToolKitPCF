// A driver's ACTUALS — one dated series per driver (Ben, 2026-09-02),
// stored in the card-series table under a virtual location so the values
// tab and every linked KPI card read and write the same points:
//   boardId "vdt" · cardId = driver id · seriesKey "actual" · date + shift.

import { applySeries, listSeries, listSeriesByPrefix } from "./series";
import { Cadence, Aggregate, foldSeries, SeriesPoint } from "../improvement/vdt/model";
import { isSpecSeriesKey, SPEC_SERIES_KEYS, SPEC_SERIES_PREFIX, SpecKind, SpecSeries, specSeriesFromCells, spreadOverBuckets } from "../../../shared/schema/specSeries";
import { DriverNode, setValue } from "../improvement/vdt/model";
import { foldValues, gridColumns, GridLocation } from "../improvement/vdt/gridModel";
import { loadGridCells } from "./gridCells";

export const DRIVER_SERIES_BOARD = "vdt";
export const DRIVER_SERIES_KEY = "actual";

/** The points inside [from, to] (yyyy-mm-dd, inclusive). */
export async function listDriverPoints(driverId: string, from: string, to: string): Promise<SeriesPoint[]> {
  const cells = await listSeries(DRIVER_SERIES_BOARD, driverId, from, to);
  return cells
    .filter((c) => c.key === DRIVER_SERIES_KEY)
    .map((c) => ({ date: c.date, shift: c.shift || "-", value: Number(c.value) }))
    .filter((p) => Number.isFinite(p.value));
}

/** Write (or overwrite) one point; an empty value deletes it. */
export async function putDriverPoint(driverId: string, date: string, shift: string, value: number | null): Promise<void> {
  const cell = { key: DRIVER_SERIES_KEY, date, shift: shift || "-", value: value === null ? "" : String(value) };
  if (value === null) await applySeries(DRIVER_SERIES_BOARD, driverId, [], [cell]);
  else await applySeries(DRIVER_SERIES_BOARD, driverId, [cell]);
}

/** A location's spec history up to `to` (any board/card — the driver's
 *  virtual location or an own card's). */
export async function listSpecSeries(boardId: string, cardId: string, to: string): Promise<SpecSeries> {
  return specSeriesFromCells(await listSeriesByPrefix(boardId, cardId, SPEC_SERIES_PREFIX, to));
}

/** Option C (Ben, 2026-09-08): a driver's target/limits live on the
 *  driver. Linking a surface whose level values are set to a driver
 *  that has NO spec yet seeds the driver's spec from them, dated at the
 *  current bucket. Returns true when it seeded. */
export async function seedDriverSpecIfEmpty(
  driverId: string,
  anchor: string,
  level: { target: number | null; lsl: number | null; usl: number | null }
): Promise<boolean> {
  if (level.target === null && level.lsl === null && level.usl === null) return false;
  const have = await listSpecSeries(DRIVER_SERIES_BOARD, driverId, "2999-12-31");
  if (have.plan.length + have.forecast.length + have.lsl.length + have.usl.length > 0) return false;
  const put = ([["plan", level.target], ["lsl", level.lsl], ["usl", level.usl]] as [SpecKind, number | null][])
    .filter(([, v]) => v !== null)
    .map(([k, v]) => ({ key: SPEC_SERIES_KEYS[k], date: anchor, shift: "-", value: String(v) }));
  await applySeries(DRIVER_SERIES_BOARD, driverId, put);
  return true;
}

/** A driver as a grid location (its rows from the format). */
export function driverLocation(n: Pick<DriverNode, "id" | "cadence" | "aggregate" | "format">): GridLocation {
  return { boardId: DRIVER_SERIES_BOARD, cardId: n.id, cadence: n.cadence, aggregate: n.aggregate, level: { target: null, lsl: null, usl: null }, rows: n.format.rows, isActual: (k) => k === DRIVER_SERIES_KEY };
}

/** The bucket is the unit of entry (Ben, 2026-09-09): a period's plan /
 *  forecast is the FOLD of its buckets' rows at the driver's aggregate.
 *  Re-fold after the grid writes so the tree, Read compare and Simulate
 *  (which read `values[period]`) agree with the buckets. Saves the node. */
export async function refoldDriverPeriod(
  n: DriverNode,
  period: string,
  window: { from: string; to: string },
  actor: { whoId: string; who: string },
  save: (n: DriverNode) => Promise<unknown>
): Promise<void> {
  const cells = await loadGridCells(driverLocation(n), window.from, window.to);
  let changed = false;
  for (const s of ["plan", "forecast"] as const) {
    if (!n.format.rows[s]) continue;
    const v = foldValues(cells.map((c) => c[s].value), n.aggregate);
    const cur = n.values[period]?.[s] ?? null;
    if (v === cur) continue;
    setValue(n, period, s, v, actor, new Date().toISOString());
    changed = true;
  }
  if (changed) await save(n);
}

/** Write a PERIOD plan / forecast (a finance pack, Adopt) as bucket
 *  points spread over the period (sum splits, others repeat), then set
 *  the period value to match. */
export async function writePeriodSpread(
  n: DriverNode,
  period: string,
  window: { from: string; to: string },
  series: "plan" | "forecast",
  value: number,
  actor: { whoId: string; who: string },
  save: (n: DriverNode) => Promise<unknown>
): Promise<void> {
  const cols = gridColumns(n.cadence, window.from, window.to).filter((c) => c.shift === "-" || c.shift === "D");
  const anchors = [...new Set(cols.map((c) => c.anchor))];
  const each = spreadOverBuckets(value, n.aggregate, anchors.length);
  await applySeries(
    DRIVER_SERIES_BOARD,
    n.id,
    anchors.map((date, i) => ({ key: SPEC_SERIES_KEYS[series], date, shift: "-", value: String(each[i]) }))
  );
  setValue(n, period, series, value, actor, new Date().toISOString());
  await save(n);
}

/** Write-through (Option C): set one spec value on the driver for the
 *  bucket holding `anchor`; null deletes that bucket's point. */
export async function putDriverSpec(driverId: string, kind: SpecKind, anchor: string, value: number | null): Promise<void> {
  const cell = { key: SPEC_SERIES_KEYS[kind], date: anchor, shift: "-", value: value === null ? "" : String(value) };
  if (value === null) await applySeries(DRIVER_SERIES_BOARD, driverId, [], [cell]);
  else await applySeries(DRIVER_SERIES_BOARD, driverId, [cell]);
}

/** The period's actual: the points in the window folded at the driver's
 *  cadence + aggregate. null = no points. */
export async function driverActual(driverId: string, from: string, to: string, cadence: Cadence, aggregate: Aggregate): Promise<number | null> {
  const pts = await listDriverPoints(driverId, from, to);
  return foldSeries(pts, cadence, aggregate);
}

// the date-keyed adapters (a linked KPI card's points ↔ the driver's
// cells) are pure and live in the model; re-exported here for callers
export { driverPointsFromCells, driverDiffPoints, windowDaysForCadence } from "../improvement/vdt/model";
export type { KpiLikePoint } from "../improvement/vdt/model";

/** Link/promote road: copy a card's private points into the driver's
 *  series where the driver has no point for that date/shift (the driver's
 *  dates win). Returns the tally for the dialog. */
export async function mergeCardSeriesIntoDriver(boardId: string, cardId: string, driverId: string): Promise<{ moved: number; kept: number }> {
  const [mine, theirs] = await Promise.all([
    listSeries(boardId, cardId, "1900-01-01", "2999-12-31"),
    listSeries(DRIVER_SERIES_BOARD, driverId, "1900-01-01", "2999-12-31"),
  ]);
  // spec cells (per-bucket target/limits, grid entry) travel under their
  // own keys; readings become the driver's actuals
  const keyOf = (c: { key: string }) => (isSpecSeriesKey(c.key) ? c.key : DRIVER_SERIES_KEY);
  const held = new Set(theirs.filter((c) => c.key === DRIVER_SERIES_KEY || isSpecSeriesKey(c.key)).map((c) => `${keyOf(c)}|${c.date}|${c.shift || "-"}`));
  const put: { key: string; date: string; shift: string; value: string }[] = [];
  let kept = 0;
  for (const c of mine) {
    if (c.value === "" || !Number.isFinite(Number(c.value))) continue;
    const key = keyOf(c);
    const k = `${key}|${c.date}|${c.shift || "-"}`;
    if (held.has(k)) {
      kept++;
      continue;
    }
    held.add(k);
    put.push({ key, date: c.date, shift: c.shift || "-", value: c.value });
  }
  if (put.length > 0) await applySeries(DRIVER_SERIES_BOARD, driverId, put);
  return { moved: put.length, kept };
}
