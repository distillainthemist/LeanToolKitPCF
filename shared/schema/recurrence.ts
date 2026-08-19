// The meeting recurrence engine — shared by MeetingScheduler (the selection
// card) and LeanHub (the calendar). Given a cadence config it generates the
// meeting instances inside the [finalDate − daysPrior, finalDate] window,
// matches them against existing meeting records, flags past instances with
// no record, and stamps each occurrence's rotation topic and on-shift crew.
//
// Roster pattern grammar: "2D-2N-5O-2D-3N-4O" — blocks of Days worked,
// Nights worked, and days Off, cycled. BaseStartDate is the date the FIRST
// listed crew started the pattern's first day shift; each next crew starts
// its days when the previous crew moves onto nights (stagger = length of the
// first D block). For unrostered anchored cadences baseStart is the
// recurrence anchor: fortnightly week parity, monthly+ nth weekday.
//
// Calendar note: generateInstances hides record-less PAST instances older
// than STALE_MISS_DAYS (they are assumed not to have happened). A calendar
// projecting historical weeks should pass now = new Date(0) so every
// occurrence renders as planned instead of being staleness-filtered.

export type Category =
  | "annually"
  | "quarterly"
  | "monthly"
  | "fortnightly"
  | "weekly"
  | "daily"
  | "shiftly";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface RosterBlock {
  len: number;
  type: "D" | "N" | "O";
}

export interface SchedulerConfig {
  finalDate: Date;
  daysPrior: number;
  category: Category;
  daysOfWeek: number[]; // 0=Sun .. 6=Sat
  timeOfDay: string; // "HH:MM"
  crews: string[];
  roster: RosterBlock[]; // empty = no roster
  baseStart: Date;
  /** Weekly topic rotation by week-of-month: [1st, 2nd, 3rd, 4th, 5th]. */
  weekTopics: string[];
  /** Daily/shiftly topics by weekday (0=Sun .. 6=Sat). */
  dayTopics: Record<number, string>;
  /** Per-day time overrides (0=Sun .. 6=Sat), HH:MM — any multi-day
   *  cadence (daily, shiftly, weekly). Optional; blank = timeOfDay. */
  dayTimes?: Record<number, string>;
  /** Per-week-of-month time overrides [1st..5th], HH:MM — weekly.
   *  Optional; "" = timeOfDay. A per-day override wins over a per-week one
   *  (Ben, 2026-08-19). */
  weekTimes?: string[];
}

/** A per-meeting text column (topic, chair, notetaker…), maker-configured. */
export interface MeetingColumn {
  key: string;
  label: string;
}

export interface ExistingMeeting {
  date: string; // yyyy-mm-dd of the scheduled instance
  hour: number; // scheduled hour (locates the shift for shiftly)
  minute: number; // scheduled minute (-1 when the record has no time)
  recordId: string;
  rescheduledTo: string; // "" when not rescheduled
  /** Created outside the cadence — rendered as its own flagged row. */
  adhoc: boolean;
  /** The record is closed (read-only; the meeting has been held). */
  closed: boolean;
  values: Record<string, string>; // stored custom-column values, by key
}

export type InstanceStatus = "existing" | "missing" | "planned";

export interface MeetingInstance {
  iso: string; // yyyy-mm-ddTHH:MM
  date: string; // yyyy-mm-dd
  day: string; // "Mon"
  time: string; // "HH:MM"
  crew: string; // "" when no roster applies
  shift: "" | "day" | "night";
  /** A record created outside the cadence (slice 5). */
  adhoc: boolean;
  /** The record is closed — held and archived, read-only. */
  closed: boolean;
  /** The rotation topic for this occurrence ("" = none configured). */
  topic: string;
  recordId: string; // "" when no record exists yet
  rescheduledTo: string;
  status: InstanceStatus;
  values: Record<string, string>; // custom-column values from the record
}

/** Hide a missing (assumed didn't-happen) instance once it is this old. */
export const STALE_MISS_DAYS = 7;

