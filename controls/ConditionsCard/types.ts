// ConditionsCard document — a set of "winning conditions" rated good/issue
// over a rolling window ending today. The window's grain is set by an input
// (every day, weekdays only, whole weeks, or two shifts a day). Ratings are
// keyed "<condition>|<periodKey>" (plus "|D"/"|N" halves at shift grain).
//
// Configuration (granularity, the conditions list, per-condition prompts)
// comes from input properties, not the document — the document is just the
// ratings map.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/conditions@1";

export type Rating = "good" | "issue";

export type Granularity = "day" | "weekday" | "week" | "shift";

export interface ConditionsData {
  ratings: Record<string, Rating>;
}

export type ConditionsEnvelope = Envelope<ConditionsData>;

export const DEFAULT_CONDITIONS = [
  "Staffing",
  "Equipment",
  "Materials",
  "Quality checks",
];

function parseData(data: unknown): ConditionsData {
  const fallback: ConditionsData = { ratings: {} };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { ratings?: unknown };
  const ratings: Record<string, Rating> = {};
  if (d.ratings && typeof d.ratings === "object") {
    for (const [k, v] of Object.entries(d.ratings as Record<string, unknown>)) {
      if (v === "good" || v === "issue") ratings[k] = v;
    }
  }
  return { ratings };
}

export function parseConditions(
  raw: string | null | undefined
): ParsedEnvelope<ConditionsData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeConditions(env: ConditionsEnvelope): string {
  return serializeEnvelope(env);
}

/** A winning condition row: its name plus an optional prompt shown beneath. */
export interface Condition {
  name: string;
  prompt: string;
}

/**
 * Parse the single conditions input into the list of rows (name + prompt).
 * Accepts, in order of preference:
 *   • a JSON object keyed by condition, values are prompts (order preserved):
 *       {"Staffing":"Crew to plan?","Equipment":"All runnable?"}
 *   • a JSON array of strings, or of {name|label|condition, prompt|hint}
 *   • a plain CSV of names (no prompts)
 */
export function parseConditionsInput(
  raw: string | null | undefined
): Condition[] {
  const t = (raw ?? "").trim();
  const fallback = (): Condition[] =>
    DEFAULT_CONDITIONS.map((name) => ({ name, prompt: "" }));
  if (t === "") return fallback();

  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const out: Condition[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const name = k.trim();
        if (name === "") continue;
        out.push({ name, prompt: typeof v === "string" ? v.trim() : "" });
      }
      return out.length > 0 ? out : fallback();
    } catch {
      return fallback();
    }
  }

  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown[];
      const out: Condition[] = [];
      for (const item of arr) {
        if (typeof item === "string") {
          const name = item.trim();
          if (name !== "") out.push({ name, prompt: "" });
        } else if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const name = String(o.name ?? o.label ?? o.condition ?? "").trim();
          if (name === "") continue;
          out.push({ name, prompt: String(o.prompt ?? o.hint ?? "").trim() });
        }
      }
      return out.length > 0 ? out : fallback();
    } catch {
      return fallback();
    }
  }

  const out: Condition[] = [];
  for (const seg of t.split(",")) {
    const name = seg.trim();
    if (name !== "") out.push({ name, prompt: "" });
  }
  return out.length > 0 ? out : fallback();
}

/** One column of the rolling window. */
export interface Period {
  key: string; // date-portion of the rating key (yyyy-mm-dd, or week's Monday)
  top: string; // small header line — weekday, or "Wk"
  bottom: string; // larger header line — the date
  title: string; // tooltip base
  isToday: boolean;
}

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function isoLocal(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateLabel(d: Date): string {
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Monday of the week containing d. */
function weekStart(d: Date): Date {
  const s = startOfDay(d);
  const offset = (s.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(s.getTime() - offset * DAY_MS);
}

/**
 * The seven columns of the rolling window, oldest first and ending on today
 * (or the current week / most recent weekday). The final column is always
 * "today"; there is no forecast column.
 */
export function buildPeriods(gran: Granularity): Period[] {
  const today = startOfDay(new Date());
  const out: Period[] = [];

  if (gran === "week") {
    const thisWeek = weekStart(today);
    for (let i = 6; i >= 0; i--) {
      const ws = new Date(thisWeek.getTime() - i * 7 * DAY_MS);
      out.push({
        key: isoLocal(ws),
        top: "Wk",
        bottom: dateLabel(ws),
        title: `Week of ${dateLabel(ws)}`,
        isToday: i === 0,
      });
    }
    return out;
  }

  if (gran === "weekday") {
    // walk back from today, collecting the seven most recent weekdays
    const days: Date[] = [];
    const cursor = new Date(today.getTime());
    while (days.length < 7) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days.push(new Date(cursor.getTime()));
      cursor.setDate(cursor.getDate() - 1);
    }
    days.reverse();
    const todayIso = isoLocal(today);
    for (const d of days) {
      out.push({
        key: isoLocal(d),
        top: WD_SHORT[d.getDay()],
        bottom: dateLabel(d),
        title: `${WD_SHORT[d.getDay()]} ${isoLocal(d)}`,
        isToday: isoLocal(d) === todayIso,
      });
    }
    return out;
  }

  // "day" and "shift": seven calendar days ending today
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    out.push({
      key: isoLocal(d),
      top: WD_SHORT[d.getDay()],
      bottom: dateLabel(d),
      title: `${WD_SHORT[d.getDay()]} ${isoLocal(d)}`,
      isToday: i === 0,
    });
  }
  return out;
}
