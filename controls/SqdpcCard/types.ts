// SqdpcCard document — one month of status ratings per dimension letter,
// laid out as the classic letter-shaped calendars (each dimension's days
// tile its own big letter). Ratings are keyed "<dimension>|<yyyy-mm-dd>"
// (plus "|D"/"|N" halves at two-shift granularity) and hold a status CODE
// from the configurable set (up to four codes, each with colour + icon).
//
// Configuration (granularity, dimensions, status codes) comes from input
// properties, not the document — the document is just month + ratings.

import { parseColor } from "../../shared/tokens";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/sqdpc@1";

export type Granularity = "day" | "weekday" | "shift2";

export interface SqdpcData {
  month: string; // yyyy-mm
  ratings: Record<string, string>; // key -> status code
}

export type SqdpcEnvelope = Envelope<SqdpcData>;

export interface StatusCode {
  code: string;
  label: string;
  color: string;
  icon: string;
}

export const DEFAULT_CODES: StatusCode[] = [
  { code: "good", label: "Good", color: "#107c10", icon: "✓" },
  { code: "issue", label: "Issue", color: "#d13438", icon: "✕" },
];

const CODE_FALLBACK_COLOURS = ["#107c10", "#d13438", "#f2c811", "#2b88d8"];

export const DEFAULT_DIMENSIONS = ["S", "Q", "D", "P", "C"];

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseData(data: unknown): SqdpcData {
  const fallback: SqdpcData = { month: currentMonth(), ratings: {} };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { month?: unknown; ratings?: unknown };
  const ratings: Record<string, string> = {};
  if (d.ratings && typeof d.ratings === "object") {
    for (const [k, v] of Object.entries(d.ratings as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "" && v.length <= 24) ratings[k] = v;
    }
  }
  return {
    month:
      typeof d.month === "string" && /^\d{4}-\d{2}$/.test(d.month)
        ? d.month
        : fallback.month,
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

/** Parse the dimensions input (CSV or JSON array), e.g. "S,Q,P". */
export function parseDimensions(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return DEFAULT_DIMENSIONS.slice();
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
  return clean.length > 0 ? clean : DEFAULT_DIMENSIONS.slice();
}

/**
 * Parse the statusCodes input: a JSON array of up to four
 * {code?, label, color?, icon?} entries (or a CSV of labels). Colours are
 * validated; anything unparseable falls back to the palette slot.
 */
export function parseStatusCodes(raw: string | null | undefined): StatusCode[] {
  const t = (raw ?? "").trim();
  if (t === "") return DEFAULT_CODES.slice();
  let entries: unknown[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      entries = Array.isArray(arr) ? arr : [];
    } catch {
      entries = t.split(",").map((v) => v.trim());
    }
  } else {
    entries = t.split(",").map((v) => v.trim());
  }
  const out: StatusCode[] = [];
  for (const raw2 of entries) {
    if (out.length >= 4) break;
    if (typeof raw2 === "string") {
      if (raw2 === "") continue;
      out.push({
        code: raw2.toLowerCase(),
        label: raw2,
        color: CODE_FALLBACK_COLOURS[out.length],
        icon: "",
      });
      continue;
    }
    if (!raw2 || typeof raw2 !== "object") continue;
    const o = raw2 as Partial<StatusCode>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const code =
      typeof o.code === "string" && o.code.trim() !== ""
        ? o.code.trim()
        : label.toLowerCase();
    if (code === "") continue;
    const colour =
      typeof o.color === "string" && parseColor(o.color) !== null
        ? o.color
        : CODE_FALLBACK_COLOURS[out.length];
    out.push({
      code,
      label: label !== "" ? label : code,
      color: colour,
      icon: typeof o.icon === "string" ? o.icon : "",
    });
  }
  return out.length > 0 ? out : DEFAULT_CODES.slice();
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

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Letter templates: '#' is a day slot, '.' is empty. Days fill the slots in
 * reading order; slots beyond the month's last day render as muted filler
 * tiles (they complete the letter shape). Every template has ≥31 slots.
 */
export const LETTER_TEMPLATES: Record<string, string[]> = {
  S: [".####", "#####", "##...", "#####", "#####", "...##", "#####", "####."],
  Q: [".####.", "##..##", "##..##", "##..##", "##..##", "##.###", ".#####", "....##"],
  D: ["####.", "#####", "##.##", "##.##", "##.##", "##.##", "#####", "####."],
  P: ["######", "##..##", "##..##", "######", "###...", "###...", "###...", "###..."],
  C: [".#####", "######", "###...", "###...", "###...", "###...", "######", ".#####"],
};

/** Fallback shape for dimensions without a letter template: a 7×5 block. */
export const BLOCK_TEMPLATE: string[] = [
  "#######",
  "#######",
  "#######",
  "#######",
  "#######",
];

/** Safety-cross shape, triggered by a "+" dimension (33 slots). */
export const CROSS_TEMPLATE: string[] = [
  "..###..",
  "..###..",
  "#######",
  "#######",
  "#######",
  "..###..",
  "..###..",
];

export function templateFor(dimension: string): string[] {
  if (dimension === "+") return CROSS_TEMPLATE;
  return LETTER_TEMPLATES[dimension.toUpperCase()] ?? BLOCK_TEMPLATE;
}

/** Does the shape spell the dimension itself (so it needs no caption)? */
export function isLetterShaped(dimension: string): boolean {
  return LETTER_TEMPLATES[dimension.toUpperCase()] !== undefined;
}

/**
 * Parse the subtitles input into a list parallel to `dimensions`. Accepts a
 * JSON object keyed by dimension ({"S":"Safety"}), a JSON array, or CSV
 * (both positional).
 */
export function parseSubtitles(
  raw: string | null | undefined,
  dimensions: string[]
): string[] {
  const out = dimensions.map(() => "");
  const t = (raw ?? "").trim();
  if (t === "") return out;
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      dimensions.forEach((d, i) => {
        const key =
          Object.keys(obj).find((k) => k.toLowerCase() === d.toLowerCase());
        if (key !== undefined && typeof obj[key] === "string") {
          out[i] = String(obj[key]).trim();
        }
      });
      return out;
    } catch {
      return out;
    }
  }
  let arr: unknown[];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      arr = Array.isArray(parsed) ? parsed : t.split(",");
    } catch {
      arr = t.split(",");
    }
  } else {
    arr = t.split(",");
  }
  arr.forEach((v, i) => {
    if (i < out.length && v != null) out[i] = String(v).trim();
  });
  return out;
}
