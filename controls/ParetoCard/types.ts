// ParetoCard document — labelled counts, drawn as descending bars with a
// cumulative % line. A fishbone/five-whys vote export drops straight in:
// parseData also accepts a causes array ({text, votes}) and converts it.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/pareto@1";

export interface ParetoItem {
  id: string;
  label: string;
  count: number;
}

export interface ParetoData {
  items: ParetoItem[];
  unit: string;
}

export type ParetoEnvelope = Envelope<ParetoData>;

function sanitizeItem(v: unknown): ParetoItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { id?: unknown; label?: unknown; count?: unknown; text?: unknown; votes?: unknown };
  // accept a shared cause node ({text, votes}) as an item
  const label =
    typeof o.label === "string" && o.label.trim() !== ""
      ? o.label.trim()
      : typeof o.text === "string"
        ? o.text.trim()
        : "";
  if (label === "") return null;
  const count = Number(o.count ?? o.votes);
  return {
    id: typeof o.id === "string" && o.id !== "" ? o.id : newId("p"),
    label,
    count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
  };
}

function parseData(data: unknown): ParetoData {
  if (!data || typeof data !== "object") return { items: [], unit: "" };
  const d = data as { items?: unknown; causes?: unknown; unit?: unknown };
  const source = Array.isArray(d.items)
    ? d.items
    : Array.isArray(d.causes)
      ? d.causes
      : [];
  return {
    items: source
      .map(sanitizeItem)
      .filter((x): x is ParetoItem => x !== null),
    unit: typeof d.unit === "string" ? d.unit : "",
  };
}

export function parsePareto(
  raw: string | null | undefined
): ParsedEnvelope<ParetoData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializePareto(env: ParetoEnvelope): string {
  return serializeEnvelope(env);
}
