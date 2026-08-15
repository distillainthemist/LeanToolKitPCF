// The CanvasCard editor — display-first: every field renders its VALUE as
// styled content; interacting swaps in an inline editor (typing types),
// acts directly (yes/no, rating, checklist ticks) or opens a picker
// (C3 — openPicker is the seam). Display-first is what keeps the tile
// snapshots true: htmlToSvg serialises the DOM, and live input state
// would vanish from it.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { hintFor, parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { openDialog } from "../../shared/ui/dialog";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { buildCaptureField, readFields } from "../CaptureCard/fields";
import { CaptureRow } from "../CaptureCard/types";
import { canvasFieldDialog } from "./fieldDialog";
import { paintCanvasValue } from "./display";
import { CAPTURE_CSS } from "../CaptureCard/styles";
import {
  CanvasConfig,
  CanvasEnvelope,
  CanvasField,
  CanvasValue,
  clampPercent,
  isEmptyValue,
  missingRequired,
  SCHEMA_ID,
  vBool,
  vNumber,
  vRange,
  vRows,
  vString,
} from "./types";
import { CANVAS_CSS } from "./styles";

export interface CanvasEditorCallbacks {
  onChange: (env: CanvasEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
  /** Card-level actions (the plan's decision 6): the mounter opens the
   *  standard action manager. Present = an "Actions…" kebab entry. */
  onManageActions?: () => void;
}

/** Types whose value area swaps to an inline editor on click. */
const INLINE_TYPES = new Set([
  "text",
  "longtext",
  "number",
  "decimal",
  "date",
  "daterange",
  "percent",
  "url",
]);

export class CanvasEditor {
  private readonly root: HTMLElement;
  private env: CanvasEnvelope;
  private config: CanvasConfig = { cols: 2, fields: [] };
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private palette: Record<string, string> = {};
  private people: Person[] = [];
  private readonly snapshots: SnapshotScheduler;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: CanvasEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-capture-css", CAPTURE_CSS);
    ensureStylesheet("ltk-canvas-css", CANVAS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { values: {} },
    };
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applyNarrow());
      this.resizeObserver.observe(this.root);
    }
    this.render();
  }

  setEnvelope(env: CanvasEnvelope): void {
    this.env = env;
    this.render();
    this.snapshots.schedule();
  }

  setConfig(config: CanvasConfig): void {
    if (JSON.stringify(config) === JSON.stringify(this.config)) return;
    this.config = config;
    this.render();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
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

  /** The app state palette (key → colour) — status fields render from it. */
  setPalette(palette: Record<string, string>): void {
    if (JSON.stringify(palette) === JSON.stringify(this.palette)) return;
    this.palette = palette;
    this.render();
  }

  /** Person-picker roster: board people up front, `secondary` people
   *  behind the search box (the action form's own convention). */
  setPeople(people: Person[]): void {
    if (JSON.stringify(people) === JSON.stringify(this.people)) return;
    this.people = people;
    // no render — people only feed the picker dialog
  }

  destroy(): void {
    this.snapshots.cancel();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.root.remove();
  }

  // ---- rendering ----

  private applyNarrow(): void {
    const narrow = this.root.clientWidth > 0 && this.root.clientWidth < 480;
    this.root.classList.toggle("ltk-cv-narrow", narrow);
  }

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
    if (this.readOnly) this.root.classList.add("ltk-readonly");
    else this.root.classList.remove("ltk-readonly");
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      const items = [
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ];
      if (this.cb.onManageActions) {
        items.unshift({ label: "Actions…", onClick: () => this.cb.onManageActions!() });
      }
      renderKebab(this.root, items);
    }

    const body = el("div", "ltk-cv-body");
    this.root.appendChild(body);

    const missing = missingRequired(this.config.fields, this.env.data.values);
    if (missing.length > 0) {
      const banner = el("div", "ltk-cv-banner");
      banner.appendChild(el("b", undefined, `${missing.length} to complete`));
      banner.appendChild(
        document.createTextNode(` — ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`)
      );
      body.appendChild(banner);
    }

    const grid = el("div", "ltk-cv-grid");
    grid.style.gridTemplateColumns = `repeat(${this.config.cols}, 1fr)`;
    body.appendChild(grid);

    if (this.config.fields.length === 0) {
      grid.style.gridTemplateColumns = "1fr";
      const ghost = el(
        "div",
        "ltk-cv-empty",
        "No fields yet — design the layout in this card's settings."
      );
      ghost.style.gridColumn = "1 / -1";
      grid.appendChild(ghost);
    }

    for (const field of this.config.fields) {
      grid.appendChild(this.renderField(field));
    }
    this.applyNarrow();
  }

  private renderField(field: CanvasField): HTMLElement {
    const box = el("div", "ltk-cv-field");
    box.style.gridColumn = `span ${Math.min(field.w, this.config.cols)}`;
    box.style.gridRow = `span ${field.h}`;

    if (field.type === "heading") {
      box.classList.add("ltk-cv-field-heading");
      box.appendChild(el("div", "ltk-cv-heading-text", field.label));
      return box;
    }

    const value = this.env.data.values[field.id];
    const label = el("div", "ltk-cv-label");
    label.appendChild(el("span", undefined, field.label));
    if (field.required && isEmptyValue(field.type, value)) {
      label.appendChild(el("span", "ltk-cv-needed", "· needed"));
    }
    box.appendChild(label);

    const area = el("div", "ltk-cv-value");
    this.paintDisplay(area, field, value);
    box.appendChild(area);

    if (!this.readOnly) {
      if (INLINE_TYPES.has(field.type)) {
        area.classList.add("ltk-cv-editable");
        area.addEventListener("click", () => this.beginInlineEdit(field, area));
      } else if (field.type === "yesno") {
        area.classList.add("ltk-cv-editable");
        area.addEventListener("click", () => {
          this.commitValue(field, !vBool(this.env.data.values[field.id]));
        });
      } else if (
        field.type === "choice" ||
        field.type === "multichoice" ||
        field.type === "person" ||
        field.type === "people" ||
        field.type === "status" ||
        field.type === "richtext" ||
        field.type === "checklist" ||
        field.type === "minitable" ||
        field.type === "image"
      ) {
        // rating handles its own star clicks; checklist ticks are inline
        // but item management is a picker (C3)
        area.classList.add("ltk-cv-editable");
        area.addEventListener("click", (e) => {
          // a checklist tick already handled the click
          if ((e.target as HTMLElement).closest(".ltk-cv-check-item")) return;
          this.openPicker(field);
        });
      }
    }
    return box;
  }

  /** Render a field's DISPLAY state (display.ts paints — shared with the
   *  canvas rollup's cells; the hooks are this card's tap-set layer). */
  private paintDisplay(
    area: HTMLElement,
    field: CanvasField,
    value: CanvasValue | undefined
  ): void {
    paintCanvasValue(area, field, value, {
      palette: this.palette,
      hint: hintFor(this.prompts, field.id, field.hint),
      readOnly: this.readOnly,
      onRatingSet: (n) => this.commitValue(field, n),
      onCheckToggle: (items) => this.commitValue(field, items),
      onMiniRowClick: (row) => this.openMiniRow(field, row),
    });
  }

  // ---- inline editing (typing types) ----

  private beginInlineEdit(field: CanvasField, area: HTMLElement): void {
    if (this.readOnly) return;
    clear(area);
    area.classList.remove("ltk-cv-editable");
    const value = this.env.data.values[field.id];

    const finish = (commit: boolean, next: CanvasValue | undefined) => {
      if (commit) {
        this.commitValue(field, next); // re-renders
      } else {
        area.classList.add("ltk-cv-editable");
        this.paintDisplay(area, field, this.env.data.values[field.id]);
      }
    };

    const wireKeys = (input: HTMLElement, read: () => CanvasValue | undefined) => {
      input.addEventListener("keydown", (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === "Enter" && input.tagName !== "TEXTAREA") {
          e.preventDefault();
          finish(true, read());
        } else if (k === "Escape") {
          e.preventDefault();
          cancelled = true;
          finish(false, undefined);
        }
      });
    };
    let cancelled = false;

    if (field.type === "longtext") {
      const ta = el("textarea") as HTMLTextAreaElement;
      ta.value = vString(value);
      const read = () => (ta.value.trim() === "" ? undefined : ta.value);
      ta.addEventListener("blur", () => {
        if (!cancelled) finish(true, read());
      });
      wireKeys(ta, read);
      area.appendChild(ta);
      ta.focus();
      return;
    }

    if (field.type === "daterange") {
      const row = el("div", "ltk-cv-rangeedit");
      const start = el("input") as HTMLInputElement;
      start.type = "date";
      const end = el("input") as HTMLInputElement;
      end.type = "date";
      const cur = vRange(value);
      start.value = cur.start;
      end.value = cur.end;
      const read = (): CanvasValue | undefined =>
        start.value === "" && end.value === ""
          ? undefined
          : { start: start.value, end: end.value };
      const maybeFinish = () => {
        // commit when focus leaves BOTH inputs
        setTimeout(() => {
          if (cancelled) return;
          if (document.activeElement !== start && document.activeElement !== end) {
            finish(true, read());
          }
        }, 0);
      };
      start.addEventListener("blur", maybeFinish);
      end.addEventListener("blur", maybeFinish);
      wireKeys(start, read);
      wireKeys(end, read);
      row.append(start, end);
      area.appendChild(row);
      start.focus();
      return;
    }

    const input = el("input") as HTMLInputElement;
    if (field.type === "number" || field.type === "decimal" || field.type === "percent") {
      input.type = "number";
      if (field.type !== "decimal") input.step = "1";
      const n = vNumber(value);
      input.value = n === undefined ? "" : String(n);
    } else if (field.type === "date") {
      input.type = "date";
      input.value = vString(value);
    } else {
      input.type = "text";
      input.value = vString(value);
      input.placeholder = hintFor(this.prompts, field.id, field.hint);
    }
    const read = (): CanvasValue | undefined => {
      const t = input.value.trim();
      if (t === "") return undefined;
      if (field.type === "number") return Math.round(Number(t));
      if (field.type === "decimal") {
        const n = Number(t);
        return Number.isFinite(n) ? n : undefined;
      }
      if (field.type === "percent") {
        const n = Number(t);
        return Number.isFinite(n) ? clampPercent(n) : undefined;
      }
      return t;
    };
    input.addEventListener("blur", () => {
      if (!cancelled) finish(true, read());
    });
    wireKeys(input, read);
    area.appendChild(input);
    input.focus();
  }

  // ---- pickers & heavy types (the hybrid's dialog half) ----

  private openPicker(field: CanvasField): void {
    if (this.readOnly) return;
    // mini-tables have their own add/edit-row flow; everything else is the
    // shared field dialog (fieldDialog.ts — the canvas ROLLUP uses the same)
    if (field.type === "minitable") return this.openMiniRow(field, null);
    canvasFieldDialog({
      host: this.root,
      field,
      value: this.env.data.values[field.id],
      palette: this.palette,
      people: this.people,
      onSave: (v) => this.commitValue(field, v),
    });
  }

  /** Mini-table rows: the CAPTURE row dialog over the field's columns.
   *  row = null adds; an existing row edits and can delete. */
  private openMiniRow(field: CanvasField, row: CaptureRow | null): void {
    const fields = field.columns.map((col) =>
      buildCaptureField(col, row?.cells[col.key], "")
    );
    const buttons = [];
    if (row) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          dlg.close();
          const rows = vRows(this.env.data.values[field.id]).filter((r) => r.id !== row.id);
          this.commitValue(field, rows.length === 0 ? undefined : rows);
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: row ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const cells = readFields(fields);
        dlg.close();
        const rows = vRows(this.env.data.values[field.id]).map((r) => ({ ...r }));
        if (row) {
          const target = rows.find((r) => r.id === row.id);
          if (target) target.cells = cells;
        } else {
          rows.push({ id: newId("row"), rowKey: "", cells });
        }
        this.commitValue(field, rows);
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: row ? `${field.label} — edit row` : `${field.label} — add row`,
      buttons,
    });
    for (const fe of fields) dlg.body.appendChild(fe.el);
    const firstInput = dlg.body.querySelector<HTMLElement>("input, textarea");
    if (firstInput) firstInput.focus();
  }

  // ---- mutations ----

  private commitValue(field: CanvasField, next: CanvasValue | undefined): void {
    if (next === undefined) delete this.env.data.values[field.id];
    else this.env.data.values[field.id] = next;
    this.commit();
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.snapshots.schedule();
  }

  // ---- snapshot + downloads ----

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS + CANVAS_CSS, this.theme.background, (svg) =>
      this.cb.onSnapshot!(svg)
    );
  }

  private downloadSvg(): void {
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS + CANVAS_CSS, this.theme.background, (svg) =>
      saveSvg(svg, "canvas.svg")
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + CAPTURE_CSS + CANVAS_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "canvas.png";
      link.click();
    });
  }
}
