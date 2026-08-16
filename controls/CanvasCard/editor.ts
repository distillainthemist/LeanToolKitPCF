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
import { buildCaptureField, optionChip, readFields } from "../CaptureCard/fields";
import { CaptureRow } from "../CaptureCard/types";
import { canvasFieldDialog } from "./fieldDialog";
import { paintCanvasValue } from "./display";
import { CAPTURE_CSS } from "../CaptureCard/styles";
import {
  CANVAS_TYPE_GLYPH,
  CANVAS_TYPE_LABEL,
  CanvasConfig,
  CanvasEnvelope,
  CanvasField,
  CanvasValue,
  clampPercent,
  DEFAULT_H,
  isEmptyValue,
  missingRequired,
  GridLayout,
  Placement,
  placeFields,
  SCHEMA_ID,
  vBool,
  vNumber,
  vRange,
  vRows,
  vString,
} from "./types";
import { CANVAS_CSS, CANVAS_STEP } from "./styles";

export interface CanvasEditorCallbacks {
  onChange: (env: CanvasEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
  /** Card-level actions (the plan's decision 6): the mounter opens the
   *  standard action manager. Present = an "Actions…" kebab entry. */
  onManageActions?: () => void;
  /**
   * Design mode (studio only): the layout changed on the canvas — the
   * mounter forwards it as a config patch (canvasJSON) to the studio's
   * draft. Never fires outside design mode.
   */
  onLayoutChange?: (config: CanvasConfig) => void;
  /** Design mode: the selected field changed (null = cleared) — the
   *  selection bridge, card → inspector. */
  onSelectField?: (id: string | null) => void;
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
  /** Studio-only: the card is THE layout editor (canvas plan D0–D2). */
  private designMode = false;
  private selectedField: string | null = null;
  /** Design mode: temporarily show the runtime look. */
  private previewing = false;
  /** Design mode: gridlines + empty cells. */
  private gridOn = true;
  /** The last render's placement + grid element (gesture geometry). */
  private layout: GridLayout = { placements: [], rows: 0, empty: [] };
  private gridEl: HTMLElement | null = null;
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

  /**
   * Studio-only design mode: the canvas becomes the layout editor (grid
   * affordance, type-true skeletons, selection, drag/resize — D1/D2) and
   * layout edits flow back through onLayoutChange. Runtime never sets it.
   */
  setDesignMode(on: boolean): void {
    if (this.designMode === on) return;
    this.designMode = on;
    if (!on) {
      this.selectedField = null;
      this.previewing = false;
    }
    this.render();
  }

  /** Selection bridge, inspector → card. */
  selectField(id: string | null): void {
    if (id === this.selectedField) return;
    this.selectedField = id;
    if (this.designMode) this.render();
  }

  /** The card's own selection changes go out through the bridge. */
  private setSelected(id: string | null): void {
    if (id === this.selectedField) return;
    this.selectedField = id;
    this.render();
    this.cb.onSelectField?.(id);
  }

  /** Design mode: apply a layout change locally, repaint, push it up. */
  private commitLayout(next: CanvasConfig): void {
    this.config = next;
    this.render();
    this.cb.onLayoutChange?.(next);
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

  /** Design mode without preview = the layout editor's own rendering. */
  private designing(): boolean {
    return this.designMode && !this.previewing;
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    if (this.readOnly) this.root.classList.add("ltk-readonly");
    else this.root.classList.remove("ltk-readonly");
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (this.designMode) {
      this.renderToolbar();
    } else if (!this.readOnly) {
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

    if (!this.designing()) {
      const missing = missingRequired(this.config.fields, this.env.data.values);
      if (missing.length > 0) {
        const banner = el("div", "ltk-cv-banner");
        banner.appendChild(el("b", undefined, `${missing.length} to complete`));
        banner.appendChild(
          document.createTextNode(` — ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`)
        );
        body.appendChild(banner);
      }
    }

    const grid = el("div", "ltk-cv-grid");
    grid.style.gridTemplateColumns = `repeat(${this.config.cols}, 1fr)`;
    if (this.designing() && this.gridOn) grid.classList.add("ltk-cv-gridon");
    body.appendChild(grid);
    if (this.designing()) {
      // clicking empty canvas clears the selection
      body.addEventListener("click", () => this.setSelected(null));
    }

    if (this.config.fields.length === 0 && !this.designing()) {
      grid.style.gridTemplateColumns = "1fr";
      const ghost = el(
        "div",
        "ltk-cv-empty",
        "No fields yet — design the layout in this card's settings."
      );
      ghost.style.gridColumn = "1 / -1";
      grid.appendChild(ghost);
    }

    // explicit placement in BOTH modes — design and run agree by construction
    const layout = placeFields(this.config.cols, this.config.fields);
    const at = new Map(layout.placements.map((p) => [p.id, p]));
    this.layout = layout;
    this.gridEl = grid;
    for (const field of this.config.fields) {
      grid.appendChild(this.renderField(field, at.get(field.id)));
    }
    if (this.designing()) {
      if (this.gridOn) {
        for (const cell of layout.empty) {
          const e = el("div", "ltk-cv-emptycell");
          e.style.gridRow = `${cell.r + 1} / span 1`;
          e.style.gridColumn = `${cell.c + 1} / span 1`;
          grid.appendChild(e);
        }
      }
      // the permanent last row: the drop target + Add field
      const zone = el("div", "ltk-cv-dropzone");
      zone.style.gridRow = `${layout.rows + 1} / span 1`;
      zone.appendChild(el("span", undefined, "Drop a field here"));
      zone.appendChild(el("span", "ltk-cv-toolbar-label", "·"));
      const add = el("button", "ltk-cv-dropzone-add", "＋ Add field") as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        this.addField();
      });
      zone.appendChild(add);
      zone.addEventListener("click", (e) => {
        e.stopPropagation();
        this.addField();
      });
      grid.appendChild(zone);
    }
    this.applyNarrow();
  }

  /** The design-mode toolbar (replaces the kebab): columns, grid, preview.
   *  Undo/redo live in the studio head beside the pane — the studio owns
   *  the stack. */
  private renderToolbar(): void {
    const bar = el("div", "ltk-cv-toolbar");
    bar.appendChild(el("span", "ltk-cv-toolbar-label", "Columns"));
    const seg = el("div", "ltk-cv-seg");
    for (const n of [1, 2, 3] as const) {
      const b = el(
        "button",
        "ltk-cv-seg-btn" + (this.config.cols === n ? " ltk-cv-seg-on" : ""),
        String(n)
      ) as HTMLButtonElement;
      b.type = "button";
      b.disabled = this.previewing;
      b.addEventListener("click", () => {
        if (this.config.cols === n) return;
        this.commitLayout({
          cols: n,
          fields: this.config.fields.map((f) => ({ ...f, w: Math.min(f.w, n) })),
        });
      });
      seg.appendChild(b);
    }
    bar.appendChild(seg);

    const grid = el("button", "ltk-cv-toolbtn" + (this.gridOn ? " ltk-cv-toolbtn-on" : ""), "⊞ Grid") as HTMLButtonElement;
    grid.type = "button";
    grid.title = "Show gridlines and empty cells";
    grid.disabled = this.previewing;
    grid.addEventListener("click", () => {
      this.gridOn = !this.gridOn;
      this.render();
    });
    bar.appendChild(grid);

    bar.appendChild(el("span", "ltk-cv-toolbar-spacer"));
    const preview = el("button", "ltk-cv-toolbtn" + (this.previewing ? " ltk-cv-toolbtn-on" : ""), this.previewing ? "✎ Design" : "▷ Preview") as HTMLButtonElement;
    preview.type = "button";
    preview.title = this.previewing ? "Back to designing the layout" : "See the card as people will fill it in";
    preview.addEventListener("click", () => {
      this.previewing = !this.previewing;
      this.render();
    });
    bar.appendChild(preview);
    this.root.appendChild(bar);
  }

  /** Design mode: append a new text field, select it (the inspector's
   *  bridge scrolls to — and focuses — its block). */
  private addField(): void {
    const taken = new Set(this.config.fields.map((f) => f.id));
    let n = this.config.fields.length + 1;
    let id = `field_${n}`;
    while (taken.has(id)) id = `field_${++n}`;
    const field: CanvasField = {
      id,
      type: "text",
      label: "",
      w: 1,
      h: DEFAULT_H.text,
      hint: "",
      required: false,
      options: [],
      columns: [],
    };
    this.commitLayout({ ...this.config, fields: [...this.config.fields, field] });
    this.setSelected(id);
  }

  private renderField(field: CanvasField, place: Placement | undefined): HTMLElement {
    const box = el("div", "ltk-cv-field");
    const w = Math.min(field.w, this.config.cols);
    if (place) {
      box.style.gridColumn = `${place.c + 1} / span ${w}`;
      box.style.gridRow = `${place.r + 1} / span ${field.h}`;
    } else {
      box.style.gridColumn = `span ${w}`;
      box.style.gridRow = `span ${field.h}`;
    }
    box.style.setProperty("--h", String(field.h));
    if (field.h === 1) box.classList.add("ltk-cv-h1");
    box.dataset.fieldId = field.id;

    const designing = this.designing();
    // design mode: the field is a selectable layout object (D2 adds the
    // drag/resize handles on top of this)
    if (designing) {
      box.classList.add("ltk-cv-designable");
      if (field.id === this.selectedField) {
        box.classList.add("ltk-cv-selected");
        const readout = el("span", "ltk-cv-readout", `${w} × ${field.h}`);
        box.appendChild(readout);
        // direct manipulation (D2): ⋮⋮ moves, edges/corner resize
        const drag = el("span", "ltk-cv-drag", "⋮⋮");
        drag.title = "Drag to move";
        box.appendChild(drag);
        this.attachMove(drag, box, field);
        if (place) {
          for (const dir of ["e", "s", "se"] as const) {
            const hnd = el("span", `ltk-cv-rs ltk-cv-rs-${dir}`);
            hnd.title = dir === "e" ? "Drag to change width" : dir === "s" ? "Drag to change height" : "Drag to resize";
            box.appendChild(hnd);
            this.attachResize(hnd, box, field, place, dir, readout);
          }
        }
      }
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setSelected(field.id);
      });
    }