// ---- date helpers (all local time) ----

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function isoLocal(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseLocalDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// ---- input parsing ----

export function parseCategory(raw: string | null | undefined): Category {
  const t = String(raw ?? "").trim().toLowerCase();
  const all: Category[] = [
    "annually", "quarterly", "monthly", "fortnightly", "weekly", "daily", "shiftly",
  ];
  return (all as string[]).includes(t) ? (t as Category) : "daily";
}

/** "Mon,Tue" / "1,2" / JSON array → sorted unique day indices (0=Sun). */
export function parseDaysOfWeek(raw: string | null | undefined): number[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [0, 1, 2, 3, 4, 5, 6];
  let items: string[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr.map((v) => String(v)) : [];
    } catch {
      items = t.split(",");
    }
  } else {
    items = t.split(",");
  }
  const names = DAY_LABELS.map((d) => d.toLowerCase());
  const out = new Set<number>();
  for (const item of items) {
    const s = item.trim().toLowerCase();
    if (s === "") continue;
    const n = Number(s);
    if (Number.isInteger(n) && n >= 0 && n <= 6) {
      out.add(n);
      continue;
    }
    const idx = names.findIndex((d) => s.startsWith(d));
    if (idx >= 0) out.add(idx);
  }
  return out.size > 0 ? [...out].sort() : [0, 1, 2, 3, 4, 5, 6];
}

export function parseTimeOfDay(raw: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return "07:00";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function parseCrews(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [];
  let items: string[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr.map((v) => String(v ?? "")) : [];
    } catch {
      items = t.split(",");
    }
  } else {
    items = t.split(",");
  }
  return items.map((v) => v.trim()).filter((v) => v !== "").slice(0, 8);
}

/** "2D-2N-5O-2D-3N-4O" → blocks; anything unparseable → [] (no roster). */
export function parseRosterPattern(raw: string | null | undefined): RosterBlock[] {
  const t = String(raw ?? "").trim().toUpperCase();
  if (t === "") return [];
  const out: RosterBlock[] = [];
  for (const seg of t.split(/[-,\s]+/)) {
    if (seg === "") continue;
    const m = /^(\d+)([DNO])$/.exec(seg);
    if (!m) return [];
    const len = Number(m[1]);
    if (len < 1 || len > 60) return [];
    out.push({ len, type: m[2] as RosterBlock["type"] });
  }
  return out.length > 0 ? out : [];
}

/**
 * weekTopics input — the weekly meeting's topic rotation through the month:
 * a JSON array or CSV of up to five entries ([1st, 2nd, 3rd, 4th, 5th
 * week]). Blank entries leave that week untopiced.
 */
export function parseWeekTopics(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [];
  let items: string[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr.map((v) => String(v ?? "")) : [];
    } catch {
      items = t.split(",");
    }
  } else {
    items = t.split(",");
  }
  const out = items.slice(0, 5).map((v) => v.trim());
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * dayTopics input — daily/shiftly topics keyed by weekday: a JSON object
 * ({"Mon": "Safety", "2": "Quality"}) or CSV pairs ("Mon:Safety,Tue:Quality").
 * Keys are day names or indices (0=Sun).
 */
export function parseDayTopics(raw: string | null | undefined): Record<number, string> {
  const t = String(raw ?? "").trim();
  if (t === "") return {};
  const names = DAY_LABELS.map((d) => d.toLowerCase());
  const dayIndex = (key: string): number => {
    const s = key.trim().toLowerCase();
    const n = Number(s);
    if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
    return names.findIndex((d) => s.startsWith(d));
  };
  const out: Record<number, string> = {};
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const idx = dayIndex(k);
        const topic = String(v ?? "").trim();
        if (idx >= 0 && topic !== "") out[idx] = topic;
      }
      return out;
    } catch {
      return {};
    }
  }
  for (const pair of t.split(",")) {
    const sep = pair.indexOf(":");
    if (sep < 0) continue;
    const idx = dayIndex(pair.slice(0, sep));
    const topic = pair.slice(sep + 1).trim();
    if (idx >= 0 && topic !== "") out[idx] = topic;
  }
  return out;
}

/** Validate one HH:MM; "" when malformed. */
function cleanTime(v: unknown): string {
  const t = String(v ?? "").trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? t.padStart(5, "0") : "";
}

/** dayTimes input — per-weekday times: JSON object ({"Mon":"07:00"}) or
 *  CSV pairs ("Mon:07:00,Fri:15:00"); keys as for dayTopics. */
export function parseDayTimes(raw: string | null | undefined): Record<number, string> {
  const t = String(raw ?? "").trim();
  if (t === "") return {};
  const names = DAY_LABELS.map((d) => d.toLowerCase());
  const dayIndex = (key: string): number => {
    const k = key.trim().toLowerCase();
    const n = Number(k);
    if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
    return names.findIndex((d) => k.startsWith(d));
  };
  const out: Record<number, string> = {};
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const idx = dayIndex(k);
        const time = cleanTime(v);
        if (idx >= 0 && time !== "") out[idx] = time;
      }
      return out;
    } catch {
      return {};
    }
  }
  for (const pair of t.split(",")) {
    const sep = pair.indexOf(":");
    if (sep < 0) continue;
    const idx = dayIndex(pair.slice(0, sep));
    const time = cleanTime(pair.slice(sep + 1));
    if (idx >= 0 && time !== "") out[idx] = time;
  }
  return out;
}

