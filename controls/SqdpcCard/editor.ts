// The SqdpcCard editor: dimension letters down the side, the month's days
// across the top. Tap a cell to cycle unset → good → issue → unset; hold a
// cell to raise an action on it (source "sqdpc"). Month navigation ‹ ›;
// two-shift granularity splits each cell into day/night halves.

import { applyThemeVars, defaultTheme, Theme, tint } from "../../shared/tokens";
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
  monthDays,
  Rating,
  shiftMonth,
  SqdpcEnvelope,
  SCHEMA_ID,
  currentMonth,
  DEFAULT_DIMENSIONS,
} from "./types";
import { SQDPC_CSS } from "./styles";

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
  private readonly png: SnapshotScheduler;

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
      data: {
        month: currentMonth(),
        granularity: "day",
        dimensions: DEFAULT_DIMENSIONS.slice(),
        ratings: {},
      },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: SqdpcEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
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
    this.root.remove();
  }

  private goodColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }
  private issueColor(): string {
    return this.theme.legend[2] ?? "#d13438";
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
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-sq-body");
    this.root.appendChild(body);

    // month navigation
    const nav = el("div", "ltk-sq-nav");
    const monthLabel = new Date(this.env.data.month + "-01T00:00:00Z");
    const label = el(
      "div",
      "ltk-sq-month",
      monthLabel.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    );
    if (!this.readOnly) {
      const prev = el("button", "ltk-sq-navbtn", "‹");
      prev.type = "button";
      prev.addEventListener("click", () => this.changeMonth(-1));
      const next = el("button", "ltk-sq-navbtn", "›");
      next.type = "button";
      next.addEventListener("click", () => this.changeMonth(1));
      nav.append(prev, label, next);
    } else {
      nav.append(label);
    }
    body.appendChild(nav);

    // the grid
    const days = monthDays(
      this.env.data.month,
      this.env.data.granularity === "weekday"
    );
    const grid = el("div", "ltk-sq-grid");
    grid.style.gridTemplateColumns = `36px repeat(${days.length}, minmax(24px, 1fr))`;

    grid.appendChild(el("div"));
    for (const day of days) {
      grid.appendChild(el("div", "ltk-sq-daylabel", String(Number(day.slice(8)))));
    }
    for (const dim of this.env.data.dimensions) {
      const dimEl = el("div", "ltk-sq-dim", dim);
      dimEl.style.color = this.theme.foreground;
      grid.appendChild(dimEl);
      for (const day of days) {
        grid.appendChild(this.renderCell(dim, day));
      }
    }
    body.appendChild(grid);

    // legend
    const legend = el("div", "ltk-sq-legend");
    const good = el("span");
    const gs = el("span", "ltk-sq-swatch");
    gs.style.background = this.goodColor();
    good.append(gs, document.createTextNode("Good"));
    const issue = el("span");
    const is2 = el("span", "ltk-sq-swatch");
    is2.style.background = this.issueColor();
    issue.append(is2, document.createTextNode("Issue"));
    legend.append(
      good,
      issue,
      el("span", undefined, this.readOnly ? "" : "Tap to cycle · hold to raise an action")
    );
    body.appendChild(legend);
  }

  private renderCell(dim: string, day: string): HTMLElement {
    const cell = el("div", "ltk-sq-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    const dow = new Date(day + "T00:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) cell.classList.add("ltk-sq-weekend");

    const shifts =
      this.env.data.granularity === "shift2" ? ["D", "N"] : [""];
    for (const shift of shifts) {
      const key = shift === "" ? `${dim}|${day}` : `${dim}|${day}|${shift}`;
      const half = el("div", shifts.length > 1 ? "ltk-sq-half" : "ltk-sq-half");
      this.paint(half, this.env.data.ratings[key]);
      half.title = `${dim} · ${day}${shift ? " · " + (shift === "D" ? "Day" : "Night") : ""}`;
      if (!this.readOnly) {
        makeInteractive(half, {
          onTap: () => {
            const cur = this.env.data.ratings[key];
            if (cur === undefined) this.env.data.ratings[key] = "good";
            else if (cur === "good") this.env.data.ratings[key] = "issue";
            else delete this.env.data.ratings[key];
            this.commit();
          },
          onLongPress: () => this.raiseAction(dim, day, shift),
        });
      }
      cell.appendChild(half);
    }
    return cell;
  }

  private paint(elm: HTMLElement, rating: Rating | undefined): void {
    if (rating === "good") elm.style.background = this.goodColor();
    else if (rating === "issue") elm.style.background = this.issueColor();
    else elm.style.background = tint(this.theme.foreground, 0.97);
  }

  private changeMonth(delta: number): void {
    this.env.data.month = shiftMonth(this.env.data.month, delta);
    this.commit();
  }

  private raiseAction(dim: string, day: string, shift: string): void {
    const action = newAction({
      source: "sqdpc",
      sourceId: shift === "" ? `${dim}|${day}` : `${dim}|${day}|${shift}`,
      hint: dim,
    });
    action.issue = `${dim} — ${day}${shift ? ` (${shift === "D" ? "Day" : "Night"} shift)` : ""}`;
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
