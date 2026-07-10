// The ActionBoard editor: one canonical action set rendered as a list or a
// kanban. The actions channel IS the data — no card document. Cancelled
// actions are hidden but preserved. Plain DOM; full re-render per mutation.

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { ActionStatus, isOverdue, LtkAction, newAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { ACTIONBOARD_CSS } from "./styles";

export type BoardView = "list" | "kanban" | "gantt";
export type KanbanGroupBy = "status" | "issue";

/** Day number of a yyyy-mm-dd date (UTC, so arithmetic is DST-proof). */
function dayNum(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);
}

function dayLabel(day: number): string {
  const d = new Date(day * 86400000);
  return `${d.getUTCDate()} ${d.toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  })}`;
}

const GANTT_DAY_W = 24;
const GANTT_LABEL_W = 210;
const GANTT_ROW_H = 40;

const STATUS_COLUMNS: { status: ActionStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in-progress", label: "In progress" },
  { status: "done", label: "Done" },
];

const DEFAULT_GHOST = [
  "No actions yet",
  "Capture who will do what by when — actions raised in other cards land here too.",
];

export interface ActionBoardCallbacks {
  onChange: (actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

export class ActionBoardEditor {
  private readonly root: HTMLElement;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private view: BoardView = "list";
  private groupBy: KanbanGroupBy = "status";
  private readonly png: SnapshotScheduler;

  // drag state (kanban): ghost follows pointer, columns are drop zones
  private ghost: HTMLElement | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dropZones: { el: HTMLElement; key: string }[] = [];
  private currentDrop: string | undefined;

  constructor(
    host: HTMLElement,
    private readonly cb: ActionBoardCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-actionboard-css", ACTIONBOARD_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setActions(actions: LtkAction[]): void {
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

  setOptions(opts: { view: BoardView; groupBy: KanbanGroupBy }): void {
    if (this.view === opts.view && this.groupBy === opts.groupBy) return;
    this.view = opts.view;
    this.groupBy = opts.groupBy;
    this.render();
  }

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  // ---- theming ----

  private doneColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }

  private openColor(): string {
    return this.theme.legend[0] ?? "#f2c811";
  }

  private overdueColor(): string {
    return this.theme.legend[2] ?? "#d13438";
  }

  // ---- rendering ----

  private visible(): LtkAction[] {
    return this.actions.filter((a) => a.status !== "cancelled");
  }

  /** Earliest due date first; undated actions last (then by start, issue). */
  private sorted(list: LtkAction[]): LtkAction[] {
    return list.slice().sort((a, b) => {
      const dueA = a.due === "" ? "9999" : a.due;
      const dueB = b.due === "" ? "9999" : b.due;
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      const startA = a.start === "" ? "9999" : a.start;
      const startB = b.start === "" ? "9999" : b.start;
      if (startA !== startB) return startA < startB ? -1 : 1;
      return a.issue < b.issue ? -1 : 1;
    });
  }

  /** Keep any open dialog alive across re-renders. */
  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    this.dropZones = [];
    applyThemeVars(this.root, this.theme);

    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-ab-body");
    this.root.appendChild(body);

    const visible = this.visible();
    if (visible.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(
        body,
        this.readOnly ? lines : [...lines, "Tap to add an action"]
      );
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.addAction());
      }
      return;
    }

    if (this.view === "kanban") {
      body.appendChild(this.renderKanban(visible));
    } else if (this.view === "gantt") {
      body.appendChild(this.renderGantt(visible));
    } else {
      body.appendChild(this.renderList(visible));
    }

