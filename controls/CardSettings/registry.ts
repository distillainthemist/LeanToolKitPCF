// CardSettings registry — the single source of truth for what a settingsJSON
// blob can contain, per card. Each entry mirrors the keys that card's index.ts
// actually reads via cfg(s, "key"); the convention is: add a cfg() key to a
// control → add its FieldSpec here.
//
// Keys deliberately NOT offered for editing (app-bound at runtime, not
// design-time settings): instanceId (card identity), peopleJSON (live people
// list), existingMeetingsJSON (live meeting records), viewerName/viewerId
// (User() of the person looking). They are recorded in `appBound` for
// maintainers — the properties pane does not show them, since a maker cannot
// act on them.

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
  | "titleColor" // a select over the app TITLE-STRIP palette (stores the KEY)
  | "colorList" // list of colours, emitted as CSV text
  | "objectList" // array of flat objects, edited as a small table (`fields`)
  | "kvList" // key→value map, edited as pairs, emitted as an object
  | "captureColumns" // CaptureCard's typed columns (dedicated builder)
  | "canvasFields" // CanvasCard's layout (dedicated builder)
  | "json"; // raw JSON fallback (validated before emit)

export interface ObjectField {
  key: string;
  label: string;
  /** paletteColor = a select over the site state palette (stores the KEY). */
  kind: "text" | "color" | "paletteColor";
  placeholder?: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** Heading above the control. Booleans need it — their label sits INSIDE
   *  the checkbox, so without this they render under a blank heading. */
  heading?: string;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[]; // enum
  fields?: ObjectField[]; // objectList columns
}

/** A new-instance data policy a card can offer ("link" retired — LinkCard). */
export type DataPolicy = "clear" | "carry" | "shared";

export interface CardSpec {
  /** Canonical id stamped into the blob as `cardType` — the control name. */
  type: string;
  label: string;
  /** Picker group ("Rituals", "Performance", …). */
  group: string;
  /** Never offered in the picker (still resolvable for existing data). */
  hidden?: boolean;
  description: string;
  /** Card-specific config keys (settings config:{...}). May be empty. */
  config: FieldSpec[];
  /** Runtime-bound config keys the app supplies live (not edited here). */
  appBound: string[];
  /**
   * Data policies this card offers in the composer's "New meeting instance"
   * section. Absent for action surfaces (source picker instead), for
   * series-backed cards (no choice — see `seriesBacked`), and for hidden
   * cards that never sit on a board.
   */
  policies?: DataPolicy[];
  /** Stamped into board.policy when a NEW slot of this type is created. */
  defaultPolicy?: DataPolicy;
  /**
   * Data lives in the Card Series table (keyed board+card, windowed by the
   * meeting's date) — every meeting shows its window of the same data, so
   * the card behaves as SHARED regardless of any stored policy: the live
   * row is its document and each close archives the tile image.
   */
  seriesBacked?: boolean;
  /**
   * The card's policy is FIXED — no maker choice, no picker. Unlike
   * seriesBacked (whose data lives in the series table) the card may still
   * own a document; CaptureRollup fixes "shared" so its live row carries
   * the freshest tile and close-meeting archives stamp it.
   */
  fixedPolicy?: DataPolicy;
  /**
   * The card has an ON-CANVAS design mode: in the studio (board mode) it
   * is mounted as THE layout editor (`CardMount.designLayout`) and pushes
   * its own config changes back through `onConfigPatch`; the settings
   * pane becomes the selected field's property panel. Canvas card only.
   */
  designable?: boolean;
  /**
   * What the card studio's left pane is for this card (default "edit"):
   *
   *  - `"edit"` — the card's live row IS its standard content, so the pane
   *    is the real editor and what you leave there is what a new meeting
   *    starts from;
   *  - `"preview"` — the card has no standard content to author (its data
   *    is a dated series, the live actions table, or another board's card),
   *    so the pane renders read-only and says why. This also keeps Cancel
   *    honest: a read-only pane cannot trigger the direct series writes
   *    that would escape the studio's buffer.
   */
  standardContent?: "edit" | "preview";
  /** Why the studio's left pane is read-only (shown with the preview). */
  standardContentNote?: string;
}

/** Picker group display order. */
export const CARD_GROUPS = [
  "Rituals",
  "Action management",
  "Performance",
  "Problem solving",
  "Project management",
  "Reference",
];

