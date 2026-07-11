// MeetingScheduler document — meeting cadence (one or more recurring
// meetings: time + days of week) plus a crew roster pattern, from which the
// control generates dated occurrences ("who is on, when") over a rolling
// horizon. The config is the document; the generated occurrences are emitted
// on the separate occurrencesJSON OUTPUT (derived data, never stored).
//
// Roster patterns (6A):
//   none    — no crews; occurrences are plain date/times
//   weekday — one crew, weekdays only: weekend occurrences are dropped
//   crew2   — two crews alternating the day shift every `swingDays` days
//   crew4   — four crews, continuous 4-on-4-off 12h cover (16-day cycle):
//             crew offsets 0/4/8/12; cycle position 0–3 = day shift block,
//             8–11 = night shift block. A meeting timed 06:00–17:59 belongs
//             to the day-shift crew, otherwise the night-shift crew.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/meeting@1";

export type RosterPattern = "none" | "weekday" | "crew2" | "crew4";

export const PATTERN_LABELS: Record<RosterPattern, string> = {
  none: "No roster",
  weekday: "Weekday crew",
  crew2: "2 crews · alternating days",
  crew4: "4 crews · continuous shifts",
};

export interface Meeting {
  id: string;
  name: string;
  time: string; // "HH:MM" 24h
  durationMin: number;
  days: number[]; // 0=Sun .. 6=Sat
}

export interface Roster {
  pattern: RosterPattern;
  anchor: string; // yyyy-mm-dd the first crew starts its (day-shift) block
  crews: string[];
  swingDays: number; // crew2: days between crew swaps
}

export interface MeetingData {
  meetings: Meeting[];
  roster: Roster;
  horizonDays: number; // preview / emission window
}

export type MeetingEnvelope = Envelope<MeetingData>;

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DEFAULT_MEETINGS: Meeting[] = [
  { id: "m1", name: "Shift start", time: "07:00", durationMin: 15, days: [1, 2, 3, 4, 5] },
];

const DEFAULT_ROSTER: Roster = {
  pattern: "none",
  anchor: "",
  crews: ["A", "B", "C", "D"],
  swingDays: 7,
};

function isPattern(v: unknown): v is RosterPattern {
  return v === "none" || v === "weekday" || v === "crew2" || v === "crew4";
}

function cleanTime(v: unknown): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return "07:00";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function cleanDate(v: unknown): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? String(v).trim() : "";
}

function parseData(data: unknown): MeetingData {
  const fallback: MeetingData = {
    meetings: DEFAULT_MEETINGS.map((m) => ({ ...m, days: m.days.slice() })),
    roster: { ...DEFAULT_ROSTER, crews: DEFAULT_ROSTER.crews.slice() },
    horizonDays: 14,
  };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { meetings?: unknown; roster?: unknown; horizonDays?: unknown };

  const meetings: Meeting[] = [];
  if (Array.isArray(d.meetings)) {
    for (const raw of d.meetings) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<Meeting>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name === "") continue;
      const days = Array.isArray(o.days)
        ? o.days
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
        : [];
      const dur = Number(o.durationMin);
      meetings.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("m"),
        name,
        time: cleanTime(o.time),
        durationMin: Number.isFinite(dur) && dur > 0 ? Math.min(480, Math.round(dur)) : 15,
        days: [...new Set(days)].sort(),
      });
    }
  }

  let roster = { ...DEFAULT_ROSTER, crews: DEFAULT_ROSTER.crews.slice() };
  if (d.roster && typeof d.roster === "object") {
    const r = d.roster as Partial<Roster>;
    const crews = Array.isArray(r.crews)
      ? r.crews.map((v) => String(v ?? "").trim()).filter((v) => v !== "")
      : [];
    const swing = Number(r.swingDays);
    roster = {
      pattern: isPattern(r.pattern) ? r.pattern : "none",
      anchor: cleanDate(r.anchor),
      crews: crews.length > 0 ? crews.slice(0, 8) : roster.crews,
      swingDays: Number.isFinite(swing) && swing >= 1 ? Math.min(28, Math.round(swing)) : 7,
    };
  }

  const horizon = Number(d.horizonDays);
  return {
    meetings: meetings.length > 0 ? meetings : fallback.meetings,
    roster,
    horizonDays:
      Number.isFinite(horizon) && horizon >= 1 ? Math.min(60, Math.round(horizon)) : 14,
  };
}

