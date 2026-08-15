// CanvasCard layout DRAFT — the Layout builder's working model of a
// canvasJSON config and its SPARSE serialisation. Pure and UI-free so the
// card mounter can serialise on-canvas layout edits (the reverse channel)
// without dragging the settings editors into the board path (chunk
// ceiling, 2026-08-16). canvasFields.ts (the builder UI) consumes it.

import {
  CANVAS_TYPES,
  CanvasFieldType,
  DEFAULT_H,
} from "./types";

export interface OptDraft {
  value: string;
  valuePinned: boolean;
  label: string;
  icon: string;
}

export interface FieldDraft {
  id: string;
  idTouched: boolean;
  label: string;
  type: CanvasFieldType;
  w: number;
  h: number;
  hint: string;
  required: boolean;
  options: OptDraft[];
  /** Raw capture-column array — the sub-editor round-trips it. */
  columns: unknown[];
}

export interface CanvasDraft {
  cols: number;
  fields: FieldDraft[];
}

export function slug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isType(t: unknown): t is CanvasFieldType {
  return typeof t === "string" && (CANVAS_TYPES as readonly string[]).includes(t);
}

export function iconIsUri(icon: string): boolean {
  return /^(data:|https?:\/\/|\/)/i.test(icon);
}

export function loadCanvasDraft(v: unknown): CanvasDraft {
  let data: unknown = v;
  if (typeof v === "string") {
    try {
      data = JSON.parse(v);
    } catch {
      data = undefined;
    }
  }
  const out: CanvasDraft = { cols: 2, fields: [] };
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  const d = data as { cols?: unknown; fields?: unknown };
  const cols = typeof d.cols === "number" ? Math.round(d.cols) : 2;
  out.cols = Math.max(1, Math.min(3, Number.isFinite(cols) ? cols : 2));
  if (!Array.isArray(d.fields)) return out;
  for (const item of d.fields) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type: CanvasFieldType = isType(o.type) ? o.type : "text";
    const options: OptDraft[] = [];
    if (Array.isArray(o.options)) {
      for (const op of o.options) {
        if (typeof op === "string") {
          if (op !== "") options.push({ value: op, valuePinned: false, label: op, icon: "" });
          continue;
        }
        if (!op || typeof op !== "object") continue;
        const oo = op as Record<string, unknown>;
        const oLabel = typeof oo.label === "string" ? oo.label : "";
        const oValue = typeof oo.value === "string" && oo.value !== "" ? oo.value : oLabel;
        if (oValue === "") continue;
        options.push({
          value: oValue,
          valuePinned: oValue !== (oLabel === "" ? oValue : oLabel),
          label: oLabel === "" ? oValue : oLabel,
          icon: typeof oo.icon === "string" ? oo.icon : "",
        });
      }
    }
    out.fields.push({
      id: typeof o.id === "string" ? o.id.trim() : "",
      idTouched: typeof o.id === "string" && o.id.trim() !== "", // loaded ids are load-bearing
      label: typeof o.label === "string" ? o.label : "",
      type,
      w: typeof o.w === "number" ? Math.max(1, Math.min(3, Math.round(o.w))) : 1,
      h:
        typeof o.h === "number"
          ? Math.max(1, Math.min(8, Math.round(o.h)))
          : DEFAULT_H[type],
      hint: typeof o.hint === "string" ? o.hint : "",
      required: o.required === true && type !== "heading",
      options,
      columns: Array.isArray(o.columns) ? o.columns : [],
    });
  }
  return out;
}

/** Sparse emit — only what differs from parseCanvasConfig's defaults. */
export function serializeCanvasDraft(draft: CanvasDraft): unknown | undefined {
  const fields: unknown[] = [];
  for (const f of draft.fields) {
    const id = f.id.trim() !== "" ? f.id.trim() : slug(f.label);
    if (id === "" && f.label.trim() === "") continue; // an entirely empty block
    const o: Record<string, unknown> = { id: id || undefined, label: f.label };
    if (f.type !== "text") o.type = f.type;
    if (f.w > 1) o.w = Math.min(f.w, draft.cols);
    if (f.h !== DEFAULT_H[f.type]) o.h = f.h;
    if (f.hint.trim() !== "") o.hint = f.hint;
    if (f.required && f.type !== "heading") o.required = true;
    if ((f.type === "choice" || f.type === "multichoice") && f.options.length > 0) {
      const opts: unknown[] = [];
      for (const op of f.options) {
        const label = op.label.trim();
        const value = op.valuePinned ? op.value : label;
        if (value === "" && label === "") continue;
        if (op.icon === "" && value === label) {
          opts.push(label);
        } else {
          const oo: Record<string, unknown> = { value: value !== "" ? value : label };
          if (label !== "" && label !== oo.value) oo.label = label;
          if (op.icon !== "") oo.icon = op.icon;
          opts.push(oo);
        }
      }
      if (opts.length > 0) o.options = opts;
    }
    if (f.type === "minitable" && f.columns.length > 0) o.columns = f.columns;
    fields.push(o);
  }
  if (fields.length === 0) return undefined;
  return { cols: draft.cols, fields };
}

