// A driver's ACTUALS — one dated series per driver (Ben, 2026-09-02),
// stored in the card-series table under a virtual location so the values
// tab and every linked KPI card read and write the same points:
//   boardId "vdt" · cardId = driver id · seriesKey "actual" · date + shift.

import { applySeries, listSeries } from "./series";
import { Cadence, Aggregate, foldSeries, SeriesPoint } from "../improvement/vdt/model";

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

/** The period's actual: the points in the window folded at the driver's
 *  cadence + aggregate. null = no points. */
export async function driverActual(driverId: string, from: string, to: string, cadence: Cadence, aggregate: Aggregate): Promise<number | null> {
  const pts = await listDriverPoints(driverId, from, to);
  return foldSeries(pts, cadence, aggregate);
}
