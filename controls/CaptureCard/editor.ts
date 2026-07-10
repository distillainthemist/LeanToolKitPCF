// The CaptureCard editor: a table driven entirely by the column config.
// Rows edit through a dialog with one field per column — text/number inputs,
// a yes/no chip, and list chips (single = radio-style, multi = checkboxes)
// whose options re-filter live when their parent column's value changes.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import {
  checkItem,
  checklist,
  fieldRow,
  openDialog,
  textInput,
} from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import {
  CaptureColumn,
  CaptureEnvelope,
  CaptureRow,
  CellValue,
  DEFAULT_COLUMNS,
  ListOption,
  RowHeader,
  SCHEMA_ID,
} from "./types";
import { CAPTURE_CSS } from "./styles";

const DEFAULT_GHOST = [
  "Nothing captured yet",
  "Tap to add the first entry.",
];

/** A field editor inside the row dialog. */
interface FieldEditor {
  column: CaptureColumn;
  el: HTMLElement;
  read: () => CellValue | undefined;
  /** Re-filter options when a parent value changes (dependent lists). */
  refilter?: (parentValue: string) => void;
  /** Current single value (for driving children). */
  current?: () => string;
  onChanged?: () => void; // wired by the dialog to cascade re-filters
}

export interface CaptureEditorCallbacks {
  onChange: (env: CaptureEnvelope) => void;
  onPngReady?: (dataUri: string) => void;
}

