// CaptureRollup — the pure model for the rollup card: config parsers, the
// occurrence-window document choice, and the projection that merges rows
// from several Capture cards into one table (docs/leanboard-capture-rollup-
// plan.md). Columns are matched across sources BY LABEL (case-insensitive,
// trimmed) because keys are auto-slugged and hand-editable — each source
// resolves a display name to its own column key. The flag column is found
// BY TYPE, never by name. All IO lives in app/src/store/rollup.ts.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";
import {
  CaptureColumn,
  CaptureEnvelope,
  CaptureRow,
  parseCapture,
  serializeCapture,
} from "../CaptureCard/types";

export const SCHEMA_ID = "ltk/capturerollup@1";

/** The rollup's own document is content-free — it exists so board tiles and
 *  close-meeting archives ride the standard save/snapshot road. */
export type RollupData = Record<string, never>;
export type RollupEnvelope = Envelope<RollupData>;

export function parseRollup(raw: string | null | undefined): ParsedEnvelope<RollupData> {
  return parseEnvelope(raw, SCHEMA_ID, () => ({}));
}

export function serializeRollup(env: RollupEnvelope): string {
  return serializeEnvelope(env);
}

// ---- config ----------------------------------------------------------------

export interface RollupSource {
  boardId: string;
  cardId: string;
}