/** weekTimes input — per-week-of-month times [1st..5th]: JSON array or CSV;
 *  blank entries = the default time. */
export function parseWeekTimes(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [];
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
  const out = items.slice(0, 5).map(cleanTime);
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** The rotation topic for a date: weekly = the day's topic (multi-day
 *  weekly rituals name their days — kickoff / closeout) else the
 *  week-of-month topic; daily/shiftly = the day's topic. */
export function topicForCfg(
  cfg: Pick<SchedulerConfig, "category" | "weekTopics" | "dayTopics">,
  date: Date
): string {
  if (cfg.category === "weekly") {
    return cfg.dayTopics[date.getDay()] ?? cfg.weekTopics[Math.ceil(date.getDate() / 7) - 1] ?? "";
  }
  if (cfg.category === "daily" || cfg.category === "shiftly") return cfg.dayTopics[date.getDay()] ?? "";
  return "";
}

/** The time an occurrence runs: per-day override, else per-week-of-month
 *  override (weekly), else the default. Pure; the engine and every summary
 *  must agree, so they all call this. */
export function timeFor(cfg: Pick<SchedulerConfig, "category" | "timeOfDay" | "dayTimes" | "weekTimes">, date: Date): string {
  const byDay = cfg.dayTimes?.[date.getDay()];
  if (byDay) return byDay;
  if (cfg.category === "weekly") {
    const byWeek = cfg.weekTimes?.[Math.ceil(date.getDate() / 7) - 1];
    if (byWeek) return byWeek;
  }
  return cfg.timeOfDay;
}

