// Card Data IO — the per-instance rows and the shared-policy live rows
// (blank instance + boardId), plus the card save loop (outputJSON +
// tile svg in one update).

import type { Ben_ltkcarddatas } from "../generated/models/Ben_ltkcarddatasModel";
import { Ben_ltkcarddatasService } from "../generated/services/Ben_ltkcarddatasService";
import { allWhere, eq, firstWhere } from "./dv";
import { CardRowLite } from "./tiles";

export interface CardRow {
  id: string;
  cardId: string;
  instanceId: string; // "" = live row
  outputJson: string;
  tileSvg: string;
}

function fromRow(row: Ben_ltkcarddatas): CardRow {
  return {
    id: row.ben_ltkcarddataid,
    cardId: row.ben_cardid,
    instanceId: row._ben_instance_value ?? "",
    outputJson: row.ben_outputjson ?? "",
    tileSvg: row.ben_tilesvg ?? "",
  };
}

export function toLite(rows: CardRow[]): CardRowLite[] {
  return rows.map((r) => ({ cardId: r.cardId, instanceId: r.instanceId, tileSvg: r.tileSvg }));
}

/** Every row for a board — instance rows AND live rows — in one query. */
export async function rowsForBoard(boardId: string): Promise<CardRow[]> {
  const rows = await allWhere(Ben_ltkcarddatasService.getAll, eq("ben_boardid", boardId));
  return rows.map(fromRow);
}

export async function instanceRow(
  instanceGuid: string,
  cardId: string
): Promise<CardRow | null> {
  const row = await firstWhere(
    Ben_ltkcarddatasService.getAll,
    `_ben_instance_value eq ${instanceGuid} and ${eq("ben_cardid", cardId)}`
  );
  return row ? fromRow(row) : null;
}

export async function liveRow(boardId: string, cardId: string): Promise<CardRow | null> {
  const row = await firstWhere(
    Ben_ltkcarddatasService.getAll,
    `_ben_instance_value eq null and ${eq("ben_boardid", boardId)} and ${eq("ben_cardid", cardId)}`
  );
  return row ? fromRow(row) : null;
}

export async function createInstanceRow(
  instanceGuid: string,
  boardId: string,
  cardId: string,
  cardType: string,
  outputJson: string,
  tileSvg: string
): Promise<void> {
  await Ben_ltkcarddatasService.create({
    "ben_Instance@odata.bind": `/ben_ltkboardinstances(${instanceGuid})`,
    ben_boardid: boardId,
    ben_cardid: cardId,
    ben_cardtype: cardType,
    ben_name: cardId,
    ben_outputjson: outputJson,
    ben_tilesvg: tileSvg,
  } as never);
}

export async function ensureLiveRow(
  boardId: string,
  cardId: string,
  cardType: string
): Promise<void> {
  const existing = await liveRow(boardId, cardId);
  if (existing) return;
  await Ben_ltkcarddatasService.create({
    ben_boardid: boardId,
    ben_cardid: cardId,
    ben_cardtype: cardType,
    ben_name: cardId,
  } as never);
}

/** One row by its GUID — the rollup write-back's fresh read. null = gone. */
export async function cardRowById(rowGuid: string): Promise<CardRow | null> {
  const result = await Ben_ltkcarddatasService.get(rowGuid);
  if (result.success === false) {
    throw new Error(`Dataverse read failed: ${result.error?.message ?? "unknown error"}`);
  }
  return result.data ? fromRow(result.data) : null;
}

/**
 * The rollup's write-back: outputJson ONLY — never the tile svg, which
 * belongs to the source card's own snapshot road (saveCard would clobber
 * it with whatever the rollup held).
 */
export async function updateOutputJson(rowGuid: string, outputJson: string): Promise<void> {
  const result = await Ben_ltkcarddatasService.update(rowGuid, {
    ben_outputjson: outputJson,
  });
  if (result.success === false) {
    throw new Error(`Dataverse write failed: ${result.error?.message ?? "unknown error"}`);
  }
}

/** The card's OnChange save: document + fresh tile in one patch. */
export async function saveCard(
  rowGuid: string,
  outputJson: string,
  tileSvg: string
): Promise<void> {
  await Ben_ltkcarddatasService.update(rowGuid, {
    ben_outputjson: outputJson,
    // oversized exports fall back to the default tile rather than failing
    ben_tilesvg: tileSvg.length <= 190000 ? tileSvg : "",
  });
}

export async function stampArchiveSvg(
  instanceGuid: string,
  boardId: string,
  cardId: string,
  /** LinkCard: copy the SOURCE card's live svg instead of this board's. */
  from?: { boardId: string; cardId: string } | null
): Promise<void> {
  const [target, live] = await Promise.all([
    instanceRow(instanceGuid, cardId),
    liveRow(from?.boardId ?? boardId, from?.cardId ?? cardId),
  ]);
  if (target && live && live.tileSvg !== "") {
    await Ben_ltkcarddatasService.update(target.id, { ben_tilesvg: live.tileSvg });
  }
}