/** Parse sourcesJSON: [{boardId, cardId}] — defensive, order-preserving. */
export function parseRollupSources(raw: string | null | undefined): RollupSource[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const data = JSON.parse(t) as unknown;
    if (!Array.isArray(data)) return [];
    const out: RollupSource[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const o = item as Partial<RollupSource>;
      const boardId = typeof o.boardId === "string" ? o.boardId.trim() : "";
      const cardId = typeof o.cardId === "string" ? o.cardId.trim() : "";
      if (boardId === "" || cardId === "") continue;
      out.push({ boardId, cardId });
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse the display column names: a JSON array of strings (the settings
 *  picker's shape), tolerating a CSV string for hand-typed configs. */
export function parseColumnNames(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  let items: unknown[] = [];
  try {
    const data = JSON.parse(t) as unknown;
    if (Array.isArray(data)) items = data;
    else items = String(t).split(",");
  } catch {
    items = t.split(",");
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name === "") continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

export interface RollupWindow {
  mode: "current" | "lastN";
  n: number;
}

export const DEFAULT_WINDOW_N = 3;

/** Window config: mode enum + occurrence count (clamped 1..50). */
export function parseWindow(
  modeRaw: string | null | undefined,
  nRaw: number | null | undefined
): RollupWindow {
  const mode = (modeRaw ?? "").trim() === "lastN" ? "lastN" : "current";
  const n =
    typeof nRaw === "number" && Number.isFinite(nRaw)
      ? Math.max(1, Math.min(50, Math.round(nRaw)))
      : DEFAULT_WINDOW_N;
  return { mode, n };
}

export type WriteMode = "readonly" | "unflag" | "full";

export function parseWriteMode(raw: string | null | undefined): WriteMode {
  const t = (raw ?? "").trim();
  return t === "unflag" || t === "full" ? t : "readonly";
}

// ---- occurrence window -----------------------------------------------------

/** One candidate document from a source card's data rows. */
export interface SourceDoc {
  /** The ben_ltkcarddata row GUID — the write-back target. */
  rowGuid: string;
  /** The meeting's ISO datetime ("" = the live row). */
  when: string;
  json: string;
}

/**
 * Which of a source's documents the rollup reads (the store road executes
 * this). Mirrors pickLinkContent's semantics, extended for last-N:
 *  - a SHARED source's truth is its live row (its instance rows never carry
 *    outputJson — archives stamp tile svg only);
 *  - current: the newest non-empty meeting document, falling back to the
 *    live row (standard content) before any meeting has run;
 *  - lastN: the newest N non-empty meeting documents, same live fallback
 *    when there are none.
 */
export function pickWindowDocs(
  policy: "clear" | "carry" | "shared",
  live: SourceDoc | null,
  instNewestFirst: SourceDoc[],
  window: RollupWindow
): SourceDoc[] {
  const liveDocs = live && live.json.trim() !== "" ? [live] : [];
  if (policy === "shared") return liveDocs;
  const nonEmpty = instNewestFirst.filter((d) => d.json.trim() !== "");
  if (nonEmpty.length === 0) return liveDocs;
  return window.mode === "lastN" ? nonEmpty.slice(0, window.n) : nonEmpty.slice(0, 1);
}

// ---- projection ------------------------------------------------------------

/** One linked capture card, resolved by the store road. */
export interface ResolvedRollupSource {
  boardId: string;
  cardId: string;
  boardName: string;
  /** The source card's title (its slot title, else a fallback label). */
  cardTitle: string;
  /** The source slot's parsed columnsJSON. */
  columns: CaptureColumn[];
  /** The window's documents, newest first, parsed. */
  docs: { rowGuid: string; when: string; envelope: CaptureEnvelope }[];
  /** Set when the source could not be resolved — the card reports it inline
   *  and the projection skips the source. */
  error?: string;
}

/** One merged row on the rollup. */
export interface RollupRow {
  source: { boardId: string; cardId: string; boardName: string; when: string };
  ref: { docRowGuid: string; rowId: string };
  /** The raw source row — write-back and the full-edit dialog work on this. */
  row: CaptureRow;
  /** Per display name, this source's matching column (null = absent).
   *  One array per source, shared by its rows. */
  columns: (CaptureColumn | null)[];
  /** The source's flag column key ("" = it has none). */
  flagKey: string;
  flagged: boolean;
}

/** Resolve display names to a source's own columns, by label
 *  (case-insensitive, trimmed; first match wins). */
export function matchColumns(
  sourceColumns: CaptureColumn[],
  names: string[]
): (CaptureColumn | null)[] {
  return names.map((name) => {
    const k = name.trim().toLowerCase();
    return sourceColumns.find((c) => c.label.trim().toLowerCase() === k) ?? null;
  });
}

/** The source's flag column — by TYPE (first one wins), never by name. */
export function flagColumn(columns: CaptureColumn[]): CaptureColumn | null {
  return columns.find((c) => c.type === "flag") ?? null;
}

/** Same truthiness the capture editor renders. */
export function isFlagged(row: CaptureRow, flagKey: string): boolean {
  if (flagKey === "") return false;
  const v = row.cells[flagKey];
  return v === true || v === "true";
}

/**
 * The write-back mutation, pure: parse the source document FRESH (the store
 * road re-reads it at save time — that read-modify-write is the concurrency
 * mitigation of record), mutate the one row, stamp updated, re-serialize.
 * null = the row is no longer in the document (edited away on the source
 * board) — the caller surfaces "changed on the source board" and refreshes.
 */
export function mutateCaptureRowJson(
  json: string,
  rowId: string,
  mutate: (row: CaptureRow) => void,
  updatedIso: string
): string | null {
  const envelope = parseCapture(json).envelope;
  const target = envelope.data.rows.find((r) => r.id === rowId);
  if (!target) return null;
  mutate(target);
  envelope.meta.updated = updatedIso;
  return serializeCapture(envelope);
}

/**
 * Merge the resolved sources into display rows: sources in config order;
 * within a source, documents newest first and rows in document order,
 * deduplicated by row id (carry-policy cards repeat rows across occurrences
 * — the newest occurrence wins). Flagged-only hides every row of a source
 * with no flag column (decision 5 — the settings UI carries the warning).
 */
export function projectRollup(
  sources: ResolvedRollupSource[],
  names: string[],
  flaggedOnly: boolean
): RollupRow[] {
  const out: RollupRow[] = [];
  for (const source of sources) {
    if (source.error) continue;
    const columns = matchColumns(source.columns, names);
    const flagKey = flagColumn(source.columns)?.key ?? "";
    if (flaggedOnly && flagKey === "") continue;
    const seen = new Set<string>();
    for (const doc of source.docs) {
      for (const row of doc.envelope.data.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const flagged = isFlagged(row, flagKey);
        if (flaggedOnly && !flagged) continue;
        out.push({
          source: {
            boardId: source.boardId,
            cardId: source.cardId,
            boardName: source.boardName,
            when: doc.when,
          },
          ref: { docRowGuid: doc.rowGuid, rowId: row.id },
          row,
          columns,
          flagKey,
          flagged,
        });
      }
    }
  }
  return out;
}
