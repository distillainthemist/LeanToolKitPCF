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

/** One configured state: the label plus its state-palette selection ("" =
 *  the positional toolkit default — green/amber/red repeating). */
export interface StateEntry {
  label: string;
  palette: string;
}

const DEFAULT_STATES: StateEntry[] = [
  { label: "On track", palette: "" },
  { label: "At risk", palette: "" },
  { label: "Off track", palette: "" },
];

/**
 * Parse the states input in any of its stored shapes: the objectList form
 * [{label, palette}], the legacy JSON array of labels, or legacy CSV.
 * Fewer than two usable states → the default RAG set.
 */
export function parseStateEntries(raw: string | null | undefined): StateEntry[] {
  const t = (raw ?? "").trim();
  if (t === "") return DEFAULT_STATES.slice();
  let items: unknown[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr : [];
    } catch {
      items = t.split(",");
    }
  } else {
    items = t.split(",");
  }
  const clean: StateEntry[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const label = item.trim();
      if (label !== "") clean.push({ label, palette: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (label === "") continue;
    clean.push({
      label,
      palette: typeof o.palette === "string" ? o.palette.trim() : "",
    });
  }
  return clean.length >= 2 ? clean : DEFAULT_STATES.slice();
}

/** Parse the states input: labels only (the cycle order). */
export function parseStates(raw: string | null | undefined): string[] {
  return parseStateEntries(raw).map((s) => s.label);
}
