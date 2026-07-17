// LeanHub — the person's home: a tabbed shell (Calendar / Actions /
// Settings). The calendar projects every supplied meeting's cadence onto a
// day/week grid via the shared recurrence engine, scoped to a person, area,
// department or site; site-level protected time zones render as coloured
// background bands. Tapping an occurrence emits it (with boardId) so the
// app can navigate to that board's MeetingScheduler pre-selected
// (selectIso). Actions ride the standard actions channel; preferences and
// protected-time edits are emitted for the app to persist.

import {
  generateInstances,
  MeetingInstance,
  parseCategory,
  parseCrews,
  parseDaysOfWeek,
  parseDayTopics,
  parseLocalDate,
  parseRosterPattern,
  parseTimeOfDay,
  parseWeekTopics,
  SchedulerConfig,
  startOfDay,
} from "../../shared/schema/recurrence";
import { MeetingInfo, parseMeetingInfo } from "../../shared/schema/meeting";

/** One meeting definition on the calendar: a board + its scheduler blob. */
export interface HubMeeting {
  boardId: string;
  title: string;
  /** The card's title-strip colour — colours the calendar chip. */
  barColor: string;
  info: MeetingInfo | null;
  /** Cadence pieces (window-independent); finalDate/daysPrior set per view. */
  cadence: Omit<SchedulerConfig, "finalDate" | "daysPrior">;
}

/** A projected occurrence, tagged with its source meeting. */
export interface HubInstance extends MeetingInstance {
  boardId: string;
  title: string;
  barColor: string;
}

