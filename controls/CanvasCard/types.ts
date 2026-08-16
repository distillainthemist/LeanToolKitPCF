// CanvasCard — the pure model for the charter/plan-on-a-page card
// (docs/leanboard-canvas-card-plan.md). LAYOUT IS DESIGN, VALUES ARE
// CONTENT: the grid (columns count + typed fields) lives in the slot's
// settings config (canvasJSON); the filled-in values live in the document
// envelope keyed by field id, so restructuring a layout never loses
// content and a deleted field's value is orphaned harmlessly (kept in the
// doc, not rendered). Values are validated by SHAPE, not by field type —
// the coercers (vString, vPeople, …) are the per-type boundary the editor
// and the rollup read through.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";
import {
  CaptureColumn,
  CaptureRow,
  ListOption,
  parseColumns as parseCaptureColumns,
  parseListOptions,
  parseRowList,
} from "../CaptureCard/types";

export const SCHEMA_ID = "ltk/canvas@1";

// ---- field model -----------------------------------------------------------

export const CANVAS_TYPES = [
  "heading",
  "text",
  "longtext",
  "richtext",
  "number",
  "decimal",
  "date",
  "daterange",
  "choice",
  "multichoice",
  "yesno",
  "person",
  "people",
  "status",
  "percent",
  "url",
  "checklist",
  "rating",
  "minitable",
  "image",
] as const;

export type CanvasFieldType = (typeof CANVAS_TYPES)[number];

export interface CanvasField {
  /** Stable key for values — never regenerate for an existing field. */
  id: string;
  type: CanvasFieldType;
  label: string;
  /** Column span, 1..cols. */
  w: number;
  /** Height in grid steps (~60px), 1..8; headings auto-height. */
  h: number;
  /** Placeholder/prompt shown while the field is empty. */
  hint: string;
  /** Marker, not a gate — see missingRequired. Never on headings. */
  required: boolean;
  /** choice / multichoice options (the capture option shape). */
  options: ListOption[];
  /** minitable only: the embedded grid's capture columns. */
  columns: CaptureColumn[];
}

export interface CanvasConfig {
  cols: 1 | 2 | 3;
  fields: CanvasField[];
}

/** Human labels per type (the builder's type select, the design-mode
 *  skeletons' captions). */
export const CANVAS_TYPE_LABEL: Record<CanvasFieldType, string> = {
  heading: "Heading",
  text: "Text",
  longtext: "Long text",
  richtext: "Rich text",
  number: "Whole number",
  decimal: "Decimal",
  date: "Date",
  daterange: "Date range",
  choice: "Choice",
  multichoice: "Multi choice",
  yesno: "Yes / no",
  person: "Person",
  people: "People",
  status: "Status",
  percent: "Percent",
  rating: "Rating",
  url: "Link",
  checklist: "Checklist",
  minitable: "Mini table",
  image: "Image",
};

/** Type glyphs worn by fields in design mode. */
export const CANVAS_TYPE_GLYPH: Record<CanvasFieldType, string> = {
  heading: "§",
  text: "¶",
  longtext: "¶",
  richtext: "¶",
  number: "#",
  decimal: "#",
  date: "▭",
  daterange: "▭",
  choice: "◉",
  multichoice: "☷",
  yesno: "☑",
  person: "◇",
  people: "◇",
  status: "●",
  percent: "%",
  rating: "★",
  url: "⤴",
  checklist: "☑",
  minitable: "▦",
  image: "▣",
};

/** Default height steps per type — one-liners 1, block types taller. */
export const DEFAULT_H: Record<CanvasFieldType, number> = {
  heading: 1,
  text: 1,
  number: 1,
  decimal: 1,
  date: 1,
  daterange: 1,
  percent: 1,
  rating: 1,
  url: 1,
  yesno: 1,
  choice: 1,
  status: 1,
  person: 1,
  multichoice: 2,
  people: 2,
  longtext: 3,
  richtext: 3,
  checklist: 3,
  minitable: 3,
  image: 3,
};

