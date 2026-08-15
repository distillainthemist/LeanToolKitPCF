// CanvasCard Layout builder — the settings editor for the canvasJSON
// config (plan C1): a columns-count select and one draggable block per
// field (label, type, width/height, required, hint, id) with sub-editors
// for choice options (capture option shape, no dependent lists) and
// mini-table columns (the captureColumnsEditor itself, re-hosted over the
// field's columns array). Emits the sparse object parseCanvasConfig
// understands. Field ids are the VALUE KEYS: auto-slugged from the label
// until touched or loaded, then load-bearing.

import { draggableRow } from "../../shared/ui/dragList";
import { checkItem } from "../../shared/ui/dialog";
import { el } from "../../shared/ui/dom";
import {
  CANVAS_TYPES,
  CanvasFieldType,
  DEFAULT_H,
} from "../CanvasCard/types";
import { captureColumnsEditor } from "./captureColumns";
import { FieldSpec } from "./registry";
import { FieldHost, labelRow } from "./fields";

type Get = () => unknown;
type Set = (v: unknown) => void;

export const CANVAS_TYPE_LABELS: { value: CanvasFieldType; label: string }[] = [
  { value: "heading", label: "Heading" },
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "richtext", label: "Rich text" },
  { value: "number", label: "Whole number" },
  { value: "decimal", label: "Decimal" },
  { value: "date", label: "Date" },
  { value: "daterange", label: "Date range" },
  { value: "choice", label: "Choice" },
  { value: "multichoice", label: "Multi choice" },
  { value: "yesno", label: "Yes / no" },
  { value: "person", label: "Person" },
  { value: "people", label: "People" },
  { value: "status", label: "Status (palette)" },
  { value: "percent", label: "Percent" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "url", label: "Link (URL)" },
  { value: "checklist", label: "Checklist" },
  { value: "minitable", label: "Mini table" },
  { value: "image", label: "Image" },
];

interface OptDraft {
  value: string;
  valuePinned: boolean;
  label: string;
  icon: string;
}

interface FieldDraft {
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

interface CanvasDraft {
  cols: number;
  fields: FieldDraft[];
}

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

function iconIsUri(icon: string): boolean {
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

export function canvasFieldsEditor(
  spec: FieldSpec,
  get: Get,
  set: Set,
  host: FieldHost
): HTMLElement {
  const draft = loadCanvasDraft(get());

  const push = () => {
    set(serializeCanvasDraft(draft));
    host.onChanged();
  };

  const box = el("div", "ltk-cs-cols");

  const optionsTable = (f: FieldDraft): HTMLElement => {
    const table = el("div", "ltk-cs-table");
    const head = el("div", "ltk-cs-tr ltk-cs-th");
    head.appendChild(el("span", "ltk-cs-td", "Option"));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-icon", "Icon"));
    head.appendChild(el("span", "ltk-cs-td-prev", ""));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-x", ""));
    table.appendChild(head);

    f.options.forEach((op, i) => {
      const tr = el("div", "ltk-cs-tr");
      const lIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      lIn.type = "text";
      lIn.value = op.label;
      lIn.placeholder = "e.g. On track";
      lIn.disabled = host.readOnly;
      lIn.addEventListener("input", () => {
        op.label = lIn.value;
        if (!op.valuePinned) op.value = lIn.value;
        push();
      });
      const lTd = el("span", "ltk-cs-td");
      lTd.appendChild(lIn);
      tr.appendChild(lTd);

      const prev = el("span", "ltk-cs-iconprev");
      const paintPrev = () => {
        while (prev.firstChild) prev.removeChild(prev.firstChild);
        if (op.icon === "") return;
        if (iconIsUri(op.icon)) {
          const img = el("img") as HTMLImageElement;
          img.src = op.icon;
          img.alt = "";
          prev.appendChild(img);
        } else {
          prev.textContent = op.icon;
        }
      };
      const iIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      iIn.type = "text";
      iIn.value = op.icon;
      iIn.placeholder = "🟢 or https://…";
      iIn.title = "An emoji / short glyph, or an image URL / data URI";
      iIn.disabled = host.readOnly;
      iIn.addEventListener("input", () => {
        op.icon = iIn.value.trim();
        paintPrev();
        push();
      });
      const iTd = el("span", "ltk-cs-td ltk-cs-td-icon");
      iTd.appendChild(iIn);
      tr.appendChild(iTd);
      paintPrev();
      tr.appendChild(prev);

      const xtd = el("span", "ltk-cs-td ltk-cs-td-x");
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove option";
        x.addEventListener("click", () => {
          f.options.splice(i, 1);
          sync();
          push();
        });
        xtd.appendChild(x);
      }
      tr.appendChild(xtd);
      table.appendChild(tr);
    });

    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Option");
      add.type = "button";
      add.addEventListener("click", () => {
        f.options.push({ value: "", valuePinned: false, label: "", icon: "" });
        sync();
        push();
        const blocks = box.querySelectorAll(".ltk-cs-col");
        const block = blocks[draft.fields.indexOf(f)];
        const inputs = block?.querySelectorAll<HTMLInputElement>(".ltk-cs-table .ltk-cs-tr input");
        inputs?.[inputs.length - 2]?.focus();
      });
      table.appendChild(add);
    }
    return table;
  };

