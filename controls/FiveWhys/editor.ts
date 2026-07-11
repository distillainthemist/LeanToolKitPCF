// The FiveWhys editor: a problem card, one or more why-chains (linked cause
// cards with arrows), root-cause marking, and action capture on any cause.
// Plain DOM rendering; full re-render per mutation (documents are small).

import { applyThemeVars, defaultTheme, textOn, Theme, tint, readableShade } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet, svgEl } from "../../shared/ui/dom";
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
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import {
  CauseNode,
  CauseStatus,
  CAUSE_STATUSES,
  MAX_CAUSE_CHARS,
  newCause,
} from "../../shared/schema/causes";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { FiveWhysEnvelope, chains, SCHEMA_ID } from "./types";
import { FIVEWHYS_CSS } from "./styles";

const DEFAULT_STATUS_COLORS: Record<CauseStatus, string> = {
  Hypothesis: "#f2c811",
  Confirmed: "#107c10",
  Rejected: "#d13438",
};

const DEFAULT_GHOST = [
  "Start your 5 whys",
  "State the problem, then keep asking why until you reach a cause you can act on.",
];

export interface FiveWhysEditorCallbacks {
  onChange: (env: FiveWhysEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

export class FiveWhysEditor {
  private readonly host: HTMLElement;
  private readonly root: HTMLElement;
  private env: FiveWhysEnvelope;
  /** The actions channel — separate from the card document (central table). */
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private readOnly = false;
  private showStatus = false;
  private readonly png: SnapshotScheduler;

  // drag state: a fixed-position ghost follows the pointer; chain rows and
  // the add-chain button register as drop zones each render. Within a chain
  // the drop is positional — an insertion marker shows the target gap.
  private ghost: HTMLElement | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dropZones: { el: HTMLElement; startId: string | null }[] = [];
  private insertMarker: HTMLElement | null = null;
  /** Positional target, `null` = break out as a new chain, undefined = none. */
  private currentDrop:
    | { chain: string; afterId: string | null }
    | null
    | undefined;

  constructor(
    host: HTMLElement,
    private readonly cb: FiveWhysEditorCallbacks
  ) {
    this.host = host;
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-fivewhys-css", FIVEWHYS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { problem: "", causes: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  // ---- host-facing API ----

  setEnvelope(env: FiveWhysEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  // setters no-op when the value is unchanged: updateView fires for many
  // reasons, and a gratuitous re-render would close any open dialog
  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setPeople(people: Person[]): void {
    this.people = people;
  }

  private lastPromptsRaw: string | null = null;

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
    this.root.remove();
  }

  // ---- theming helpers ----

  private statusColor(status: CauseStatus): string {
    const idx = CAUSE_STATUSES.indexOf(status);
    return this.theme.legend[idx] ?? DEFAULT_STATUS_COLORS[status];
  }

  /** Root highlight: status colour when statuses are on, green otherwise. */
  private rootColor(cause: CauseNode): string {
    if (this.showStatus) return this.statusColor(cause.status);
    return this.theme.legend[1] ?? DEFAULT_STATUS_COLORS.Confirmed;
  }

  /** Highlight for completed actions (ticked circle, done badge). */
  private doneColor(): string {
    return this.theme.legend[1] ?? DEFAULT_STATUS_COLORS.Confirmed;
  }

  // ---- rendering ----

  /** Re-render the board, keeping any open dialog alive across the rebuild
      (live changes like completing an action commit while a dialog is up). */
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

    const body = el("div", "ltk-fw-body");
    this.root.appendChild(body);

    const hasContent =
      this.env.data.problem.trim() !== "" || this.env.data.causes.length > 0;
    if (!hasContent) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(body, this.readOnly ? lines : [...lines, "Tap to begin"]);
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editProblem());
      }
      return;
    }

    body.appendChild(this.renderProblem());

    const chainsWrap = el("div", "ltk-fw-chains");
    for (const chain of chains(this.env.data)) {
      chainsWrap.appendChild(this.renderChain(chain));
    }
    body.appendChild(chainsWrap);

