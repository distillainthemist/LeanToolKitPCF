// The CaptureCard editor: a table driven entirely by the column config.
// Rows edit through a dialog with one field per column — text/number inputs,
// a yes/no chip, and list chips (single = radio-style, multi = checkboxes)
// whose options re-filter live when their parent column's value changes.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { openDialog } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import {
  CaptureColumn,
  CaptureEnvelope,
  CaptureRow,
  DEFAULT_COLUMNS,
  RowHeader,
  SCHEMA_ID,
} from "./types";
import {
  buildCaptureField,
  FieldEditor,
  readFields,
  renderCaptureCellInto,
  wireDependentFields,
} from "./fields";
import { CAPTURE_CSS } from "./styles";

const DEFAULT_GHOST = [
  "Nothing captured yet",
  "Tap to add the first entry.",
];

export interface CaptureEditorCallbacks {
  onChange: (env: CaptureEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
}

export class CaptureEditor {
  private readonly root: HTMLElement;
  private env: CaptureEnvelope;
  private columns: CaptureColumn[] = DEFAULT_COLUMNS;
  private rowHeaders: RowHeader[] = [];
  private titledRows = true;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly snapshots: SnapshotScheduler;
  private resizeObserver: ResizeObserver | null = null;

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
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    // a simple (no-list) card scales its text up to fill the box
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applyFontScale());
      this.resizeObserver.observe(this.root);
    }
    this.render();
  }

  /** True when every column is a plain value (no list/multi-select). */
  private isSimple(): boolean {
    return this.columns.every((c) => c.type !== "list");
  }

  setEnvelope(env: CaptureEnvelope): void {
    this.env = env;
    this.syncFixedRows();
    this.render();
    this.snapshots.schedule();
  }

  setConfig(columns: CaptureColumn[], rowHeaders: RowHeader[], titled: boolean): void {
    if (
      JSON.stringify(columns) === JSON.stringify(this.columns) &&
      JSON.stringify(rowHeaders) === JSON.stringify(this.rowHeaders) &&
      titled === this.titledRows
    ) {
      return;
    }
    this.columns = columns;
    this.rowHeaders = rowHeaders;
    this.titledRows = titled;
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
    this.snapshots.cancel();
    if (this.resizeObserver) this.resizeObserver.disconnect();
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
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-cc-body");
    if (this.isSimple()) body.classList.add("ltk-cc-simple");
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

    const showHead = fixed && this.titledRows;
    const table = el("table", "ltk-cc-table");
    const thead = el("thead");
    const headRow = el("tr");
    if (showHead) headRow.appendChild(el("th"));
    for (const col of this.columns) {
      headRow.appendChild(el("th", undefined, col.label));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const row of this.env.data.rows) {
      const tr = el("tr", "ltk-cc-row");
      if (this.readOnly) tr.classList.add("ltk-readonly");
      if (showHead) {
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
    // the table scrolls inside its own wrapper so the Add-row button below it
    // stays put even when rows expand to fill the height
    const wrap = el("div", "ltk-cc-tablewrap");
    wrap.appendChild(table);
    body.appendChild(wrap);

    if (!this.readOnly && !fixed) {
      const add = el("button", "ltk-cc-add", "＋ Add row");
      add.type = "button";
      add.addEventListener("click", () => this.editRow(null));
      body.appendChild(add);
    }

    this.applyFontScale();
  }

  /**
   * A simple card (plain value columns only) scales its cell text up to fill
   * the height — the fewer the rows, the larger the text. Sets a --cc-font var
   * the .ltk-cc-simple styles read. Card types with chips keep their fixed size.
   */
  private applyFontScale(): void {
    if (!this.isSimple()) {
      this.root.style.removeProperty("--cc-font");
      return;
    }
    const h = this.root.clientHeight;
    const rows = Math.max(1, this.env.data.rows.length);
    if (h <= 0) return;
    const addButton = this.rowHeaders.length === 0 ? 50 : 0; // free rows show ＋ Add row
    const chromeH =
      (this.cardTitle.trim() !== "" ? 36 : 8) + 28 + 30 + addButton; // title + header + paddings + add
    const rowH = (h - chromeH) / rows;
    const font = Math.max(14, Math.min(44, Math.floor(rowH * 0.4)));
    if (this.root.style.getPropertyValue("--cc-font") !== `${font}px`) {
      this.root.style.setProperty("--cc-font", `${font}px`);
    }
  }

  private renderCell(row: CaptureRow, col: CaptureColumn): HTMLElement {
    const td = el("td");
    renderCaptureCellInto(td, col, row.cells[col.key]);
    return td;
  }

  // ---- the row dialog (field machinery shared with CaptureRollup: fields.ts) ----

  private editRow(row: CaptureRow | null): void {
    const fields: FieldEditor[] = this.columns.map((col) =>
      buildCaptureField(col, row?.cells[col.key], hintFor(this.prompts, col.key, ""))
    );
    wireDependentFields(fields);

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
        const cells = readFields(fields);
        if (row) {
          row.cells = cells;
        } else {
          this.env.data.rows.push({ id: newId("row"), rowKey: "", cells });
        }
        dlg.close();
        this.commit();
      },
    });

    let title = "Add entry";
    if (row) {
      if (fixed && this.titledRows) {
        title = this.rowHeaders.find((h) => h.key === row.rowKey)?.label ?? "Edit entry";
      } else if (fixed) {
        title = `Entry ${this.env.data.rows.indexOf(row) + 1}`;
      } else {
        title = "Edit entry";
      }
    }
    const dlg = openDialog({
      host: this.root,
      title,
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
    this.snapshots.schedule();
  }

  // ---- snapshot + downloads ----

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS, this.theme.background, (svg) =>
      this.cb.onSnapshot!(svg)
    );
  }

    private downloadSvg(): void {
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS, this.theme.background, (svg) =>
      saveSvg(svg, "capture.svg")
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
