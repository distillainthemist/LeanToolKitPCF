// The SqdpcCard editor: the classic letter-shaped month calendars — each
// dimension's days tile its own big letter (S, Q, D, P, C; unknown
// dimensions fall back to a captioned block). Tap a tile to cycle through
// the configured status codes; hold to raise an action (source "sqdpc").
// Two-shift granularity splits each tile diagonally (day ◤ / night ◢).

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
  currentMonth,
  DEFAULT_CODES,
  DEFAULT_DIMENSIONS,
  Granularity,
  isLetterShaped,
  monthDays,
  SqdpcEnvelope,
  StatusCode,
  SCHEMA_ID,
  templateFor,
  WEEKDAY_INITIALS,
} from "./types";
import { SQDPC_CSS } from "./styles";

export interface SqdpcOptions {
  granularity: Granularity;
  dimensions: string[];
  subtitles: string[];
  codes: StatusCode[];
}

export interface SqdpcEditorCallbacks {
  onChange: (env: SqdpcEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

export class SqdpcEditor {
  private readonly root: HTMLElement;
  private env: SqdpcEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private granularity: Granularity = "day";
  private dimensions: string[] = DEFAULT_DIMENSIONS.slice();
  private subtitles: string[] = [];
  private codes: StatusCode[] = DEFAULT_CODES.slice();
  private readonly png: SnapshotScheduler;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: SqdpcEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-sqdpc-css", SQDPC_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { month: currentMonth(), ratings: {} },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    // scale the letters to fill the box whenever it resizes
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applyTileSize());
      this.resizeObserver.observe(this.root);
    }
    this.render();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setEnvelope(env: SqdpcEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  setOptions(opts: SqdpcOptions): void {
    if (
      opts.granularity === this.granularity &&
      JSON.stringify(opts.dimensions) === JSON.stringify(this.dimensions) &&
      JSON.stringify(opts.subtitles) === JSON.stringify(this.subtitles) &&
      JSON.stringify(opts.codes) === JSON.stringify(this.codes)
    ) {
      return;
    }
    this.granularity = opts.granularity;
    this.dimensions = opts.dimensions;
    this.subtitles = opts.subtitles;
    this.codes = opts.codes;
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

  private codeFor(code: string | undefined): StatusCode | null {
    if (code === undefined) return null;
    return this.codes.find((c) => c.code === code) ?? null;
  }

  private unratedTint(): string {
    return tint(this.theme.foreground, 0.97);
  }

  /** unset → codes[0] → codes[1] → … → unset */
  private cycle(key: string): void {
    const current = this.env.data.ratings[key];
    const idx = this.codes.findIndex((c) => c.code === current);
    if (current === undefined || idx === -1) {
      this.env.data.ratings[key] = this.codes[0].code;
    } else if (idx + 1 < this.codes.length) {
      this.env.data.ratings[key] = this.codes[idx + 1].code;
    } else {
      delete this.env.data.ratings[key];
    }
    this.commit();
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

    const body = el("div", "ltk-sq-body");
    this.root.appendChild(body);

    // one letter panel per configured dimension (month is input-driven, no nav)
    const panels = el("div", "ltk-sq-panels");
    this.dimensions.forEach((dim, i) => {
      panels.appendChild(this.renderLetter(dim, this.subtitles[i] ?? ""));
    });
    body.appendChild(panels);

    // legend: the configured codes with their icons
    const legend = el("div", "ltk-sq-legend");
    for (const code of this.codes) {
      const item = el("span", "ltk-sq-legend-item");
      const swatch = el("span", "ltk-sq-swatch");
      swatch.style.background = code.color;
      item.appendChild(swatch);
      item.appendChild(
        el("span", undefined, code.icon !== "" ? `${code.icon} ${code.label}` : code.label)
      );
      legend.appendChild(item);
    }
    if (!this.readOnly) {
      legend.appendChild(
        el(
          "span",
          "ltk-sq-legend-hint",
          this.granularity === "shift2"
            ? "Tap a half to cycle (day ◤ / night ◢) · hold to raise an action"
            : "Tap to cycle · hold to raise an action"
        )
      );
    }
    body.appendChild(legend);

    this.applyTileSize();
  }

  /** One dimension's month as its letter shape, with an optional subtitle. */
  private renderLetter(dim: string, subtitle: string): HTMLElement {
    const panel = el("div", "ltk-sq-panel");
    const template = templateFor(dim);
    const cols = template[0].length;
    const days = monthDays(this.env.data.month, this.granularity === "weekday");

    // subtitle sits ABOVE the element; a shared band keeps every subtitle at
    // the same height (an empty spacer when this element has no subtitle, so
    // the letters below still align)
    const caption = subtitle !== "" ? subtitle : isLetterShaped(dim) ? "" : dim;
    const anyCaption =
      this.subtitles.some((s) => s !== "") ||
      this.dimensions.some((d) => !isLetterShaped(d));
    if (anyCaption) {
      panel.appendChild(el("div", "ltk-sq-caption", caption));
    }

    // grid wrapper centres the element vertically, so a shorter shape (the
    // cross) sits level with the taller letters
    const wrap = el("div", "ltk-sq-gridwrap");
    const grid = el("div", "ltk-sq-letter");
    grid.style.gridTemplateColumns = `repeat(${cols}, var(--sq-tile, 30px))`;

    let slot = 0;
    for (const row of template) {
      for (const ch of row) {
        if (ch !== "#") {
          grid.appendChild(el("div"));
          continue;
        }
        if (slot < days.length) {
          grid.appendChild(this.renderTile(dim, days[slot]));
        } else {
          // filler completes the letter shape past the month's last day
          grid.appendChild(el("div", "ltk-sq-tile ltk-sq-filler"));
        }
        slot++;
      }
    }
    wrap.appendChild(grid);
    panel.appendChild(wrap);
    return panel;
  }

  /**
   * Scale the tiles so the whole set of letters fills the box (limited by
   * width or height, whichever binds first). Sets a --sq-tile CSS var that
   * every grid and tile reads.
   */
  private applyTileSize(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w <= 0 || h <= 0) return;

    const GAP = 3;
    const PANEL_GAP = 24;
    const colsArr = this.dimensions.map((d) => templateFor(d)[0].length);
    const rowsArr = this.dimensions.map((d) => templateFor(d).length);
    const sumCols = colsArr.reduce((a, b) => a + b, 0) || 1;
    const sumColGaps = colsArr.reduce((a, c) => a + (c - 1), 0);
    const n = this.dimensions.length;
    const maxRows = Math.max(...rowsArr, 1);
    const hasCaption = this.subtitles.some((s) => s !== "");

    const availW = w - 24; // body horizontal padding
    const tileW =
      (availW - GAP * sumColGaps - PANEL_GAP * Math.max(0, n - 1)) / sumCols;

    const chromeH =
      (this.cardTitle.trim() !== "" ? 36 : 6) + // titlebar
      42 + // legend
      (hasCaption ? 26 : 0) + // subtitle band + margin
      18; // body padding + gaps
    const availH = h - chromeH;
    const tileH = (availH - GAP * (maxRows - 1)) / maxRows;

    const tile = Math.max(12, Math.min(88, Math.floor(Math.min(tileW, tileH))));
    if (this.root.style.getPropertyValue("--sq-tile") !== `${tile}px`) {
      this.root.style.setProperty("--sq-tile", `${tile}px`);
    }
  }

  private renderTile(dim: string, day: string): HTMLElement {
    const tile = el("div", "ltk-sq-tile");
    if (this.readOnly) tile.classList.add("ltk-readonly");
    const dayNum = String(Number(day.slice(8)));
    const weekday = WEEKDAY_INITIALS[new Date(day + "T00:00:00Z").getUTCDay()];

    if (this.granularity === "shift2") {
      return this.renderShiftTile(tile, dim, day, dayNum, weekday);
    }

    const key = `${dim}|${day}`;
    const rated = this.codeFor(this.env.data.ratings[key]);
    const unknown =
      this.env.data.ratings[key] !== undefined && rated === null;
    const bg = rated ? rated.color : unknown ? "#9b9b9b" : this.unratedTint();
    tile.style.background = bg;
    const fg = rated || unknown ? textOn(bg) : this.theme.foreground;

    const num = el("div", "ltk-sq-num", dayNum);
    num.style.color = fg;
    tile.appendChild(num);
    const sub = el(
      "div",
      "ltk-sq-sub",
      rated ? (rated.icon !== "" ? rated.icon : weekday) : unknown ? "?" : weekday
    );
    sub.style.color = fg;
    tile.appendChild(sub);

    tile.title =
      `${dim} · ${weekday} ${day}` +
      (rated ? ` — ${rated.label}` : unknown ? ` — ${this.env.data.ratings[key]}` : "");

    if (!this.readOnly) {
      makeInteractive(tile, {
        onTap: () => this.cycle(key),
        onLongPress: () => this.raiseAction(dim, day, ""),
      });
    }
    return tile;
  }

  /** Two-shift tile: diagonal split, day shift ◤ top-left, night ◢ bottom-right. */
  private renderShiftTile(
    tile: HTMLElement,
    dim: string,
    day: string,
    dayNum: string,
    weekday: string
  ): HTMLElement {
    const keyD = `${dim}|${day}|D`;
    const keyN = `${dim}|${day}|N`;
    const ratedD = this.codeFor(this.env.data.ratings[keyD]);
    const ratedN = this.codeFor(this.env.data.ratings[keyN]);
    const cD = ratedD ? ratedD.color : this.unratedTint();
    const cN = ratedN ? ratedN.color : this.unratedTint();
    tile.style.background = `linear-gradient(135deg, ${cD} 0%, ${cD} 50%, ${cN} 50%, ${cN} 100%)`;

    const anyRated = ratedD !== null || ratedN !== null;
    const num = el("div", "ltk-sq-num", dayNum);
    const sub = el("div", "ltk-sq-sub", weekday);
    if (anyRated) {
      num.classList.add("ltk-sq-halo");
      sub.classList.add("ltk-sq-halo");
      num.style.color = "#ffffff";
      sub.style.color = "#ffffff";
    } else {
      num.style.color = this.theme.foreground;
      sub.style.color = this.theme.foreground;
    }
    tile.append(num, sub);

    tile.title =
      `${dim} · ${weekday} ${day}\n` +
      `Day ◤: ${ratedD ? ratedD.label : "—"} · Night ◢: ${ratedN ? ratedN.label : "—"}`;

    const halfOf = (e: PointerEvent): "D" | "N" => {
      const r = tile.getBoundingClientRect();
      const rel =
        (e.clientX - r.left) / Math.max(1, r.width) +
        (e.clientY - r.top) / Math.max(1, r.height);
      return rel < 1 ? "D" : "N";
    };
    if (!this.readOnly) {
      makeInteractive(tile, {
        onTap: (e) => this.cycle(halfOf(e) === "D" ? keyD : keyN),
        onLongPress: (e) => this.raiseAction(dim, day, halfOf(e)),
      });
    }
    return tile;
  }

  // ---- mutations ----

  private raiseAction(dim: string, day: string, shift: string): void {
    const action = newAction({
      source: "sqdpc",
      sourceId: shift === "" ? `${dim}|${day}` : `${dim}|${day}|${shift}`,
      hint: dim,
    });
    action.issue = `${dim} — ${day}${shift !== "" ? ` (${shift === "D" ? "Day" : "Night"} shift)` : ""}`;
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
    htmlToPng(this.root, LTK_BASE_CSS + SQDPC_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + SQDPC_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "sqdpc.png";
      link.click();
    });
  }
}
