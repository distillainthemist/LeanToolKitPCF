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
  return category === "weekly" || category === "daily" || category === "shiftly";
}

export interface WizardDraft {
  title: string;
  purpose: string;
  owner: MeetingPerson | null;
  org: { site: string; department: string; area: string };
  category: string;
  daysOfWeek: string; // CSV
  timeOfDay: string; // HH:MM
  daysPrior: string; // numeric text; "" = control default
  crewList: string; // CSV, roster order
  rosterPattern: string; // e.g. 2D-2N-5O
  baseStartDate: string; // yyyy-mm-dd
  columns: string; // CSV of row-column labels
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
    crewList: "",
    rosterPattern: "",
    baseStartDate: "",
    columns: "",
    participants: [],
    extraTop: {},
    extraConfig: {},
  };
}

const MANAGED_TOP = ["cardType", "title", "config", "meeting"];
const MANAGED_CONFIG = [
  "category",
  "daysOfWeek",
  "timeOfDay",
  "daysPrior",
  "crewList",
  "rosterPattern",
  "baseStartDate",
  "columns",
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
  const config = (o.config ?? {}) as Record<string, unknown>;
  if (typeof config === "object" && !Array.isArray(config)) {
    const cat = s(config.category);
    if (CADENCES.some((c) => c.value === cat)) draft.category = cat;
    draft.daysOfWeek = s(config.daysOfWeek);
    if (s(config.timeOfDay) !== "") draft.timeOfDay = s(config.timeOfDay);
    draft.daysPrior = s(config.daysPrior);
    draft.crewList = s(config.crewList);
    draft.rosterPattern = s(config.rosterPattern);
    draft.baseStartDate = s(config.baseStartDate);
    draft.columns = s(config.columns);
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
  if (isRostered(draft.category)) {
    if (draft.crewList !== "") config.crewList = draft.crewList;
    if (draft.rosterPattern !== "") config.rosterPattern = draft.rosterPattern;
    if (draft.baseStartDate !== "") config.baseStartDate = draft.baseStartDate;
  }
  if (draft.columns !== "") config.columns = draft.columns;

  const out: Record<string, unknown> = { ...draft.extraTop, cardType: "MeetingScheduler" };
  if (draft.title !== "") out.title = draft.title;
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
