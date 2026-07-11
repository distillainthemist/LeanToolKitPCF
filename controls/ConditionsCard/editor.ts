// The ConditionsCard editor: winning conditions down the side, a rolling
// window of columns ending today across the top. Tap a cell to cycle
// unset → good → issue; hold to raise an action. At shift grain each cell is
// split diagonally (day ◤ / night ◢). The conditions list and its prompts
// are input-driven; tiles scale to fill the box. Shares the SQDPC visual
// language.

import { applyThemeVars, defaultTheme, textOn, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  buildPeriods,
  Condition,
  ConditionsEnvelope,
  DEFAULT_CONDITIONS,
  Granularity,
  Period,
  Rating,
  SCHEMA_ID,
} from "./types";
import { CONDITIONS_CSS } from "./styles";

export interface ConditionsOptions {
  granularity: Granularity;
  conditions: Condition[];
}

export interface ConditionsEditorCallbacks {
  onChange: (env: ConditionsEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

const LABEL_COL = 168; // px reserved for the conditions column

export class ConditionsEditor {
  private readonly root: HTMLElement;
  private env: ConditionsEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private granularity: Granularity = "day";
  private conditions: Condition[] = DEFAULT_CONDITIONS.map((name) => ({
    name,
    prompt: "",
  }));
  private readonly png: SnapshotScheduler;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: ConditionsEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-conditions-css", CONDITIONS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { ratings: {} },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    // scale the tiles to fill the box whenever it resizes
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applyTileSize());
      this.resizeObserver.observe(this.root);
    }
    this.render();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setEnvelope(env: ConditionsEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  setOptions(opts: ConditionsOptions): void {
    if (
      opts.granularity === this.granularity &&
      JSON.stringify(opts.conditions) === JSON.stringify(this.conditions)
    ) {
      return;
    }
    this.granularity = opts.granularity;
    this.conditions = opts.conditions;
    this.render();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setPeople(people: Person[]): void {
    this.people = people;
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
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.root.remove();
  }

  // ---- helpers ----

  private goodColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }
  private issueColor(): string {
    return this.theme.legend[2] ?? "#d13438";
  }
  private unratedTint(): string {
    return tint(this.theme.foreground, 0.97);
  }
  private colorOf(rating: Rating | undefined): string | null {
    if (rating === "good") return this.goodColor();
    if (rating === "issue") return this.issueColor();
    return null;
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

    const body = el("div", "ltk-cn-body");
    this.root.appendChild(body);

    const periods = buildPeriods(this.granularity);
    const n = periods.length;

    const grid = el("div", "ltk-cn-grid");
    grid.style.gridTemplateColumns = `${LABEL_COL}px repeat(${n}, var(--cn-tile-w, 40px))`;
    grid.style.gridTemplateRows = "auto";
    grid.style.gridAutoRows = "var(--cn-tile-h, 40px)";

    // header row: an empty corner, then a two-line label per period
    grid.appendChild(el("div"));
    for (const p of periods) {
      const head = el("div", "ltk-cn-daylabel");
      if (p.isToday) head.classList.add("ltk-cn-today");
      head.appendChild(el("div", "ltk-cn-dl-top", p.top));
      head.appendChild(el("div", "ltk-cn-dl-date", p.bottom));
      grid.appendChild(head);
    }

    // one row per condition: the label (with its prompt), then a cell per period
    for (const cond of this.conditions) {
      const label = el("div", "ltk-cn-cond");
      label.appendChild(el("div", "ltk-cn-cond-name", cond.name));
      if (cond.prompt) {
        label.appendChild(el("div", "ltk-cn-cond-prompt", cond.prompt));
      }
      grid.appendChild(label);

      for (const p of periods) {
        grid.appendChild(this.renderCell(cond.name, p));
      }
    }
    body.appendChild(grid);

    const legend = el("div", "ltk-cn-legend");
    legend.appendChild(this.swatchItem(this.goodColor(), "Good"));
    legend.appendChild(this.swatchItem(this.issueColor(), "Issue"));
    if (!this.readOnly) {
      legend.appendChild(
        el(
          "span",
          "ltk-cn-hint",
          this.granularity === "shift"
            ? "Tap a half to cycle (day ◤ / night ◢) · hold to raise an action"
            : "Tap to cycle · hold to raise an action"
        )
      );
    }
    body.appendChild(legend);

    this.applyTileSize();
  }

  private swatchItem(color: string, label: string): HTMLElement {
    const item = el("span", "ltk-cn-legend-item");
    const swatch = el("span", "ltk-cn-swatch");
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(label));
    return item;
  }

