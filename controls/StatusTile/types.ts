// StatusTile document — one big tap-to-cycle state with a reason. The state
// list comes from the `states` input (labels) + legendColors (colours), so a
// tier-2 board can show one tile per tier-1 board.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/statustile@1";

export interface StatusTileData {
  stateIndex: number;
  reason: string;
}

export type StatusTileEnvelope = Envelope<StatusTileData>;

function parseData(data: unknown): StatusTileData {
  if (!data || typeof data !== "object") {
    return { stateIndex: 0, reason: "" };
  }
  const d = data as { stateIndex?: unknown; reason?: unknown };
  const idx = Number(d.stateIndex);
  return {
    stateIndex: Number.isFinite(idx) ? Math.max(0, Math.round(idx)) : 0,
    reason: typeof d.reason === "string" ? d.reason : "",
  };
}

export function parseStatusTile(
  raw: string | null | undefined
): ParsedEnvelope<StatusTileData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeStatusTile(env: StatusTileEnvelope): string {
  return serializeEnvelope(env);
}

/** Parse the states input: JSON array or CSV of labels; default RAG. */
export function parseStates(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  const fallback = ["On track", "At risk", "Off track"];
  if (t === "") return fallback;
  let items: string[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr.map((v) => String(v).trim()) : [];
    } catch {
      items = t.split(",").map((v) => v.trim());
    }
  } else {
    items = t.split(",").map((v) => v.trim());
  }
  const clean = items.filter((v) => v !== "");
  return clean.length >= 2 ? clean : fallback;
}