function slug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isType(t: unknown): t is CanvasFieldType {
  return typeof t === "string" && (CANVAS_TYPES as readonly string[]).includes(t);
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Parse the canvasJSON config. Defensive; field ids are kept when present
 * and otherwise DERIVED deterministically (label slug, then position) so
 * the same config always yields the same ids — an id that changed between
 * parses would orphan every value under it.
 */
export function parseCanvasConfig(raw: string | null | undefined): CanvasConfig {
  const empty: CanvasConfig = { cols: 2, fields: [] };
  const t = (raw ?? "").trim();
  if (t === "") return empty;
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;
  const d = data as { cols?: unknown; fields?: unknown };
  const cols = clampInt(d.cols, 1, 3, 2) as 1 | 2 | 3;
  const fields: CanvasField[] = [];
  const seen = new Set<string>();
  if (Array.isArray(d.fields)) {
    d.fields.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const o = item as Record<string, unknown>;
      const type: CanvasFieldType = isType(o.type) ? o.type : "text";
      const label = typeof o.label === "string" ? o.label : "";
      let id = typeof o.id === "string" ? o.id.trim() : "";
      if (id === "") id = slug(label) || `field_${i + 1}`;
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      fields.push({
        id,
        type,
        label,
        w: clampInt(o.w, 1, cols, 1),
        h: clampInt(o.h, 1, 8, DEFAULT_H[type]),
        hint: typeof o.hint === "string" ? o.hint : "",
        // a heading is display-only — required would be unanswerable
        required: type !== "heading" && o.required === true,
        options: parseListOptions(o.options),
        columns:
          type === "minitable"
            ? parseCaptureColumns(
                Array.isArray(o.columns) ? JSON.stringify(o.columns) : ""
              )
            : [],
      });
    });
  }
  return { cols, fields };
}

// ---- placement -------------------------------------------------------------

/** One field's cell rectangle on the grid (0-based rows/cols). */
export interface Placement {
  id: string;
  r: number;
  c: number;
  w: number;
  h: number;
}

export interface GridLayout {
  placements: Placement[];
  /** Total rows the layout occupies (0 when there are no fields). */
  rows: number;
  /** Cells no field covers, row-major — the design view's gutters. */
  empty: { r: number; c: number }[];
}

/**
 * Where each field lands: a pure simulation of CSS grid's SPARSE row
 * auto-placement (the cursor only moves forward; an item goes in the
 * first free rectangle at or after it, row-major). The card sets these
 * as EXPLICIT grid positions in both design and run modes, so the two
 * agree by construction and the design view can draw the empty cells —
 * and D2's drag/resize has real geometry to hit-test against.
 */
export function placeFields(cols: number, fields: CanvasField[]): GridLayout {
  const taken = new Set<string>();
  const key = (r: number, c: number) => `${r}:${c}`;
  const free = (r: number, c: number, w: number, h: number): boolean => {
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) if (taken.has(key(r + dr, c + dc))) return false;
    }
    return true;
  };
  const placements: Placement[] = [];
  let cur = { r: 0, c: 0 };
  let rows = 0;
  for (const f of fields) {
    const w = Math.max(1, Math.min(f.w, cols));
    const h = Math.max(1, f.h);
    let { r, c } = cur;
    for (;;) {
      if (c + w > cols) {
        r++;
        c = 0;
        continue;
      }
      if (free(r, c, w, h)) break;
      c++;
    }
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) taken.add(key(r + dr, c + dc));
    }
    placements.push({ id: f.id, r, c, w, h });
    rows = Math.max(rows, r + h);
    cur = { r, c: c + w };
  }
  const empty: { r: number; c: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (!taken.has(key(r, c))) empty.push({ r, c });
  }
  return { placements, rows, empty };
}

// ---- values ----------------------------------------------------------------

