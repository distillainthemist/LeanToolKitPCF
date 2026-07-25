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
import {
  KeyedCell,
  partitionSeries,
  SeriesCell,
  SeriesWindowReq,
  unionWindow,
} from "./seriesMap";

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

// ---- batched reads ----
//
// A board opens every series card at once — five of them on a full board,
// each asking for its own window — so the reads arrive together and used to
// cost one round trip each. They are coalesced here rather than at the call
// sites: the mounters stay unchanged, and the card editor gets the same
// benefit for free.
//
// Requests that land in the same microtask are merged into ONE query over
// the union of their windows, filtered to just the cards asked for, then
// split back up by partitionSeries. Each caller sees exactly the rows it
// would have seen alone.

interface PendingRead extends SeriesWindowReq {
  resolve: (cells: SeriesCell[]) => void;
  reject: (err: unknown) => void;
}

const pendingReads = new Map<string, PendingRead[]>();

async function flushReads(boardId: string): Promise<void> {
  const batch = pendingReads.get(boardId) ?? [];
  pendingReads.delete(boardId);
  if (batch.length === 0) return;
  const window = unionWindow(batch);
  if (!window) return;
  try {
    const cardIds = [...new Set(batch.map((r) => r.cardId))];
    const cardFilter = cardIds.map((id) => eq("ben_cardid", id)).join(" or ");
    const rows = await allWhere(
      Ben_ltkcardseriesesService.getAll,
      `${eq("ben_boardid", boardId)} and (${cardFilter}) ` +
        `and ben_date ge ${window.from} and ben_date le ${window.to}`
    );
    const keyed: KeyedCell[] = rows.map((row) => ({
      ...fromRow(row),
      cardId: row.ben_cardid ?? "",
    }));
    const split = partitionSeries(keyed, batch);
    batch.forEach((req, i) => req.resolve(split[i]));
  } catch (err) {
    for (const req of batch) req.reject(err);
  }
}

/** The window's cells (dates inclusive). Coalesced — see above. */
export function listSeries(
  boardId: string,
  cardId: string,
  from: string,
  to: string
): Promise<SeriesCell[]> {
  return new Promise<SeriesCell[]>((resolve, reject) => {
    const batch = pendingReads.get(boardId);
    if (batch) {
      batch.push({ cardId, from, to, resolve, reject });
      return;
    }
    pendingReads.set(boardId, [{ cardId, from, to, resolve, reject }]);
    // microtask, not a timer: every card on a board mounts in one
    // synchronous render pass, so they are all queued by the time this runs
    queueMicrotask(() => {
      void flushReads(boardId);
    });
  });
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
