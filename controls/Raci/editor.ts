// The RaciCard editor: deliverables down the side, roles across the top, one
// RACI letter per cell (tap to cycle unset → R → A → C → I). A task row warns
// when it doesn't have exactly one Accountable. Roles, deliverables and
// assignments all live in the board data and are editable in-card; each row
// ends with an action button (manage / raise actions for that deliverable).

import { applyThemeVars, defaultTheme, textOn, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, sectionLabel, textInput } from "../../shared/ui/dialog";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  accountableCount,
  RACI_CYCLE,
  RACI_DEFS,
  RaciDef,
  RaciEnvelope,
  RaciLetter,
  RaciTask,
  SCHEMA_ID,
} from "./types";
import { RACI_CSS } from "./styles";

export interface RaciEditorCallbacks {
  onChange: (env: RaciEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

const LABEL_COL = 170;
const ACTION_COL = 52;

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
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: RaciEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-raci-css", RACI_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { roles: [], tasks: [], assign: {} },
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
        { label: "Add role", onClick: () => this.editRole(null) },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-ra-body");
    this.root.appendChild(body);

    const roles = this.env.data.roles;
    const n = roles.length;
    const grid = el("div", "ltk-ra-grid");
    grid.style.gridTemplateColumns = `${LABEL_COL}px repeat(${n}, minmax(58px, 1fr)) ${ACTION_COL}px`;

    // header row: corner + role names (tap to edit) + actions column spacer
    grid.appendChild(el("div", "ltk-ra-corner"));
    roles.forEach((role, i) => {
      const head = el("div", "ltk-ra-rolehead", role);
      if (!this.readOnly) {
        head.classList.add("ltk-ra-rolehead-edit");
        head.title = "Tap to rename or remove this role";
        head.addEventListener("click", () => this.editRole(i));
      }
      grid.appendChild(head);
    });
    grid.appendChild(el("div", "ltk-ra-acthead"));

    // one row per deliverable
    for (const task of this.env.data.tasks) {
      grid.appendChild(this.renderTaskLabel(task));
      for (const role of roles) {
        grid.appendChild(this.renderCell(task, role));
      }
      grid.appendChild(this.renderActionCell(task));
    }
    body.appendChild(grid);

    if (!this.readOnly) {
      const buttons = el("div", "ltk-ra-addrow");
      const addTask = el("button", "ltk-ra-add", "＋ Add deliverable");
      addTask.type = "button";
      addTask.addEventListener("click", () => this.editTask(null));
      const addRole = el("button", "ltk-ra-add", "＋ Add role");
      addRole.type = "button";
      addRole.addEventListener("click", () => this.editRole(null));
      buttons.append(addTask, addRole);
      body.appendChild(buttons);
    }

    body.appendChild(this.renderLegend());
  }

  private renderTaskLabel(task: RaciTask): HTMLElement {
    const cell = el("div", "ltk-ra-task");
    const aCount = accountableCount(this.env.data, task.id);
    if (aCount !== 1) cell.classList.add("ltk-ra-warn");

    const name = el("div", "ltk-ra-taskname", task.label || "Untitled");
    cell.appendChild(name);

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
      cell.appendChild(warn);
    }

    if (!this.readOnly) {
      cell.classList.add("ltk-ra-task-edit");
      cell.title = "Tap to rename or remove this deliverable";
      cell.addEventListener("click", () => this.editTask(task));
    }
    return cell;
  }

  /** Trailing per-row action button: manage / raise actions for the row. */
  private renderActionCell(task: RaciTask): HTMLElement {
    const cell = el("div", "ltk-ra-actcell");
    if (this.readOnly) return cell;
    const open = this.openActionCount(task.id);
    const btn = el("button", "ltk-ra-actbtn", open > 0 ? `● ${open}` : "＋");
    btn.type = "button";
    btn.title = open > 0 ? `Actions (${open})` : "Add an action for this deliverable";
    if (open > 0) btn.classList.add("ltk-ra-actbtn-on");
    btn.addEventListener("click", () => this.openTaskActions(task));
    cell.appendChild(btn);
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
        el("span", "ltk-ra-hint", "Tap a cell to cycle · tap a role or deliverable to edit")
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

  /** Rename or remove a role column (index into data.roles). */
  private editRole(index: number | null): void {
    const current = index !== null ? this.env.data.roles[index] : "";
    const input = textInput(current, { placeholder: "Role or person" });
    const buttons = [];
    if (index !== null) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          const role = this.env.data.roles[index];
          this.env.data.roles = this.env.data.roles.filter((_, i) => i !== index);
          for (const row of Object.values(this.env.data.assign)) delete row[role];
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: index !== null ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const name = input.value.trim();
        if (name === "") return;
        if (index !== null) {
          const old = this.env.data.roles[index];
          if (name !== old) {
            // migrate assignments from the old key to the new one
            for (const row of Object.values(this.env.data.assign)) {
              if (row[old] !== undefined && row[name] === undefined) {
                row[name] = row[old];
              }
              delete row[old];
            }
            this.env.data.roles[index] = name;
          }
        } else if (!this.env.data.roles.includes(name)) {
          this.env.data.roles.push(name);
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: index !== null ? "Edit role" : "Add role",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Role", input));
    input.focus();
  }

  /** Manage the actions for a deliverable (list + raise); empty → raise now. */
  private openTaskActions(task: RaciTask): void {
    const existing = this.actions.filter(
      (a) => a.context.sourceId === task.id && a.status !== "cancelled"
    );
    if (existing.length === 0) {
      this.raiseAction(task);
      return;
    }
    const dlg = openDialog({
      host: this.root,
      title: task.label || "Deliverable",
      buttons: [
        { label: "Close", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "＋ Raise action",
          kind: "primary",
          onClick: () => {
            dlg.close();
            this.raiseAction(task);
          },
        },
      ],
    });
    dlg.body.appendChild(sectionLabel(`Actions (${existing.length})`));
    for (const a of existing) {
      dlg.body.appendChild(
        actionRow(a, {
          doneColor: this.theme.legend[1] ?? "#107c10",
          onChanged: () => this.emit(),
          onEdit: (act) =>
            openActionDialog({
              host: this.root,
              action: act,
              people: this.people,
              isNew: false,
              onCommit: () => this.emit(),
            }),
        })
      );
    }
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
