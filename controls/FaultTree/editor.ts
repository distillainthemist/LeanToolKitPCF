// The FaultTree editor: a top event with an arbitrary branching cause tree
// beneath it. Cards mirror the FiveWhys language (same shared cause model);
// drag a card onto another card to re-parent it — its whole subtree moves
// with it. Branches collapse; root causes flag + capture actions inline.

import { applyThemeVars, defaultTheme, textOn, Theme, tint, readableShade } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import {
  charCounter,
  checkItem,
  fieldRow,
  openDialog,
  sectionLabel,
  selectInput,
  textArea,
} from "../../shared/ui/dialog";
import {
  ActionForm,
  actionRow,
  addActionSection,
  openActionDialog,
} from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { PanZoom } from "../../shared/ui/panzoom";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import {
  CauseNode,
  CauseStatus,
  CAUSE_STATUSES,
  childrenOf,
  descendantsOf,
  MAX_CAUSE_CHARS,
  newCause,
} from "../../shared/schema/causes";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { FaultTreeEnvelope, SCHEMA_ID } from "./types";
import { FAULTTREE_CSS } from "./styles";

const DEFAULT_STATUS_COLORS: Record<CauseStatus, string> = {
  Hypothesis: "#f2c811",
  Confirmed: "#107c10",
  Rejected: "#d13438",
};

const DEFAULT_GHOST = [
  "Start your fault tree",
  "State the top event, then break it down branch by branch until you reach root causes.",
];

export interface FaultTreeEditorCallbacks {
  onChange: (env: FaultTreeEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

export class FaultTreeEditor {
  private readonly root: HTMLElement;
  private env: FaultTreeEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private showStatus = false;
  private readonly png: SnapshotScheduler;
  private readonly panzoom: PanZoom;

  /** Collapsed branch ids — transient UI state, not persisted. */
  private collapsed = new Set<string>();

  // drag state: re-parenting — drop zones are cards + the add-branch button
  private ghost: HTMLElement | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dropZones: { el: HTMLElement; causeId: string | null }[] = [];
  /** Target parent id, `null` = top level, undefined = no drop. */
  private currentDrop: string | null | undefined;

  constructor(
    host: HTMLElement,
    private readonly cb: FaultTreeEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-faulttree-css", FAULTTREE_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { problem: "", causes: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.panzoom = new PanZoom({ onView: () => this.png.schedule() });
    this.render();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setEnvelope(env: FaultTreeEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.panzoom.requestFit(); // auto-fit the (re)loaded tree
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

  setOptions(opts: { showStatus: boolean }): void {
    if (this.showStatus !== opts.showStatus) {
      this.showStatus = opts.showStatus;
      this.render();
    }
  }

  destroy(): void {
    this.png.cancel();
    this.panzoom.destroy();
    this.root.remove();
  }

  // ---- theming ----

  private statusColor(status: CauseStatus): string {
    const idx = CAUSE_STATUSES.indexOf(status);
    return this.theme.legend[idx] ?? DEFAULT_STATUS_COLORS[status];
  }

  private rootColor(cause: CauseNode): string {
    if (this.showStatus) return this.statusColor(cause.status);
    return this.theme.legend[1] ?? DEFAULT_STATUS_COLORS.Confirmed;
  }

  private doneColor(): string {
    return this.theme.legend[1] ?? DEFAULT_STATUS_COLORS.Confirmed;
  }

  // ---- rendering ----

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

    const body = el("div", "ltk-ft-body");
    this.root.appendChild(body);

    const hasContent =
      this.env.data.problem.trim() !== "" || this.env.data.causes.length > 0;
    if (!hasContent) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(
        body,
        this.readOnly ? lines : [...lines, "Tap to begin"]
      );
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editProblem());
      }
      return;
    }

    // the tree lives in a pan/zoom "world" inside the body viewport, so a big
    // tree can be shrunk to fit, zoomed and dragged around
    const world = el("div", "ltk-ft-world");
    const tree = el("div", "ltk-ft-tree");
    const root = el("div", "ltk-ft-node");
    root.appendChild(this.renderProblem());

    const top = childrenOf(this.env.data.causes, null);
    const seen = new Set<string>();
    if (top.length > 0) {
      root.appendChild(this.renderGate(null));
      const row = el("div", "ltk-ft-kids");
      top.forEach((cause, i) => {
        const branch = el("div", "ltk-ft-branch");
        branch.appendChild(this.renderNode(cause, `${i + 1}`, seen));
        row.appendChild(branch);
      });
      root.appendChild(row);
    } else if (!this.readOnly) {
      const add = el("button", "ltk-ft-add-branch", "＋ Add first cause");
      add.type = "button";
      add.style.marginTop = "14px";
      add.addEventListener("click", () => this.addCause(null));
      root.appendChild(add);
    }
    tree.appendChild(root);
    world.appendChild(tree);
    body.appendChild(world);
    body.appendChild(this.panzoom.cluster());
    this.panzoom.mount(body, world);
  }

