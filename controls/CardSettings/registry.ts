// CardSettings registry — the single source of truth for what a settingsJSON
// blob can contain, per card. Each entry mirrors the keys that card's index.ts
// actually reads via cfg(s, "key"); the convention is: add a cfg() key to a
// control → add its FieldSpec here.
//
// Keys deliberately NOT offered for editing (app-bound at runtime, not
// design-time settings): instanceId (card identity), peopleJSON (live people
// list), existingMeetingsJSON (live meeting records), viewerName/viewerId
// (User() of the person looking). They are listed in `appBound` so the UI can
// say so.

export type FieldKind =
  | "text" // single-line text
  | "multiline" // textarea
  | "number"
  | "date" // yyyy-mm-dd
  | "time" // HH:MM
  | "enum" // one of `options`
  | "boolean"
  | "csvChips" // string list edited as chips, emitted as CSV text
  | "color" // one CSS colour
  | "colorList" // list of colours, emitted as CSV text
  | "objectList" // array of flat objects, edited as a small table (`fields`)
  | "kvList" // key→value map, edited as pairs, emitted as an object
  | "captureColumns" // CaptureCard's typed columns (dedicated builder)
  | "json"; // raw JSON fallback (validated before emit)

export interface ObjectField {
  key: string;
  label: string;
  kind: "text" | "color";
  placeholder?: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[]; // enum
  fields?: ObjectField[]; // objectList columns
}

export interface CardSpec {
  /** Canonical id stamped into the blob as `cardType` — the control name. */
  type: string;
  label: string;
  description: string;
  /** Card-specific config keys (settings config:{...}). May be empty. */
  config: FieldSpec[];
  /** Runtime-bound config keys the app supplies live (not edited here). */
  appBound: string[];
  /** Shown when a card keeps its interesting knobs in its DOCUMENT. */
  configNote?: string;
}

// ---- common section (identical for every card) ------------------------------

export const COMMON_FIELDS: FieldSpec[] = [
  {
    key: "title",
    label: "Card title",
    kind: "text",
    help: "Shown as the card's title bar. Empty = no chrome.",
    placeholder: "e.g. Daily SQDPC board",
  },
  {
    key: "prompts",
    label: "Prompts",
    kind: "multiline",
    help:
      "Coaching prompts: empty-state text and the ⓘ popover. One prompt per line.",
    placeholder: "What made today hard?\nRate each dimension before the huddle",
  },
  {
    key: "readOnly",
    label: "Read only",
    kind: "boolean",
    help: "Display mode — disables all editing in the card.",
  },
];

export const THEME_FIELDS: FieldSpec[] = [
  {
    key: "background",
    label: "Background",
    kind: "color",
    help: "Card background colour. Empty = default white.",
  },
  {
    key: "foreground",
    label: "Foreground",
    kind: "color",
    help: "Text / line colour. Empty = rich black.",
  },
  {
    key: "accent",
    label: "Accent",
    kind: "color",
    help: "Highlights, selection, primary buttons. Empty = rich black.",
  },
  {
    key: "legend",
    label: "Legend colours",
    kind: "colorList",
    help:
      "Status / series colours, meaning varies per card (e.g. [–, Done, Issue]). Empty = defaults.",
  },
  {
    key: "font",
    label: "Font",
    kind: "text",
    help: "Font family or comma-separated stack. Empty = inherit.",
    placeholder: "Segoe UI, system-ui, sans-serif",
  },
];

// ---- per-card specs ----------------------------------------------------------

const DOC_NOTE_RCA =
  "The problem, causes and votes live in the card's document (inputJSON), edited in the card itself.";

