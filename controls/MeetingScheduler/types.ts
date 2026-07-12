// MeetingScheduler — a SELECTION component. The cadence comes from a meeting
// definition record via discrete inputs (category, days, time, crews, roster
// pattern, base date); the control generates the meeting instances inside
// the [finalDate − daysPrior, finalDate] window, matches them against the
// existing meeting records (existingMeetingsJSON), flags past instances with
// no record, and emits the tapped row on selectedMeetingJSON so the app's
// OnChange can open the existing record or create a new one.
//
// Roster pattern grammar: "2D-2N-5O-2D-3N-4O" — blocks of Days worked,
// Nights worked, and days Off, cycled. BaseStartDate is the date the FIRST
// listed crew started the pattern's first day shift; each next crew starts
// its days when the previous crew moves onto nights (stagger = length of the
// first D block).

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
}

/** A per-meeting text column (topic, chair, notetaker…), maker-configured. */
export interface MeetingColumn {
  key: string;
  label: string;
}

export interface ExistingMeeting {
  date: string; // yyyy-mm-dd of the scheduled instance
  hour: number; // scheduled hour (locates the shift for shiftly)
  recordId: string;
  rescheduledTo: string; // "" when not rescheduled
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

/** Stagger between crews: the next crew starts days when the previous crew
 *  goes onto nights — i.e. the length of the pattern's first D block. */
function crewStagger(roster: RosterBlock[]): number {
  const firstD = roster.find((b) => b.type === "D");
  return firstD ? firstD.len : roster[0]?.len ?? 1;
}

/** What crew `idx` is doing on `date` under the roster. */
export function crewStateOn(
  roster: RosterBlock[],
  baseStart: Date,
  idx: number,
  date: Date
): "D" | "N" | "O" {
  const cycle = cycleLength(roster);
  if (cycle === 0) return "O";
  let p = mod(daysBetween(baseStart, date) - idx * crewStagger(roster), cycle);
  for (const block of roster) {
    if (p < block.len) return block.type;
    p -= block.len;
  }
  return "O";
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
    if (crewStateOn(roster, baseStart, i, date) === shift) return crews[i];
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

  const out: MeetingInstance[] = [];
  const push = (date: Date, time: string, shift: "" | "day" | "night", crew: string) => {
    const dIso = isoLocal(date);
    const rec = matchRecord(existing, dIso, shift);
    const iso = `${dIso}T${time}`;
    const past = new Date(`${dIso}T${time}:00`) < now;
    out.push({
      iso,
      date: dIso,
      day: DAY_LABELS[date.getDay()],
      time,
      crew,
      shift,
      recordId: rec?.recordId ?? "",
      rescheduledTo: rec?.rescheduledTo ?? "",
      status: rec && rec.recordId !== "" ? "existing" : past ? "missing" : "planned",
      values: rec?.values ?? {},
    });
  };

  for (const date of dates) {
    if (cfg.category === "shiftly") {
      push(date, cfg.timeOfDay, "day",
        hasRoster ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "D") : "");
      push(date, addHours(cfg.timeOfDay, 12), "night",
        hasRoster ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "N") : "");
    } else {
      const crew =
        hasRoster && (cfg.category === "daily")
          ? crewOnShift(cfg.roster, cfg.crews, cfg.baseStart, date, "D")
          : "";
      push(date, cfg.timeOfDay, "", crew);
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

  visible.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0)); // newest first
  return visible;
}