  /** The mini-table's columns: the capture columns builder itself,
   *  re-hosted over this field's columns array. */
  const miniTableColumns = (f: FieldDraft): HTMLElement =>
    captureColumnsEditor(
      {
        key: "columns",
        label: "Table columns",
        kind: "captureColumns",
        help:
          "The embedded table's columns — the capture card's column model (picklists, icons, dependent lists all work).",
      },
      () => f.columns,
      (v) => {
        f.columns = Array.isArray(v) ? v : [];
      },
      host
    );

  const fieldBlock = (f: FieldDraft, i: number): HTMLElement => {
    const block = el("div", "ltk-cs-col");
    // the selection bridge: this block IS field f.id — the canvas can find
    // and mark it, and clicking into it selects the field on the canvas
    const effectiveId = () => (f.id.trim() !== "" ? f.id.trim() : slug(f.label));
    block.dataset.fieldId = effectiveId();
    if (host.selectedField !== undefined && host.selectedField === effectiveId()) {
      block.classList.add("ltk-cs-col-selected");
    }
    block.addEventListener("focusin", () => host.onSelectField?.(effectiveId()));
    block.addEventListener("click", () => host.onSelectField?.(effectiveId()));

    const headRow = el("div", "ltk-cs-col-head");
    const handle = el("span", "ltk-cs-drag", "≡");
    handle.title = "Drag to reorder";
    headRow.appendChild(handle);
    if (!host.readOnly) {
      draggableRow(block, handle, "canvas-fields", i, draft.fields, () => {
        sync();
        push();
      });
    }

    const lIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-label") as HTMLInputElement;
    lIn.type = "text";
    lIn.value = f.label;
    lIn.placeholder = "Field title";
    lIn.disabled = host.readOnly;
    lIn.addEventListener("input", () => {
      f.label = lIn.value;
      if (!f.idTouched) {
        f.id = slug(lIn.value);
        idIn.value = f.id;
      }
      push();
    });

    const tSel = el("select", "ltk-input ltk-select ltk-cs-col-type") as HTMLSelectElement;
    for (const t of CANVAS_TYPE_LABELS) {
      const o = el("option", undefined, t.label) as HTMLOptionElement;
      o.value = t.value;
      if (t.value === f.type) o.selected = true;
      tSel.appendChild(o);
    }
    tSel.disabled = host.readOnly;
    tSel.addEventListener("change", () => {
      const prevDefault = DEFAULT_H[f.type];
      if (isType(tSel.value)) f.type = tSel.value;
      if (f.type === "heading") f.required = false;
      // an untouched height follows the new type's default
      if (f.h === prevDefault) f.h = DEFAULT_H[f.type];
      sync(); // sub-sections appear/disappear
      push();
    });

    headRow.append(lIn, tSel);
    if (!host.readOnly) {
      const x = el("button", "ltk-cs-chip-x", "×");
      x.type = "button";
      x.title = "Remove field (its saved values stay in documents, unrendered)";
      x.addEventListener("click", () => {
        draft.fields.splice(i, 1);
        sync();
        push();
      });
      headRow.appendChild(x);
    }
    block.appendChild(headRow);

    // ---- the meta row: id · width · height · required · hint ----
    const meta = el("div", "ltk-cs-canvas-meta");

    const idIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-key") as HTMLInputElement;
    idIn.type = "text";
    idIn.value = f.id;
    idIn.placeholder = "id";
    idIn.title =
      "The key values are stored under. Auto-generated from the title; change it only before anyone has filled the field in.";
    idIn.disabled = host.readOnly;
    idIn.addEventListener("input", () => {
      f.idTouched = true;
      f.id = idIn.value.trim();
      push();
    });
    meta.appendChild(idIn);

    const wSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let w = 1; w <= draft.cols; w++) {
      const o = el(
        "option",
        undefined,
        w === 1 ? "1 column wide" : `${w} columns wide`
      ) as HTMLOptionElement;
      o.value = String(w);
      if (Math.min(f.w, draft.cols) === w) o.selected = true;
      wSel.appendChild(o);
    }
    wSel.disabled = host.readOnly || draft.cols === 1;
    wSel.addEventListener("change", () => {
      f.w = Number(wSel.value);
      push();
    });
    meta.appendChild(wSel);