    if (!this.readOnly) {
      const addChain = el(
        "button",
        "ltk-fw-add-chain",
        this.env.data.causes.length === 0 ? "＋ Add first why" : "＋ Add another why chain"
      );
      addChain.type = "button";
      addChain.addEventListener("click", () => this.addCause(null));
      body.appendChild(addChain);
      this.dropZones.push({ el: addChain, startId: null });
    }
  }

  private renderProblem(): HTMLElement {
    const card = el("div", "ltk-fw-problem");
    if (this.readOnly) card.classList.add("ltk-readonly");
    card.style.background = this.theme.accent;
    card.style.color = textOn(this.theme.accent);
    card.appendChild(el("div", "ltk-fw-problem-label", "Problem"));
    const hint = hintFor(this.prompts, "problem", "What is the problem?");
    const text = el(
      "div",
      "ltk-fw-problem-text" +
        (this.env.data.problem.trim() === "" ? " ltk-fw-placeholder" : ""),
      this.env.data.problem.trim() === "" ? hint : this.env.data.problem
    );
    card.appendChild(text);
    if (!this.readOnly) {
      card.addEventListener("click", () => this.editProblem());
    }
    return card;
  }

  private renderChain(chain: CauseNode[]): HTMLElement {
    const row = el("div", "ltk-fw-chain");
    this.dropZones.push({ el: row, startId: chain[0].id });
    chain.forEach((cause, i) => {
      const step = el("div", "ltk-fw-step");
      if (i > 0) step.appendChild(this.renderArrow());
      step.appendChild(this.renderCard(cause, i));
      row.appendChild(step);
    });
    const last = chain[chain.length - 1];
    if (!this.readOnly && last && !last.isRoot) {
      const add = el("button", "ltk-fw-add", "＋");
      add.type = "button";
      add.title = "Ask why again";
      add.addEventListener("click", () => this.addCause(last.id));
      row.appendChild(this.renderArrow());
      row.appendChild(add);
    }
    return row;
  }

  private renderArrow(): HTMLElement {
    const wrap = el("div", "ltk-fw-arrow");
    const svg = svgEl("svg", { width: "22", height: "16", viewBox: "0 0 22 16" });
    const path = svgEl("path", {
      d: "M1 8 H16 M11 2.5 L17 8 L11 13.5",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
  }

  private renderCard(cause: CauseNode, index: number): HTMLElement {
    const card = el("div", "ltk-fw-card");
    card.dataset.causeId = cause.id;
    if (this.readOnly) card.classList.add("ltk-readonly");
    // colours set directly (not via inline custom properties) — some Safari
    // versions drop var()-driven backgrounds on dynamically created elements
    const rootColour = this.rootColor(cause);
    if (this.showStatus) {
      card.style.borderTopWidth = "3px";
      card.style.borderTopColor = this.statusColor(cause.status);
    }
    if (cause.isRoot) {
      card.classList.add("ltk-fw-root");
      card.style.background = tint(rootColour, 0.9);
      card.style.borderColor = rootColour;
    }

    const tag = el("div", "ltk-fw-card-tag");
    if (cause.isRoot) tag.style.color = readableShade(rootColour);
    tag.appendChild(el("span", undefined, `Why ${index + 1}`));
    if (cause.isRoot) {
      const pill = el("span", "ltk-fw-root-pill", "Root cause");
      pill.style.background = rootColour;
      pill.style.color = textOn(rootColour);
      tag.appendChild(pill);
    }
    card.appendChild(tag);

    const hint = hintFor(this.prompts, "why", "Why did this happen?");
    card.appendChild(
      el(
        "div",
        "ltk-fw-card-text" + (cause.text.trim() === "" ? " ltk-fw-placeholder" : ""),
        cause.text.trim() === "" ? hint : cause.text
      )
    );

    const foot = el("div", "ltk-fw-card-foot");
    foot.appendChild(
      el("span", undefined, this.showStatus ? cause.status : "")
    );
    const related = this.actions.filter(
      (a) => a.context.sourceId === cause.id && a.status !== "cancelled"
    );
    const openCount = related.filter((a) => a.status !== "done").length;
    if (openCount > 0) {
      foot.appendChild(
        el(
          "span",
          "ltk-fw-badge ltk-fw-badge-action",
          `${openCount} Action${openCount > 1 ? "s" : ""}`
        )
      );
    } else if (related.length > 0) {
      // every action on this cause is complete
      const doneBadge = el("span", "ltk-fw-badge", "✓ Done");
      const dc = this.doneColor();
      doneBadge.style.background = dc;
      doneBadge.style.color = textOn(dc);
      foot.appendChild(doneBadge);
    }
    card.appendChild(foot);

    if (!this.readOnly) {
      this.attachDrag(card, cause);
    }
    return card;
  }

  // ---------- drag and drop between chains ----------

  private attachDrag(card: HTMLElement, cause: CauseNode): void {
    makeInteractive(card, {
      onTap: () => this.editCause(cause),
      onStart: (e) => {
        const rect = card.getBoundingClientRect();
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("ltk-fw-ghost");
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        this.root.appendChild(ghost); // inside root so theme vars apply
        this.ghost = ghost;
        card.classList.add("ltk-fw-dragging");
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
        if (target !== undefined) this.moveCause(cause, target);
      },
    });
  }

  /** The id of the first cause in the chain this cause belongs to. */
  private chainStartOf(cause: CauseNode): string {
    const byId = new Map(this.env.data.causes.map((c) => [c.id, c]));
    const seen = new Set<string>();
    let current = cause;
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId) as CauseNode;
    }
    return current.id;
  }

  private updateDropTarget(x: number, y: number, dragging: CauseNode): void {
    let hit: { el: HTMLElement; startId: string | null } | undefined;
    for (const zone of this.dropZones) {
      const r = zone.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        hit = zone;
        break;
      }
    }

    // the add-chain button: break the card out as a new chain (no-op when
    // the card is already a chain of its own head)
    if (hit && hit.startId === null) {
      this.currentDrop = dragging.parentId === null ? undefined : null;
      hit.el.classList.toggle("ltk-fw-drop", this.currentDrop === null);
      this.showInsertMarker(null, 0);
      return;
    }
    for (const zone of this.dropZones) zone.el.classList.remove("ltk-fw-drop");

    // a chain row: positional — find the gap under the pointer
    let pos: { chain: string; afterId: string | null } | undefined;
    let markerX = 0;
    if (hit) {
      const row = hit.el;
      const cards = Array.from(
        row.querySelectorAll<HTMLElement>(".ltk-fw-card")
      ).filter((c) => !c.classList.contains("ltk-fw-dragging"));
      if (cards.length > 0) {
        const rowRect = row.getBoundingClientRect();
        let index = cards.length; // default: after the last card
        for (let i = 0; i < cards.length; i++) {
          const r = cards[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            index = i;
            break;
          }
        }
        const afterId =
          index === 0 ? null : cards[index - 1].dataset.causeId ?? null;
        pos = { chain: hit.startId as string, afterId };
        const edge =
          index === 0
            ? cards[0].getBoundingClientRect().left - 8
            : cards[index - 1].getBoundingClientRect().right + 8;
        markerX = Math.max(2, edge - rowRect.left + row.scrollLeft);
      }
    }

    // no-op: dropping back into the gap the card already occupies
    if (
      pos &&
      pos.afterId === dragging.parentId &&
      (pos.afterId !== null || this.chainStartOf(dragging) === pos.chain)
    ) {
      pos = undefined;
    }

    this.currentDrop = pos;
    this.showInsertMarker(pos && hit ? hit.el : null, markerX);
  }

  private showInsertMarker(row: HTMLElement | null, x: number): void {
    if (!row) {
      if (this.insertMarker) this.insertMarker.remove();
      this.insertMarker = null;
      return;
    }
    if (!this.insertMarker) {
      this.insertMarker = el("div", "ltk-fw-insert-marker");
    }
    if (this.insertMarker.parentElement !== row) {
      row.appendChild(this.insertMarker);
    }
    this.insertMarker.style.left = `${x}px`;
  }

  private clearDrag(card: HTMLElement): void {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
    card.classList.remove("ltk-fw-dragging");
    for (const zone of this.dropZones) zone.el.classList.remove("ltk-fw-drop");
    this.showInsertMarker(null, 0);
    this.currentDrop = undefined;
  }

  /**
   * Move a cause into a specific gap of a chain (or out as a new chain),
   * splicing its own chain back together behind it. Chains are linked lists
   * via parentId, so a move is: splice out, then relink at the target gap.
   */
  private moveCause(
    cause: CauseNode,
    target: { chain: string; afterId: string | null } | null
  ): void {
    const causes = this.env.data.causes;
    const oldChild = causes.find((c) => c.parentId === cause.id);
    if (oldChild) oldChild.parentId = cause.parentId;

    if (target === null) {
      cause.parentId = null; // new chain
    } else if (target.afterId === null) {
      // becomes the new head; the old head (post-splice) hangs off it
      const headId = target.chain === cause.id ? oldChild?.id : target.chain;
      const head = causes.find((c) => c.id === headId && c.id !== cause.id);
      cause.parentId = null;
      if (head) head.parentId = cause.id;
    } else {
      const after = causes.find((c) => c.id === target.afterId);
      if (!after) return;
      const next = causes.find(
        (c) => c.parentId === after.id && c.id !== cause.id
      );
      cause.parentId = after.id;
      if (next) next.parentId = cause.id;
    }
    this.commit();
  }

  // ---- mutations ----

  /** A change to the card document (and possibly actions). */
  private commit(): void {
    this.env.meta.updated = nowIso();
    this.emit();
  }

  /** An actions-only change — the document (and its timestamp) is untouched. */
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
      placeholder: hintFor(this.prompts, "problem", "What is the problem?"),
      rows: 3,
    });
    const dlg = openDialog({
      host: this.root,
      title: "Problem",
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
    dlg.body.appendChild(fieldRow("Problem statement", ta));
    ta.focus();
  }

  private addCause(parentId: string | null): void {
    const ta = textArea("", {
      placeholder: hintFor(this.prompts, "why", "Why did this happen?"),
      rows: 3,
      maxLength: MAX_CAUSE_CHARS,
    });
    const rootChk = checkItem("This is the root cause");
    const inline = addActionSection(this.people);
    const depth =
      parentId === null
        ? 1
        : chains(this.env.data).find((c) => c.some((n) => n.id === parentId))!.length + 1;
    const dlg = openDialog({
      host: this.root,
      title: `Why ${depth}`,
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

    // existing actions on this cause + raise a new one
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
        source: "fivewhys",
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
   * Delete a cause, splicing its child (if any) onto its parent. Its actions
   * are CANCELLED, never removed — they live in a central register and
   * silent disappearance would orphan real commitments.
   */
  private deleteCause(cause: CauseNode): void {
    const child = this.env.data.causes.find((c) => c.parentId === cause.id);
    if (child) child.parentId = cause.parentId;
    this.env.data.causes = this.env.data.causes.filter((c) => c.id !== cause.id);
    for (const a of this.actions) {
      if (a.context.sourceId === cause.id && a.status !== "done") {
        a.status = "cancelled";
      }
    }
  }

  private pushAction(cause: CauseNode, issue: string, form: ActionForm): void {
    const action: LtkAction = newAction({
      source: "fivewhys",
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
    htmlToPng(
      this.root,
      LTK_BASE_CSS + FIVEWHYS_CSS,
      this.theme.background,
      (uri, svg) => this.cb.onPngReady!(uri, svg)
    );
  }

  private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + FIVEWHYS_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "five-whys.svg")
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + FIVEWHYS_CSS, this.theme.background, (uri) => {
      const a = document.createElement("a");
      a.href = uri;
      a.download = "five-whys.png";
      a.click();
    });
  }
}
