// Capture field machinery, shared by the CaptureCard editor and the
// CaptureRollup's full-edit dialog: cell content rendering, the per-column
// dialog field builders, and the dependent-picklist cascade wiring.
// Extracted verbatim from editor.ts (R3 of the capture-rollup plan) — the
// behaviour is the capture card's, not a variant.

import { checkItem, checklist, fieldRow, textInput } from "../../shared/ui/dialog";
import { el } from "../../shared/ui/dom";
import { CaptureColumn, CellValue, ListOption } from "./types";

/** An icon is rendered as an image when it's a data URI or a URL. */
export function isImageIcon(icon: string): boolean {
  return /^(data:|https?:\/\/|\/)/i.test(icon);
}

/** A picklist value as its option chip (icon + label). */
export function optionChip(option: ListOption | undefined, value: string): HTMLElement {
  const chip = el("span", "ltk-cc-chip");
  const icon = option?.icon ?? "";
  if (isImageIcon(icon)) {
    const img = el("img") as HTMLImageElement;
    img.src = icon;
    img.alt = "";
    chip.appendChild(img);
  } else if (icon !== "") {
    chip.appendChild(el("span", undefined, icon));
  }
  chip.appendChild(el("span", undefined, option?.label ?? value));
  return chip;
}

/** Render one cell's content into `td`, by the column's type. */
export function renderCaptureCellInto(
  td: HTMLElement,
  col: CaptureColumn,
  value: CellValue | undefined
): void {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    td.appendChild(el("span", "ltk-cc-empty", "—"));
    return;
  }
  if (col.type === "yesno") {
    td.textContent = value === true || value === "true" ? "✓" : "—";
    return;
  }
  if (col.type === "flag") {
    if (value === true || value === "true") {
      td.appendChild(el("span", "ltk-cc-flag", "⚑"));
    } else {
      td.appendChild(el("span", "ltk-cc-empty", "—"));
    }
    return;
  }
  if (col.type === "list") {
    const values = Array.isArray(value) ? value : [String(value)];
    for (const v of values) {
      const option = col.options.find((o) => o.value === v);
      td.appendChild(optionChip(option, v));
    }
    return;
  }
  td.textContent = String(value);
}

/** A field editor inside the row dialog. */
export interface FieldEditor {
  column: CaptureColumn;
  el: HTMLElement;
  read: () => CellValue | undefined;
  /** Re-filter options against the parent's selected value(s) (dependent lists). */
  refilter?: (parentValues: string[]) => void;
  /** All currently selected values (a multi-select parent drives children with every pick). */
  currentValues?: () => string[];
  onChanged?: () => void; // wired by the dialog to cascade re-filters
}

/** Build one dialog field for a column, seeded with the row's value. */
export function buildCaptureField(
  col: CaptureColumn,
  value: CellValue | undefined,
  textPlaceholder: string
): FieldEditor {
  if (col.type === "yesno" || col.type === "flag") {
    const chk = checkItem(col.type === "flag" ? `⚑ ${col.label}` : col.label);
    chk.box.checked = value === true || value === "true";
    chk.wrap.classList.toggle("ltk-check-on", chk.box.checked);
    return { column: col, el: chk.wrap, read: () => chk.box.checked };
  }

  if (col.type === "number" || col.type === "decimal") {
    const input = textInput(value === undefined ? "" : String(value), {
      type: "number",
    });
    if (col.type === "number") input.step = "1";
    const wrap = fieldRow(col.label, input);
    wrap.classList.add("ltk-field-half");
    return {
      column: col,
      el: wrap,
      read: () => {
        if (input.value.trim() === "") return undefined;
        const n = Number(input.value);
        if (!Number.isFinite(n)) return undefined;
        return col.type === "number" ? Math.round(n) : n;
      },
    };
  }

  if (col.type === "list") {
    const wrap = el("div");
    wrap.appendChild(el("div", "ltk-field-label", col.label));
    const list = checklist();
    wrap.appendChild(list);
    const selected = new Set<string>(
      Array.isArray(value) ? value : value !== undefined ? [String(value)] : []
    );
    let boxes: { box: HTMLInputElement; wrap: HTMLElement; value: string }[] = [];
    const field: FieldEditor = {
      column: col,
      el: wrap,
      read: () => {
        const picked = boxes.filter((b) => b.box.checked).map((b) => b.value);
        if (picked.length === 0) return undefined;
        return col.multi ? picked : picked[0];
      },
      currentValues: () => boxes.filter((b) => b.box.checked).map((b) => b.value),
    };
    const rebuild = (parentValues: string[]) => {
      while (list.firstChild) list.removeChild(list.firstChild);
      boxes = [];
      const options = col.options.filter(
        (o) => o.when === "" || col.parent === "" || parentValues.includes(o.when)
      );
      for (const option of options) {
        const item = checkItem("");
        // chip content: icon + label
        item.wrap.appendChild(optionChip(option, option.value));
        if (selected.has(option.value)) {
          item.box.checked = true;
          item.wrap.classList.add("ltk-check-on");
        }
        item.box.addEventListener("change", () => {
          if (!col.multi && item.box.checked) {
            for (const other of boxes) {
              if (other.box !== item.box && other.box.checked) {
                other.box.checked = false;
                other.wrap.classList.remove("ltk-check-on");
              }
            }
          }
          // keep the selection set current so a parent re-filter preserves it
          selected.clear();
          for (const b of boxes) if (b.box.checked) selected.add(b.value);
          if (field.onChanged) field.onChanged();
        });
        list.appendChild(item.wrap);
        boxes.push({ box: item.box, wrap: item.wrap, value: option.value });
      }
      if (options.length === 0) {
        list.appendChild(
          el("div", "ltk-cc-empty", col.parent !== "" ? "Pick the parent first" : "No options")
        );
      }
    };
    field.refilter = rebuild;
    rebuild([]);
    return field;
  }

  // text (default)
  const input = textInput(value === undefined ? "" : String(value), {
    placeholder: textPlaceholder,
  });
  return {
    column: col,
    el: fieldRow(col.label, input),
    read: () => (input.value.trim() === "" ? undefined : input.value.trim()),
  };
}

/** Wire dependent lists: a parent's selection change re-filters every child
 *  column keyed to it, with an initial filter against the loaded values. */
export function wireDependentFields(fields: FieldEditor[]): void {
  for (const field of fields) {
    const children = fields.filter(
      (f) => f.column.parent !== "" && f.column.parent === field.column.key
    );
    if (children.length === 0) continue;
    const cascade = () => {
      const parentValues = field.currentValues ? field.currentValues() : [];
      for (const child of children) {
        if (child.refilter) child.refilter(parentValues);
      }
    };
    field.onChanged = cascade;
    cascade(); // initial filter against the loaded value
  }
}

/** Read every field into a sparse cells record (unset values dropped). */
export function readFields(fields: FieldEditor[]): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  for (const field of fields) {
    const v = field.read();
    if (v !== undefined) cells[field.column.key] = v;
  }
  return cells;
}