    if (field.type === "heading") {
      box.classList.add("ltk-cv-field-heading");
      const text = el("div", "ltk-cv-heading-text");
      if (designing) text.appendChild(el("span", "ltk-cv-glyph", CANVAS_TYPE_GLYPH.heading));
      text.appendChild(el("span", undefined, field.label !== "" ? field.label : designing ? "Heading" : ""));
      box.appendChild(text);
      return box;
    }

    const value = this.env.data.values[field.id];
    const label = el("div", "ltk-cv-label");
    if (designing) label.appendChild(el("span", "ltk-cv-glyph", CANVAS_TYPE_GLYPH[field.type]));
    label.appendChild(
      el("span", undefined, field.label !== "" ? field.label : designing ? "Untitled field" : "")
    );
    // required renders at BOTH times — the one property with real consequence
    if (field.required) label.appendChild(el("span", "ltk-cv-req", "✱"));
    if (!designing && field.required && isEmptyValue(field.type, value)) {
      label.appendChild(el("span", "ltk-cv-needed", "· needed"));
    }
    box.appendChild(label);

    const area = el("div", "ltk-cv-value");
    box.appendChild(area);

    if (designing) {
      // build mode: a field advertises its TYPE, not its emptiness
      this.paintSkeleton(area, field);
      return box;
    }