/**
 * Card types a LinkCard may NOT use as its source: itself (no chains),
 * EmbedCard (frames have their own lifecycle — use an Embed card with the
 * same URL), the action surfaces (they already have source pickers) and the
 * scheduler (never on a board). Shared between the editor's source picker
 * and the app's runtime guard.
 */
export const LINK_SOURCE_EXCLUDED = new Set([
  "LinkCard",
  "EmbedCard",
  "ActionBoard",
  "EscalationViewer",
  "MeetingScheduler",
  // live SharePoint views — linking a live view of a live view is noise
  "DocsCard",
  "DocHealth",
  // windows onto other boards' cards — no chains, same as LinkCard
  "CaptureRollup",
  "CanvasRollup",
]);

/** Display label for a card type ("ActionBoard" → "Actions"). */
export function cardLabel(type: string): string {
  return cardSpec(type)?.label ?? type;
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
    heading: "Display mode",
    kind: "boolean",
    // the heading already says "Display mode"; the help explains the effect
    help: "Nobody can change this card during a meeting — it shows its content and nothing else.",
  },
];

/**
 * The Appearance section: the ONE per-card cosmetic. The PCF-era fields
 * (background / foreground / accent / legend / font) were never applied by
 * the code app and are no longer offered — colours come from the app accent
 * and, from the state palette onwards, per-state selections in Configuration.
 * Old blobs that stored those keys keep them verbatim (lossless parse).
 */
export const THEME_FIELDS: FieldSpec[] = [
  {
    key: "titlebar",
    label: "Title strip",
    kind: "titleColor",
    help:
      "Fill for just the title bar, from the title-strip palette (Settings → Branding) — use one colour across related cards to associate them on a board. Default = no strip.",
  },
];

// ---- per-card specs ----------------------------------------------------------

