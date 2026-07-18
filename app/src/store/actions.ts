// Actions IO — the central table on the standard channel: rollups for
// cards, boards and the viewer; upsert by action id (the alternate key's
// purpose, emulated through the generated client).

import { LtkAction } from "../../../shared/schema/actions";
import { Ben_ltkactionsService } from "../generated/services/Ben_ltkactionsService";
import { allWhere, eq, odata, upsertWhere } from "./dv";
import { actionFromRow, actionToRow } from "./mappers";

export async function actionsForInstance(instanceId: string): Promise<LtkAction[]> {
  const rows = await allWhere(Ben_ltkactionsService.getAll, eq("ben_instanceid", instanceId));
  return rows.map(actionFromRow);
}

export async function actionsForBoard(boardId: string): Promise<LtkAction[]> {
  const rows = await allWhere(Ben_ltkactionsService.getAll, eq("ben_boardid", boardId));
  return rows.map(actionFromRow);
}

/** The viewer's rollup for LeanHub — their whoId appears in assignees. */
export async function actionsForViewer(whoId: string): Promise<LtkAction[]> {
  const rows = await allWhere(
    Ben_ltkactionsService.getAll,
    `contains(ben_assigneesjson, '${odata(`"whoId":"${whoId}"`)}')`
  );
  return rows.map(actionFromRow);
}

/** Upsert the emitted set — one row per action, keyed by action id. */
export async function upsertActions(
  actions: LtkAction[],
  boardId?: string
): Promise<void> {
  for (const action of actions) {
    await upsertWhere(
      Ben_ltkactionsService,
      eq("ben_actionid", action.id),
      (row) => row.ben_ltkactionid,
      actionToRow(action, boardId)
    );
  }
}
