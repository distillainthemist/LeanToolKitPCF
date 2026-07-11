// The SkillsMatrix editor: skills down the side (grouped under categories),
// people across the top (from peopleJSON), a quarter-filled disc per cell
// (tap to cycle unset → 1 → 2 → 3 → 4 → unset). Each skill row shows its
// target + coverage; a cell below target gets a gap ring. Categories and
// skills are editable and drag-reorderable; the final row is Actions, one
// button per person column.

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
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  coverage,
  LEVEL_LABELS,
  levelOf,
  MAX_LEVEL,
  setLevel,
  Skill,
  SkillCategory,
  SkillsEnvelope,
  SCHEMA_ID,
} from "./types";
import { SKILLS_CSS } from "./styles";

export interface SkillsEditorCallbacks {
  onChange: (env: SkillsEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

const LABEL_COL = 190;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Quadrant wedge path for a disc of radius r, clockwise from 12 o'clock. */
function quadrantPath(i: number, r: number): string {
  const pts = [
    [0, -r, r, 0],
    [r, 0, 0, r],
    [0, r, -r, 0],
    [-r, 0, 0, -r],
  ][i];
  return `M 0 0 L ${pts[0]} ${pts[1]} A ${r} ${r} 0 0 1 ${pts[2]} ${pts[3]} Z`;
}

interface DragState {
  kind: "category" | "skill";
  catId: string;
  skillId?: string;
  ghost: HTMLElement;
}

export class SkillsMatrixEditor {
  private readonly root: HTMLElement;
  private body!: HTMLElement;
  private env: SkillsEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;
  private drag: DragState | null = null;
  private insertLine: HTMLElement | null = null;

  constructor(host: HTMLElement, private readonly cb: SkillsEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-skills-css", SKILLS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { categories: [], levels: {} },
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
    // people drive the columns now, so a change must re-render
    if (JSON.stringify(people) === JSON.stringify(this.people)) return;
    this.people = people;
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

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  // ---- helpers ----

  private personIds(): string[] {
    return this.people.map((p) => p.whoId);
  }
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
        { label: "Add category", onClick: () => this.editCategory(null) },
        { label: "Add skill", onClick: () => this.editSkill(null, null) },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-sk-body");
    this.body = body;
    this.root.appendChild(body);

    const cats = this.env.data.categories;
    if (cats.length === 0 || cats.every((c) => c.skills.length === 0)) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : ["No skills yet", "Add a category and skills to build the matrix."];
      const ghost = renderGhost(body, this.readOnly ? lines.slice(0, 1) : lines);
      if (!this.readOnly) ghost.addEventListener("click", () => this.editCategory(null));
      if (this.people.length === 0 && !this.readOnly) {
        body.appendChild(
          el("div", "ltk-sk-hint", "Tip: feed the columns from the People (JSON) input.")
        );
      }
      return;
    }

    const people = this.people;
    const grid = el("div", "ltk-sk-grid");
    grid.style.gridTemplateColumns = `${LABEL_COL}px repeat(${people.length}, minmax(60px, 1fr))`;

    // header row: corner + person names, closed by a continuous rule
    grid.appendChild(el("div", "ltk-sk-corner"));
    for (const p of people) {
      grid.appendChild(el("div", "ltk-sk-personhead", p.who));
    }
    grid.appendChild(el("div", "ltk-sk-rule"));

    // categories, each a full-width band header then its skill rows
    for (const cat of cats) {
      grid.appendChild(this.renderCategoryHead(cat, people.length));
      for (const skill of cat.skills) {
        grid.appendChild(this.renderSkillLabel(cat, skill));
        for (const p of people) {
          grid.appendChild(this.renderCell(skill, p.whoId));
        }
      }
    }

    // final Actions row (separated by a continuous rule): a button per person
    if (people.length > 0) {
      grid.appendChild(el("div", "ltk-sk-rule"));
      grid.appendChild(el("div", "ltk-sk-actlabel", "Actions"));
      for (const p of people) {
        grid.appendChild(this.renderActionCell(p));
      }
    }

    body.appendChild(grid);

    // footer: add buttons left, level legend right (in line)
    const footer = el("div", "ltk-sk-footer");
    if (!this.readOnly) {
      const buttons = el("div", "ltk-sk-addrow");
      const addCat = el("button", "ltk-sk-add", "＋ Add category");
      addCat.type = "button";
      addCat.addEventListener("click", () => this.editCategory(null));
      const addSkill = el("button", "ltk-sk-add", "＋ Add skill");
      addSkill.type = "button";
      addSkill.addEventListener("click", () => this.editSkill(null, null));
      buttons.append(addCat, addSkill);
      footer.appendChild(buttons);
    }
    footer.appendChild(this.renderLegend());
    body.appendChild(footer);

    if (!this.readOnly) {
      body.appendChild(
        el(
          "div",
          "ltk-sk-hint",
          "Tap a disc to cycle · tap to edit · drag a skill or category to reorder · red ring = below target"
        )
      );
    }
  }

  private renderCategoryHead(cat: SkillCategory, span: number): HTMLElement {
    const head = el("div", "ltk-sk-cathead");
    head.style.gridColumn = `1 / ${span + 2}`;
    head.dataset.catId = cat.id;
    head.appendChild(el("span", "ltk-sk-catname", cat.name));
    if (!this.readOnly) {
      head.classList.add("ltk-sk-drag");
      head.title = "Tap to rename / remove · drag to reorder categories";
      makeInteractive(head, {
        onTap: () => this.editCategory(cat),
        onStart: () => this.beginDrag("category", cat.id, undefined, cat.name),
        onMove: (e) => this.dragMove(e),
        onEnd: (e) => this.dragEnd(e),
      });
    }
    return head;
  }

  private renderSkillLabel(cat: SkillCategory, skill: Skill): HTMLElement {
    const cell = el("div", "ltk-sk-skilllabel");
    cell.dataset.catId = cat.id;
    cell.dataset.skillId = skill.id;
    const name = el("div", "ltk-sk-skillname", skill.name);
    cell.appendChild(name);
    if (skill.target > 0) {
      const meta = el("div", "ltk-sk-skillmeta");
      meta.appendChild(this.disc(skill.target, 6, false));
      const cov = coverage(this.env.data, skill, this.personIds());
      const covEl = el("span", "ltk-sk-cov", `${cov.met}/${cov.of}`);
      covEl.title = `${cov.met} of ${cov.of} at or above target (${LEVEL_LABELS[skill.target]})`;
      if (cov.met < cov.of) covEl.classList.add("ltk-sk-cov-short");
      meta.appendChild(covEl);
      cell.appendChild(meta);
    }
    if (!this.readOnly) {
      cell.classList.add("ltk-sk-drag");
      cell.title = "Tap to edit · drag to reorder";
      makeInteractive(cell, {
        onTap: () => this.editSkill(cat, skill),
        onStart: () => this.beginDrag("skill", cat.id, skill.id, skill.name),
        onMove: (e) => this.dragMove(e),
        onEnd: (e) => this.dragEnd(e),
      });
    }
    return cell;
  }

  private renderCell(skill: Skill, personId: string): HTMLElement {
    const cell = el("div", "ltk-sk-cell");
    if (this.readOnly) cell.classList.add("ltk-readonly");
    const level = levelOf(this.env.data, skill.id, personId);
    const gap = skill.target > 0 && level < skill.target;
    cell.appendChild(this.disc(level, 13, gap));
    const who = this.people.find((p) => p.whoId === personId)?.who ?? "";
    cell.title =
      `${skill.name} · ${who} — ` +
      (level > 0 ? LEVEL_LABELS[level] : "Not assessed") +
      (skill.target > 0 ? ` (target ${LEVEL_LABELS[skill.target]})` : "");
    if (!this.readOnly) {
      cell.addEventListener("click", () => this.cycle(skill.id, personId));
    }
    return cell;
  }

  private renderActionCell(person: Person): HTMLElement {
    const cell = el("div", "ltk-sk-actcell");
    if (this.readOnly) return cell;
    const open = this.openActionCount(person.whoId);
    const btn = el("button", "ltk-sk-actbtn", open > 0 ? `● ${open}` : "＋");
    btn.type = "button";
    btn.title = open > 0 ? `Actions (${open})` : `Add an action for ${person.who}`;
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

  // ---- drag & drop (reorder categories / skills) ----

  private beginDrag(
    kind: "category" | "skill",
    catId: string,
    skillId: string | undefined,
    name: string
  ): void {
    const ghost = el("div", "ltk-sk-ghost", name);
    document.body.appendChild(ghost);
    this.drag = { kind, catId, skillId, ghost };
  }

  private dragMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${e.clientX + 10}px`;
    this.drag.ghost.style.top = `${e.clientY + 8}px`;
    this.showInsertLine(e.clientY);
  }

  /** Draw the insertion indicator at the gap nearest the pointer. */
  private showInsertLine(clientY: number): void {
    if (!this.drag) return;
    const target = this.computeDrop(clientY);
    if (!this.insertLine) {
      this.insertLine = el("div", "ltk-sk-insert");
      this.body.appendChild(this.insertLine);
    }
    const bodyRect = this.body.getBoundingClientRect();
    this.insertLine.style.top = `${target.y - bodyRect.top + this.body.scrollTop}px`;
  }

  /**
   * Work out where a drop at clientY lands. For a category drag, the result
   * is a category insertion index; for a skill drag, a {catId, index}. `y`
   * is the client-space y of the gap, for the indicator.
   */
  private computeDrop(clientY: number): {
    y: number;
    catIndex: number;
    catId: string;
    skillIndex: number;
  } {
    const cats = this.env.data.categories;
    if (this.drag?.kind === "category") {
      // insert before the category whose header midpoint is below the pointer
      let idx = cats.length;
      let y = 0;
      for (let i = 0; i < cats.length; i++) {
        const head = this.body.querySelector<HTMLElement>(
          `.ltk-sk-cathead[data-cat-id="${cats[i].id}"]`
        );
        if (!head) continue;
        const r = head.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
          idx = i;
          y = r.top;
          return { y, catIndex: idx, catId: cats[i].id, skillIndex: 0 };
        }
        y = r.bottom;
      }
      return { y, catIndex: idx, catId: "", skillIndex: 0 };
    }

    // skill drag: find the target category + index by scanning skill rows
    let best = { y: 0, catIndex: 0, catId: cats[0]?.id ?? "", skillIndex: 0 };
    for (let ci = 0; ci < cats.length; ci++) {
      const cat = cats[ci];
      const head = this.body.querySelector<HTMLElement>(
        `.ltk-sk-cathead[data-cat-id="${cat.id}"]`
      );
      if (head) best = { y: head.getBoundingClientRect().bottom, catIndex: ci, catId: cat.id, skillIndex: 0 };
      for (let si = 0; si < cat.skills.length; si++) {
        const rowEl = this.body.querySelector<HTMLElement>(
          `.ltk-sk-skilllabel[data-skill-id="${cat.skills[si].id}"]`
        );
        if (!rowEl) continue;
        const r = rowEl.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
          return { y: r.top, catIndex: ci, catId: cat.id, skillIndex: si };
        }
        best = { y: r.bottom, catIndex: ci, catId: cat.id, skillIndex: si + 1 };
      }
    }
    return best;
  }

  private dragEnd(e: PointerEvent): void {
    if (!this.drag) return;
    const drop = this.computeDrop(e.clientY);
    const drag = this.drag;
    if (this.insertLine) {
      this.insertLine.remove();
      this.insertLine = null;
    }
    drag.ghost.remove();
    this.drag = null;

    if (drag.kind === "category") {
      this.moveCategory(drag.catId, drop.catIndex);
    } else if (drag.skillId) {
      this.moveSkill(drag.catId, drag.skillId, drop.catId, drop.skillIndex);
    }
  }

  private moveCategory(catId: string, insertIndex: number): void {
    const cats = this.env.data.categories;
    const from = cats.findIndex((c) => c.id === catId);
    if (from < 0) return;
    let to = insertIndex;
    const [moved] = cats.splice(from, 1);
    if (from < to) to--;
    to = Math.max(0, Math.min(cats.length, to));
    cats.splice(to, 0, moved);
    this.commit();
  }

  private moveSkill(
    fromCatId: string,
    skillId: string,
    toCatId: string,
    insertIndex: number
  ): void {
    const cats = this.env.data.categories;
    const fromCat = cats.find((c) => c.id === fromCatId);
    const toCat = cats.find((c) => c.id === (toCatId || fromCatId));
    if (!fromCat || !toCat) return;
    const from = fromCat.skills.findIndex((s) => s.id === skillId);
    if (from < 0) return;
    let to = insertIndex;
    const [moved] = fromCat.skills.splice(from, 1);
    if (fromCat === toCat && from < to) to--;
    to = Math.max(0, Math.min(toCat.skills.length, to));
    toCat.skills.splice(to, 0, moved);
    this.commit();
  }

  // ---- mutations ----

  private cycle(skillId: string, personId: string): void {
    const cur = levelOf(this.env.data, skillId, personId);
    setLevel(this.env.data, skillId, personId, cur >= MAX_LEVEL ? 0 : cur + 1);
    this.commit();
  }

  private editCategory(cat: SkillCategory | null): void {
    const input = textInput(cat?.name ?? "", { placeholder: "Category" });
    const buttons = [];
    if (cat) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          for (const s of cat.skills) delete this.env.data.levels[s.id];
          this.env.data.categories = this.env.data.categories.filter((c) => c.id !== cat.id);
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: cat ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const name = input.value.trim();
        if (name === "") return;
        if (cat) cat.name = name;
        else this.env.data.categories.push({ id: newId("c"), name, skills: [] });
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: cat ? "Edit category" : "Add category",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Category", input));
    input.focus();
  }

  private editSkill(cat: SkillCategory | null, skill: Skill | null): void {
    const cats = this.env.data.categories;
    if (cats.length === 0) {
      // no category to hold a skill — make one first
      this.editCategory(null);
      return;
    }
    const nameInput = textInput(skill?.name ?? "", { placeholder: "Skill" });
    const targetSel = selectInput(String(skill?.target ?? 0), [
      { value: "0", label: "No target" },
      { value: "1", label: `1 — ${LEVEL_LABELS[1]}` },
      { value: "2", label: `2 — ${LEVEL_LABELS[2]}` },
      { value: "3", label: `3 — ${LEVEL_LABELS[3]}` },
      { value: "4", label: `4 — ${LEVEL_LABELS[4]}` },
    ]);
    const catSel = selectInput(
      (cat ?? cats[0]).id,
      cats.map((c) => ({ value: c.id, label: c.name }))
    );
    const buttons = [];
    if (cat && skill) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          cat.skills = cat.skills.filter((s) => s.id !== skill.id);
          delete this.env.data.levels[skill.id];
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
        const destCat = cats.find((c) => c.id === catSel.value) ?? cats[0];
        if (cat && skill) {
          skill.name = name;
          skill.target = target;
          if (destCat.id !== cat.id) {
            cat.skills = cat.skills.filter((s) => s.id !== skill.id);
            destCat.skills.push(skill);
          }
        } else {
          destCat.skills.push({ id: newId("s"), name, target });
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
    dlg.body.appendChild(fieldRow("Category", catSel));
    const targetRow = fieldRow("Target", targetSel);
    targetRow.classList.add("ltk-field-half");
    dlg.body.appendChild(targetRow);
    nameInput.focus();
  }

  private openPersonActions(person: Person): void {
    const existing = this.actions.filter(
      (a) => a.context.sourceId === person.whoId && a.status !== "cancelled"
    );
    if (existing.length === 0) {
      this.raiseAction(person);
      return;
    }
    const dlg = openDialog({
      host: this.root,
      title: person.who,
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

  private raiseAction(person: Person): void {
    const action = newAction({ source: "skills", sourceId: person.whoId });
    action.issue = `Training — ${person.who}`;
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
    htmlToPng(this.root, LTK_BASE_CSS + SKILLS_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
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