export class CaptureEditor {
  private readonly root: HTMLElement;
  private env: CaptureEnvelope;
  private columns: CaptureColumn[] = DEFAULT_COLUMNS;
  private rowHeaders: RowHeader[] = [];
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: CaptureEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-capture-css", CAPTURE_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { rows: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: CaptureEnvelope): void {
    this.env = env;
    this.syncFixedRows();
    this.render();
    this.png.schedule();
  }

  setConfig(columns: CaptureColumn[], rowHeaders: RowHeader[]): void {
    if (
      JSON.stringify(columns) === JSON.stringify(this.columns) &&
      JSON.stringify(rowHeaders) === JSON.stringify(this.rowHeaders)
    ) {
      return;
    }
    this.columns = columns;
    this.rowHeaders = rowHeaders;
    this.syncFixedRows();
    this.render();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) {
      return;
    }
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  /** With fixed row headers, ensure exactly one row per header, in order. */
  private syncFixedRows(): void {
    if (this.rowHeaders.length === 0) return;
    const byKey = new Map(this.env.data.rows.map((r) => [r.rowKey, r]));
    this.env.data.rows = this.rowHeaders.map(
      (h) => byKey.get(h.key) ?? { id: newId("row"), rowKey: h.key, cells: {} }
    );
  }

  // ---- rendering ----

  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-cc-body");
    this.root.appendChild(body);

    const fixed = this.rowHeaders.length > 0;
    if (!fixed && this.env.data.rows.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(body, this.readOnly ? lines.slice(0, 1) : lines);
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editRow(null));
      }
      return;
    }

    const table = el("table", "ltk-cc-table");
    const thead = el("thead");
    const headRow = el("tr");
    if (fixed) headRow.appendChild(el("th"));
    for (const col of this.columns) {
      headRow.appendChild(el("th", undefined, col.label));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const row of this.env.data.rows) {
      const tr = el("tr", "ltk-cc-row");
      if (this.readOnly) tr.classList.add("ltk-readonly");
      if (fixed) {
        const header = this.rowHeaders.find((h) => h.key === row.rowKey);
        tr.appendChild(el("td", "ltk-cc-rowhead", header?.label ?? row.rowKey));
      }
      for (const col of this.columns) {
        tr.appendChild(this.renderCell(row, col));
      }
      if (!this.readOnly) {
        tr.addEventListener("click", () => this.editRow(row));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    if (!this.readOnly && !fixed) {
      const add = el("button", "ltk-cc-add", "＋ Add row");
      add.type = "button";
      add.addEventListener("click", () => this.editRow(null));
      body.appendChild(add);
    }
  }

  private renderCell(row: CaptureRow, col: CaptureColumn): HTMLElement {
    const td = el("td");
    const value = row.cells[col.key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      td.appendChild(el("span", "ltk-cc-empty", "—"));
      return td;
    }
    if (col.type === "yesno") {
      td.textContent = value === true || value === "true" ? "✓" : "—";
      return td;
    }
    if (col.type === "list") {
      const values = Array.isArray(value) ? value : [String(value)];
      for (const v of values) {
        const option = col.options.find((o) => o.value === v);
        td.appendChild(this.optionChip(option, v));
      }
      return td;
    }
    td.textContent = String(value);
    return td;
  }

  private optionChip(option: ListOption | undefined, value: string): HTMLElement {
    const chip = el("span", "ltk-cc-chip");
    const icon = option?.icon ?? "";
    if (icon.startsWith("data:")) {
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

  // ---- the row dialog ----

  private buildField(col: CaptureColumn, row: CaptureRow | null): FieldEditor {
    const value = row?.cells[col.key];

    if (col.type === "yesno") {
      const chk = checkItem(col.label);
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
        current: () => {
          const picked = boxes.find((b) => b.box.checked);
          return picked ? picked.value : "";
        },
      };
      const rebuild = (parentValue: string) => {
        while (list.firstChild) list.removeChild(list.firstChild);
        boxes = [];
        const options = col.options.filter(
          (o) => o.when === "" || col.parent === "" || o.when === parentValue
        );
        for (const option of options) {
          const item = checkItem("");
          // chip content: icon + label
          item.wrap.appendChild(this.optionChip(option, option.value));
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
      rebuild("");
      return field;
    }

    // text (default)
    const input = textInput(value === undefined ? "" : String(value), {
      placeholder: hintFor(this.prompts, col.key, ""),
    });
    return {
      column: col,
      el: fieldRow(col.label, input),
      read: () => (input.value.trim() === "" ? undefined : input.value.trim()),
    };
  }

  private editRow(row: CaptureRow | null): void {
    const fields = this.columns.map((col) => this.buildField(col, row));

    // wire dependent lists: when a parent's selection changes, re-filter
    // every child column keyed to it
    for (const field of fields) {
      const children = fields.filter(
        (f) => f.column.parent !== "" && f.column.parent === field.column.key
      );
      if (children.length === 0) continue;
      const cascade = () => {
        const parentValue = field.current ? field.current() : "";
        for (const child of children) {
          if (child.refilter) child.refilter(parentValue);
        }
      };
      field.onChanged = cascade;
      cascade(); // initial filter against the loaded value
    }

    const fixed = this.rowHeaders.length > 0;
    const buttons = [];
    if (row && !fixed) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.rows = this.env.data.rows.filter((r) => r.id !== row.id);
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({
      label: "Cancel",
      kind: "secondary" as const,
      onClick: () => dlg.close(),
    });
    buttons.push({
      label: row ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const cells: Record<string, CellValue> = {};
        for (const field of fields) {
          const v = field.read();
          if (v !== undefined) cells[field.column.key] = v;
        }
        if (row) {
          row.cells = cells;
        } else {
          this.env.data.rows.push({ id: newId("row"), rowKey: "", cells });
        }
        dlg.close();
        this.commit();
      },
    });

    const header = fixed
      ? this.rowHeaders.find((h) => h.key === row?.rowKey)?.label
      : undefined;
    const dlg = openDialog({
      host: this.root,
      title: row ? (header ?? "Edit entry") : "Add entry",
      buttons,
    });
    for (const field of fields) dlg.body.appendChild(field.el);
    const firstInput = dlg.body.querySelector<HTMLElement>("input, textarea");
    if (firstInput) firstInput.focus();
  }

  // ---- mutations ----

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.png.schedule();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + CAPTURE_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + CAPTURE_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "capture.png";
      link.click();
    });
  }
}