/** True when any override differs from the default (summaries say "varies"). */
export function timeVaries(cfg: Pick<SchedulerConfig, "category" | "timeOfDay" | "dayTimes" | "weekTimes">): boolean {
  const d = Object.values(cfg.dayTimes ?? {}).some((t) => t !== "" && t !== cfg.timeOfDay);
  const w = cfg.category === "weekly" && (cfg.weekTimes ?? []).some((t) => t !== "" && t !== cfg.timeOfDay);
  return d || w;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * columns input: CSV of labels ("Topic,Chair,Notetaker"), or a JSON array of
 * strings / {key,label} objects. Keys default to a slug of the label.
 */
export function parseColumns(raw: string | null | undefined): MeetingColumn[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [];
  let items: unknown[];
  if (t.startsWith("[")) {
    try {
      const a = JSON.parse(t);
      items = Array.isArray(a) ? a : [];
    } catch {
      items = t.split(",");
    }
  } else {
    items = t.split(",");
  }
  const out: MeetingColumn[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    let label = "";
    let key = "";
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      label = String(o.label ?? o.name ?? o.key ?? "").trim();
      key = String(o.key ?? "").trim();
    } else {
      label = String(it ?? "").trim();
    }
    if (label === "" && key === "") continue;
    if (label === "") label = key;
    if (key === "") key = slug(label);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * existingMeetingsJSON: [{date|datetime|when, rescheduledDate|rescheduledTo,
 * recordId|id, values:{colKey: text}}] — datetimes may be "yyyy-mm-dd", ISO,
 * or "yyyy-mm-dd HH:MM".
 */
export function parseExistingMeetings(raw: string | null | undefined): ExistingMeeting[] {
  const t = String(raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: ExistingMeeting[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const whenRaw = String(o.date ?? o.datetime ?? o.when ?? "").trim();
      const date = parseLocalDate(whenRaw);
      if (!date) continue;
      const hm = /[T ](\d{1,2}):(\d{2})/.exec(whenRaw);
      const values: Record<string, string> = {};
      if (o.values && typeof o.values === "object") {
        for (const [k, v] of Object.entries(o.values as Record<string, unknown>)) {
          values[k] = String(v ?? "");
        }
      }
      out.push({
        date: isoLocal(date),
        hour: hm ? Math.max(0, Math.min(23, Number(hm[1]))) : -1,
        minute: hm ? Math.max(0, Math.min(59, Number(hm[2]))) : -1,
        adhoc: o.adhoc === true,
        closed: o.closed === true,
        recordId: String(o.recordId ?? o.id ?? "").trim(),
        rescheduledTo: String(o.rescheduledDate ?? o.rescheduledTo ?? "").trim(),
        values,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---- roster engine ----

function cycleLength(roster: RosterBlock[]): number {
  return roster.reduce((a, b) => a + b.len, 0);
}

/** Block type at position `p` of the written cycle. */
function stateAtPos(roster: RosterBlock[], p: number): "D" | "N" | "O" {
  for (const block of roster) {
    if (p < block.len) return block.type;
    p -= block.len;
  }
  return "O";
}

/**
 * When each crew joins the roster. The offsets are spread evenly through
 * the cycle (cycle ÷ crews apart — the standard continuous-roster
 * construction, so a well-formed pattern has exactly one crew on days and
 * one on nights every day). They are then assigned to the LISTED crews in
 * the order each offset first takes the day shift after the base date:
 * crew 1 starts the sequence on the base date, crew 2 picks up days when
 * crew 1's first day block ends, and so on — whatever the internal block
 * structure. With the crew count unknown (0), fall back to the
 * single-block classic: stagger by the first day-block's length.
 */
function crewOffsets(roster: RosterBlock[], crewCount: number): number[] {
  const cycle = cycleLength(roster);
  const offs = Array.from(
    { length: crewCount },
    (_, i) => Math.round((i * cycle) / crewCount) % cycle
  );
  const firstDayShift = (o: number): number => {
    for (let t = 0; t < cycle; t++) {
      if (stateAtPos(roster, mod(t - o, cycle)) === "D") return t;
    }
    return cycle;
  };
  return offs.sort((a, b) => firstDayShift(a) - firstDayShift(b));
}

/** What crew `idx` (of `crewCount`) is doing on `date` under the roster. */
export function crewStateOn(
  roster: RosterBlock[],
  baseStart: Date,
  idx: number,
  date: Date,
  crewCount = 0
): "D" | "N" | "O" {
  const cycle = cycleLength(roster);
  if (cycle === 0) return "O";
  let offset: number;
  if (crewCount > 0) {
    const offs = crewOffsets(roster, crewCount);
    offset = offs[Math.min(idx, offs.length - 1)] ?? 0;
  } else {
    const firstD = roster.find((b) => b.type === "D");
    offset = idx * (firstD ? firstD.len : roster[0]?.len ?? 1);
  }
  return stateAtPos(roster, mod(daysBetween(baseStart, date) - offset, cycle));
}

/** The first-listed crew on day / night shift on `date` (or ""). */
export function crewOnShift(
  roster: RosterBlock[],
  crews: string[],
  baseStart: Date,
  date: Date,
  shift: "D" | "N"
): string {
  if (roster.length === 0 || crews.length === 0) return "";
  for (let i = 0; i < crews.length; i++) {
    if (crewStateOn(roster, baseStart, i, date, crews.length) === shift) {
      return crews[i];
    }
  }
  return "";
}

// ---- recurrence engine ----

/** nth occurrence (1-based) of `weekday` in the month; past-the-end → last. */
function nthWeekdayOfMonth(year: number, month: number, nth: number, weekday: number): Date {
  const first = new Date(year, month, 1);
  const firstHit = 1 + mod(weekday - first.getDay(), 7);
  let day = firstHit + (nth - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  while (day > lastDay) day -= 7;
  return new Date(year, month, day);
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const nh = mod(h + hours, 24);
  return `${String(nh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The dates (no times yet) the meeting recurs on, inside the window. */
function recurrenceDates(cfg: SchedulerConfig, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const base = cfg.baseStart;

  if (cfg.category === "daily" || cfg.category === "shiftly" || cfg.category === "weekly") {
    for (let d = new Date(from.getTime()); d <= to; d = new Date(d.getTime() + DAY_MS)) {
      if (cfg.daysOfWeek.includes(d.getDay())) out.push(new Date(d.getTime()));
    }
    return out;
  }

  if (cfg.category === "fortnightly") {
    // weeks with the same parity as the base date's week
    for (let d = new Date(from.getTime()); d <= to; d = new Date(d.getTime() + DAY_MS)) {
      if (!cfg.daysOfWeek.includes(d.getDay())) continue;
      const weeks = Math.floor(daysBetween(base, d) / 7);
      if (mod(weeks, 2) === 0) out.push(new Date(d.getTime()));
    }
    return out;
  }

  // monthly / quarterly / annually: the base date's relative weekday
  // (e.g. "1st Monday") repeated at the cadence.
  const nth = Math.ceil(base.getDate() / 7);
  const weekday = base.getDay();
  const stepMonths = cfg.category === "monthly" ? 1 : cfg.category === "quarterly" ? 3 : 12;
  // walk months from base to the window end
  const cursor = new Date(base.getFullYear(), base.getMonth(), 1);
  const endGate = new Date(to.getFullYear(), to.getMonth() + 1, 1);
  while (cursor < endGate) {
    const hit = nthWeekdayOfMonth(cursor.getFullYear(), cursor.getMonth(), nth, weekday);
    if (hit >= from && hit <= to) out.push(hit);
    cursor.setMonth(cursor.getMonth() + stepMonths);
  }
  return out;
}

// ---- instance generation + record matching ----

function matchRecord(
  existing: ExistingMeeting[],
  date: string,
  shift: "" | "day" | "night"
): ExistingMeeting | undefined {
  return existing.find((e) => {
    if (e.date !== date) return false;
    if (shift === "") return true;
    if (e.hour < 0) return true; // record has no time — accept on date
    const recDay = e.hour >= 6 && e.hour < 18;
    return (shift === "day") === recDay;
  });
}

/**
 * Generate the selectable meeting instances in the window, newest first,
 * matched against the existing records. `now` decides past-vs-planned.
 */
export function generateInstances(
  cfg: SchedulerConfig,
  existing: ExistingMeeting[],
  now: Date
): MeetingInstance[] {
  const to = startOfDay(cfg.finalDate);
  const from = new Date(to.getTime() - Math.max(0, cfg.daysPrior) * DAY_MS);
  const dates = recurrenceDates(cfg, from, to);
  const hasRoster = cfg.roster.length > 0 && cfg.crews.length > 0;

  // the occurrence's rotation topic: weekly rotates through the month
  // (1st..5th occurrence of the weekday), daily/shiftly follows the weekday
  const topicFor = (date: Date): string => topicForCfg(cfg, date);

  const out: MeetingInstance[] = [];
  const push = (date: Date, time: string, shift: "" | "day" | "night", crew: string) => {
    const dIso = isoLocal(date);
    const rec = matchRecord(existing.filter((e) => !e.adhoc), dIso, shift);
    const iso = `${dIso}T${time}`;
    const past = new Date(`${dIso}T${time}:00`) < now;
    out.push({
      iso,
      date: dIso,
      day: DAY_LABELS[date.getDay()],
      time,
      crew,
      shift,
      topic: topicFor(date),
      adhoc: false,
      closed: rec?.closed ?? false,
      recordId: rec?.recordId ?? "",
      rescheduledTo: rec?.rescheduledTo ?? "",
      status: rec && rec.recordId !== "" ? "existing" : past ? "missing" : "planned",
      values: rec?.values ?? {},
    });
  };

  for (const date of dates) {
    const time = timeFor(cfg, date);
    if (cfg.category === "shiftly") {
      push(date, time, "day",
        hasRoster ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "D") : "");
      push(date, addHours(time, 12), "night",
        hasRoster ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "N") : "");
    } else {
      const crew =
        hasRoster && (cfg.category === "daily")
          ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "D")
          : "";
      push(date, time, "", crew);
    }
  }

  // hide missing instances more than STALE_MISS_DAYS old — assume they simply
  // didn't happen (a recent miss stays, so its record can still be created)
  const staleCutoff = now.getTime() - STALE_MISS_DAYS * DAY_MS;
  const visible = out.filter(
    (inst) =>
      inst.status !== "missing" ||
      new Date(`${inst.date}T${inst.time}:00`).getTime() >= staleCutoff
  );

  // ad-hoc records render as their own rows, outside the cadence
  for (const e of existing) {
    if (!e.adhoc || e.recordId === "") continue;
    const hh = e.hour >= 0 ? String(e.hour).padStart(2, "0") : "00";
    const mm = e.minute >= 0 ? String(e.minute).padStart(2, "0") : "00";
    const d = parseLocalDate(e.date);
    visible.push({
      iso: `${e.date}T${hh}:${mm}`,
      date: e.date,
      day: d ? DAY_LABELS[d.getDay()] : "",
      time: `${hh}:${mm}`,
      crew: "",
      shift: "",
      topic: "",
      adhoc: true,
      closed: e.closed,
      recordId: e.recordId,
      rescheduledTo: e.rescheduledTo,
      status: "existing",
      values: e.values,
    });
  }

  visible.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0)); // newest first
  return visible;
}

// ---- attendees ----

import { Person } from "./people";

/**
 * Expected attendees for an instance's on-shift crew: people whose crew
 * matches, plus everyone without a crew (they always attend). No crew on
 * the instance (no roster) = everyone.
 */
export function attendeesFor(people: Person[], instanceCrew: string): Person[] {
  const crew = instanceCrew.trim().toLowerCase();
  if (crew === "") return people;
  return people.filter(
    (p) => p.crew === undefined || p.crew.toLowerCase() === crew
  );
}

// ---- the rotation as a list, and the topic for one date --------------------

/** The rotation topics a wizard blob defines, in rotation order, as
 *  the card settings pane lists them ("Week 2 · Ops", "Tuesday · Cost").
 *  Weekly → week-of-month entries; daily/shiftly → weekday entries; other
 *  categories have no rotation. Blank entries are skipped. */
export function rotationTopics(occurrenceSettingsRaw: string): { key: string; label: string }[] {
  const cfg = rotationConfig(occurrenceSettingsRaw);
  if (!cfg) return [];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string) => {
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    out.push({ key, label });
  };
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (cfg.category === "weekly" || cfg.category === "daily" || cfg.category === "shiftly") {
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const t = cfg.dayTopics[d] ?? "";
      push(t, `${names[d]} · ${t}`);
    }
  }
  if (cfg.category === "weekly") {
    const ord = ["1st", "2nd", "3rd", "4th", "5th"];
    cfg.weekTopics.forEach((t, i) => push(t, `${ord[i] ?? `${i + 1}th`} week · ${t}`));
  }
  return out;
}

/** The rotation topic for one occurrence date ("" = none). Same rule the
 *  engine stamps on instances (weekly by week-of-month, daily by weekday). */
export function topicForDate(occurrenceSettingsRaw: string, whenIso: string): string {
  const cfg = rotationConfig(occurrenceSettingsRaw);
  if (!cfg || whenIso.length < 10) return "";
  const date = new Date(`${whenIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return topicForCfg(cfg, date);
}

/**
 * The cadence part of a SchedulerConfig from a wizard/scheduler blob's
 * `config` object — ONE reader for the board pane, the card editor, the
 * hub and the topic helpers (they used to carry four copies). `finalDate`,
 * `daysPrior` and `baseStart` fallback are the caller's.
 */
export function cadenceFromConfig(
  config: Record<string, unknown>,
  baseFallback: Date
): Omit<SchedulerConfig, "finalDate" | "daysPrior"> {
  const s = (k: string) => String(config[k] ?? "");
  return {
    category: parseCategory(s("category")),
    daysOfWeek: parseDaysOfWeek(s("daysOfWeek")),
    timeOfDay: parseTimeOfDay(s("timeOfDay")),
    crews: parseCrews(s("crewList")),
    roster: parseRosterPattern(s("rosterPattern")),
    baseStart: parseLocalDate(s("baseStartDate")) ?? baseFallback,
    weekTopics: parseWeekTopics(Array.isArray(config.weekTopics) ? JSON.stringify(config.weekTopics) : s("weekTopics")),
    dayTopics: parseDayTopics(
      config.dayTopics && typeof config.dayTopics === "object" ? JSON.stringify(config.dayTopics) : s("dayTopics")
    ),
    dayTimes: parseDayTimes(
      config.dayTimes && typeof config.dayTimes === "object" ? JSON.stringify(config.dayTimes) : s("dayTimes")
    ),
    weekTimes: parseWeekTimes(Array.isArray(config.weekTimes) ? JSON.stringify(config.weekTimes) : s("weekTimes")),
  };
}

function rotationConfig(
  occurrenceSettingsRaw: string
): { category: Category; weekTopics: string[]; dayTopics: Record<number, string> } | null {
  try {
    const raw = String(occurrenceSettingsRaw ?? "").trim();
    if (!raw.startsWith("{")) return null;
    const blob = JSON.parse(raw) as Record<string, unknown>;
    const config = (blob.config ?? {}) as Record<string, unknown>;
    const s = (k: string) => String(config[k] ?? "");
    return {
      category: parseCategory(s("category")),
      weekTopics: parseWeekTopics(Array.isArray(config.weekTopics) ? JSON.stringify(config.weekTopics) : s("weekTopics")),
      dayTopics: parseDayTopics(
        config.dayTopics && typeof config.dayTopics === "object" ? JSON.stringify(config.dayTopics) : s("dayTopics")
      ),
    };
  } catch {
    return null;
  }
}
