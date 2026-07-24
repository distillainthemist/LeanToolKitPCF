// Card Series IO — the rolling time-keyed data behind the series cards
// (Conditions, SQDPC; later KPI, Pareto, StatusTile). One row per datum,
// windowed reads by date range, cell upserts/deletes keyed by
// (boardId, cardId, seriesKey, date, shift). See
// docs/leanboard-card-series-plan.md and store/seriesMap.ts for the pure
// document-key conversions.

import type { Ben_ltkcardserieses } from "../generated/models/Ben_ltkcardseriesesModel";
import { Ben_ltkcardseriesesService } from "../generated/services/Ben_ltkcardseriesesService";
import { currentViewer } from "../runtime";
import { allWhere, eq, firstWhere } from "./dv";
import { SeriesCell } from "./seriesMap";

function fromRow(row: Ben_ltkcardserieses): SeriesCell {
  return {
    key: row.ben_serieskey ?? "",
    date: (row.ben_date ?? "").slice(0, 10),
    shift: row.ben_shift ?? "-",
    value: row.ben_value ?? "",
  };
}

function cellFilter(boardId: string, cardId: string, c: SeriesCell): string {
  return [
    eq("ben_boardid", boardId),
    eq("ben_cardid", cardId),
    eq("ben_serieskey", c.key),
    `ben_date eq ${c.date}`,
    eq("ben_shift", c.shift),
  ].join(" and ");
}

/** The window's cells (dates inclusive). */
export async function listSeries(
  boardId: string,
  cardId: string,
  from: string,
  to: string
): Promise<SeriesCell[]> {
  const rows = await allWhere(
    Ben_ltkcardseriesesService.getAll,
    `${eq("ben_boardid", boardId)} and ${eq("ben_cardid", cardId)} and ben_date ge ${from} and ben_date le ${to}`
  );
  return rows.map(fromRow);
}

/** True when the card has ANY series rows (migration guard). */
export async function hasAnySeries(boardId: string, cardId: string): Promise<boolean> {
  const row = await firstWhere(
    Ben_ltkcardseriesesService.getAll,
    `${eq("ben_boardid", boardId)} and ${eq("ben_cardid", cardId)}`,
    ["ben_ltkcardseriesid"]
  );
  return row !== null;
}

/** Upsert one cell (find by the key tuple, update or create). */
async function putCell(boardId: string, cardId: string, c: SeriesCell): Promise<void> {
  const who = currentViewer()?.objectId ?? "";
  const existing = await firstWhere(
    Ben_ltkcardseriesesService.getAll,
    cellFilter(boardId, cardId, c),
    ["ben_ltkcardseriesid", "ben_value"]
  );
  if (existing) {
    if ((existing.ben_value ?? "") !== c.value) {
      await Ben_ltkcardseriesesService.update(existing.ben_ltkcardseriesid, {
        ben_value: c.value,
        ben_who: who,
      });
    }
    return;
  }
  await Ben_ltkcardseriesesService.create({
    ben_name: `${cardId} ${c.key} ${c.date}${c.shift === "-" ? "" : " " + c.shift}`,
    ben_boardid: boardId,
    ben_cardid: cardId,
    ben_serieskey: c.key,
    ben_date: c.date,
    ben_shift: c.shift,
    ben_value: c.value,
    ben_who: who,
  } as never);
}

async function deleteCell(boardId: string, cardId: string, c: SeriesCell): Promise<void> {
  const existing = await firstWhere(
    Ben_ltkcardseriesesService.getAll,
    cellFilter(boardId, cardId, c),
    ["ben_ltkcardseriesid"]
  );
  if (existing) await Ben_ltkcardseriesesService.delete(existing.ben_ltkcardseriesid);
}

/** Apply an edit's write set (chunked so a bulk seed doesn't stampede). */
export async function applySeries(
  boardId: string,
  cardId: string,
  put: SeriesCell[],
  del: SeriesCell[] = []
): Promise<void> {
  const CHUNK = 10;
  const ops = [
    ...put.map((c) => () => putCell(boardId, cardId, c)),
    ...del.map((c) => () => deleteCell(boardId, cardId, c)),
  ];
  for (let i = 0; i < ops.length; i += CHUNK) {
    await Promise.all(ops.slice(i, i + CHUNK).map((f) => f()));
  }
}
