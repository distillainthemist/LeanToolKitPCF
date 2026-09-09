// Load + resolve a location's grid cells (readings folded per bucket,
// spec carried forward): one windowed read for readings + one sparse read
// for the spec history up to the window's end. Shared by the grid
// component, the Metrics card's rows and the driver period re-fold.

import { listSeries, listSeriesByPrefix } from "./series";
import { SPEC_SERIES_PREFIX } from "../../../shared/schema/specSeries";
import { columnsWindow, GridCell, gridColumns, GridLocation, resolveGrid, splitGridCells } from "../improvement/vdt/gridModel";

export async function loadGridCells(loc: GridLocation, from: string, to: string, shiftsOf?: (actuals: { shift: string }[]) => string[]): Promise<GridCell[]> {
  const probe = gridColumns(loc.cadence, from, to, loc.shifts);
  const w = columnsWindow(probe);
  const [cells, specCells] = await Promise.all([
    listSeries(loc.boardId, loc.cardId, w.from, w.to),
    listSeriesByPrefix(loc.boardId, loc.cardId, SPEC_SERIES_PREFIX, w.to),
  ]);
  const { actuals } = splitGridCells(cells, loc.isActual);
  const { spec } = splitGridCells(specCells, () => false);
  const cols = loc.cadence === "shiftly" && shiftsOf ? gridColumns(loc.cadence, from, to, shiftsOf(actuals)) : probe;
  return resolveGrid(cols, actuals, spec, loc.level, loc.cadence, loc.aggregate);
}