export function parseMeeting(raw: string | null | undefined): ParsedEnvelope<MeetingData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeMeeting(env: MeetingEnvelope): string {
  return serializeEnvelope(env);
}

// ---- occurrence generation ----

export interface Occurrence {
  date: string; // yyyy-mm-dd
  day: string; // "Mon"
  time: string; // "HH:MM"
  iso: string; // "yyyy-mm-ddTHH:MM"
  meetingId: string;
  meeting: string;
  durationMin: number;
  crew: string; // "" when no roster
  shift: "" | "day" | "night";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isoLocal(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
/** Whole days from the roster anchor to the date (anchor missing → epoch Monday). */
function daysFromAnchor(roster: Roster, date: Date): number {
  const anchor = parseLocalDate(roster.anchor) ?? new Date(2026, 0, 5); // a Monday
  return Math.round((startOfDay(date).getTime() - startOfDay(anchor).getTime()) / DAY_MS);
}
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function crewName(roster: Roster, i: number, fallback: string): string {
  return roster.crews[i] ?? fallback;
}

/**
 * Which crew attends a meeting on `date` at `time` under the roster.
 * Returns null when the roster says the meeting doesn't happen (weekend for
 * the weekday pattern; no crew on shift for crew4 off-block days is
 * impossible — cover is continuous).
 */
export function crewFor(
  roster: Roster,
  date: Date,
  time: string
): { crew: string; shift: "" | "day" | "night" } | null {
  const dow = date.getDay();
  switch (roster.pattern) {
    case "none":
      return { crew: "", shift: "" };
    case "weekday": {
      if (dow === 0 || dow === 6) return null;
      return { crew: crewName(roster, 0, "Crew"), shift: "" };
    }
    case "crew2": {
      const d = daysFromAnchor(roster, date);
      const idx = mod(Math.floor(d / Math.max(1, roster.swingDays)), 2);
      return { crew: crewName(roster, idx, idx === 0 ? "A" : "B"), shift: "" };
    }
    case "crew4": {
      // 16-day cycle, offsets 0/4/8/12; position 0–3 day block, 8–11 night.
      const d = daysFromAnchor(roster, date);
      const hour = Number(time.slice(0, 2));
      const wantDay = hour >= 6 && hour < 18;
      for (let i = 0; i < 4; i++) {
        const p = mod(d - i * 4, 16);
        if (wantDay && p >= 0 && p <= 3) {
          return { crew: crewName(roster, i, "ABCD"[i]), shift: "day" };
        }
        if (!wantDay && p >= 8 && p <= 11) {
          return { crew: crewName(roster, i, "ABCD"[i]), shift: "night" };
        }
      }
      return null; // unreachable — the four offsets tile the cycle
    }
  }
}

/** All occurrences over the horizon, from `from` (defaults to today). */
export function generateOccurrences(data: MeetingData, from?: Date): Occurrence[] {
  const start = startOfDay(from ?? new Date());
  const out: Occurrence[] = [];
  for (let i = 0; i < data.horizonDays; i++) {
    const date = new Date(start.getTime() + i * DAY_MS);
    const dow = date.getDay();
    for (const m of data.meetings) {
      if (!m.days.includes(dow)) continue;
      const who = crewFor(data.roster, date, m.time);
      if (!who) continue;
      const iso = isoLocal(date);
      out.push({
        date: iso,
        day: DAY_LABELS[dow],
        time: m.time,
        iso: `${iso}T${m.time}`,
        meetingId: m.id,
        meeting: m.name,
        durationMin: m.durationMin,
        crew: who.crew,
        shift: who.shift,
      });
    }
  }
  out.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  return out;
}
