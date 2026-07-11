// The SkillsMatrix editor: team members down the side, skills across the
// top, a quarter-filled disc per cell (tap to cycle unset → 1 → 2 → 3 → 4 →
// unset). Skill headers carry the target level and coverage; a cell below
// its skill's target gets a gap ring. People, skills and targets are all
// editable in-card; each person row ends with an Actions button (e.g. to
// raise a training action).

import { applyThemeVars, defaultTheme, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import {
  fieldRow,
  openDialog,
  sectionLabel,
  selectInput,
  textInput,
} from "../../shared/ui/dialog";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  coverage,
  LEVEL_LABELS,
  levelOf,
  MAX_LEVEL,
  Skill,
  SkillPerson,
  SkillsEnvelope,
  SCHEMA_ID,
} from "./types";
import { SKILLS_CSS } from "./styles";

export interface SkillsEditorCallbacks {
  onChange: (env: SkillsEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

const LABEL_COL = 150;
const ACTION_COL = 62;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Quadrant wedge paths for a disc of radius r centred on (0,0), clockwise
 *  from 12 o'clock: quadrant i fills when level > i. */
function quadrantPath(i: number, r: number): string {
  const pts = [
    [0, -r, r, 0], // top-right
    [r, 0, 0, r], // bottom-right
    [0, r, -r, 0], // bottom-left
    [-r, 0, 0, -r], // top-left
  ][i];
  return `M 0 0 L ${pts[0]} ${pts[1]} A ${r} ${r} 0 0 1 ${pts[2]} ${pts[3]} Z`;
}

export class SkillsMatrixEditor {
  private readonly root: HTMLElement;
  private env: SkillsEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: SkillsEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-skills-css", SKILLS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { people: [], skills: [], levels: {} },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: SkillsEnvelope, actions: LtkAction[]): void {
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

  private fillColor(): string {
    return this.theme.legend[1] ?? this.theme.accent;
  }
  private gapColor(): string {
    return this.theme.legend[2] ?? "#d13438";
  }

  private openActionCount(personId: string): number {
    return this.actions.filter(
      (a) =>
        a.context.sourceId === personId &&
        a.status !== "cancelled" &&
        a.status !== "done"
    ).length;
  }

  /** A quarter-filled disc for a level (and optional gap ring). */
  private disc(level: number, r: number, gap: boolean): SVGSVGElement {
    const pad = gap ? 4 : 2;
    const size = r * 2 + pad * 2;
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", `${-r - pad} ${-r - pad} ${size} ${size}`);
    svg.classList.add("ltk-sk-disc");

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(r));
    circle.style.fill = tint(this.theme.foreground, 0.97);
    circle.style.stroke = this.theme.foreground;
    circle.style.strokeWidth = "1.4";
    svg.appendChild(circle);

    for (let i = 0; i < Math.min(level, MAX_LEVEL); i++) {
      const wedge = document.createElementNS(SVG_NS, "path");
      wedge.setAttribute("d", quadrantPath(i, r));
      wedge.style.fill = this.fillColor();
      svg.appendChild(wedge);
    }

    // crosshair lines so the quadrants read even when full
    for (const [x1, y1, x2, y2] of [
      [0, -r, 0, r],
      [-r, 0, r, 0],
    ]) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.style.stroke = this.theme.foreground;
      line.style.strokeWidth = "0.9";
      line.style.opacity = "0.5";
      svg.appendChild(line);
    }

    if (gap) {
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("r", String(r + 3));
      ring.style.fill = "none";
      ring.style.stroke = this.gapColor();
      ring.style.strokeWidth = "2";
      svg.appendChild(ring);
    }
    return svg;
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
        { label: "Add person", onClick: () => this.editPerson(null) },
        { label: "Add skill", onClick: () => this.editSkill(null) },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-sk-body");
    this.root.appendChild(body);

    const skills = this.env.data.skills;
    const grid = el("div", "ltk-sk-grid");
    grid.style.gridTemplateColumns = `${LABEL_COL}px repeat(${skills.length}, minmax(64px, 1fr)) ${ACTION_COL}px`;

    // header row: corner + skills (tap to edit) + Actions
    grid.appendChild(el("div"));
    for (const skill of skills) {
      grid.appendChild(this.renderSkillHead(skill));
    }
    const acthead = el("div", "ltk-sk-acthead", "Actions");
    grid.appendChild(acthead);

    // one row per person
    for (const person of this.env.data.people) {
      grid.appendChild(this.renderPersonLabel(person));
      for (const skill of skills) {
        grid.appendChild(this.renderCell(person, skill));
      }
      grid.appendChild(this.renderActionCell(person));
    }
    body.appendChild(grid);

    // footer: add buttons left, level legend right (in line)
    const footer = el("div", "ltk-sk-footer");
    if (!this.readOnly) {
      const buttons = el("div", "ltk-sk-addrow");
      const addPerson = el("button", "ltk-sk-add", "＋ Add person");
      addPerson.type = "button";
      addPerson.addEventListener("click", () => this.editPerson(null));
      const addSkill = el("button", "ltk-sk-add", "＋ Add skill");
      addSkill.type = "button";
      addSkill.addEventListener("click", () => this.editSkill(null));
      buttons.append(addPerson, addSkill);
      footer.appendChild(buttons);
    }
    footer.appendChild(this.renderLegend());
    body.appendChild(footer);

    if (!this.readOnly) {
      body.appendChild(
        el(
          "div",
          "ltk-sk-hint",
          "Tap a disc to cycle the level · tap a person or skill to edit · red ring = below target"
        )
      );
    }
  }

