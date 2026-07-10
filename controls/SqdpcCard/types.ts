// SqdpcCard document — one month of good/issue ratings per dimension letter
// (default S,Q,D,P,C), at day, weekday or two-shift granularity. Ratings are
// keyed "<dimension>|<yyyy-mm-dd>" (plus "|D"/"|N" for shifts).

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/sqdpc@1";

export type Rating = "good" | "issue";
export type Granularity = "day" | "weekday" | "shift2";

export interface SqdpcData {
  month: string; // yyyy-mm
  granularity: Granularity;
  dimensions: string[];
  ratings: Record<string, Rating>;
}

export type SqdpcEnvelope = Envelope<SqdpcData>;

export const DEFAULT_DIMENSIONS = ["S", "Q", "D", "P", "C"];

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseData(data: unknown): SqdpcData {
  const fallback: SqdpcData = {
    month: currentMonth(),
    granularity: "day",
    dimensions: DEFAULT_DIMENSIONS.slice(),
    ratings: {},
  };
  if (!data || typeof data !== "object") return fallback;
  const d = data as {
    month?: unknown;
    granularity?: unknown;
    dimensions?: unknown;
    ratings?: unknown;
  };
  const dimensions = Array.isArray(d.dimensions)
    ? d.dimensions.map((v) => String(v).trim()).filter((v) => v !== "")
    : [];
  const ratings: Record<string, Rating> = {};
  if (d.ratings && typeof d.ratings === "object") {
    for (const [k, v] of Object.entries(d.ratings as Record<string, unknown>)) {
      if (v === "good" || v === "issue") ratings[k] = v;
    }
  }
  return {
    month:
      typeof d.month === "string" && /^\d{4}-\d{2}$/.test(d.month)
        ? d.month
        : fallback.month,
    granularity:
      d.granularity === "weekday" || d.granularity === "shift2"
        ? d.granularity
        : "day",
    dimensions: dimensions.length > 0 ? dimensions : fallback.dimensions,
    ratings,
  };
}

export function parseSqdpc(
  raw: string | null | undefined
): ParsedEnvelope<SqdpcData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeSqdpc(env: SqdpcEnvelope): string {
  return serializeEnvelope(env);
}

/** Days of the month as yyyy-mm-dd (weekdays only when asked). */
export function monthDays(month: string, weekdaysOnly: boolean): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    const dow = new Date(iso + "T00:00:00Z").getUTCDay();
    if (weekdaysOnly && (dow === 0 || dow === 6)) continue;
    out.push(iso);
  }
  return out;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
