// A driver's ACTUALS — one dated series per driver (Ben, 2026-09-02),
// stored in the card-series table under a virtual location so the values
// tab and every linked KPI card read and write the same points:
//   boardId "vdt" · cardId = driver id · seriesKey "actual" · date + shift.

import { applySeries, listSeries, listSeriesByPrefix } from "./series";
import { Cadence, Aggregate, foldSeries, SeriesPoint } from "../improvement/vdt/model";
import { isSpecSeriesKey, SPEC_SERIES_PREFIX, SpecSeries, specSeriesFromCells } from "../../../shared/schema/specSeries";

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