  private renderSkillHead(skill: Skill): HTMLElement {
    const head = el("div", "ltk-sk-skillhead");
    head.appendChild(el("div", "ltk-sk-skillname", skill.name));
    const meta = el("div", "ltk-sk-skillmeta");
    if (skill.target > 0) {
      meta.appendChild(this.disc(skill.target, 6, false));
      const cov = coverage(this.env.data, skill);
      const covEl = el("span", "ltk-sk-cov", `${cov.met}/${cov.of}`);
      covEl.title = `${cov.met} of ${cov.of} at or above the target (${LEVEL_LABELS[skill.target]})`;
      if (cov.met < cov.of) covEl.classList.add("ltk-sk-cov-short");
      meta.appendChild(covEl);
    }
    head.appendChild(meta);
    if (!this.readOnly) {
      head.classList.add("ltk-sk-head-edit");
      head.title = "Tap to rename, set the target, or remove this skill";
      head.addEventListener("click", () => this.editSkill(skill));
    }
    return head;
  }

  private renderPersonLabel(person: SkillPerson): HTMLElement {
    const cell = el("div", "ltk-sk-person", person.name);
    if (!this.readOnly) {
      cell.classList.add("ltk-sk-head-edit");
      cell.title = "Tap to rename or remove this person";
      cell.addEventListener("click", () => this.editPerson(person));
    }
    return cell;
  }

  private renderCell(person: SkillPerson, skill: Skill): HTMLElement {
    const cell = el("div", "ltk-sk-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    const level = levelOf(this.env.data, person.id, skill.id);
    const gap = skill.target > 0 && level < skill.target;
    cell.appendChild(this.disc(level, 13, gap));
    cell.title =
      `${person.name} · ${skill.name} — ` +
      (level > 0 ? LEVEL_LABELS[level] : "Not assessed") +
      (skill.target > 0 ? ` (target ${LEVEL_LABELS[skill.target]})` : "");
    if (!this.readOnly) {
      cell.addEventListener("click", () => this.cycle(person.id, skill.id));
    }
    return cell;
  }

  private renderActionCell(person: SkillPerson): HTMLElement {
    const cell = el("div", "ltk-sk-actcell");
    if (this.readOnly) return cell;
    const open = this.openActionCount(person.id);
    const btn = el("button", "ltk-sk-actbtn", open > 0 ? `● ${open}` : "＋");
    btn.type = "button";
    btn.title = open > 0 ? `Actions (${open})` : "Add an action for this person";
    if (open > 0) btn.classList.add("ltk-sk-actbtn-on");
    btn.addEventListener("click", () => this.openPersonActions(person));
    cell.appendChild(btn);
    return cell;
  }

  private renderLegend(): HTMLElement {
    const legend = el("div", "ltk-sk-legend");
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      const item = el("span", "ltk-sk-legend-item");
      item.appendChild(this.disc(lvl, 8, false));
      item.appendChild(document.createTextNode(LEVEL_LABELS[lvl]));
      legend.appendChild(item);
    }
    return legend;
  }