    if (!this.readOnly) {
      const add = el("button", "ltk-ab-add", "＋ Add action");
      add.type = "button";
      add.addEventListener("click", () => this.addAction());
      body.appendChild(add);
    }
  }

  private renderList(visible: LtkAction[]): HTMLElement {
    const list = el("div", "ltk-ab-list");
    for (const a of this.sorted(visible)) {
      list.appendChild(
        actionRow(a, {
          doneColor: this.doneColor(),
          showIssue: true,
          readOnly: this.readOnly,
          onChanged: () => this.commit(),
          onEdit: (act) => this.editAction(act),
        })
      );
    }
    return list;
  }

  // ---- kanban ----

  private columns(visible: LtkAction[]): { key: string; label: string; items: LtkAction[] }[] {
    if (this.groupBy === "status") {
      return STATUS_COLUMNS.map((c) => ({
        key: c.status,
        label: c.label,
        items: visible.filter((a) => a.status === c.status),
      }));
    }
    // by issue: preserve first-seen order, empty issue last
    const keys: string[] = [];
    for (const a of visible) {
      const k = a.issue.trim();
      if (k !== "" && !keys.includes(k)) keys.push(k);
    }
    const cols = keys.map((k) => ({
      key: k,
      label: k,
      items: visible.filter((a) => a.issue.trim() === k),
    }));
    const blank = visible.filter((a) => a.issue.trim() === "");
    if (blank.length > 0) {
      cols.push({ key: "", label: "(No issue)", items: blank });
    }
    return cols;
  }

  private renderKanban(visible: LtkAction[]): HTMLElement {
    const board = el("div", "ltk-ab-kanban");
    for (const col of this.columns(visible)) {
      const colEl = el("div", "ltk-ab-col");
      const title = el("div", "ltk-ab-col-title");
      title.appendChild(el("span", undefined, col.label));
      title.appendChild(el("span", "ltk-ab-col-count", String(col.items.length)));
      colEl.appendChild(title);
      const cards = el("div", "ltk-ab-cards");
      for (const a of this.sorted(col.items)) {
        cards.appendChild(this.renderKanbanCard(a));
      }
      colEl.appendChild(cards);
      board.appendChild(colEl);
      this.dropZones.push({ el: colEl, key: col.key });
    }
    return board;
  }

  private renderKanbanCard(a: LtkAction): HTMLElement {
    const card = el("div", "ltk-ab-card");
    if (this.readOnly) card.classList.add("ltk-readonly");
    // left edge colour signals state (inline for Safari)
    const edge =
      a.status === "done"
        ? this.doneColor()
        : isOverdue(a)
          ? this.overdueColor()
          : this.openColor();
    card.style.borderLeftColor = edge;

    if (this.groupBy !== "issue" && a.issue.trim() !== "") {
      card.appendChild(el("div", "ltk-ab-card-issue", a.issue));
    }
    const desc = el(
      "div",
      "ltk-ab-card-desc" + (a.status === "done" ? " ltk-ab-done" : ""),
      a.description || a.issue
    );
    card.appendChild(desc);

    const meta = el("div", "ltk-ab-card-meta");
    const whoEl = el("span", undefined, a.assignees[0]?.who ?? "Unassigned");
    meta.appendChild(whoEl);
    if (a.due !== "") {
      const dueEl = el("span", undefined, `Due ${a.due}`);
      if (isOverdue(a)) dueEl.style.color = this.overdueColor();
      if (a.escalated) {
        dueEl.appendChild(el("span", "ltk-action-flag", " ⚑"));
      }
      meta.appendChild(dueEl);
    } else if (a.escalated) {
      whoEl.appendChild(el("span", "ltk-action-flag", " ⚑"));
    }
    card.appendChild(meta);

    if (!this.readOnly) this.attachDrag(card, a);
    return card;
  }

  // ---- gantt ----

  /**
   * Time-axis view: one row per dated action, bar from start to due (a
   * single-day bar when only one date is set). Undated actions list beneath.
   * Tap a row to edit — dates are changed in the dialog.
   */
  private renderGantt(visible: LtkAction[]): HTMLElement {
    const wrap = el("div", "ltk-ab-gantt");
    const dated = visible.filter((a) => a.due !== "" || a.start !== "");
    const undated = visible.filter((a) => a.due === "" && a.start === "");

    if (dated.length === 0) {
      wrap.appendChild(
        el(
          "div",
          "ltk-ab-g-empty",
          "No dated actions yet — add a start or due date to plot them here."
        )
      );
    } else {
      const today = dayNum(new Date().toISOString().slice(0, 10));
      const startOf = (a: LtkAction) => dayNum(a.start !== "" ? a.start : a.due);
      const endOf = (a: LtkAction) => dayNum(a.due !== "" ? a.due : a.start);
      let minDay = Math.min(today, ...dated.map(startOf));
      let maxDay = Math.max(today, ...dated.map(endOf));
      minDay -= 2;
      maxDay += 2;
      const days = maxDay - minDay + 1;
      const plotW = days * GANTT_DAY_W;

      const scroller = el("div", "ltk-ab-g-scroll");
      const inner = el("div", "ltk-ab-g-inner");
      inner.style.width = `${GANTT_LABEL_W + plotW}px`;

      // header: week tick labels (Mondays)
      const header = el("div", "ltk-ab-g-header");
      header.appendChild(el("div", "ltk-ab-g-corner"));
      const scale = el("div", "ltk-ab-g-scale");
      scale.style.width = `${plotW}px`;
      for (let d = minDay; d <= maxDay; d++) {
        if (new Date(d * 86400000).getUTCDay() === 1) {
          const tick = el("div", "ltk-ab-g-tick", dayLabel(d));
          tick.style.left = `${(d - minDay) * GANTT_DAY_W}px`;
          scale.appendChild(tick);
        }
      }
      header.appendChild(scale);
      inner.appendChild(header);

      const rows = el("div", "ltk-ab-g-rows");
      const sorted = dated
        .slice()
        .sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));
      for (const a of sorted) {
        const row = el("div", "ltk-ab-g-row");
        const label = el("div", "ltk-ab-g-label");
        if (a.issue.trim() !== "") {
          label.appendChild(el("div", "ltk-ab-card-issue", a.issue));
        }
        const desc = el(
          "div",
          "ltk-ab-g-desc" + (a.status === "done" ? " ltk-ab-done" : ""),
          a.description || a.issue
        );
        label.appendChild(desc);
        row.appendChild(label);

        const plot = el("div", "ltk-ab-g-plot");
        plot.style.width = `${plotW}px`;
        const s = startOf(a);
        const e = endOf(a);
        const bar = el("div", "ltk-ab-g-bar");
        bar.style.left = `${(s - minDay) * GANTT_DAY_W + 1}px`;
        bar.style.width = `${(e - s + 1) * GANTT_DAY_W - 2}px`;
        const colour =
          a.status === "done"
            ? this.doneColor()
            : isOverdue(a)
              ? this.overdueColor()
              : this.openColor();
        bar.style.background = colour;
        const who = el(
          "span",
          "ltk-ab-g-bar-who",
          `${a.escalated ? "⚑ " : ""}${a.assignees[0]?.who ?? ""}`
        );
        who.style.color = textOn(colour);
        bar.appendChild(who);
        plot.appendChild(bar);
        row.appendChild(plot);

        if (!this.readOnly) {
          row.addEventListener("click", () => this.editAction(a));
        }
        rows.appendChild(row);
      }
      inner.appendChild(rows);

      // today marker spanning header + rows
      const marker = el("div", "ltk-ab-g-today");
      marker.style.left = `${
        GANTT_LABEL_W + (today - minDay) * GANTT_DAY_W + GANTT_DAY_W / 2
      }px`;
      marker.style.height = `${28 + sorted.length * GANTT_ROW_H}px`;
      inner.appendChild(marker);

      scroller.appendChild(inner);
      wrap.appendChild(scroller);
    }

    if (undated.length > 0) {
      wrap.appendChild(
        el("div", "ltk-ab-g-undated-title", `No dates (${undated.length})`)
      );
      for (const a of this.sorted(undated)) {
        wrap.appendChild(
          actionRow(a, {
            doneColor: this.doneColor(),
            showIssue: true,
            readOnly: this.readOnly,
            onChanged: () => this.commit(),
            onEdit: (act) => this.editAction(act),
          })
        );
      }
    }
    return wrap;
  }

  // ---- kanban drag: move cards between columns ----

  private attachDrag(card: HTMLElement, a: LtkAction): void {
    makeInteractive(card, {
      onTap: () => this.editAction(a),
      onStart: (e) => {
        const rect = card.getBoundingClientRect();
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("ltk-ab-ghost");
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        this.root.appendChild(ghost);
        this.ghost = ghost;
        card.classList.add("ltk-ab-dragging");
      },
      onMove: (e) => {
        if (!this.ghost) return;
        this.ghost.style.left = `${e.clientX - this.dragOffsetX}px`;
        this.ghost.style.top = `${e.clientY - this.dragOffsetY}px`;
        this.updateDropTarget(e.clientX, e.clientY, a);
      },
      onEnd: () => {
        const target = this.currentDrop;
        this.clearDrag(card);
        if (target !== undefined) this.dropInColumn(a, target);
      },
    });
  }

  private currentKey(a: LtkAction): string {
    return this.groupBy === "status" ? a.status : a.issue.trim();
  }

  private updateDropTarget(x: number, y: number, dragging: LtkAction): void {
    let hit: { el: HTMLElement; key: string } | undefined;
    for (const zone of this.dropZones) {
      const r = zone.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        hit = zone;
        break;
      }
    }
    if (hit && hit.key === this.currentKey(dragging)) hit = undefined;
    this.currentDrop = hit?.key;
    for (const zone of this.dropZones) {
      zone.el.classList.toggle("ltk-ab-col-drop", zone === hit);
    }
  }

  private clearDrag(card: HTMLElement): void {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
    card.classList.remove("ltk-ab-dragging");
    for (const zone of this.dropZones) zone.el.classList.remove("ltk-ab-col-drop");
    this.currentDrop = undefined;
  }

  private dropInColumn(a: LtkAction, key: string): void {
    if (this.groupBy === "status") {
      a.status = key as ActionStatus;
      const done = a.status === "done";
      for (const x of a.assignees) x.done = done;
    } else {
      a.issue = key;
    }
    this.commit();
  }

  // ---- mutations ----

  private commit(): void {
    this.render();
    this.cb.onChange(this.actions);
    this.png.schedule();
  }

  private addAction(): void {
    const action = newAction({ source: "actionboard", sourceId: "" });
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: true,
      onCommit: () => {
        this.actions.push(action);
        this.commit();
      },
    });
  }

  private editAction(action: LtkAction): void {
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: false,
      onCommit: () => this.commit(),
    });
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + ACTIONBOARD_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + ACTIONBOARD_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "action-board.png";
      link.click();
    });
  }
}