    this.paintDisplay(area, field, value);
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

  // ---- direct manipulation (design mode, D2) ----

  /** The grid's cell geometry: column pitch and row pitch in px, from the
   *  live element (the gap is CANVAS_STEP's sibling: 8px). */
  private cellGeometry(): { left: number; top: number; colPitch: number; rowPitch: number } | null {
    if (!this.gridEl) return null;
    const rect = this.gridEl.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const gap = 8;
    return {
      left: rect.left,
      top: rect.top,
      colPitch: (rect.width + gap) / this.config.cols,
      rowPitch: CANVAS_STEP + gap,
    };
  }

  /** ⋮⋮: pointer-drag reorders (the model is a flow grid — a move IS a
   *  reorder). An insertion marker shows where the field will land. */
  private attachMove(handle: HTMLElement, box: HTMLElement, field: CanvasField): void {
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      down.stopPropagation();
      handle.setPointerCapture(down.pointerId);
      const others = this.config.fields.filter((f) => f.id !== field.id);
      let target: { index: number; markEl: HTMLElement | null; side: "before" | "after" | "zone" } | null = null;
      let cancelled = false;
      box.classList.add("ltk-cv-dragging");

      const clearMarks = () => {
        this.gridEl
          ?.querySelectorAll(".ltk-cv-drop-before, .ltk-cv-drop-after, .ltk-cv-dropzone-on")
          .forEach((e) => e.classList.remove("ltk-cv-drop-before", "ltk-cv-drop-after", "ltk-cv-dropzone-on"));
      };

      const onMove = (ev: PointerEvent) => {
        const g = this.cellGeometry();
        if (!g || !this.gridEl) return;
        clearMarks();
        const c = Math.max(0, Math.min(this.config.cols - 1, Math.floor((ev.clientX - g.left) / g.colPitch)));
        const r = Math.floor((ev.clientY - g.top) / g.rowPitch);
        const zone = this.gridEl.querySelector<HTMLElement>(".ltk-cv-dropzone");
        // past the last row (or on the drop zone itself) → the end
        if (r >= this.layout.rows) {
          target = { index: others.length, markEl: zone, side: "zone" };
          zone?.classList.add("ltk-cv-dropzone-on");
          return;
        }
        const covering = this.layout.placements.find(
          (p) => p.id !== field.id && r >= p.r && r < p.r + p.h && c >= p.c && c < p.c + p.w
        );
        if (covering) {
          const el2 = this.gridEl.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(covering.id)}"]`);
          const rect = el2?.getBoundingClientRect();
          const before = rect ? ev.clientX < rect.left + rect.width / 2 : true;
          const idx = others.findIndex((f) => f.id === covering.id);
          target = { index: idx + (before ? 0 : 1), markEl: el2, side: before ? "before" : "after" };
          el2?.classList.add(before ? "ltk-cv-drop-before" : "ltk-cv-drop-after");
          return;
        }
        // an empty cell: after the last field that sits row-major before it
        let last: Placement | null = null;
        for (const p of this.layout.placements) {
          if (p.id === field.id) continue;
          if (p.r < r || (p.r === r && p.c < c)) {
            if (!last || p.r > last.r || (p.r === last.r && p.c > last.c)) last = p;
          }
        }
        if (!last) {
          target = { index: 0, markEl: null, side: "before" };
          const first = this.gridEl.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(others[0]?.id ?? "")}"]`);
          first?.classList.add("ltk-cv-drop-before");
          return;
        }
        const el2 = this.gridEl.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(last.id)}"]`);
        const idx = others.findIndex((f) => f.id === last!.id);
        target = { index: idx + 1, markEl: el2, side: "after" };
        el2?.classList.add("ltk-cv-drop-after");
      };
      const finish = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        clearMarks();
        box.classList.remove("ltk-cv-dragging");
      };
      const onUp = () => {
        finish();
        if (cancelled || !target) return;
        const next = others.slice();
        next.splice(Math.max(0, Math.min(next.length, target.index)), 0, field);
        if (next.map((f) => f.id).join("|") === this.config.fields.map((f) => f.id).join("|")) return;
        this.commitLayout({ ...this.config, fields: next });
      };
      const onCancel = () => {
        cancelled = true;
        finish();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    });
  }

  /** Edge/corner handles: width snaps to column boundaries, height to
   *  steps; the readout follows live; the change commits on release. */
  private attachResize(
    handle: HTMLElement,
    box: HTMLElement,
    field: CanvasField,
    place: Placement,
    dir: "e" | "s" | "se",
    readout: HTMLElement
  ): void {
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      down.stopPropagation();
      handle.setPointerCapture(down.pointerId);
      const startW = Math.min(field.w, this.config.cols);
      const startH = field.h;
      let w = startW;
      let h = startH;
      let cancelled = false;
      const boxRect = box.getBoundingClientRect();
      const g = this.cellGeometry();
      box.classList.add("ltk-cv-resizing");

      const onMove = (ev: PointerEvent) => {
        if (!g) return;
        if (dir !== "s") {
          const raw = Math.round((ev.clientX - boxRect.left + 4) / g.colPitch);
          w = Math.max(1, Math.min(this.config.cols - place.c, raw));
        }
        if (dir !== "e") {
          const raw = Math.round((ev.clientY - boxRect.top + 4) / g.rowPitch);
          h = Math.max(1, Math.min(8, raw));
        }
        box.style.gridColumn = `${place.c + 1} / span ${w}`;
        box.style.gridRow = `${place.r + 1} / span ${h}`;
        readout.textContent = `${w} × ${h}`;
      };
      const finish = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        box.classList.remove("ltk-cv-resizing");
      };
      const onUp = () => {
        finish();
        if (cancelled) {
          this.render();
          return;
        }
        if (w === startW && h === startH) return;
        this.commitLayout({
          ...this.config,
          fields: this.config.fields.map((f) => (f.id === field.id ? { ...f, w, h } : f)),
        });
      };
      const onCancel = () => {
        cancelled = true;
        finish();
        this.render();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    });
  }

  /** The type-true skeleton a field wears in build mode: what KIND of
   *  thing goes here, at its honest height. */
  private paintSkeleton(area: HTMLElement, field: CanvasField): void {
    const caption = (text: string) => {
      const hint = field.hint.trim();
      return hint !== "" ? `${text} · “${hint}”` : text;
    };
    switch (field.type) {
      case "choice":
      case "multichoice": {
        const box = el("div", "ltk-cv-skel");
        if (field.options.length === 0) {
          box.appendChild(el("span", undefined, caption(`${CANVAS_TYPE_LABEL[field.type]} · no options yet`)));
        } else {
          for (const o of field.options.slice(0, 6)) {
            box.appendChild(optionChip(o, o.value));
          }
          if (field.options.length > 6) box.appendChild(el("span", undefined, `+${field.options.length - 6}`));
        }
        area.appendChild(box);
        return;
      }
      case "status": {
        const box = el("div", "ltk-cv-skel ltk-cv-skel-line");
        const chip = el("span", "ltk-cv-status", "Status");
        chip.style.background = "var(--ltk-hairline)";
        box.appendChild(chip);
        box.appendChild(el("span", undefined, "from the app palette"));
        area.appendChild(box);
        return;
      }
      case "rating": {
        const box = el("div", "ltk-cv-skel ltk-cv-skel-line");
        box.appendChild(el("span", "ltk-cv-stars", "☆☆☆☆☆"));
        area.appendChild(box);
        return;
      }
      case "yesno": {
        area.appendChild(el("div", "ltk-cv-skel ltk-cv-skel-line", caption("☐ Yes / no")));
        return;
      }
      case "checklist": {
        const box = el("div", "ltk-cv-skel");
        box.appendChild(el("span", undefined, caption("☐ Checklist")));
        area.appendChild(box);
        return;
      }
      case "minitable": {
        // the configured column headers with — cells: the layout preview
        // CAN show layout
        const wrap = el("div", "ltk-cv-mini ltk-cv-skel");
        const table = el("table", "ltk-cc-table");
        const thead = el("thead");
        const hr = el("tr");
        for (const col of field.columns) hr.appendChild(el("th", undefined, col.label));
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = el("tbody");
        const tr = el("tr");
        for (const _ of field.columns) tr.appendChild(el("td", "ltk-cc-empty", "—"));
        tbody.appendChild(tr);
        table.appendChild(tbody);
        wrap.appendChild(table);
        area.appendChild(wrap);
        return;
      }
      case "person":
      case "people":
        area.appendChild(el("div", "ltk-cv-skel ltk-cv-skel-line", caption(field.type === "person" ? "Person picker" : "People picker")));
        return;
      case "percent": {
        const box = el("div", "ltk-cv-skel ltk-cv-skel-line");
        const bar = el("div", "ltk-cv-bar");
        bar.style.width = "100%";
        const track = el("div", "ltk-cv-bar-track");
        track.appendChild(el("div", "ltk-cv-bar-fill"));
        bar.appendChild(track);
        bar.appendChild(el("span", undefined, "%"));
        box.appendChild(bar);
        area.appendChild(box);
        return;
      }
      case "image":
        area.appendChild(el("div", "ltk-cv-skel", caption("▣ Image")));
        return;
      case "longtext":
      case "richtext":
        area.appendChild(el("div", "ltk-cv-skel", caption(CANVAS_TYPE_LABEL[field.type])));
        return;
      default:
        area.appendChild(el("div", "ltk-cv-skel ltk-cv-skel-line", caption(CANVAS_TYPE_LABEL[field.type])));
        return;
    }
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