  // ---- mutations ----

  /** unset → 1 → 2 → 3 → 4 → unset */
  private cycle(personId: string, skillId: string): void {
    const row = this.env.data.levels[personId] ?? {};
    const cur = row[skillId] ?? 0;
    if (cur >= MAX_LEVEL) delete row[skillId];
    else row[skillId] = cur + 1;
    if (Object.keys(row).length > 0) this.env.data.levels[personId] = row;
    else delete this.env.data.levels[personId];
    this.commit();
  }

  private editPerson(person: SkillPerson | null): void {
    const input = textInput(person?.name ?? "", { placeholder: "Name" });
    const buttons = [];
    if (person) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.people = this.env.data.people.filter((p) => p.id !== person.id);
          delete this.env.data.levels[person.id];
          for (const a of this.actions) {
            if (a.context.sourceId === person.id && a.status !== "done") {
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
      label: person ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const name = input.value.trim();
        if (name === "") return;
        if (person) person.name = name;
        else this.env.data.people.push({ id: newId("p"), name });
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: person ? "Edit person" : "Add person",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Name", input));
    input.focus();
  }

  private editSkill(skill: Skill | null): void {
    const nameInput = textInput(skill?.name ?? "", { placeholder: "Skill" });
    const targetSel = selectInput(String(skill?.target ?? 0), [
      { value: "0", label: "No target" },
      { value: "1", label: `1 — ${LEVEL_LABELS[1]}` },
      { value: "2", label: `2 — ${LEVEL_LABELS[2]}` },
      { value: "3", label: `3 — ${LEVEL_LABELS[3]}` },
      { value: "4", label: `4 — ${LEVEL_LABELS[4]}` },
    ]);
    const buttons = [];
    if (skill) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.skills = this.env.data.skills.filter((s) => s.id !== skill.id);
          for (const row of Object.values(this.env.data.levels)) delete row[skill.id];
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: skill ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const name = nameInput.value.trim();
        if (name === "") return;
        const target = Number(targetSel.value);
        if (skill) {
          skill.name = name;
          skill.target = target;
        } else {
          this.env.data.skills.push({ id: newId("s"), name, target });
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: skill ? "Edit skill" : "Add skill",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Skill", nameInput));
    const targetRow = fieldRow("Target", targetSel);
    targetRow.classList.add("ltk-field-half");
    dlg.body.appendChild(targetRow);
    nameInput.focus();
  }

  /** Manage the actions for a person (list + raise); empty → raise now. */
  private openPersonActions(person: SkillPerson): void {
    const existing = this.actions.filter(
      (a) => a.context.sourceId === person.id && a.status !== "cancelled"
    );
    if (existing.length === 0) {
      this.raiseAction(person);
      return;
    }
    const dlg = openDialog({
      host: this.root,
      title: person.name,
      buttons: [
        { label: "Close", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "＋ Raise action",
          kind: "primary",
          onClick: () => {
            dlg.close();
            this.raiseAction(person);
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

  private raiseAction(person: SkillPerson): void {
    const action = newAction({ source: "skills", sourceId: person.id });
    action.issue = `Training — ${person.name}`;
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
    htmlToPng(this.root, LTK_BASE_CSS + SKILLS_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + SKILLS_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "skills-matrix.png";
      link.click();
    });
  }
}