export const CARDS: CardSpec[] = [
  {
    type: "FiveWhys",
    label: "Five whys",
    description: "Linear why-chains from a problem statement, root causes flagged.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote: DOC_NOTE_RCA,
  },
  {
    type: "Fishbone",
    label: "Fishbone",
    description: "Cause-and-effect diagram — causes on category bones.",
    config: [
      {
        key: "categories",
        label: "Cause categories",
        kind: "csvChips",
        help:
          "The bone labels for a NEW fishbone (a diagram that already has bones keeps its own). Empty = the classic 6M set.",
        placeholder: "Measurements, Materials, People, Environment, Methods, Machines",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    configNote: DOC_NOTE_RCA,
  },
  {
    type: "FaultTree",
    label: "Fault tree",
    description: "Top-down gated cause tree (AND/OR) under one top event.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote: DOC_NOTE_RCA,
  },
  {
    type: "ActionBoard",
    label: "Action board",
    description: "Every action in one place — list, kanban or gantt.",
    config: [
      {
        key: "view",
        label: "View",
        kind: "enum",
        options: [
          { value: "list", label: "List" },
          { value: "kanban", label: "Kanban" },
          { value: "gantt", label: "Gantt" },
        ],
        help: "How the board lays the actions out.",
      },
      {
        key: "kanbanGroupBy",
        label: "Kanban columns",
        kind: "enum",
        options: [
          { value: "status", label: "By status" },
          { value: "issue", label: "By issue" },
        ],
        help: "What the kanban columns represent (kanban view only).",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "StatusTile",
    label: "Status tile",
    description: "One big tap-to-cycle state with a reason — a tier roll-up tile.",
    config: [
      {
        key: "states",
        label: "States",
        kind: "csvChips",
        help:
          "The states, in cycle order. Colours come from the theme legend colours.",
        placeholder: "On track, At risk, Off track",
      },
    ],
    appBound: ["instanceId"],
  },
  {
    type: "ParetoCard",
    label: "Pareto",
    description: "Descending count bars with the cumulative % line.",
    config: [],
    appBound: ["instanceId"],
    configNote:
      "The categories and counts live in the card's document, edited in the card itself.",
  },
  {
    type: "KpiTrendCard",
    label: "KPI trend",
    description: "Run chart with target and spec limits (USL/LSL).",
    config: [],
    appBound: ["instanceId"],
    configNote:
      "Target, unit and spec limits live in the card's document — set them in the card's kebab dialog.",
  },
  {
    type: "BenefitEffort",
    label: "Benefit – effort",
    description: "2×2 prioritisation canvas — quick wins to thankless.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote:
      "The ideas themselves live in the card's document. Quadrant labels can be renamed via prompts field hints (quadTL/quadTR/quadBL/quadBR).",
  },
  {
    type: "RiskMatrix",
    label: "Risk matrix",
    description: "5×5 likelihood × consequence register, inherent → residual.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote: "The risks live in the card's document, edited in the card itself.",
  },
  {
    type: "SqdpcCard",
    label: "SQDPC board",
    description: "Letter-shaped month calendars rated per day (S, Q, D, P, C…).",
    config: [
      {
        key: "granularity",
        label: "Granularity",
        kind: "enum",
        options: [
          { value: "day", label: "Every day" },
          { value: "weekday", label: "Weekdays only" },
          { value: "shift2", label: "Two shifts (day ◤ / night ◢)" },
        ],
      },
      {
        key: "dimensions",
        label: "Dimensions",
        kind: "csvChips",
        help: "One letter per panel; letters with a template draw as that letter.",
        placeholder: "S, Q, D, P, C",
      },
      {
        key: "subtitles",
        label: "Subtitles",
        kind: "kvList",
        help: "A caption under each dimension letter, keyed by the letter.",
        placeholder: "S → Safety",
      },
      {
        key: "statusCodes",
        label: "Status codes",
        kind: "objectList",
        help: "Up to four tap-cycle states, each with a colour and glyph.",
        fields: [
          { key: "code", label: "Code", kind: "text", placeholder: "good" },
          { key: "label", label: "Label", kind: "text", placeholder: "Good" },
          { key: "color", label: "Colour", kind: "color" },
          { key: "icon", label: "Icon", kind: "text", placeholder: "✓" },
        ],
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "ConditionsCard",
    label: "Winning conditions",
    description: "Conditions rated good/issue over a rolling window ending today.",
    config: [
      {
        key: "granularity",
        label: "Granularity",
        kind: "enum",
        options: [
          { value: "day", label: "Every day" },
          { value: "weekday", label: "Weekdays only" },
          { value: "week", label: "Weekly" },
          { value: "shift", label: "Two shifts (diagonal split)" },
        ],
      },
      {
        key: "conditions",
        label: "Conditions",
        kind: "objectList",
        help: "The rows: each condition with an optional prompt shown beneath.",
        fields: [
          {
            key: "name",
            label: "Condition",
            kind: "text",
            placeholder: "5S standard maintained",
          },
          {
            key: "prompt",
            label: "Prompt",
            kind: "text",
            placeholder: "Work areas clean, tools shadow-boarded",
          },
        ],
      },
      {
        key: "asOfDate",
        label: "As-of date",
        kind: "date",
        help: "Anchor the window to a past date for review. Empty = today.",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "CaptureCard",
    label: "Capture card",
    description: "Typed capture grid — text/number/yes-no/list columns, free or fixed rows.",
    config: [
      {
        key: "columnsJSON",
        label: "Columns",
        kind: "captureColumns",
        help:
          "The grid's typed columns. Picklist options can carry an icon (an emoji, or an image URL / data URI); a picklist can depend on another picklist so its options filter by the parent's selection.",
      },
      {
        key: "rowsJSON",
        label: "Rows",
        kind: "text",
        help:
          "Empty = free rows (add/delete). A number (e.g. 5) = that many fixed untitled rows. A JSON array of labels or {key,label} = fixed titled rows.",
        placeholder: '5   or   ["Line 1","Line 2"]',
      },
    ],
    appBound: [],
  },
  {
    type: "HeatmapCard",
    label: "Heatmap",
    description: "Issues pinned onto an image (floor plan, machine photo…).",
    config: [
      {
        key: "image",
        label: "Image",
        kind: "text",
        help: "The background image: a URL or data URI.",
        placeholder: "https://… or data:image/png;base64,…",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "ProcessMap",
    label: "Process map",
    description: "Flowchart, swimlane, SIPOC or value stream map (set by type).",
    config: [
      {
        key: "mapType",
        label: "Map type",
        kind: "enum",
        options: [
          { value: "simple", label: "Simple process map" },
          { value: "swimlane", label: "Swimlane map" },
          { value: "sipoc", label: "SIPOC" },
          { value: "vsm", label: "Value stream map" },
        ],
        help: "A maker setting — there is no in-card selector.",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "Raci",
    label: "RACI",
    description: "Deliverables × roles responsibility matrix.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote:
      "Roles and deliverables live in the card's document, editable in-card.",
  },
  {
    type: "SkillsMatrix",
    label: "Skills matrix",
    description: "Skills (rows, by category) × people (columns), quadrant discs.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    configNote:
      "Categories, skills and targets live in the card's document, editable in-card.",
  },
  {
    type: "MeetingScheduler",
    label: "Meeting scheduler",
    description: "Selectable meeting instances generated from a cadence.",
    config: [
      {
        key: "category",
        label: "Cadence",
        kind: "enum",
        options: [
          { value: "annually", label: "Annually" },
          { value: "quarterly", label: "Quarterly" },
          { value: "monthly", label: "Monthly" },
          { value: "fortnightly", label: "Fortnightly" },
          { value: "weekly", label: "Weekly" },
          { value: "daily", label: "Daily" },
          { value: "shiftly", label: "Shiftly (day + night)" },
        ],
      },
      {
        key: "daysOfWeek",
        label: "Days of week",
        kind: "csvChips",
        help: "Which weekdays the meeting occurs. Empty = every day.",
        placeholder: "Mon, Tue, Wed, Thu, Fri",
      },
      {
        key: "timeOfDay",
        label: "Time",
        kind: "time",
        help: "24h HH:MM. For shiftly, the night meeting is 12 hours later.",
      },
      {
        key: "daysPrior",
        label: "Days prior",
        kind: "number",
        help: "Window size: how many days before the final date to include.",
        placeholder: "14",
      },
      {
        key: "finalDate",
        label: "Final date",
        kind: "date",
        help: "Latest instance date. Usually bound by the app; empty = today.",
      },
      {
        key: "crewList",
        label: "Crews",
        kind: "csvChips",
        help: "Crew names in roster order (rostered cadences only).",
        placeholder: "A, B, C, D",
      },
      {
        key: "rosterPattern",
        label: "Roster pattern",
        kind: "text",
        help:
          "Blocks of Days / Nights / Off, cycled, e.g. 2D-2N-5O-2D-3N-4O. Empty = no roster.",
        placeholder: "2D-2N-5O",
      },
      {
        key: "baseStartDate",
        label: "Base start date",
        kind: "date",
        help:
          "Recurrence anchor: the first crew's first day shift (rosters), or the relative-weekday anchor (monthly+).",
      },
      {
        key: "columns",
        label: "Row columns",
        kind: "csvChips",
        help: "Custom text fields entered per meeting row.",
        placeholder: "Topic, Chair, Notetaker",
      },
    ],
    appBound: ["existingMeetingsJSON"],
  },
  {
    type: "EscalationViewer",
    label: "Escalation viewer",
    description: "Actions escalated to this board, grouped by their source card.",
    config: [
      {
        key: "sourcesJSON",
        label: "Source boards",
        kind: "objectList",
        help:
          "Friendly names for the source cards, matched by the actions' instance ids.",
        fields: [
          {
            key: "instanceId",
            label: "Instance id",
            kind: "text",
            placeholder: "b-bottling",
          },
          {
            key: "label",
            label: "Label",
            kind: "text",
            placeholder: "Bottling line board",
          },
        ],
      },
    ],
    appBound: ["peopleJSON", "viewerName", "viewerId"],
  },
];

export function cardSpec(type: string): CardSpec | undefined {
  return CARDS.find((c) => c.type === type);
}
