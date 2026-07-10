// The ConditionsCard editor: conditions down the side, the last seven days
// across the top, plus a highlighted "Next" forecast column. Tap to cycle
// unset → good → issue; hold to raise an action. Conditions are edited from
// the kebab. Shares the SQDPC visual language.

import { applyThemeVars, defaultTheme, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, textArea } from "../../shared/ui/dialog";
import { openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  ConditionsEnvelope,
  DEFAULT_CONDITIONS,
  Rating,
  rollingDays,
  SCHEMA_ID,
} from "./types";
import { CONDITIONS_CSS } from "./styles";

export interface ConditionsEditorCallbacks {
  onChange: (env: ConditionsEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

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
  private readonly png: SnapshotScheduler;

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
      data: { conditions: DEFAULT_CONDITIONS.slice(), ratings: {}, forecast: {} },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: ConditionsEnvelope, actions: LtkAction[]): void {
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
        { label: "Edit conditions", onClick: () => this.editConditions() },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-cn-body");
    this.root.appendChild(body);

    const days = rollingDays();
    const grid = el("div", "ltk-cn-grid");
    grid.style.gridTemplateColumns = `minmax(110px, auto) repeat(7, minmax(30px, 1fr)) minmax(44px, 1fr)`;

    grid.appendChild(el("div"));
    days.forEach((day, i) => {
      const d = new Date(day + "T00:00:00Z");
      const label = el(
        "div",
        "ltk-cn-daylabel",
        i === 6
          ? "Today"
          : d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
      );
      grid.appendChild(label);
    });
    grid.appendChild(el("div", "ltk-cn-daylabel ltk-cn-next", "Next"));

    for (const cond of this.env.data.conditions) {
      grid.appendChild(el("div", "ltk-cn-cond", cond));
      for (const day of days) {
        grid.appendChild(
          this.renderCell(`${cond}|${day}`, this.env.data.ratings, `${cond} · ${day}`)
        );
      }
      const forecast = this.renderCell(cond, this.env.data.forecast, `${cond} · next shift`);
      forecast.classList.add("ltk-cn-forecast");
      grid.appendChild(forecast);
    }
    body.appendChild(grid);

    const legend = el("div", "ltk-cn-legend");
    const good = el("span");
    const gs = el("span", "ltk-cn-swatch");
    gs.style.background = this.goodColor();
    good.append(gs, document.createTextNode("Good"));
    const issue = el("span");
    const isw = el("span", "ltk-cn-swatch");
    isw.style.background = this.issueColor();
    issue.append(isw, document.createTextNode("Issue"));
    legend.append(
      good,
      issue,
      el("span", undefined, this.readOnly ? "" : "Tap to cycle · hold to raise an action")
    );
    body.appendChild(legend);
  }

  private renderCell(
    key: string,
    store: Record<string, Rating>,
    title: string
  ): HTMLElement {
    const cell = el("div", "ltk-cn-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    cell.title = title;
    const rating = store[key];
    if (rating === "good") cell.style.background = this.goodColor();
    else if (rating === "issue") cell.style.background = this.issueColor();
    else cell.style.background = tint(this.theme.foreground, 0.97);

    if (!this.readOnly) {
      makeInteractive(cell, {
        onTap: () => {
          const cur = store[key];
          if (cur === undefined) store[key] = "good";
          else if (cur === "good") store[key] = "issue";
          else delete store[key];
          this.commit();
        },
        onLongPress: () => this.raiseAction(key, title),
      });
    }
    return cell;
  }

  private editConditions(): void {
    const ta = textArea(this.env.data.conditions.join("\n"), { rows: 6 });
    const dlg = openDialog({
      host: this.root,
      title: "Conditions (one per line)",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            const conditions = ta.value
              .split("\n")
              .map((v) => v.trim())
              .filter((v) => v !== "");
            if (conditions.length === 0) return;
            this.env.data.conditions = conditions;
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Conditions", ta));
    ta.focus();
  }

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
