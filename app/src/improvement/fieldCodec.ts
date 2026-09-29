// Header field values ↔ canvas values (2026-09-29). An initiative stores
// its custom field values as STRINGS (`fieldValues`, one JSON column); the
// canvas card and the forms edit typed values. This is the one boundary:
// what kind a header field is as a canvas type, its value decoded for an
// editor, encoded for the row, and in plain words for a line of text.
// Pure — the binding, the forms and the tests share it.

import {
  CanvasField,
  CanvasFieldType,
  CanvasValue,
  clampPercent,
  clampRating,
  isEmptyValue,
  rangeLabel,
  richTextPlain,
  sanitizeRichText,
  vBool,
  vChecklist,
  vNumber,
  vPeople,
  vRange,
  vString,
  vStrings,
} from "../../../controls/CanvasCard/types";
import type { FieldKind, TemplateField } from "./templateModel";

const CANVAS_TYPE: Record<FieldKind, CanvasFieldType> = {
  text: "text",
  longtext: "longtext",
  richtext: "richtext",
  integer: "number",
  number: "decimal",
  percent: "percent",
  rating: "rating",
  date: "date",
  daterange: "daterange",
  picklist: "choice",
  multichoice: "multichoice",
  yesno: "yesno",
  status: "status",
  person: "person",
  people: "people",
  url: "url",
  checklist: "checklist",
};

export function canvasTypeOf(kind: FieldKind): CanvasFieldType {
  return CANVAS_TYPE[kind] ?? "text";
}

/** The header field as the canvas field an editor or a painter takes. */
export function canvasFieldFor(f: Pick<TemplateField, "key" | "label" | "kind" | "options" | "required">): CanvasField {
  return {
    id: f.key,
    type: canvasTypeOf(f.kind),
    label: f.label,
    w: 1,
    h: 1,
    hint: "",
    required: f.required,
    options: f.options.map((o) => ({ value: o, label: o, icon: "", when: "" })),
    columns: [],
    bound: "",
  };
}

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** The stored string as the value its editor takes; undefined = unset. */
export function decodeFieldValue(kind: FieldKind, raw: string | undefined): CanvasValue | undefined {
  const s = raw ?? "";
  if (s.trim() === "") return undefined;
  switch (kind) {
    case "integer":
    case "number":
    case "percent":
    case "rating": {
      const n = Number(s);
      if (!Number.isFinite(n)) return undefined;
      return kind === "integer" ? Math.round(n) : kind === "percent" ? clampPercent(n) : kind === "rating" ? clampRating(n) : n;
    }
    case "yesno": {
      const t = s.trim().toLowerCase();
      return t === "yes" || t === "true" ? true : t === "no" || t === "false" ? false : undefined;
    }
    case "daterange": {
      const r = vRange(json(s) as CanvasValue);
      return r.start === "" && r.end === "" ? undefined : r;
    }
    case "multichoice": {
      const v = json(s);
      // a value from before the field was multi: one option, or a list
      const list = Array.isArray(v) ? vStrings(v as CanvasValue) : s.split(",").map((x) => x.trim()).filter((x) => x !== "");
      return list.length === 0 ? undefined : list;
    }
    case "person":
    case "people": {
      const v = json(s);
      // a name typed into the old plain "person" box stays a name
      const list = Array.isArray(v) ? vPeople(v as CanvasValue) : [{ id: "", name: s.trim() }];
      const kept = kind === "person" ? list.slice(0, 1) : list;
      return kept.length === 0 ? undefined : kept;
    }
    case "checklist": {
      const v = json(s);
      const list = Array.isArray(v) ? vChecklist(v as CanvasValue) : s.split("\n").map((x) => x.trim()).filter((x) => x !== "").map((text) => ({ text, done: false }));
      return list.length === 0 ? undefined : list;
    }
    case "richtext": {
      // plain text from before the field was rich keeps its line breaks
      const html = /<[a-z][^>]*>/i.test(s) ? sanitizeRichText(s) : sanitizeRichText(s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"));
      return richTextPlain(html) === "" ? undefined : html;
    }
    default:
      return s;
  }
}

/** The editor's value as the string the row stores; "" = unset. */
export function encodeFieldValue(kind: FieldKind, v: CanvasValue | undefined): string {
  if (v === undefined || isEmptyValue(canvasTypeOf(kind), v)) return "";
  switch (kind) {
    case "integer":
    case "number":
    case "percent":
    case "rating": {
      const n = vNumber(v);
      return n === undefined ? "" : String(kind === "integer" ? Math.round(n) : n);
    }
    case "yesno":
      return vBool(v) ? "yes" : "no";
    case "daterange":
      return JSON.stringify(vRange(v));
    case "multichoice":
      return JSON.stringify(vStrings(v));
    case "person":
      return JSON.stringify(vPeople(v).slice(0, 1));
    case "people":
      return JSON.stringify(vPeople(v));
    case "checklist":
      return JSON.stringify(vChecklist(v));
    case "richtext":
      return sanitizeRichText(vString(v));
    default:
      return vString(v).trim();
  }
}

/** The value in plain words — a line of text, a search, a CSV cell. */
export function plainFieldValue(kind: FieldKind, raw: string | undefined): string {
  const v = decodeFieldValue(kind, raw);
  if (v === undefined) return "";
  switch (kind) {
    case "yesno":
      return vBool(v) ? "Yes" : "No";
    case "percent":
      return `${vNumber(v) ?? ""}%`;
    case "rating":
      return `${vNumber(v) ?? 0} / 5`;
    case "daterange":
      return rangeLabel(vRange(v));
    case "multichoice":
      return vStrings(v).join(", ");
    case "person":
    case "people":
      return vPeople(v).map((p) => p.name).join(", ");
    case "checklist": {
      const items = vChecklist(v);
      return `${items.filter((i) => i.done).length} of ${items.length} done`;
    }
    case "richtext":
      return richTextPlain(vString(v));
    case "status":
      return vString(v).replace(/_/g, " ");
    default:
      return typeof v === "number" ? String(v) : vString(v);
  }
}

/** Is a required field still unanswered? */
export function isFieldEmpty(kind: FieldKind, raw: string | undefined): boolean {
  return decodeFieldValue(kind, raw) === undefined;
}
