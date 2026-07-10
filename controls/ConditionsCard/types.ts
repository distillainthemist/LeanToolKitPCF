// ConditionsCard document — customisable conditions rated good/issue over a
// rolling seven days (ending today) plus a forecast for the coming shift.
// Ratings are keyed "<condition>|<yyyy-mm-dd>"; the forecast by condition.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/conditions@1";

export type Rating = "good" | "issue";

export interface ConditionsData {
  conditions: string[];
  ratings: Record<string, Rating>;
  forecast: Record<string, Rating>;
}

export type ConditionsEnvelope = Envelope<ConditionsData>;

export const DEFAULT_CONDITIONS = [
  "Staffing",
  "Equipment",
  "Materials",
  "Quality checks",
];

function parseData(data: unknown): ConditionsData {
  const fallback: ConditionsData = {
    conditions: DEFAULT_CONDITIONS.slice(),
    ratings: {},
    forecast: {},
  };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { conditions?: unknown; ratings?: unknown; forecast?: unknown };
  const conditions = Array.isArray(d.conditions)
    ? d.conditions.map((v) => String(v).trim()).filter((v) => v !== "")
    : [];
  const ratings: Record<string, Rating> = {};
  if (d.ratings && typeof d.ratings === "object") {
    for (const [k, v] of Object.entries(d.ratings as Record<string, unknown>)) {
      if (v === "good" || v === "issue") ratings[k] = v;
    }
  }
  const forecast: Record<string, Rating> = {};
  if (d.forecast && typeof d.forecast === "object") {
    for (const [k, v] of Object.entries(d.forecast as Record<string, unknown>)) {
      if (v === "good" || v === "issue") forecast[k] = v;
    }
  }
  return {
    conditions: conditions.length > 0 ? conditions : fallback.conditions,
    ratings,
    forecast,
  };
}

export function parseConditions(
  raw: string | null | undefined
): ParsedEnvelope<ConditionsData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeConditions(env: ConditionsEnvelope): string {
  return serializeEnvelope(env);
}

/** The rolling window: seven days ending today (yyyy-mm-dd, oldest first). */
export function rollingDays(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const p = (v: number) => String(v).padStart(2, "0");
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }
  return out;
}