  private renderCell(cond: string, period: Period): HTMLElement {
    if (this.granularity === "shift") return this.renderShiftCell(cond, period);

    const key = `${cond}|${period.key}`;
    const cell = el("div", "ltk-cn-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    if (period.isToday) cell.classList.add("ltk-cn-todaycol");
    const rating = this.env.data.ratings[key];
    cell.style.background = this.colorOf(rating) ?? this.unratedTint();
    cell.title =
      `${cond} · ${period.title}` +
      (rating ? ` — ${rating === "good" ? "Good" : "Issue"}` : "");

    if (!this.readOnly) {
      makeInteractive(cell, {
        onTap: () => this.cycle(key),
        onLongPress: () => this.raiseAction(key, `${cond} · ${period.title}`),
      });
    }
    return cell;
  }

  /** Shift cell: diagonal split, day shift ◤ top-left, night ◢ bottom-right. */
  private renderShiftCell(cond: string, period: Period): HTMLElement {
    const keyD = `${cond}|${period.key}|D`;
    const keyN = `${cond}|${period.key}|N`;
    const cell = el("div", "ltk-cn-cell ltk-cn-shift");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    if (period.isToday) cell.classList.add("ltk-cn-todaycol");
    const cD = this.colorOf(this.env.data.ratings[keyD]) ?? this.unratedTint();
    const cN = this.colorOf(this.env.data.ratings[keyN]) ?? this.unratedTint();
    // "to bottom right" splits corner-to-corner (top-right → bottom-left) for
    // any aspect ratio, so the diagonal stays true when cells are rectangular
    // and matches the tap-half test below (x/w + y/h < 1 → the day ◤ side).
    cell.style.background = `linear-gradient(to bottom right, ${cD} 0 50%, ${cN} 50% 100%)`;
    cell.title =
      `${cond} · ${period.title}\n` +
      `Day ◤: ${this.ratingLabel(keyD)} · Night ◢: ${this.ratingLabel(keyN)}`;

    const halfOf = (e: PointerEvent): "D" | "N" => {
      const r = cell.getBoundingClientRect();
      const rel =
        (e.clientX - r.left) / Math.max(1, r.width) +
        (e.clientY - r.top) / Math.max(1, r.height);
      return rel < 1 ? "D" : "N";
    };
    if (!this.readOnly) {
      makeInteractive(cell, {
        onTap: (e) => this.cycle(halfOf(e) === "D" ? keyD : keyN),
        onLongPress: (e) => {
          const half = halfOf(e);
          this.raiseAction(
            half === "D" ? keyD : keyN,
            `${cond} · ${period.title} (${half === "D" ? "Day" : "Night"} shift)`
          );
        },
      });
    }
    return cell;
  }

  private ratingLabel(key: string): string {
    const r = this.env.data.ratings[key];
    return r === "good" ? "Good" : r === "issue" ? "Issue" : "—";
  }

  /** unset → good → issue → unset */
  private cycle(key: string): void {
    const cur = this.env.data.ratings[key];
    if (cur === undefined) this.env.data.ratings[key] = "good";
    else if (cur === "good") this.env.data.ratings[key] = "issue";
    else delete this.env.data.ratings[key];
    this.commit();
  }

  /**
   * Size the cells so the grid fills the box. Width and height are computed
   * independently — the conditions expand to fill the container's height, so
   * cells become rectangles (not squares) when there are several conditions.
   * Sets --cn-tile-w / --cn-tile-h CSS vars the grid reads.
   */
  private applyTileSize(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w <= 0 || h <= 0) return;

    const GAP = 3;
    const n = buildPeriods(this.granularity).length;
    const rows = Math.max(1, this.conditions.length);

    const availW = w - 24 - LABEL_COL - GAP * n; // body padding + label col + gaps
    const tileW = Math.max(20, Math.min(240, Math.floor(availW / n)));

    const chromeH =
      (this.cardTitle.trim() !== "" ? 36 : 6) + // titlebar
      40 + // header row (weekday + date)
      34 + // legend + its offset
      20; // body padding + gaps
    const availH = h - chromeH - GAP * rows;
    const tileH = Math.max(20, Math.min(240, Math.floor(availH / rows)));

    if (this.root.style.getPropertyValue("--cn-tile-w") !== `${tileW}px`) {
      this.root.style.setProperty("--cn-tile-w", `${tileW}px`);
    }
    if (this.root.style.getPropertyValue("--cn-tile-h") !== `${tileH}px`) {
      this.root.style.setProperty("--cn-tile-h", `${tileH}px`);
    }
  }

  // ---- mutations ----

  private raiseAction(sourceId: string, title: string): void {
    const action = newAction({ source: "conditions", sourceId });
    action.issue = title;
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: true,
      onCommit: () => {
        this.actions.push(action);
        this.commitActions();
      },
    });
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.emit();
  }

  private commitActions(): void {
    this.emit();
  }

  private emit(): void {
    this.render();
    this.cb.onChange(this.env, this.actions);
    this.png.schedule();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + CONDITIONS_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + CONDITIONS_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "conditions.png";
      link.click();
    });
  }
}
