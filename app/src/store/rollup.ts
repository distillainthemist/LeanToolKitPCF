// Rollup IO — resolving linked source cards to the right documents (the
// multi-source generalisation of linkCard.ts) and the read-modify-write
// write-backs, shared by the CAPTURE rollup (rows from capture cards) and
// the CANVAS rollup (one row per charter). All decisions live in the
// controls' pure models (tested); this module executes them.

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
import {
  mutateCanvasValueJson,
  ResolvedCanvasSource,
} from "../../../controls/CanvasRollup/types";
import { parseCanvas, parseCanvasConfig } from "../../../controls/CanvasCard/types";
import type { CanvasValue } from "../../../controls/CanvasCard/types";
import type { CaptureRow } from "../../../controls/CaptureCard/types";
import { cardLabel } from "../../../controls/CardSettings/registry";
import { nowIso } from "../../../shared/schema/id";
import { getBoard } from "./boards";
import { cardRowById, rowsForBoard, updateOutputJson } from "./cards";
import { listInstances } from "./instances";
import { ManifestSlot, parseManifest, slotPolicy } from "./mappers";

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

// ---- the shared source-resolution skeleton ---------------------------------

interface ResolvedSlot {
  boardName: string;
  slot: ManifestSlot;
  live: SourceDoc | null;
  instNewestFirst: SourceDoc[];
}

/** board → slot (of the expected type) → the card's documents. A string
 *  is the per-source failure message. */
async function resolveSlot(
  src: RollupSource,
  expectType: string,
  expectLabel: string
): Promise<ResolvedSlot | { error: string; boardName: string }> {
  const board = await getBoard(src.boardId);
  if (!board) return { error: "The source board no longer exists.", boardName: "" };
  const slot = parseManifest(board.manifestRaw).slots.find(
    (s) => s.cardId === src.cardId
  );
  if (!slot) {
    return {
      error: "The linked card no longer exists on its board.",
      boardName: board.name,
    };
  }
  if (slot.cardType !== expectType) {
    return {
      error: `The linked card is not a ${expectLabel}.`,
      boardName: board.name,
    };
  }
  const [rows, instances] = await Promise.all([
    rowsForBoard(src.boardId),
    listInstances(src.boardId),
  ]);
  const when = new Map(instances.map((i) => [i.id, i.when]));
  const cardRows = rows.filter((r) => r.cardId === src.cardId);
  const liveRow = cardRows.find((r) => r.instanceId === "");
  return {
    boardName: board.name,
    slot,
    live: liveRow ? { rowGuid: liveRow.id, when: "", json: liveRow.outputJson } : null,
    instNewestFirst: cardRows
      .filter((r) => r.instanceId !== "")
      .map((r) => ({
        rowGuid: r.id,
        when: when.get(r.instanceId) ?? "",
        json: r.outputJson,
      }))
      .sort((a, b) => b.when.localeCompare(a.when)),
  };
}

function loadFailure(err: unknown): string {
  return `The source could not be loaded (${err instanceof Error ? err.message : String(err)}).`;
}

// ---- capture rollup --------------------------------------------------------

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
    const r = await resolveSlot(src, "CaptureCard", "Capture card");
    if ("error" in r) return { ...base, boardName: r.boardName, error: r.error };
    return {
      ...base,
      boardName: r.boardName,
      cardTitle: r.slot.title !== "" ? r.slot.title : cardLabel(r.slot.cardType),
      columns: parseCaptureColumns(slotCfgRaw(r.slot.settings, "columnsJSON")),
      docs: pickWindowDocs(slotPolicy(r.slot), r.live, r.instNewestFirst, window).map(
        (d) => ({
          rowGuid: d.rowGuid,
          when: d.when,
          envelope: parseCapture(d.json).envelope,
        })
      ),
    };
  } catch (err) {
    return { ...base, error: loadFailure(err) };
  }
}

// ---- canvas rollup ---------------------------------------------------------

/** Resolve every linked charter to its CURRENT document (the canvas
 *  rollup's only window — a plan-of-record is current by definition). */
export async function loadCanvasSources(
  sources: RollupSource[]
): Promise<ResolvedCanvasSource[]> {
  return Promise.all(sources.map((s) => loadCanvasOne(s)));
}

async function loadCanvasOne(src: RollupSource): Promise<ResolvedCanvasSource> {
  const base: ResolvedCanvasSource = {
    boardId: src.boardId,
    cardId: src.cardId,
    boardName: "",
    cardTitle: "",
    config: { cols: 2, fields: [] },
    doc: null,
  };
  try {
    const r = await resolveSlot(src, "CanvasCard", "Canvas card");
    if ("error" in r) return { ...base, boardName: r.boardName, error: r.error };
    const docs = pickWindowDocs(slotPolicy(r.slot), r.live, r.instNewestFirst, {
      mode: "current",
      n: 1,
    });
    const doc = docs[0];
    return {
      ...base,
      boardName: r.boardName,
      cardTitle: r.slot.title !== "" ? r.slot.title : cardLabel(r.slot.cardType),
      config: parseCanvasConfig(slotCfgRaw(r.slot.settings, "canvasJSON")),
      doc: doc
        ? { rowGuid: doc.rowGuid, when: doc.when, envelope: parseCanvas(doc.json).envelope }
        : null,
    };
  } catch (err) {
    return { ...base, error: loadFailure(err) };
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

/**
 * The canvas rollup's write-back: one FIELD of one charter, same
 * read-modify-write shape. "gone" only when the charter's card-data row
 * itself vanished — an absent field id is a legal orphan write.
 */
export async function writeBackCanvasField(
  docRowGuid: string,
  fieldId: string,
  value: CanvasValue | undefined
): Promise<WriteBackResult> {
  const fresh = await cardRowById(docRowGuid);
  if (!fresh) return "gone";
  await updateOutputJson(
    docRowGuid,
    mutateCanvasValueJson(fresh.outputJson, fieldId, value, nowIso())
  );
  return "ok";
}
