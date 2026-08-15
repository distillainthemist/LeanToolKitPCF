// The CanvasCard editor — display-first: every field renders its VALUE as
// styled content; interacting swaps in an inline editor (typing types),
// acts directly (yes/no, rating, checklist ticks) or opens a picker
// (C3 — openPicker is the seam). Display-first is what keeps the tile
// snapshots true: htmlToSvg serialises the DOM, and live input state
// would vanish from it.

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { hintFor, parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { nowIso } from "../../shared/schema/id";
import { initialsFor } from "../../shared/schema/people";
import { renderCaptureCellInto } from "../CaptureCard/fields";
import { CAPTURE_CSS } from "../CaptureCard/styles";
import {
  CanvasConfig,
  CanvasEnvelope,
  CanvasField,
  CanvasValue,
  clampPercent,
  clampRating,
  dateLabel,
  isEmptyValue,
  missingRequired,
  rangeLabel,
  sanitizeRichText,
  SCHEMA_ID,
  vBool,
  vChecklist,
  vNumber,
  vPeople,
  vRange,
  vRows,
  vString,
  vStrings,
} from "./types";
import { CANVAS_CSS } from "./styles";

export interface CanvasEditorCallbacks {
  onChange: (env: CanvasEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
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
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
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

  /** Render a field's DISPLAY state into `area`. */
  private paintDisplay(
    area: HTMLElement,
    field: CanvasField,
    value: CanvasValue | undefined
  ): void {
    clear(area);
    const hint = hintFor(this.prompts, field.id, field.hint);
    const empty = (): void => {
      area.appendChild(el("span", "ltk-cv-empty", hint !== "" ? hint : "—"));
    };

    switch (field.type) {
      case "text":
      case "number":
      case "decimal": {
        const s =
          field.type === "text" ? vString(value) : (vNumber(value)?.toString() ?? "");
        if (s === "") return empty();
        area.appendChild(el("span", undefined, s));
        return;
      }
      case "longtext": {
        const s = vString(value);
        if (s.trim() === "") return empty();
        area.appendChild(el("div", "ltk-cv-pre", s));
        return;
      }
      case "richtext": {
        const html = sanitizeRichText(vString(value));
        if (html.replace(/<[^>]*>/g, "").trim() === "") return empty();
        const rich = el("div", "ltk-cv-rich");
        rich.innerHTML = html; // sanitised on render — never trusted stored
        area.appendChild(rich);
        return;
      }
      case "date": {
        const s = vString(value);
        if (s === "") return empty();
        area.appendChild(el("span", undefined, dateLabel(s)));
        return;
      }
      case "daterange": {
        const s = rangeLabel(vRange(value));
        if (s === "") return empty();
        area.appendChild(el("span", undefined, s));
        return;
      }
      case "percent": {
        const n = vNumber(value);
        if (n === undefined) return empty();
        const bar = el("div", "ltk-cv-bar");
        const track = el("div", "ltk-cv-bar-track");
        const fill = el("div", "ltk-cv-bar-fill");
        fill.style.width = `${clampPercent(n)}%`;
        track.appendChild(fill);
        bar.appendChild(track);
        bar.appendChild(el("span", undefined, `${clampPercent(n)}%`));
        area.appendChild(bar);
        return;
      }
      case "rating": {
        const n = clampRating(vNumber(value) ?? 0);
        const stars = el("div", "ltk-cv-stars");
        for (let k = 1; k <= 5; k++) {
          const star = el(
            "span",
            "ltk-cv-star" + (k <= n ? " ltk-cv-star-on" : ""),
            k <= n ? "★" : "☆"
          );
          if (!this.readOnly) {
            star.addEventListener("click", (e) => {
              e.stopPropagation();
              // tapping the current rating again clears it
              this.commitValue(field, k === n ? undefined : k);
            });
          }
          stars.appendChild(star);
        }
        area.appendChild(stars);
        return;
      }
      case "url": {
        const s = vString(value);
        if (s === "") return empty();
        const row = el("div", "ltk-cv-url");
        const a = el("a", undefined, s) as HTMLAnchorElement;
        if (/^https?:\/\//i.test(s)) {
          a.href = s;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.addEventListener("click", (e) => e.stopPropagation()); // open, don't edit
        }
        row.appendChild(a);
        area.appendChild(row);
        return;
      }
      case "yesno": {
        if (value === undefined) return empty();
        area.appendChild(
          el("span", "ltk-cv-yes", vBool(value) ? "✓ Yes" : "— No")
        );
        return;
      }
      case "choice":
      case "multichoice": {
        const picked = vStrings(value);
        if (picked.length === 0) return empty();
        // the capture chip renderer paints icons/labels from the options
        renderCaptureCellInto(
          area,
          {
            key: field.id,
            label: field.label,
            type: "list",
            multi: field.type === "multichoice",
            parent: "",
            options: field.options,
          },
          picked.length === 1 && field.type === "choice" ? picked[0] : picked
        );
        return;
      }
      case "status": {
        const key = vString(value);
        if (key === "") return empty();
        const color = this.palette[key] ?? "";
        const chip = el("span", "ltk-cv-status", statusLabel(key));
        if (color !== "") {
          chip.style.background = color;
          chip.style.color = textOn(color);
        }
        area.appendChild(chip);
        return;
      }
      case "person":
      case "people": {
        const people = vPeople(value);
        if (people.length === 0) return empty();
        for (const p of people) {
          const chip = el("span", "ltk-cv-person");
          chip.appendChild(el("span", "ltk-cv-person-dot", initialsFor(p.name)));
          chip.appendChild(el("span", undefined, p.name));
          area.appendChild(chip);
        }
        return;
      }
      case "checklist": {
        const items = vChecklist(value);
        if (items.length === 0) return empty();
        const list = el("div", "ltk-cv-check");
        items.forEach((item, i) => {
          const row = el(
            "div",
            "ltk-cv-check-item" + (item.done ? " ltk-cv-check-done" : "")
          );
          row.appendChild(el("span", "ltk-cv-check-box", item.done ? "☑" : "☐"));
          row.appendChild(el("span", "ltk-cv-check-text", item.text));
          if (!this.readOnly) {
            row.addEventListener("click", (e) => {
              e.stopPropagation();
              const next = items.map((it, j) =>
                j === i ? { text: it.text, done: !it.done } : it
              );
              this.commitValue(field, next);
            });
          }
          list.appendChild(row);
        });
        area.appendChild(list);
        return;
      }
      case "minitable": {
        const rows = vRows(value);
        if (rows.length === 0) return empty();
        const wrap = el("div", "ltk-cv-mini");
        const table = el("table", "ltk-cc-table");
        const thead = el("thead");
        const hr = el("tr");
        for (const col of field.columns) hr.appendChild(el("th", undefined, col.label));
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const row of rows) {
          const tr = el("tr");
          for (const col of field.columns) {
            const td = el("td");
            renderCaptureCellInto(td, col, row.cells[col.key]);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        area.appendChild(wrap);
        return;
      }
      case "image": {
        const src = vString(value);
        if (!src.startsWith("data:image/")) return empty();
        const img = el("img", "ltk-cv-img") as HTMLImageElement;
        img.src = src;
        img.alt = field.label;
        area.appendChild(img);
        return;
      }
      default:
        return empty();
    }
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

  /** C3's seam: choice/people/status/richtext/checklist/minitable/image. */
  protected openPicker(field: CanvasField): void {
    void field;
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

/** A palette key as a human label ("at_risk" → "At risk") — the mount's
 *  palette is key→colour only; keys are slugs of the site's own labels. */
function statusLabel(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s === "" ? key : s[0].toUpperCase() + s.slice(1);
}
