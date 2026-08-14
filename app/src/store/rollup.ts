// Capture-rollup IO — resolving each linked Capture card to the occurrence
// window's documents (the multi-source generalisation of linkCard.ts), and
// the read-modify-write write-back. All decisions live in
// controls/CaptureRollup/types.ts (pure, tested); this module executes them.

import {
  parseCapture,
  parseColumns as parseCaptureColumns,
} from "../../../controls/CaptureCard/types";
import {
  mutateCaptureRowJson,
  pickWindowDocs,
  ResolvedRollupSource,
  RollupSource,
  RollupWindow,
  SourceDoc,
} from "../../../controls/CaptureRollup/types";
import type { CaptureRow } from "../../../controls/CaptureCard/types";
import { cardLabel } from "../../../controls/CardSettings/registry";
import { nowIso } from "../../../shared/schema/id";
import { getBoard } from "./boards";
import { cardRowById, rowsForBoard, updateOutputJson } from "./cards";
import { listInstances } from "./instances";
import { parseManifest, slotPolicy } from "./mappers";

/** A slot config value as the raw string the control parsers expect —
 *  CardSettings stores structured fields as arrays/objects (cfgRaw's rule). */
function slotCfgRaw(settings: Record<string, unknown>, key: string): string {
  const config = settings.config;
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const v = c[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

/** Resolve every configured source — one failure never sinks the rest. */
export async function loadRollupSources(
  sources: RollupSource[],
  window: RollupWindow
): Promise<ResolvedRollupSource[]> {
  return Promise.all(sources.map((s) => loadOne(s, window)));
}

async function loadOne(
  src: RollupSource,
  window: RollupWindow
): Promise<ResolvedRollupSource> {
  const base: ResolvedRollupSource = {
    boardId: src.boardId,
    cardId: src.cardId,
    boardName: "",
    cardTitle: "",
    columns: [],
    docs: [],
  };
  try {
    const board = await getBoard(src.boardId);
    if (!board) return { ...base, error: "The source board no longer exists." };
    const slot = parseManifest(board.manifestRaw).slots.find(
      (s) => s.cardId === src.cardId
    );
    if (!slot) {
      return {
        ...base,
        boardName: board.name,
        error: "The linked card no longer exists on its board.",
      };
    }
    if (slot.cardType !== "CaptureCard") {
      return {
        ...base,
        boardName: board.name,
        error: "The linked card is not a Capture card.",
      };
    }

    const [rows, instances] = await Promise.all([
      rowsForBoard(src.boardId),
      listInstances(src.boardId),
    ]);
    const when = new Map(instances.map((i) => [i.id, i.when]));
    const cardRows = rows.filter((r) => r.cardId === src.cardId);
    const liveRow = cardRows.find((r) => r.instanceId === "");
    const live: SourceDoc | null = liveRow
      ? { rowGuid: liveRow.id, when: "", json: liveRow.outputJson }
      : null;
    const instNewestFirst: SourceDoc[] = cardRows
      .filter((r) => r.instanceId !== "")
      .map((r) => ({
        rowGuid: r.id,
        when: when.get(r.instanceId) ?? "",
        json: r.outputJson,
      }))
      .sort((a, b) => b.when.localeCompare(a.when));

    return {
      ...base,
      boardName: board.name,
      cardTitle: slot.title !== "" ? slot.title : cardLabel(slot.cardType),
      columns: parseCaptureColumns(slotCfgRaw(slot.settings, "columnsJSON")),
      docs: pickWindowDocs(slotPolicy(slot), live, instNewestFirst, window).map((d) => ({
        rowGuid: d.rowGuid,
        when: d.when,
        envelope: parseCapture(d.json).envelope,
      })),
    };
  } catch (err) {
    return {
      ...base,
      error: `The source could not be loaded (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

export type WriteBackResult = "ok" | "gone";

/**
 * Write one row's change into its source document: re-read the card-data
 * row by GUID at save time, apply the mutation to the FRESH document, write
 * outputJson only. "gone" = the row (or its whole document) has been edited
 * away on the source board since the rollup loaded — the caller refreshes
 * instead of writing. Dataverse refusals throw (the caller reports them).
 */
export async function writeBackRow(
  docRowGuid: string,
  rowId: string,
  mutate: (row: CaptureRow) => void
): Promise<WriteBackResult> {
  const fresh = await cardRowById(docRowGuid);
  if (!fresh) return "gone";
  const next = mutateCaptureRowJson(fresh.outputJson, rowId, mutate, nowIso());
  if (next === null) return "gone";
  await updateOutputJson(docRowGuid, next);
  return "ok";
}
