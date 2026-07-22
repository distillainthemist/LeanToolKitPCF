// MeetingWizard draft model — the working copy of a meeting being set up.
// The wizard walks a maker through the meeting's identity (title, purpose,
// owner, organisation), cadence, crews, participants and record columns,
// then emits ONE MeetingScheduler settingsJSON blob (config + meeting
// sections). Parsing is defensive and LOSSLESS: top-level and config keys
// the wizard does not manage (theme, prompts, board, …) are carried
// verbatim and written back, so wizard-editing an existing meeting never
// strips composer-made settings.

import {
  buildMeetingSection,
  MeetingPerson,
  parseMeetingInfo,
} from "../../shared/schema/meeting";

export const CADENCES = [
  { value: "annually", label: "Annually" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
  { value: "shiftly", label: "Shiftly (day + night)" },
];

/** Cadences that use the crew roster machinery. */
export function isRostered(category: string): boolean {
  return category === "daily" || category === "shiftly";
}

/** Cadences where picking weekdays makes sense. */
export function hasWeekdays(category: string): boolean {
  return (
    category === "weekly" ||
    category === "fortnightly" ||
    category === "daily" ||
    category === "shiftly"
  );
}

/** Cadences that meet on exactly ONE day of the week. */
export function isSingleDay(category: string): boolean {
  return category === "weekly" || category === "fortnightly";
}

/**
 * Cadences whose recurrence projects forward from an anchor date (the
 * scheduler's baseStartDate): fortnightly = same week parity as the anchor;
 * monthly/quarterly/annually = the anchor's nth weekday (e.g. 2nd Tuesday).
 * Rostered cadences anchor via the roster's first day shift instead.
 */
export function isAnchored(category: string): boolean {
  return (
    category === "annually" ||
    category === "quarterly" ||
    category === "monthly" ||
    category === "fortnightly"
  );
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface WizardDraft {
  title: string;
  purpose: string;
  owner: MeetingPerson | null;
  org: { site: string; department: string; area: string };
  category: string;
  daysOfWeek: string; // CSV
  timeOfDay: string; // HH:MM
  daysPrior: string; // numeric text; "" = control default
  daysAhead: string; // future days listed; "" = none
  crewList: string; // CSV, roster order
  rosterPattern: string; // e.g. 2D-2N-5O
  baseStartDate: string; // yyyy-mm-dd
  columns: string; // CSV of row-column labels
  /** Admin-managed classification (NOT the cadence). */
  meetingCategory: string;
  /** Participants may adjust individual instances (instance composer). */
  instancesAdjustable: boolean;
  /** Weekly topic rotation through the month: [1st..5th week]. */
  weekTopics: string[];
  /** Daily/shiftly topics keyed by weekday label ("Mon".."Sun"). */
  dayTopics: Record<string, string>;
  participants: MeetingPerson[];
  /** Unmanaged top-level keys (theme, prompts, board, …), kept verbatim. */
  extraTop: Record<string, unknown>;
  /** Unmanaged config keys, kept verbatim. */
  extraConfig: Record<string, unknown>;
}

export function emptyDraft(): WizardDraft {
  return {
    title: "",
    purpose: "",
    owner: null,
    org: { site: "", department: "", area: "" },
    category: "weekly",
    daysOfWeek: "",
    timeOfDay: "07:00",
    daysPrior: "",
    daysAhead: "",
    crewList: "",
    rosterPattern: "",
    baseStartDate: "",
    columns: "",
    meetingCategory: "",
    instancesAdjustable: false,
    weekTopics: [],
    dayTopics: {},
    participants: [],
    extraTop: {},
    extraConfig: {},
  };
}

const MANAGED_TOP = ["cardType", "title", "config", "meeting", "meetingCategory", "instancesAdjustable"];
const MANAGED_CONFIG = [
  "category",
  "daysOfWeek",
  "timeOfDay",
  "daysPrior",
  "daysAhead",
  "crewList",
  "rosterPattern",
  "baseStartDate",
  "columns",
  "weekTopics",
  "dayTopics",
];

function s(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Parse an existing settingsJSON into a wizard draft; never throws. */
export function parseWizardDraft(raw: string | null | undefined): WizardDraft {
  const draft = emptyDraft();
  const t = (raw ?? "").trim();
  if (t === "" || !t.startsWith("{")) return draft;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return draft;
  }
  draft.title = s(o.title);
  draft.meetingCategory = s(o.meetingCategory);
  draft.instancesAdjustable = o.instancesAdjustable === true;
  const config = (o.config ?? {}) as Record<string, unknown>;
  if (typeof config === "object" && !Array.isArray(config)) {
    const cat = s(config.category);
    if (CADENCES.some((c) => c.value === cat)) draft.category = cat;
    draft.daysOfWeek = s(config.daysOfWeek);
    if (s(config.timeOfDay) !== "") draft.timeOfDay = s(config.timeOfDay);
    draft.daysPrior = s(config.daysPrior);
    draft.daysAhead = s(config.daysAhead);
    draft.crewList = s(config.crewList);
    draft.rosterPattern = s(config.rosterPattern);
    draft.baseStartDate = s(config.baseStartDate);
    draft.columns = s(config.columns);
    if (Array.isArray(config.weekTopics)) {
      draft.weekTopics = config.weekTopics.slice(0, 5).map((v) => s(v));
    } else if (s(config.weekTopics) !== "") {
      draft.weekTopics = s(config.weekTopics).split(",").slice(0, 5).map((v) => v.trim());
    }
    if (config.dayTopics && typeof config.dayTopics === "object" && !Array.isArray(config.dayTopics)) {
      for (const [k, v] of Object.entries(config.dayTopics as Record<string, unknown>)) {
        const day = WEEKDAYS.find((d) => k.trim().toLowerCase().startsWith(d.toLowerCase()));
        if (day && s(v) !== "") draft.dayTopics[day] = s(v);
      }
    }
    for (const key of Object.keys(config)) {
      if (!MANAGED_CONFIG.includes(key)) draft.extraConfig[key] = config[key];
    }
  }
  const info = parseMeetingInfo(t);
  if (info) {
    draft.purpose = info.purpose;
    draft.owner = info.owner;
    draft.org = { ...info.org };
    draft.participants = info.participants;
  }
  for (const key of Object.keys(o)) {
    if (!MANAGED_TOP.includes(key)) draft.extraTop[key] = o[key];
  }
  return draft;
}

/**
 * The draft as a complete MeetingScheduler settingsJSON string. SPARSE for
 * everything the maker left empty; roster fields are dropped entirely for
 * unrostered cadences so a cadence change cleans up after itself.
 */
export function serializeWizardDraft(draft: WizardDraft): string {
  const config: Record<string, unknown> = { ...draft.extraConfig };
  config.category = draft.category;
  if (hasWeekdays(draft.category) && draft.daysOfWeek !== "") {
    config.daysOfWeek = draft.daysOfWeek;
  }
  if (draft.timeOfDay !== "") config.timeOfDay = draft.timeOfDay;
  if (draft.daysPrior !== "" && Number.isFinite(Number(draft.daysPrior))) {
    config.daysPrior = Math.max(1, Math.round(Number(draft.daysPrior)));
  }
  if (draft.daysAhead !== "" && Number.isFinite(Number(draft.daysAhead))) {
    config.daysAhead = Math.max(0, Math.round(Number(draft.daysAhead)));
  }
  if (isRostered(draft.category)) {
    if (draft.crewList !== "") config.crewList = draft.crewList;
    if (draft.rosterPattern !== "") config.rosterPattern = draft.rosterPattern;
  }
  // the recurrence anchor: rostered cadences anchor the roster, anchored
  // cadences project the recurrence (nth weekday / week parity) from it
  if (
    (isRostered(draft.category) || isAnchored(draft.category)) &&
    draft.baseStartDate !== ""
  ) {
    config.baseStartDate = draft.baseStartDate;
  }
  if (draft.category === "weekly") {
    const topics = draft.weekTopics.map((t) => t.trim());
    while (topics.length > 0 && topics[topics.length - 1] === "") topics.pop();
    if (topics.some((t) => t !== "")) config.weekTopics = topics;
  }
  if (isRostered(draft.category)) {
    const days: Record<string, string> = {};
    for (const [day, topic] of Object.entries(draft.dayTopics)) {
      if (topic.trim() !== "") days[day] = topic.trim();
    }
    if (Object.keys(days).length > 0) config.dayTopics = days;
  }
  if (draft.columns !== "") config.columns = draft.columns;

  const out: Record<string, unknown> = { ...draft.extraTop, cardType: "MeetingScheduler" };
  if (draft.title !== "") out.title = draft.title;
  if (draft.meetingCategory !== "") out.meetingCategory = draft.meetingCategory;
  if (draft.instancesAdjustable) out.instancesAdjustable = true;
  out.config = config;
  const meeting = buildMeetingSection({
    purpose: draft.purpose,
    owner: draft.owner,
    org: draft.org,
    participants: draft.participants,
  });
  if (meeting) out.meeting = meeting;
  return JSON.stringify(out);
}

/** Split a CSV field into trimmed, non-empty entries. */
export function csvItems(csv: string): string[] {
  return csv
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** Join entries back into the canonical CSV form. */
export function csvJoin(items: string[]): string {
  return items.join(",");
}