  /**
   * The AND/OR gate pill on the connector beneath a parent (null = the top
   * event). Tap to toggle; persisted on the node (or data.rootGate).
   */
  private renderGate(parent: CauseNode | null): HTMLElement {
    const wrap = el("div", "ltk-ft-gatewrap");
    wrap.appendChild(el("div", "ltk-ft-vline"));
    const value = (parent ? parent.gate : this.env.data.rootGate) ?? "or";
    const pill = el("button", "ltk-ft-gate", value.toUpperCase());
    pill.type = "button";
    if (this.readOnly) {
      pill.classList.add("ltk-readonly");
    } else {
      pill.title = "Toggle AND / OR";
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = value === "or" ? "and" : "or";
        if (parent) parent.gate = next;
        else this.env.data.rootGate = next;
        this.commit();
      });
    }
    wrap.appendChild(pill);
    wrap.appendChild(el("div", "ltk-ft-vline"));
    return wrap;
  }

  private renderProblem(): HTMLElement {
    const card = el("div", "ltk-ft-problem");
    if (this.readOnly) card.classList.add("ltk-readonly");
    card.style.background = this.theme.accent;
    card.style.color = textOn(this.theme.accent);
    card.appendChild(el("div", "ltk-ft-problem-label", "Top event"));
    const hint = hintFor(this.prompts, "problem", "What is the failure or problem?");
    card.appendChild(
      el(
        "div",
        "ltk-ft-problem-text" +
          (this.env.data.problem.trim() === "" ? " ltk-ft-placeholder" : ""),
        this.env.data.problem.trim() === "" ? hint : this.env.data.problem
      )
    );
    if (!this.readOnly) {
      card.addEventListener("click", () => this.editProblem());
      const add = el("button", "ltk-ft-mini ltk-ft-mini-invert", "＋");
      add.type = "button";
      add.title = "Add a cause beneath the top event";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        this.addCause(null);
      });
      card.appendChild(add);
    }
    return card;
  }

  /** One node: its card, then a gate + children row when expanded. */
  private renderNode(cause: CauseNode, path: string, seen: Set<string>): HTMLElement {
    const node = el("div", "ltk-ft-node");
    if (seen.has(cause.id)) return node; // malformed cycle — render nothing
    seen.add(cause.id);

    const kids = childrenOf(this.env.data.causes, cause.id);
    node.appendChild(this.renderCard(cause, path, kids.length));

    if (kids.length > 0 && !this.collapsed.has(cause.id)) {
      node.appendChild(this.renderGate(cause));
      const row = el("div", "ltk-ft-kids");
      kids.forEach((kid, i) => {
        const branch = el("div", "ltk-ft-branch");
        branch.appendChild(this.renderNode(kid, `${path}.${i + 1}`, seen));
        row.appendChild(branch);
      });
      node.appendChild(row);
    }
    return node;
  }

  private renderCard(cause: CauseNode, path: string, childCount: number): HTMLElement {
    const card = el("div", "ltk-ft-card");
    card.dataset.causeId = cause.id;
    if (this.readOnly) card.classList.add("ltk-readonly");

    const rootColour = this.rootColor(cause);
    if (this.showStatus) {
      card.style.borderTopWidth = "3px";
      card.style.borderTopColor = this.statusColor(cause.status);
    }
    if (cause.isRoot) {
      card.style.background = tint(rootColour, 0.9);
      card.style.borderColor = rootColour;
    }

    const tag = el("div", "ltk-ft-card-tag");
    if (cause.isRoot) tag.style.color = readableShade(rootColour);
    tag.appendChild(el("span", undefined, path));
    if (cause.isRoot) {
      const pill = el("span", "ltk-ft-root-pill", "Root cause");
      pill.style.background = rootColour;
      pill.style.color = textOn(rootColour);
      tag.appendChild(pill);
    }
    tag.appendChild(el("span", "ltk-ft-spacer"));
    if (childCount > 0) {
      const chevron = el(
        "button",
        "ltk-ft-mini",
        this.collapsed.has(cause.id) ? `▸ ${childCount}` : "▾"
      );
      chevron.type = "button";
      chevron.title = this.collapsed.has(cause.id) ? "Expand branch" : "Collapse branch";
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.collapsed.has(cause.id)) this.collapsed.delete(cause.id);
        else this.collapsed.add(cause.id);
        this.render();
      });
      tag.appendChild(chevron);
    }
    card.appendChild(tag);

    const hint = hintFor(this.prompts, "cause", "What could cause this?");
    card.appendChild(
      el(
        "div",
        "ltk-ft-card-text",
        cause.text.trim() === "" ? hint : cause.text
      )
    );

    const foot = el("div", "ltk-ft-card-foot");
    foot.appendChild(
      el("span", undefined, this.showStatus ? cause.status : "")
    );
    const right = el("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "6px";
    const related = this.actions.filter(
      (a) => a.context.sourceId === cause.id && a.status !== "cancelled"
    );
    const openCount = related.filter((a) => a.status !== "done").length;
    if (openCount > 0) {
      right.appendChild(
        el(
          "span",
          "ltk-ft-badge ltk-ft-badge-action",
          `${openCount} Action${openCount > 1 ? "s" : ""}`
        )
      );
    } else if (related.length > 0) {
      const doneBadge = el("span", "ltk-ft-badge", "✓ Done");
      const dc = this.doneColor();
      doneBadge.style.background = dc;
      doneBadge.style.color = textOn(dc);
      right.appendChild(doneBadge);
    }
    if (!this.readOnly) {
      const add = el("button", "ltk-ft-mini", "＋");
      add.type = "button";
      add.title = "Add a cause beneath this";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        this.collapsed.delete(cause.id);
        this.addCause(cause.id);
      });
      right.appendChild(add);
    }
    foot.appendChild(right);
    card.appendChild(foot);

    if (!this.readOnly) {
      this.attachDrag(card, cause);
    }
    return card;
  }

  // ---- drag to re-parent ----

  private attachDrag(card: HTMLElement, cause: CauseNode): void {
    makeInteractive(card, {
      onTap: () => this.editCause(cause),
      onStart: (e) => {
        const rect = card.getBoundingClientRect();
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("ltk-ft-ghost");
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        this.root.appendChild(ghost);
        this.ghost = ghost;
        card.classList.add("ltk-ft-dragging");
        // drop zones register lazily, at drag start, so the list reflects
        // the tree as currently rendered: the top-event card (→ top level)
        // plus every card outside the dragged subtree
        this.dropZones = [];
        const problem = this.root.querySelector<HTMLElement>(".ltk-ft-problem");
        if (problem) this.dropZones.push({ el: problem, causeId: null });
        const forbidden = new Set<string>([
          cause.id,
          ...descendantsOf(this.env.data.causes, cause.id).map((c) => c.id),
        ]);
        for (const cardEl of Array.from(
          this.root.querySelectorAll<HTMLElement>(".ltk-ft-card")
        )) {
          const id = cardEl.dataset.causeId;
          if (id && !forbidden.has(id)) {
            this.dropZones.push({ el: cardEl, causeId: id });
          }
        }
      },
      onMove: (e) => {
        if (!this.ghost) return;
        this.ghost.style.left = `${e.clientX - this.dragOffsetX}px`;
        this.ghost.style.top = `${e.clientY - this.dragOffsetY}px`;
        this.updateDropTarget(e.clientX, e.clientY, cause);
      },
      onEnd: () => {
        const target = this.currentDrop;
        this.clearDrag(card);
        if (target !== undefined) {
          cause.parentId = target;
          if (target !== null) this.collapsed.delete(target);
          this.commit();
        }
      },
    });
  }

  private updateDropTarget(x: number, y: number, dragging: CauseNode): void {
    let hit: { el: HTMLElement; causeId: string | null } | undefined;
    for (const zone of this.dropZones) {
      const r = zone.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        hit = zone;
        break;
      }
    }
    // no-ops: dropping on the current parent, or to top level when already there
    if (hit && hit.causeId === dragging.parentId) hit = undefined;
    this.currentDrop = hit ? hit.causeId : undefined;
    for (const zone of this.dropZones) {
      zone.el.classList.toggle("ltk-ft-drop-target", zone === hit);
    }
  }

  private clearDrag(card: HTMLElement): void {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
    card.classList.remove("ltk-ft-dragging");
    for (const zone of this.dropZones) {
      zone.el.classList.remove("ltk-ft-drop-target");
    }
    this.currentDrop = undefined;
  }

  // ---- mutations ----

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

  private editProblem(): void {
    const ta = textArea(this.env.data.problem, {
      placeholder: hintFor(this.prompts, "problem", "What is the failure or problem?"),
      rows: 3,
    });
    const dlg = openDialog({
      host: this.root,
      title: "Top event",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            this.env.data.problem = ta.value.trim();
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Top event", ta));
    ta.focus();
  }

  private addCause(parentId: string | null): void {
    const ta = textArea("", {
      placeholder: hintFor(this.prompts, "cause", "What could cause this?"),
      rows: 3,
      maxLength: MAX_CAUSE_CHARS,
    });
    const rootChk = checkItem("This is the root cause");
    const inline = addActionSection(this.people);
    const dlg = openDialog({
      host: this.root,
      title: "Add cause",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Add",
          kind: "primary",
          onClick: () => {
            const text = ta.value.trim();
            if (text === "") return;
            const created = newCause({
              text,
              parentId,
              isRoot: rootChk.box.checked,
            });
            this.env.data.causes.push(created);
            if (inline.form.hasContent()) {
              this.pushAction(created, text, inline.form);
            }
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Cause", ta));
    dlg.body.appendChild(charCounter(ta, MAX_CAUSE_CHARS));
    dlg.body.appendChild(rootChk.wrap);
    dlg.body.appendChild(inline.el);
    ta.focus();
  }

  private editCause(cause: CauseNode): void {
    const ta = textArea(cause.text, { rows: 3, maxLength: MAX_CAUSE_CHARS });
    const statusSel = selectInput(
      cause.status,
      CAUSE_STATUSES.map((s) => ({ value: s, label: s }))
    );
    const rootChk = checkItem("This is the root cause");
    rootChk.box.checked = cause.isRoot;
    rootChk.wrap.classList.toggle("ltk-check-on", cause.isRoot);

    const dlg = openDialog({
      host: this.root,
      title: "Edit cause",
      buttons: [
        {
          label: "Delete",
          kind: "danger",
          onClick: () => {
            this.deleteCause(cause);
            dlg.close();
            this.commit();
          },
        },
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            cause.text = ta.value.trim().slice(0, MAX_CAUSE_CHARS);
            if (this.showStatus) cause.status = statusSel.value as CauseStatus;
            cause.isRoot = rootChk.box.checked;
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Cause", ta));
    dlg.body.appendChild(charCounter(ta, MAX_CAUSE_CHARS));
    if (this.showStatus) dlg.body.appendChild(fieldRow("Status", statusSel));
    dlg.body.appendChild(rootChk.wrap);

    const existing = this.actions.filter(
      (a) => a.context.sourceId === cause.id && a.status !== "cancelled"
    );
    dlg.body.appendChild(
      sectionLabel(existing.length > 0 ? `Actions (${existing.length})` : "Actions")
    );
    for (const a of existing) {
      dlg.body.appendChild(
        actionRow(a, {
          doneColor: this.doneColor(),
          onChanged: () => this.commitActions(),
          onEdit: (act) =>
            openActionDialog({
              host: this.root,
              action: act,
              people: this.people,
              isNew: false,
              onCommit: () => this.commitActions(),
            }),
        })
      );
    }
    const raise = el("button", "ltk-btn ltk-btn-secondary", "＋ Raise action");
    raise.type = "button";
    raise.addEventListener("click", () => {
      dlg.close();
      const action = newAction({
        source: "faulttree",
        sourceId: cause.id,
        hint: cause.isRoot ? "root-cause" : undefined,
      });
      action.issue = cause.text;
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
    });
    dlg.body.appendChild(raise);
    ta.focus();
  }

  /**
   * Delete a cause; its children re-parent to its parent (the branch closes
   * up). Its open actions are CANCELLED, never removed.
   */
  private deleteCause(cause: CauseNode): void {
    for (const kid of childrenOf(this.env.data.causes, cause.id)) {
      kid.parentId = cause.parentId;
    }
    this.env.data.causes = this.env.data.causes.filter((c) => c.id !== cause.id);
    for (const a of this.actions) {
      if (a.context.sourceId === cause.id && a.status !== "done") {
        a.status = "cancelled";
      }
    }
  }

  private pushAction(cause: CauseNode, issue: string, form: ActionForm): void {
    const action: LtkAction = newAction({
      source: "faulttree",
      sourceId: cause.id,
      hint: cause.isRoot ? "root-cause" : undefined,
    });
    action.issue = issue;
    form.apply(action);
    this.actions.push(action);
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + FAULTTREE_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + FAULTTREE_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "fault-tree.svg")
    );
  }

private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + FAULTTREE_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "fault-tree.png";
      link.click();
    });
  }
}