export const CARDS: CardSpec[] = [
  {
    type: "FiveWhys",
    label: "Five whys",
    group: "Problem solving",
    description: "Linear why-chains from a problem statement, root causes flagged.",
    config: [
      {
        key: "showStatus",
        label: "Show cause status",
        kind: "boolean",
        help: "Show each cause's open/closed status on the chain.",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "Fishbone",
    label: "Fishbone",
    group: "Problem solving",
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
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "FaultTree",
    label: "Fault tree",
    group: "Problem solving",
    description: "Top-down gated cause tree (AND/OR) under one top event.",
    config: [
      {
        key: "showStatus",
        label: "Show cause status",
        kind: "boolean",
        help: "Show each cause's open/closed status on the tree.",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "ActionBoard",
    standardContent: "preview",
    standardContentNote:
      "This card renders the live actions table — there is no standard content to author.",
    label: "Actions",
    group: "Action management",
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
        label: "Kanban grouping",
        kind: "enum",
        options: [
          { value: "status", label: "By status" },
          { value: "issue", label: "By issue" },
        ],
        help: "What each kanban column represents (Kanban view only).",
      },
      {
        key: "kanbanColumns",
        label: "Fixed columns",
        kind: "csvChips",
        help:
          "Name the columns yourself, in the order you want them. They always show, even when empty, and dragging a card into one files it under that name. Empty = build the columns from whatever the actions are already tagged with. Grouped by issue only.",
        placeholder: "Safety, Quality, Delivery",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
  },
  {
    type: "StatusTile",
    label: "Status tile",
    group: "Performance",
    description: "One big tap-to-cycle state with a reason — a tier roll-up tile.",
    config: [
      {
        key: "states",
        label: "States",
        kind: "objectList",
        help:
          "The states, in cycle order, each colouring from the app's state palette (Settings → Branding). Colour Default = the toolkit green/amber/red by position. Empty = On track / At risk / Off track.",
        fields: [
          { key: "label", label: "State", kind: "text", placeholder: "On track" },
          { key: "palette", label: "Colour", kind: "paletteColor" },
        ],
      },
    ],
    appBound: ["instanceId"],
    // clear is not offered: an empty document resets to the FIRST state,
    // which reads as a false "all good" every meeting
    policies: ["carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "ParetoCard",
    standardContent: "preview",
    standardContentNote:
      "This card's data is a dated series — every meeting shows its own window of it. There is nothing to pre-fill; configure the card on the right.",
    label: "Pareto",
    group: "Performance",
    description: "Descending count bars with the cumulative % line.",
    config: [
      {
        key: "paretoWindowDays",
        label: "Window (days)",
        kind: "text",
        help:
          "The bars sum each category's daily counts over this many trailing days, ending on the meeting's date. Default 30. ＋1 tallies land on the meeting's day; older days stay stored and reportable.",
        placeholder: "30",
      },
      {
        key: "unit",
        label: "Unit",
        kind: "text",
        help: "What the counts are — shown in bar tooltips and the edit dialog.",
        placeholder: "e.g. defects, stops",
      },
    ],
    appBound: ["instanceId"],
    seriesBacked: true,
  },
  {
    type: "KpiTrendCard",
    standardContent: "preview",
    standardContentNote:
      "This card's data is a dated series — every meeting shows its own window of it. There is nothing to pre-fill; configure the card on the right.",
    label: "KPI trend",
    group: "Performance",
    description: "Run chart with target and spec limits (USL/LSL).",
    config: [
      {
        key: "target",
        label: "Target",
        kind: "number",
        help: "The goal line drawn across the chart. Empty = no target line.",
      },
      {
        key: "unit",
        label: "Unit",
        kind: "text",
        help: "Shown after the latest value and the target.",
        placeholder: "e.g. %, units/hr",
      },
      {
        key: "usl",
        label: "Upper spec limit",
        kind: "number",
        help: "A reading above this is flagged out of spec (red). Empty = none.",
      },
      {
        key: "lsl",
        label: "Lower spec limit",
        kind: "number",
        help: "A reading below this is flagged out of spec (red). Empty = none.",
      },
      {
        key: "kpiWindowDays",
        label: "Window (days)",
        kind: "text",
        help:
          "How many trailing days of readings the chart shows, ending on the meeting's date. Default 91 (13 weeks). Older readings stay stored and reportable.",
        placeholder: "91",
      },
    ],
    appBound: ["instanceId"],
    seriesBacked: true,
  },
  {
    type: "BenefitEffort",
    label: "Benefit – effort",
    group: "Problem solving",
    description: "2×2 prioritisation canvas — quick wins to thankless.",
    config: [
      {
        key: "quadTL",
        label: "Top-left quadrant",
        kind: "text",
        help: "High benefit, low effort.",
        placeholder: "Quick wins",
      },
      {
        key: "quadTR",
        label: "Top-right quadrant",
        kind: "text",
        help: "High benefit, high effort.",
        placeholder: "Major projects",
      },
      {
        key: "quadBL",
        label: "Bottom-left quadrant",
        kind: "text",
        help: "Low benefit, low effort.",
        placeholder: "Fill-ins",
      },
      {
        key: "quadBR",
        label: "Bottom-right quadrant",
        kind: "text",
        help: "Low benefit, high effort.",
        placeholder: "Thankless",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "RiskMatrix",
    label: "Risk management",
    group: "Project management",
    description: "5×5 likelihood × consequence register, inherent → residual.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    // a register: there is ONE truth. clear would silently empty it each meeting
    policies: ["carry", "shared"],
    defaultPolicy: "shared",
  },
  {
    type: "SqdpcCard",
    standardContent: "preview",
    standardContentNote:
      "This card's data is a dated series — every meeting shows its own window of it. There is nothing to pre-fill; configure the card on the right.",
    label: "SQDPC",
    group: "Performance",
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
        help:
          "Up to four tap-cycle states, each with a state-palette colour and glyph (older cards with fixed hex colours keep them).",
        fields: [
          { key: "code", label: "Code", kind: "text", placeholder: "good" },
          { key: "label", label: "Label", kind: "text", placeholder: "Good" },
          { key: "color", label: "Colour", kind: "paletteColor" },
          { key: "icon", label: "Icon", kind: "text", placeholder: "✓" },
        ],
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    seriesBacked: true,
  },
  {
    type: "ConditionsCard",
    standardContent: "preview",
    standardContentNote:
      "This card's data is a dated series — every meeting shows its own window of it. There is nothing to pre-fill; configure the card on the right.",
    label: "Winning conditions",
    group: "Performance",
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
        help:
          "Pin the window to end on a fixed date — overrides the meeting-date window (for pinned reviews). Empty = the meeting's own date, so each meeting shows its own period.",
      },
    ],
    appBound: ["instanceId", "peopleJSON"],
    seriesBacked: true,
  },
  {
    type: "AgendaCard",
    label: "Agenda",
    group: "Rituals",
    description:
      "Runs a traditional meeting: checkable pre-work, the agenda running order (who, timing, links, actions per item) and a checkable outputs list.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    // the ritual: each meeting starts from the standard agenda; carrying a
    // ticked pre-work list defeats it
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "clear",
  },
  {
    type: "EmbedCard",
    label: "Embed",
    group: "Performance",
    description:
      "An embedded page — a Power BI report or any https embed link — with a refresh button. Never reloads on resize.",
    config: [
      {
        key: "embedUrl",
        label: "Embed URL",
        kind: "text",
        help:
          "Best: open the item's File > Share > Embed and paste the whole <iframe> code — the url is lifted out for you " +
          "(works for Power BI, Excel/Word/PowerPoint on SharePoint/OneDrive, and Power Apps). A plain https url works too. " +
          "\"This content is blocked\" means the domain isn't in the environment's code-app CSP frame-src — an admin adds it " +
          "(e.g. https://app.powerbi.com, https://*.sharepoint.com). Sites that forbid framing can't embed; use Open in new tab.",
        placeholder: "Paste an <iframe> embed code, or https://app.powerbi.com/reportEmbed?...",
      },
      {
        key: "hideFilterPane",
        label: "Hide filter pane",
        kind: "boolean",
        help: "Power BI links only: hides the report filter pane.",
      },
      {
        key: "hidePageNav",
        label: "Hide page navigation",
        kind: "boolean",
        help: "Power BI links only: hides the page-navigation pane.",
      },
      {
        key: "presentInWindow",
        label: "Present in a window",
        kind: "boolean",
        heading: "Display",
        help:
          "The card shows a Present button instead of embedding; the page opens in its own window, outside the app. Use where the embedded sign-in is blocked (Power BI on Windows with browser work-account SSO — see the deployment cookbook). Any embed card also has a ⧉ chip to present on demand.",
      },
      {
        key: "pageName",
        label: "Page name",
        kind: "text",
        help:
          "Power BI links only: open on this page (the ReportSection id from the page url).",
        placeholder: "ReportSection1a2b3c",
      },
      {
        key: "deferLoad",
        label: "Load only when opened",
        kind: "boolean",
        help:
          "By default the board loads this embed with the tile, so opening " +
          "it is instant. Tick this for a heavy or sign-in-protected report " +
          "you do not want loading on every board open.",
      },
      {
        key: "commentaryHeadings",
        label: "Commentary headings",
        kind: "multiline",
        help:
          "One heading per line. When set, a commentary pane appears beside the embed with a rich-text note under each heading, plus the card's actions. Leave empty for no pane (actions then live on an Actions chip).",
        placeholder: "Observations\nDecisions",
      },
    ],
    appBound: [],
    // the document is only the commentary; fresh notes each meeting
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "clear",
  },
  {
    type: "CaptureCard",
    label: "Capture card",
    group: "Rituals",
    description: "Typed capture grid — text/number/yes-no/list columns, free or fixed rows.",
    config: [
      {
        key: "columnsJSON",
        label: "Columns",
        kind: "captureColumns",
        help:
          "The grid's typed columns. Picklist options can carry an icon (an emoji, or an image URL / data URI); a picklist can depend on another picklist so its options filter by the parent's selection. A Flag column (⚑) marks rows for a Capture rollup card on another board.",
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
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "CaptureRollup",
    label: "Capture rollup",
    group: "Rituals",
    standardContent: "preview",
    standardContentNote:
      "This card merges rows from other boards' capture cards — its content belongs to the sources.",
    description:
      "Rows from Capture cards on other boards, merged into one table — filter to flagged items, act on them at this ritual.",
    config: [
      {
        key: "flaggedOnly",
        label: "Only show flagged items",
        kind: "boolean",
        heading: "Filter",
        help:
          "Show only rows marked with a ⚑ Flag column. A linked card without a Flag column then contributes nothing.",
      },
      {
        key: "window",
        label: "Occurrences",
        kind: "enum",
        options: [
          { value: "current", label: "Current content" },
          { value: "lastN", label: "Last N occurrences" },
        ],
        help:
          "Current content shows what each source card holds now. Last N merges the most recent N meetings' rows (newest wins on carried rows) — for sources that clear between meetings.",
      },
      {
        key: "windowN",
        label: "N (occurrences)",
        kind: "number",
        help: "How many recent occurrences Last N sweeps per source (1–50; 3 when blank).",
        placeholder: "3",
      },
      {
        key: "writeMode",
        label: "Editing from this card",
        kind: "enum",
        options: [
          { value: "readonly", label: "Read-only" },
          { value: "unflag", label: "Remove flags only" },
          { value: "full", label: "Full editing" },
        ],
        help:
          "What a row's dialog allows. Changes save straight onto the source board's card.",
      },
    ],
    appBound: [],
    // no policy choice: fixed shared — the live row exists for tiles and
    // close-meeting archives, never as authored content
    policies: [],
    fixedPolicy: "shared",
  },
  {
    type: "CanvasCard",
    label: "Canvas",
    group: "Project management",
    description:
      "A charter / plan-on-a-page: typed, titled fields laid out in a 1–3 column grid — filled in on the card.",
    config: [
      {
        key: "canvasJSON",
        label: "Layout",
        kind: "canvasFields",
        help:
          "The canvas's fields: drag to reorder; each has a type, a title, a width in columns and a height in steps. Field ids key the saved values — restructuring the layout never loses content.",
      },
    ],
    appBound: [],
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
    standardContent: "edit",
    designable: true,
  },
  {
    type: "CanvasRollup",
    label: "Canvas rollup",
    group: "Project management",
    standardContent: "preview",
    standardContentNote:
      "This card merges other boards' canvas cards into a portfolio table — its content belongs to the sources.",
    description:
      "The portfolio view: one row per Canvas card on other boards, with the fields you choose as columns.",
    config: [
      {
        key: "writeMode",
        label: "Editing from this card",
        kind: "enum",
        options: [
          { value: "readonly", label: "Read-only" },
          { value: "full", label: "Full editing" },
        ],
        help:
          "Full editing opens each cell's own field editor; changes save straight onto the source board's canvas. Mini-table fields always edit on their source card.",
      },
    ],
    appBound: [],
    // no policy choice: fixed shared — the live row exists for tiles and
    // close-meeting archives, never as authored content
    policies: [],
    fixedPolicy: "shared",
  },
  {
    type: "HeatmapCard",
    label: "Heatmap",
    group: "Performance",
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
    policies: ["clear", "carry", "shared"],
    defaultPolicy: "carry",
  },
  {
    type: "ProcessMap",
    label: "Process map",
    group: "Problem solving",
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
    // a maintained artifact — an empty flowchart each meeting serves nobody
    policies: ["carry", "shared"],
    defaultPolicy: "shared",
  },
  {
    type: "Raci",
    label: "RACI",
    group: "Project management",
    description: "Deliverables × roles responsibility matrix.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    policies: ["carry", "shared"],
    defaultPolicy: "shared",
  },
  {
    type: "SkillsMatrix",
    label: "Skills matrix",
    group: "Project management",
    description: "Skills (rows, by category) × people (columns), quadrant discs.",
    config: [],
    appBound: ["instanceId", "peopleJSON"],
    policies: ["carry", "shared"],
    defaultPolicy: "shared",
  },
  {
    type: "MeetingScheduler",
    label: "Meeting scheduler",
    group: "Rituals",
    hidden: true,
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
    appBound: ["existingMeetingsJSON", "peopleJSON"],
  },
  {
    type: "LinkCard",
    standardContent: "preview",
    standardContentNote:
      "This card shows another board's card — its content belongs to the source.",
    label: "Linked card",
    group: "Reference",
    description:
      "Shows a card from another board, read-only — a live window that makes linkages between meetings traceable.",
    config: [
      {
        key: "hideCaption",
        label: "Hide source caption",
        kind: "boolean",
        help:
          'By default a small "from board · card" caption shows under the title bar so viewers can trace the source.',
      },
    ],
    appBound: [],
    // no policy choice: the card has no document of its own (policies: []
    // renders an explanatory note instead of the picker)
    policies: [],
  },
  {
    // Standard Documents on the board (docs plan Phase 3) — documents
    // INSIDE the ritual, the part only LeanBoard can do (FR-DI-004).
    type: "DocsCard",
    standardContent: "preview",
    standardContentNote:
      "This card lists live controlled documents from the Documents area — there is no standard content to author.",
    label: "Standard documents",
    group: "Reference",
    description:
      "The area's controlled documents, live from SharePoint — the team's standards on the board they run from.",
    config: [
      {
        // doc-cards plan A: the register's Copy link carries the WHOLE
        // view state (library, organisation and taxonomy filters by
        // term id, search, date windows, columns) — pasting it here is
        // the card's filter UI, and the one source of filter truth.
        key: "docsView",
        label: "View (paste a Documents link)",
        kind: "text",
        help:
          "In Documents, set the library and filters you want, then ⋮ → Copy link and paste it here — the card shows exactly what the register showed, and keeps working through renames. Blank keeps this card's older text settings working as before.",
        placeholder: "https://apps.powerapps.com/play/…?docview=…",
      },
      {
        key: "docsLibrary",
        label: "Libraries",
        kind: "text",
        help:
          "Display names, comma-separated; blank shows every exposed library. Narrows the pasted view when both are set.",
        placeholder: "Standards, HSEC",
      },
      {
        key: "docsCount",
        label: "Rows",
        kind: "number",
        help: "How many documents to show (default 8).",
        placeholder: "8",
      },
    ],
    appBound: [],
    // no policy choice: the card holds no document of its own
    policies: [],
  },
  {
    // The reminder surface of the flow-free design: overdue and due-soon
    // reviews, derived at read time — never stored (docs plan Phase 3).
    type: "DocHealth",
    standardContent: "preview",
    standardContentNote:
      "This card derives document health live from SharePoint — there is no standard content to author.",
    label: "Document health",
    group: "Reference",
    description:
      "Overdue and due-soon document reviews for this area, derived live — the daily meeting is the reminder.",
    config: [
      {
        key: "docsView",
        label: "View (paste a Documents link)",
        kind: "text",
        help:
          "In Documents, set the library and filters you want, then ⋮ → Copy link and paste it here — health is judged inside that scope. Blank keeps this card's older text settings working as before.",
        placeholder: "https://apps.powerapps.com/play/…?docview=…",
      },
      {
        key: "docsLibrary",
        label: "Libraries",
        kind: "text",
        help:
          "Display names, comma-separated; blank checks every exposed library. Narrows the pasted view when both are set.",
        placeholder: "Standards, HSEC",
      },
      {
        key: "dueSoonDays",
        label: "Due-soon window (days)",
        kind: "number",
        help: "Reviews inside this window count as due soon (default 30).",
        placeholder: "30",
      },
    ],
    appBound: [],
    policies: [],
  },
  {
    type: "EscalationViewer",
    standardContent: "preview",
    standardContentNote:
      "This card renders the live actions table — there is no standard content to author.",
    label: "Escalation viewer",
    group: "Action management",
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
            placeholder: "b-packing",
          },
          {
            key: "label",
            label: "Label",
            kind: "text",
            placeholder: "Packing line board",
          },
        ],
      },
    ],
    appBound: ["peopleJSON", "viewerName", "viewerId"],
  },
];

// Every action-capable card (all but ActionBoard and EscalationViewer, which
// ARE the action surfaces) gains a shared "disable actions" toggle — appended
// last in its Configuration section.
const DISABLE_ACTIONS_FIELD: FieldSpec = {
  key: "disableActions",
  label: "Disable actions",
  kind: "boolean",
  help:
    "Hide the add / raise-action controls so no new actions can be captured on this card. Existing actions stay visible and can still be completed, commented and edited.",
};

const ACTION_CAPABLE = new Set([
  "FiveWhys",
  "Fishbone",
  "FaultTree",
  "SqdpcCard",
  "ConditionsCard",
  "BenefitEffort",
  "RiskMatrix",
  "Raci",
  "SkillsMatrix",
  "ProcessMap",
  "HeatmapCard",
  "AgendaCard",
  "KpiTrendCard",
  "ParetoCard",
  "EmbedCard",
]);
for (const card of CARDS) {
  if (ACTION_CAPABLE.has(card.type)) card.config.push(DISABLE_ACTIONS_FIELD);
}

export function cardSpec(type: string): CardSpec | undefined {
  return CARDS.find((c) => c.type === type);
}

/**
 * The board.policy value a slot should hold after the maker picks (or
 * changes to) `type`: a still-offered current policy is kept; otherwise the
 * type's default is stamped ("" for cards with no policy choice — action
 * surfaces, series-backed cards). Stamping the default explicitly means a
 * per-type default only ever applies to slots created after it existed —
 * existing slots with an unset policy keep the runtime default (carry).
 */
export function policyOnPick(type: string, current: string): string {
  const spec = cardSpec(type);
  if (!spec) return current;
  const offered = spec.policies ?? [];
  if (offered.includes(current as DataPolicy)) return current;
  return spec.defaultPolicy ?? "";
}

/**
 * The registry as JSON — the catalogJSON output. Seeds the board app's card
 * palette and the LTK Card Catalog table, so neither can drift from the
 * installed solution version.
 */
export function buildCatalogJson(): string {
  return JSON.stringify(
    CARDS.map((c) => ({
      type: c.type,
      label: c.label,
      description: c.description,
      actionCapable: ACTION_CAPABLE.has(c.type),
    }))
  );
}
