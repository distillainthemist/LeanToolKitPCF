// CanvasRollup — the pure model for the portfolio card: the Capture
// rollup TRANSPOSED (one row per linked canvas card, not per capture
// row), columns picked from the union of the sources' field LABELS with
// the same case-insensitive matching rule. Window is CURRENT CONTENT
// only — a plan-of-record is current by definition. Config parsers are
// shared with the capture rollup where the shapes are identical.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";
import {
  CanvasConfig,
  CanvasEnvelope,
  CanvasField,
  CanvasValue,
  parseCanvas,
  serializeCanvas,
} from "../CanvasCard/types";

export const SCHEMA_ID = "ltk/canvasrollup@1";

/** Content-free document — exists so tiles and close-meeting archives
 *  ride the standard save road (the capture rollup's pattern). */
export type CanvasRollupData = Record<string, never>;
export type CanvasRollupEnvelope = Envelope<CanvasRollupData>;

export function parseCanvasRollup(
  raw: string | null | undefined
): ParsedEnvelope<CanvasRollupData> {
  return parseEnvelope(raw, SCHEMA_ID, () => ({}));
}

export function serializeCanvasRollup(env: CanvasRollupEnvelope): string {
  return serializeEnvelope(env);
}

// The sources/columns config parsers are the capture rollup's — same shapes.
export { parseColumnNames, parseRollupSources } from "../CaptureRollup/types";
export type { RollupSource } from "../CaptureRollup/types";

/** Canvas write modes: read-only or full (no flag to remove). */
export type CanvasWriteMode = "readonly" | "full";

export function parseCanvasWriteMode(raw: string | null | undefined): CanvasWriteMode {
  return (raw ?? "").trim() === "full" ? "full" : "readonly";
}

// ---- projection ------------------------------------------------------------

/** One linked canvas card, resolved by the store road. */
export interface ResolvedCanvasSource {
  boardId: string;
  cardId: string;
  boardName: string;
  cardTitle: string;
  /** The source slot's parsed canvasJSON. */
  config: CanvasConfig;
  /** The CURRENT document (live row for shared, newest meeting doc
   *  otherwise) — null before any content exists. */
  doc: { rowGuid: string; when: string; envelope: CanvasEnvelope } | null;
  error?: string;
}

/** One portfolio row = one linked canvas card. */
export interface CanvasRollupRow {
  source: { boardId: string; cardId: string; boardName: string; cardTitle: string };
  ref: { docRowGuid: string };
  /** The charter's values (write-back and the full-view dialog read these). */
  values: Record<string, CanvasValue>;
  /** Per display name, this source's matching field (null = absent).
   *  One array per source. */
  fields: (CanvasField | null)[];
}

/** Resolve display names to a source's fields, by label (case-insensitive,
 *  trimmed; first match wins). Headings never match — they carry no value. */
export function matchCanvasFields(
  fields: CanvasField[],
  names: string[]
): (CanvasField | null)[] {
  const candidates = fields.filter((f) => f.type !== "heading");
  return names.map((name) => {
    const k = name.trim().toLowerCase();
    return candidates.find((f) => f.label.trim().toLowerCase() === k) ?? null;
  });
}

/** The union of the sources' field labels (headings excluded), in
 *  source-then-field order — the settings picker's offer. */
export function canvasLabelUnion(sources: ResolvedCanvasSource[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (s.error) continue;
    for (const f of s.config.fields) {
      if (f.type === "heading" || f.label.trim() === "") continue;
      if (!out.some((n) => n.trim().toLowerCase() === f.label.trim().toLowerCase())) {
        out.push(f.label);
      }
    }
  }
  return out;
}

/**
 * One row per source, in config order; errored sources and sources with
 * no content yet are skipped (the card reports them inline instead).
 */
export function projectCanvasRollup(
  sources: ResolvedCanvasSource[],
  names: string[]
): CanvasRollupRow[] {
  const out: CanvasRollupRow[] = [];
  for (const source of sources) {
    if (source.error || source.doc === null) continue;
    out.push({
      source: {
        boardId: source.boardId,
        cardId: source.cardId,
        boardName: source.boardName,
        cardTitle: source.cardTitle,
      },
      ref: { docRowGuid: source.doc.rowGuid },
      values: source.doc.envelope.data.values,
      fields: matchCanvasFields(source.config.fields, names),
    });
  }
  return out;
}

/**
 * The write-back mutation, pure: parse the source charter FRESH (the
 * store road re-reads at save time), set or clear ONE field's value,
 * stamp updated, re-serialize. Always succeeds — an absent field id is a
 * legal orphan write target, unlike a deleted capture row.
 */
export function mutateCanvasValueJson(
  json: string,
  fieldId: string,
  value: CanvasValue | undefined,
  updatedIso: string
): string {
  const envelope = parseCanvas(json).envelope;
  if (value === undefined) delete envelope.data.values[fieldId];
  else envelope.data.values[fieldId] = value;
  envelope.meta.updated = updatedIso;
  return serializeCanvas(envelope);
}