export interface PersonRef {
  id: string;
  name: string;
}

export interface CheckItem {
  text: string;
  done: boolean;
}

export interface DateRange {
  start: string; // yyyy-mm-dd or ""
  end: string;
}

export type CanvasValue =
  | string
  | number
  | boolean
  | string[]
  | PersonRef[]
  | CheckItem[]
  | CaptureRow[]
  | DateRange;

export interface CanvasData {
  values: Record<string, CanvasValue>;
}

export type CanvasEnvelope = Envelope<CanvasData>;

function isPersonRef(v: unknown): v is PersonRef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string" && !("cells" in o);
}

function isCheckItem(v: unknown): v is CheckItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.text === "string" && typeof o.done === "boolean";
}

function isCaptureRowLike(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.cells !== undefined && typeof o.cells === "object";
}

function isDateRange(v: unknown): v is DateRange {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.start === "string" && typeof o.end === "string";
}

/** A stored value survives when it matches one of the legal shapes. */
function parseValueShape(v: unknown): CanvasValue | undefined {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (isDateRange(v)) return { start: v.start, end: v.end };
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    if (v.every((x) => typeof x === "string")) return v as string[];
    if (v.every(isPersonRef)) return v.map((p) => ({ id: p.id, name: p.name }));
    if (v.every(isCheckItem)) return v.map((c) => ({ text: c.text, done: c.done }));
    if (v.every(isCaptureRowLike)) return parseRowList(v);
    return undefined;
  }
  return undefined;
}

function parseData(data: unknown): CanvasData {
  const out: CanvasData = { values: {} };
  if (!data || typeof data !== "object") return out;
  const d = data as { values?: unknown };
  if (!d.values || typeof d.values !== "object") return out;
  for (const [k, v] of Object.entries(d.values as Record<string, unknown>)) {
    const parsed = parseValueShape(v);
    if (parsed !== undefined) out.values[k] = parsed;
  }
  return out;
}

export function parseCanvas(raw: string | null | undefined): ParsedEnvelope<CanvasData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeCanvas(env: CanvasEnvelope): string {
  return serializeEnvelope(env);
}

// ---- coercers (the per-type read boundary) ---------------------------------

export function vString(v: CanvasValue | undefined): string {
  return typeof v === "string" ? v : "";
}