export interface ProtectedTime {
  label: string;
  color: string;
  days: number[]; // 0=Sun .. 6=Sat
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type ScopeKind = "person" | "area" | "department" | "site";

export interface HubPrefs {
  scopeKind: ScopeKind;
  scopeValue: string; // whoId for person, org value otherwise; "" = viewer/all
  view: "day" | "week";
  weekStart: 0 | 1; // Sun | Mon
  dayStart: number; // first visible hour
  dayEnd: number; // last visible hour (exclusive)
}

export function defaultPrefs(): HubPrefs {
  return {
    scopeKind: "person",
    scopeValue: "",
    view: "week",
    weekStart: 1,
    dayStart: 6,
    dayEnd: 18,
  };
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** meetingsJSON: [{boardId, settingsJSON}] — settingsJSON string or object. */
export function parseHubMeetings(raw: string | null | undefined): HubMeeting[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  let arr: unknown;
  try {
    arr = JSON.parse(t);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: HubMeeting[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const boardId = asStr(o.boardId);
    if (boardId === "") continue;
    const blobRaw =
      typeof o.settingsJSON === "string"
        ? o.settingsJSON
        : o.settingsJSON && typeof o.settingsJSON === "object"
          ? JSON.stringify(o.settingsJSON)
          : "";
    if (blobRaw.trim() === "") continue;
    let blob: Record<string, unknown>;
    try {
      blob = JSON.parse(blobRaw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const config = (blob.config ?? {}) as Record<string, unknown>;
    const theme = (blob.theme ?? {}) as Record<string, unknown>;
    const today = startOfDay(new Date());
    out.push({
      boardId,
      title: asStr(blob.title) !== "" ? asStr(blob.title) : boardId,
      barColor: asStr(theme.titlebar),
      info: parseMeetingInfo(blobRaw),
      cadence: {
        category: parseCategory(asStr(config.category)),
        daysOfWeek: parseDaysOfWeek(asStr(config.daysOfWeek)),
        timeOfDay: parseTimeOfDay(asStr(config.timeOfDay)),
        crews: parseCrews(asStr(config.crewList)),
        roster: parseRosterPattern(asStr(config.rosterPattern)),
        baseStart: parseLocalDate(asStr(config.baseStartDate)) ?? today,
        weekTopics: parseWeekTopics(
          Array.isArray(config.weekTopics)
            ? JSON.stringify(config.weekTopics)
            : asStr(config.weekTopics)
        ),
        dayTopics: parseDayTopics(
          config.dayTopics && typeof config.dayTopics === "object"
            ? JSON.stringify(config.dayTopics)
            : asStr(config.dayTopics)
        ),
      },
    });
  }
  return out;
}

/**
 * Project every meeting's occurrences inside [from, to]. now = epoch so
 * history renders as planned (no record matching, no staleness filter).
 */
export function projectInstances(
  meetings: HubMeeting[],
  from: Date,
  to: Date
): HubInstance[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const out: HubInstance[] = [];
  for (const m of meetings) {
    const cfg: SchedulerConfig = { ...m.cadence, finalDate: to, daysPrior: days };
    for (const inst of generateInstances(cfg, [], new Date(0))) {
      out.push({ ...inst, boardId: m.boardId, title: m.title, barColor: m.barColor });
    }
  }
  return out;
}

/**
 * Does this occurrence concern the scope? Org scopes match the meeting's
 * org section. Person scope: the owner (attends everything) or a
 * participant — crew-linked participants only when their crew is on shift.
 */
export function instanceInScope(
  meeting: HubMeeting,
  inst: HubInstance,
  kind: ScopeKind,
  value: string
): boolean {
  if (value === "") return true;
  const org = meeting.info?.org;
  if (kind === "site") return org?.site === value;
  if (kind === "department") return org?.department === value;
  if (kind === "area") return org?.area === value;
  // person
  if (meeting.info?.owner?.whoId === value) return true;
  const p = meeting.info?.participants.find((x) => x.whoId === value);
  if (!p) return false;
  if (p.crew === "" || inst.crew === "") return true;
  return p.crew.toLowerCase() === inst.crew.toLowerCase();
}

/** The distinct org values available for a scope kind, for the selector. */
export function scopeOptions(meetings: HubMeeting[], kind: ScopeKind): string[] {
  const values = new Set<string>();
  for (const m of meetings) {
    const org = m.info?.org;
    const v =
      kind === "site" ? org?.site : kind === "department" ? org?.department : org?.area;
    if (v) values.add(v);
  }
  return [...values].sort();
}

// ---- protected time zones ----

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function timeToMinutes(t: string): number {
  const m = TIME_RE.exec(t.trim());
  if (!m) return -1;
  return Math.max(0, Math.min(23, Number(m[1]))) * 60 + Math.min(59, Number(m[2]));
}

/** [{label, color, days (names/indices CSV or array), start, end}] */
export function parseProtectedTimes(raw: string | null | undefined): ProtectedTime[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  let arr: unknown;
  try {
    arr = JSON.parse(t);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ProtectedTime[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = asStr(o.start);
    const end = asStr(o.end);
    if (timeToMinutes(start) < 0 || timeToMinutes(end) < 0) continue;
    if (timeToMinutes(end) <= timeToMinutes(start)) continue;
    out.push({
      label: asStr(o.label),
      color: asStr(o.color) !== "" ? asStr(o.color) : "#f2c811",
      days: parseDaysOfWeek(
        Array.isArray(o.days) ? JSON.stringify(o.days) : asStr(o.days)
      ),
      start,
      end,
    });
  }
  return out;
}

export function serializeProtectedTimes(times: ProtectedTime[]): string {
  return JSON.stringify(
    times.map((z) => ({
      label: z.label,
      color: z.color,
      days: z.days,
      start: z.start,
      end: z.end,
    }))
  );
}

// ---- preferences ----

export function parsePrefs(raw: string | null | undefined): HubPrefs {
  const d = defaultPrefs();
  const t = (raw ?? "").trim();
  if (t === "" || !t.startsWith("{")) return d;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const kind = asStr(o.scopeKind);
    if (["person", "area", "department", "site"].includes(kind)) {
      d.scopeKind = kind as ScopeKind;
    }
    d.scopeValue = asStr(o.scopeValue);
    if (asStr(o.view) === "day") d.view = "day";
    if (o.weekStart === 0) d.weekStart = 0;
    const start = Number(o.dayStart);
    const end = Number(o.dayEnd);
    if (Number.isInteger(start) && start >= 0 && start <= 22) d.dayStart = start;
    if (Number.isInteger(end) && end > d.dayStart && end <= 24) d.dayEnd = end;
  } catch {
    /* defaults */
  }
  return d;
}

export function serializePrefs(p: HubPrefs): string {
  return JSON.stringify(p);
}
