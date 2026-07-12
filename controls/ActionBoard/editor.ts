// The ActionBoard editor: one canonical action set rendered as a list or a
// kanban. The actions channel IS the data — no card document. Cancelled
// actions are hidden but preserved. Plain DOM; full re-render per mutation.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { actionRow, completeCircle, openActionDialog } from "../../shared/ui/actionUi";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
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

const GANTT_ROW_H = 40;
const GANTT_HEAD_H = 28;
const GANTT_MIN_DAY_W = 8;
const GANTT_MAX_DAY_W = 56;

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
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
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

  // gantt state (transient): zoom level and the scroll position to restore
  // after a zoom re-render
  private ganttDayW = 24;
  private ganttScrollFrac: number | null = null;
  // one-shot: fit the day-width to [today … latest] and start the view at
  // today. Armed on first render and whenever the gantt view is (re)entered,
  // then consumed once the plot has been measured.
  private ganttAutoFit = true;
  // day pinned to the left edge (today after an auto-fit). Re-applied on every
  // gantt render so a host re-render can't lose it; cleared once the user
  // scrolls away or zooms.
  private ganttViewStart: number | null = null;

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
    // re-fit the gantt whenever it is (re)entered
    if (opts.view === "gantt" && this.view !== "gantt") this.ganttAutoFit = true;
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

  /**
   * Completed actions drop below open ones; within each group, earliest due
   * date first with undated actions last (then by start, issue).
   */
  private sorted(list: LtkAction[]): LtkAction[] {
    return list.slice().sort((a, b) => {
      const doneA = a.status === "done" ? 1 : 0;
      const doneB = b.status === "done" ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
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
        { label: "Download SVG", onClick: () => this.downloadSvg() },
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

    // top row: complete circle beside the issue tag (or standing alone)
    const head = el("div", "ltk-ab-card-head");
    const circle = completeCircle(a, this.doneColor(), () => this.commit(), this.readOnly);
    head.appendChild(circle);
    if (this.groupBy !== "issue" && a.issue.trim() !== "") {
      head.appendChild(el("div", "ltk-ab-card-issue", a.issue));
    }
    card.appendChild(head);

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
   * Time-axis view. Fixed left columns (Issue/Action, Who, Dates) beside a
   * horizontally scrollable, zoomable plot: bars run start→due (a single-day
   * bar when only one date is set), coloured by state, with a today marker.
   * Zoom via the −/＋ buttons or Ctrl/Cmd + wheel; tap a row to edit.
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
      const dayW = this.ganttDayW;
      const today = dayNum(new Date().toISOString().slice(0, 10));
      const startOf = (a: LtkAction) => dayNum(a.start !== "" ? a.start : a.due);
      const endOf = (a: LtkAction) => dayNum(a.due !== "" ? a.due : a.start);
      let minDay = Math.min(today, ...dated.map(startOf));
      let maxDay = Math.max(today, ...dated.map(endOf));
      minDay -= 2;
      maxDay += 2;
      const days = maxDay - minDay + 1;
      const plotW = days * dayW;
      const sorted = dated
        .slice()
        .sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));

      const scroller = el("div", "ltk-ab-g-scroll");
      const zoom = (mult: number, focusFrac?: number) => {
        this.ganttViewStart = null; // manual zoom takes over from the today-pin
        this.ganttScrollFrac =
          focusFrac ??
          (scroller.scrollLeft + scroller.clientWidth / 2) /
            Math.max(1, scroller.scrollWidth);
        this.ganttDayW = Math.max(
          GANTT_MIN_DAY_W,
          Math.min(GANTT_MAX_DAY_W, Math.round(this.ganttDayW * mult))
        );
        this.render();
      };

      // zoom controls
      const zoomBar = el("div", "ltk-ab-g-zoom");
      const zOut = el("button", "ltk-ab-g-zbtn", "−");
      zOut.type = "button";
      zOut.title = "Zoom out";
      zOut.addEventListener("click", () => zoom(0.75));
      const zIn = el("button", "ltk-ab-g-zbtn", "＋");
      zIn.type = "button";
      zIn.title = "Zoom in";
      zIn.addEventListener("click", () => zoom(1.33));
      zoomBar.append(zOut, zIn);
      wrap.appendChild(zoomBar);

      const main = el("div", "ltk-ab-g-main");

      // fixed left pane: Issue/Action, Who, Dates
      const left = el("div", "ltk-ab-g-left");
      const lhead = el("div", "ltk-ab-g-lhead");
      lhead.append(
        el("div", "ltk-ab-g-hcell ltk-ab-g-c0"),
        el("div", "ltk-ab-g-hcell ltk-ab-g-c1", "Issue / Action"),
        el("div", "ltk-ab-g-hcell ltk-ab-g-c2", "Who"),
        el("div", "ltk-ab-g-hcell ltk-ab-g-c3", "Dates")
      );
      left.appendChild(lhead);
      for (const a of sorted) {
        const lrow = el("div", "ltk-ab-g-lrow");
        const c0 = el("div", "ltk-ab-g-c0");
        c0.appendChild(
          completeCircle(a, this.doneColor(), () => this.commit(), this.readOnly)
        );
        const c1 = el("div", "ltk-ab-g-c1");
        if (a.issue.trim() !== "") {
          c1.appendChild(el("div", "ltk-ab-card-issue", a.issue));
        }
        c1.appendChild(
          el(
            "div",
            "ltk-ab-g-desc" + (a.status === "done" ? " ltk-ab-done" : ""),
            a.description || a.issue
          )
        );
        const c2 = el("div", "ltk-ab-g-c2", a.assignees[0]?.who ?? "—");
        const c3 = el("div", "ltk-ab-g-c3");
        const range =
          (a.start !== "" ? dayLabel(dayNum(a.start)) + " → " : "") +
          (a.due !== "" ? dayLabel(dayNum(a.due)) : "");
        const rangeEl = el("span", undefined, range);
        if (a.due !== "" && isOverdue(a)) {
          rangeEl.classList.add("ltk-action-overdue");
        }
        c3.appendChild(rangeEl);
        if (a.escalated) c3.appendChild(el("span", "ltk-action-flag", " ⚑"));
        lrow.append(c0, c1, c2, c3);
        if (!this.readOnly) {
          lrow.addEventListener("click", () => this.editAction(a));
        }
        left.appendChild(lrow);
      }
      main.appendChild(left);

      // scrollable, zoomable plot pane
      const inner = el("div", "ltk-ab-g-inner");
      inner.style.width = `${plotW}px`;

      const scale = el("div", "ltk-ab-g-scale");
      for (let d = minDay; d <= maxDay; d++) {
        if (new Date(d * 86400000).getUTCDay() === 1) {
          const tick = el("div", "ltk-ab-g-tick", dayLabel(d));
          tick.style.left = `${(d - minDay) * dayW}px`;
          scale.appendChild(tick);
        }
      }
      inner.appendChild(scale);

      for (const a of sorted) {
        const plot = el("div", "ltk-ab-g-plot");
        const s = startOf(a);
        const e = endOf(a);
        const bar = el("div", "ltk-ab-g-bar");
        bar.style.left = `${(s - minDay) * dayW + 1}px`;
        bar.style.width = `${(e - s + 1) * dayW - 2}px`;
        const colour =
          a.status === "done"
            ? this.doneColor()
            : isOverdue(a)
              ? this.overdueColor()
              : this.openColor();
        bar.style.background = colour;
        plot.appendChild(bar);
        if (!this.readOnly) {
          plot.addEventListener("click", () => this.editAction(a));
        }
        inner.appendChild(plot);
      }

      // today marker spanning scale + rows
      const marker = el("div", "ltk-ab-g-today");
      marker.style.left = `${(today - minDay) * dayW + dayW / 2}px`;
      marker.style.height = `${GANTT_HEAD_H + sorted.length * GANTT_ROW_H}px`;
      inner.appendChild(marker);

      scroller.appendChild(inner);
      // Ctrl/Cmd + wheel zooms about the pointer; plain wheel scrolls
      scroller.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const rect = scroller.getBoundingClientRect();
          const frac =
            (scroller.scrollLeft + (e.clientX - rect.left)) /
            Math.max(1, scroller.scrollWidth);
          zoom(e.deltaY < 0 ? 1.25 : 0.8, frac);
        },
        { passive: false }
      );
      main.appendChild(scroller);
      wrap.appendChild(main);

      // where today (or another pinned day) should sit at the left edge,
      // clamped to the scroll range
      const pinTarget = () => {
        const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        return Math.min(
          maxScroll,
          Math.max(0, (this.ganttViewStart! - minDay) * this.ganttDayW)
        );
      };
      const applyPin = () => {
        if (this.ganttViewStart === null) return;
        requestAnimationFrame(() => {
          if (this.ganttViewStart !== null) scroller.scrollLeft = pinTarget();
        });
      };
      // a scroll that lands away from the pin means the user took control
      scroller.addEventListener("scroll", () => {
        if (this.ganttViewStart === null) return;
        if (Math.abs(scroller.scrollLeft - pinTarget()) > 2) {
          this.ganttViewStart = null;
        }
      });

      if (this.ganttAutoFit) {
        // measure the plot pane, size a day so [today … latest] fills it, then
        // pin today to the left edge (re-rendering if the zoom changed)
        requestAnimationFrame(() => {
          const avail = scroller.clientWidth;
          if (avail <= 0) return;
          this.ganttAutoFit = false;
          this.ganttViewStart = today;
          const spanDays = Math.max(1, maxDay - today + 1);
          const w = Math.max(
            GANTT_MIN_DAY_W,
            Math.min(GANTT_MAX_DAY_W, Math.floor(avail / spanDays))
          );
          if (w !== this.ganttDayW) {
            this.ganttDayW = w;
            this.render(); // applyPin runs in the fresh render
          } else {
            applyPin();
          }
        });
      } else if (this.ganttViewStart !== null) {
        applyPin();
      } else if (this.ganttScrollFrac !== null) {
        // restore the centre after a manual zoom re-render
        const frac = this.ganttScrollFrac;
        this.ganttScrollFrac = null;
        requestAnimationFrame(() => {
          scroller.scrollLeft =
            frac * scroller.scrollWidth - scroller.clientWidth / 2;
        });
      }
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
    htmlToPng(this.root, LTK_BASE_CSS + ACTIONBOARD_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + ACTIONBOARD_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "action-board.svg")
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