    const hSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let h = 1; h <= 8; h++) {
      const o = el("option", undefined, `Height ${h}`) as HTMLOptionElement;
      o.value = String(h);
      if (f.h === h) o.selected = true;
      hSel.appendChild(o);
    }
    hSel.disabled = host.readOnly;
    hSel.title = "Height in grid steps — long text, tables and images want 3+";
    hSel.addEventListener("change", () => {
      f.h = Number(hSel.value);
      push();
    });
    meta.appendChild(hSel);

    if (f.type !== "heading") {
      const req = checkItem("Required");
      req.box.checked = f.required;
      req.wrap.classList.toggle("ltk-check-on", f.required);
      req.box.disabled = host.readOnly;
      req.box.title = "A marker, not a gate — empty required fields count toward “N to complete”.";
      req.box.addEventListener("change", () => {
        f.required = req.box.checked;
        req.wrap.classList.toggle("ltk-check-on", f.required);
        push();
      });
      meta.appendChild(req.wrap);
    }

    const hintIn = el("input", "ltk-input ltk-cs-cell ltk-cs-canvas-hint") as HTMLInputElement;
    hintIn.type = "text";
    hintIn.value = f.hint;
    hintIn.placeholder = "Prompt shown while empty";
    hintIn.disabled = host.readOnly;
    hintIn.addEventListener("input", () => {
      f.hint = hintIn.value;
      push();
    });
    meta.appendChild(hintIn);

    block.appendChild(meta);

    if (f.type === "choice" || f.type === "multichoice") {
      block.appendChild(optionsTable(f));
    }
    if (f.type === "status") {
      block.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "Status fields offer the app's state palette — no options to configure here."
        )
      );
    }
    if (f.type === "minitable") {
      block.appendChild(miniTableColumns(f));
    }

    return block;
  };

  const sync = () => {
    while (box.firstChild) box.removeChild(box.firstChild);

    const colsRow = el("div", "ltk-cs-canvas-cols");
    colsRow.appendChild(el("span", "ltk-cs-sublabel", "Layout columns"));
    const cSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let c = 1; c <= 3; c++) {
      const o = el("option", undefined, `${c} column${c === 1 ? "" : "s"}`) as HTMLOptionElement;
      o.value = String(c);
      if (draft.cols === c) o.selected = true;
      cSel.appendChild(o);
    }
    cSel.disabled = host.readOnly;
    cSel.addEventListener("change", () => {
      draft.cols = Number(cSel.value);
      for (const f of draft.fields) f.w = Math.min(f.w, draft.cols);
      sync(); // width selects re-range
      push();
    });
    colsRow.appendChild(cSel);
    box.appendChild(colsRow);

    draft.fields.forEach((f, i) => box.appendChild(fieldBlock(f, i)));
    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Add field");
      add.type = "button";
      add.addEventListener("click", () => {
        draft.fields.push({
          id: "",
          idTouched: false,
          label: "",
          type: "text",
          w: 1,
          h: DEFAULT_H.text,
          hint: "",
          required: false,
          options: [],
          columns: [],
        });
        sync();
        push();
        box.querySelector<HTMLInputElement>(".ltk-cs-col:last-of-type .ltk-cs-col-label")?.focus();
      });
      box.appendChild(add);
    }
  };
  sync();

  const field = el("div", "ltk-cs-field ltk-cs-field-wide");
  field.appendChild(labelRow(spec.label, spec.help));
  field.appendChild(box);
  return field;
}
