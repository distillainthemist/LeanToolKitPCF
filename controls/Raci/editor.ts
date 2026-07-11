// The RaciCard editor: deliverables down the side, roles across the top, one
// RACI letter per cell (tap to cycle unset → R → A → C → I). A task row warns
// when it doesn't have exactly one Accountable. Tasks are editable in-card;
// roles come from the `roles` input. Hold a task to raise an action.

import { applyThemeVars, defaultTheme, textOn, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, textInput } from "../../shared/ui/dialog";
import { openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  accountableCount,
  DEFAULT_ROLES,
  RACI_CYCLE,
  RACI_DEFS,
  RaciDef,
  RaciEnvelope,
  RaciLetter,
  RaciTask,
  SCHEMA_ID,
} from "./types";
import { RACI_CSS } from "./styles";

export interface RaciOptions {
  roles: string[];
}

export interface RaciEditorCallbacks {
  onChange: (env: RaciEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

const LABEL_COL = 170;

export class RaciEditor {
  private readonly root: HTMLElement;
  private env: RaciEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private roles: string[] = DEFAULT_ROLES.slice();
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: RaciEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-raci-css", RACI_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { tasks: [], assign: {} },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: RaciEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  setOptions(opts: RaciOptions): void {
    if (JSON.stringify(opts.roles) === JSON.stringify(this.roles)) return;
    this.roles = opts.roles;
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

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  // ---- helpers ----

  /** The four role defs, colours overridden per slot by legendColors[1..4]. */
  private defs(): RaciDef[] {
    return RACI_DEFS.map((d, i) => ({
      ...d,
      color: this.theme.legend[i + 1] ?? d.color,
    }));
  }

  private defFor(letter: RaciLetter | undefined): RaciDef | undefined {
    return letter ? this.defs().find((d) => d.letter === letter) : undefined;
  }

  private openActionCount(taskId: string): number {
    return this.actions.filter(
      (a) =>
        a.context.sourceId === taskId &&
        a.status !== "cancelled" &&
        a.status !== "done"
    ).length;
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
        { label: "Add deliverable", onClick: () => this.editTask(null) },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-ra-body");
    this.root.appendChild(body);

    const n = this.roles.length;
    const grid = el("div", "ltk-ra-grid");
    grid.style.gridTemplateColumns = `${LABEL_COL}px repeat(${n}, minmax(58px, 1fr))`;

    // header row: corner + role names
    grid.appendChild(el("div", "ltk-ra-corner"));
    for (const role of this.roles) {
      grid.appendChild(el("div", "ltk-ra-rolehead", role));
    }

    // one row per deliverable
    for (const task of this.env.data.tasks) {
      grid.appendChild(this.renderTaskLabel(task));
      for (const role of this.roles) {
        grid.appendChild(this.renderCell(task, role));
      }
    }
    body.appendChild(grid);

    if (!this.readOnly) {
      const add = el("button", "ltk-ra-add", "＋ Add deliverable");
      add.type = "button";
      add.addEventListener("click", () => this.editTask(null));
      body.appendChild(add);
    }

    body.appendChild(this.renderLegend());
  }

  private renderTaskLabel(task: RaciTask): HTMLElement {
    const cell = el("div", "ltk-ra-task");
    const aCount = accountableCount(this.env.data, task.id, this.roles);
    if (aCount !== 1) cell.classList.add("ltk-ra-warn");

    const name = el("div", "ltk-ra-taskname", task.label || "Untitled");
    cell.appendChild(name);

    const meta = el("div", "ltk-ra-taskmeta");
    if (aCount !== 1) {
      const warn = el(
        "span",
        "ltk-ra-warnflag",
        aCount === 0 ? "No Accountable" : `${aCount} Accountable`
      );
      warn.title =
        aCount === 0
          ? "Every deliverable needs exactly one Accountable (A)."
          : "Only one role should be Accountable (A) for a deliverable.";
      meta.appendChild(warn);
    }
    const openCount = this.openActionCount(task.id);
    if (openCount > 0) {
      const badge = el("span", "ltk-ra-abadge", `● ${openCount}`);
      badge.title = `${openCount} open action(s)`;
      meta.appendChild(badge);
    }
    if (meta.childNodes.length > 0) cell.appendChild(meta);

    if (!this.readOnly) {
      makeInteractive(cell, {
        onTap: () => this.editTask(task),
        onLongPress: () => this.raiseAction(task),
      });
    }
    return cell;
  }

  private renderCell(task: RaciTask, role: string): HTMLElement {
    const cell = el("div", "ltk-ra-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    const letter = this.env.data.assign[task.id]?.[role];
    const def = this.defFor(letter);
    if (def) {
      cell.style.background = def.color;
      cell.style.color = textOn(def.color);
      cell.textContent = def.letter;
      cell.title = `${task.label || "Untitled"} · ${role} — ${def.label}`;
    } else {
      cell.style.background = tint(this.theme.foreground, 0.97);
      cell.title = `${task.label || "Untitled"} · ${role}`;
    }

    if (!this.readOnly) {
      makeInteractive(cell, { onTap: () => this.cycle(task.id, role) });
    }
    return cell;
  }

  private renderLegend(): HTMLElement {
    const legend = el("div", "ltk-ra-legend");
    for (const d of this.defs()) {
      const item = el("span", "ltk-ra-legend-item");
      const sw = el("span", "ltk-ra-swatch", d.letter);
      sw.style.background = d.color;
      sw.style.color = textOn(d.color);
      item.append(sw, document.createTextNode(d.label));
      legend.appendChild(item);
    }
    if (!this.readOnly) {
      legend.appendChild(
        el("span", "ltk-ra-hint", "Tap a cell to cycle · tap a row to edit · hold to raise an action")
      );
    }
    return legend;
  }

  // ---- mutations ----

  /** unset → R → A → C → I → unset */
  private cycle(taskId: string, role: string): void {
    const row = this.env.data.assign[taskId] ?? {};
    const cur = row[role];
    const idx = cur ? RACI_CYCLE.indexOf(cur) : -1;
    if (idx === -1) {
      row[role] = RACI_CYCLE[0];
    } else if (idx + 1 < RACI_CYCLE.length) {
      row[role] = RACI_CYCLE[idx + 1];
    } else {
      delete row[role];
    }
    if (Object.keys(row).length > 0) this.env.data.assign[taskId] = row;
    else delete this.env.data.assign[taskId];
    this.commit();
  }

  private editTask(task: RaciTask | null): void {
    const input = textInput(task?.label ?? "", { placeholder: "Deliverable / task" });
    const buttons = [];
    if (task) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.tasks = this.env.data.tasks.filter((t) => t.id !== task.id);
          delete this.env.data.assign[task.id];
          for (const a of this.actions) {
            if (a.context.sourceId === task.id && a.status !== "done") {
              a.status = "cancelled";
            }
          }
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: task ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const label = input.value.trim();
        if (label === "") return;
        if (task) {
          task.label = label;
        } else {
          this.env.data.tasks.push({ id: newId("t"), label });
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: task ? "Edit deliverable" : "Add deliverable",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Deliverable", input));
    input.focus();
  }

  private raiseAction(task: RaciTask): void {
    const action = newAction({ source: "raci", sourceId: task.id });
    action.issue = task.label;
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: true,
      onCommit: () => {
        this.actions.push(action);
        this.emit();
      },
    });
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
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
    htmlToPng(this.root, LTK_BASE_CSS + RACI_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + RACI_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "raci.png";
      link.click();
    });
  }
}