export function vNumber(v: CanvasValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function vBool(v: CanvasValue | undefined): boolean {
  return v === true;
}

export function vStrings(v: CanvasValue | undefined): string[] {
  if (typeof v === "string") return v === "" ? [] : [v];
  if (!Array.isArray(v)) return [];
  const arr: unknown[] = v;
  return arr.every((x) => typeof x === "string") ? (arr as string[]) : [];
}

export function vPeople(v: CanvasValue | undefined): PersonRef[] {
  return Array.isArray(v) ? (v as unknown[]).filter(isPersonRef) : [];
}

export function vChecklist(v: CanvasValue | undefined): CheckItem[] {
  return Array.isArray(v) ? (v as unknown[]).filter(isCheckItem) : [];
}

export function vRows(v: CanvasValue | undefined): CaptureRow[] {
  if (!Array.isArray(v)) return [];
  const arr: unknown[] = v;
  return arr.every((x) => isCaptureRowLike(x)) ? (arr as CaptureRow[]) : [];
}

export function vRange(v: CanvasValue | undefined): DateRange {
  return isDateRange(v) ? v : { start: "", end: "" };
}

export function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 0 = unset; set values clamp to 1..5. */
export function clampRating(n: number): number {
  return n <= 0 ? 0 : Math.max(1, Math.min(5, Math.round(n)));
}

// ---- rich text -------------------------------------------------------------

/** Bound the envelope cost of one rich-text field. */
export const RICHTEXT_MAX = 20000;

const RT_PLAIN_TAGS = new Set(["b", "strong", "i", "em", "u", "p", "ul", "ol", "li"]);
/** Opening one of these swallows everything until its close. */
const RT_SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/**
 * The rich-text sanitiser: a pure REBUILDER, not a filter. It tokenizes
 * the input and emits only what it can vouch for — allowed tags rebuilt
 * from scratch with no carried attributes (links get a validated http(s)
 * href plus rel/target set here), all text entity-normalised and
 * re-escaped, script/style content swallowed whole, and a tag stack that
 * closes whatever the input left open. Runs on every WRITE and every
 * RENDER — stored HTML is never trusted either. Pure by design so the
 * node vitest environment can test the policy without a DOM.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  const input = (html ?? "").slice(0, RICHTEXT_MAX);
  let out = "";
  const stack: string[] = [];
  let skipUntil: string | null = null;

  const tokens = input.match(/<[^>]*>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token[0] !== "<") {
      if (skipUntil === null) out += escapeText(decodeEntities(token));
      continue;
    }
    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)>$/.exec(token);
    if (!m) continue; // mangled tag — drop
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attrs = m[3];

    if (skipUntil !== null) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (RT_SKIP_TAGS.has(name)) {
      if (!closing) skipUntil = name;
      continue;
    }
    if (name === "br") {
      if (!closing) out += "<br>";
      continue;
    }
    if (closing) {
      // close only what is actually open, unwinding nested tags in order
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    if (RT_PLAIN_TAGS.has(name)) {
      out += `<${name}>`;
      stack.push(name);
      continue;
    }
    if (name === "a") {
      const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = decodeEntities(hm?.[2] ?? hm?.[3] ?? hm?.[4] ?? "").trim();
      if (/^https?:\/\//i.test(href)) {
        out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
        stack.push("a");
      }
      continue; // invalid href: the tag vanishes, its text survives
    }
    // any other tag: dropped, its text content survives
  }
  while (stack.length > 0) out += `</${stack.pop()}>`;
  return out;
}

/** The sanitised value's plain text (emptiness checks, rollup cells). */
export function richTextPlain(html: string | null | undefined): string {
  return decodeEntities(sanitizeRichText(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ---- display labels --------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-12" → "12 Aug 2026" — pure string work, no Date re-parse. */
export function dateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** A date range as people say it: both sides, "from …", or "until …". */
export function rangeLabel(range: DateRange): string {
  const s = range.start.trim();
  const e = range.end.trim();
  if (s !== "" && e !== "") return `${dateLabel(s)} – ${dateLabel(e)}`;
  if (s !== "") return `from ${dateLabel(s)}`;
  if (e !== "") return `until ${dateLabel(e)}`;
  return "";
}

// ---- required --------------------------------------------------------------

/** Whether a field currently holds no answer (per-type emptiness). */
export function isEmptyValue(
  type: CanvasFieldType,
  v: CanvasValue | undefined
): boolean {
  switch (type) {
    case "heading":
      return false; // display-only, never counted
    case "yesno":
      return v === undefined; // false IS an answer
    case "number":
    case "decimal":
    case "percent":
      return vNumber(v) === undefined;
    case "rating":
      return (vNumber(v) ?? 0) <= 0;
    case "multichoice":
      return vStrings(v).length === 0;
    case "person":
    case "people":
      return vPeople(v).length === 0;
    case "checklist":
      return vChecklist(v).length === 0;
    case "minitable":
      return vRows(v).length === 0;
    case "daterange": {
      const r = vRange(v);
      return r.start === "" && r.end === "";
    }
    case "richtext":
      return richTextPlain(vString(v)) === "";
    default:
      return vString(v).trim() === "";
  }
}

/** The labels of required fields still unanswered — "N to complete". */
export function missingRequired(
  fields: CanvasField[],
  values: Record<string, CanvasValue>
): string[] {
  return fields
    .filter((f) => f.required && isEmptyValue(f.type, values[f.id]))
    .map((f) => (f.label !== "" ? f.label : f.id));
}
