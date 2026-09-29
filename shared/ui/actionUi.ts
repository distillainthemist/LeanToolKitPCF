// Shared action UI: the form (what / who / due), the list row with a
// complete/not-complete circle, and the raise/edit dialog. Every
// action-capable control uses these, so raising, editing, completing and
// cancelling an action looks and behaves identically toolkit-wide.
//
// Conventions carried here: single assignee (chips act as a radio group);
// actions are never hard-deleted (the danger button cancels); Done/Due/
// Overdue are capitalised; circle colours are set inline (Safari rule).

import { ActionComment, ActionPdca, ACTION_PDCA, isOverdue, LtkAction, newAction, newComment, PDCA_LABELS, PDCA_QUARTERS, pdcaOf } from "../schema/actions";
import { ActionLink, applyLink, currentLink, isCardKeyed, linkChanges, linkLabel, LinkTarget, searchLinkTargets } from "../schema/actionLinks";
import { ACTION_MOVED_EVENT, ActionLinkContext, actionLinkProvider, actionViewer, endorsementFor } from "./actionLinkProvider";
import { applyEndorsementRule, awaitingEndorsement, endorse, sendBack } from "../schema/actionEndorsement";
import { Person } from "../schema/people";
import { textOn } from "../tokens";
import { el } from "./dom";
import {
  checkItem,
  checklist,
  fieldRow,
  openDialog,
  sectionLabel,
  textArea,
  textInput,
  selectInput,
} from "./dialog";

export interface ActionForm {
  el: HTMLElement;
  focus: () => void;
  hasContent: () => boolean;
  apply: (action: LtkAction) => void;
}

/** The action fields: description, single assignee, due date. */
export function buildActionForm(
  people: Person[],
  initial?: LtkAction
): ActionForm {
  const wrap = el("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "12px";

  const desc = textArea(initial?.description ?? "", {
    placeholder: "What will be done?",
    rows: 2,
  });
  const start = textInput(initial?.start ?? "", { type: "date" });
  const due = textInput(initial?.due ?? "", { type: "date" });
  const currentWho = initial?.assignees[0];

  // single assignee: chips act as a radio group when a people list is
  // supplied, one free-text name otherwise. People flagged `secondary`
  // (the wider roster behind a meeting's own participants) stay off the
  // chip grid until found through the search box below it. A large
  // primary set is CAPPED (Ben, 2026-09-01: a 500-person site must not
  // become a wall of chips) — the overflow joins the search, which
  // covers everyone not already a chip. Hosts order `people` by
  // closeness (self · crew · site …), so the cap keeps the near circle.
  const CHIP_CAP = 20;
  const allPrimary = people.filter((p) => p.secondary !== true);
  const primary = allPrimary.slice(0, CHIP_CAP);
  const secondary = [...allPrimary.slice(CHIP_CAP), ...people.filter((p) => p.secondary === true)];
  const whoWrap = people.length > 0 ? checklist() : el("div");
  const checks: { box: HTMLInputElement; wrap: HTMLElement; person: Person }[] = [];
  let freeWho: HTMLInputElement | null = null;
  const isCurrent = (person: Person) =>
    currentWho !== undefined &&
    (currentWho.whoId === person.whoId || currentWho.who === person.who);
  const addChip = (person: Person, checked: boolean) => {
    const item = checkItem(person.who);
    if (checked) {
      item.box.checked = true;
      item.wrap.classList.add("ltk-check-on");
    }
    item.box.addEventListener("change", () => {
      if (!item.box.checked) return;
      for (const other of checks) {
        if (other.box !== item.box && other.box.checked) {
          other.box.checked = false;
          other.wrap.classList.remove("ltk-check-on");
        }
      }
    });
    whoWrap.appendChild(item.wrap);
    checks.push({ box: item.box, wrap: item.wrap, person });
  };
  if (people.length > 0) {
    for (const person of primary) addChip(person, isCurrent(person));
    // an existing assignee from the wider roster starts pinned + selected
    if (!checks.some((c) => c.box.checked)) {
      const held = secondary.find(isCurrent);
      if (held) addChip(held, true);
    }
  } else {
    freeWho = textInput(currentWho?.who ?? "", { placeholder: "Who" });
    whoWrap.appendChild(freeWho);
  }

  // the wider-roster search: typing filters, picking a match pins the
  // person as a normal (selected) chip above
  let searchWrap: HTMLElement | null = null;
  if (secondary.length > 0) {
    searchWrap = el("div", "ltk-who-search");
    const query = textInput("", { placeholder: "Search everyone…" });
    const results = el("div", "ltk-who-results");
    const renderResults = () => {
      while (results.firstChild) results.removeChild(results.firstChild);
      const q = query.value.trim().toLowerCase();
      if (q === "") return;
      const pinned = new Set(checks.map((c) => c.person.whoId));
      const matches = secondary
        .filter((p) => !pinned.has(p.whoId) && p.who.toLowerCase().includes(q))
        .slice(0, 8);
      for (const person of matches) {
        const hit = el("button", "ltk-check ltk-who-hit", person.who);
        (hit as HTMLButtonElement).type = "button";
        hit.addEventListener("click", () => {
          for (const other of checks) {
            if (other.box.checked) {
              other.box.checked = false;
              other.wrap.classList.remove("ltk-check-on");
            }
          }
          addChip(person, true);
          query.value = "";
          renderResults();
        });
        results.appendChild(hit);
      }
    };
    query.addEventListener("input", renderResults);
    searchWrap.append(query, results);
  }

  wrap.appendChild(fieldRow("Action", desc));
  wrap.appendChild(sectionLabel("Who"));
  wrap.appendChild(whoWrap);
  if (searchWrap) wrap.appendChild(searchWrap);
  const dates = el("div");
  dates.style.display = "flex";
  dates.style.gap = "12px";
  const startRow = fieldRow("Start (optional)", start);
  startRow.classList.add("ltk-field-half");
  const dueRow = fieldRow("Due", due);
  dueRow.classList.add("ltk-field-half");
  dates.append(startRow, dueRow);
  wrap.appendChild(dates);

  return {
    el: wrap,
    focus: () => desc.focus(),
    hasContent: () => desc.value.trim() !== "",
    apply: (action) => {
      action.description = desc.value.trim();
      action.start = start.value;
      action.due = due.value;
      const done = action.status === "done";
      const picked = checks.find((c) => c.box.checked);
      if (picked) {
        action.assignees = [
          { whoId: picked.person.whoId, who: picked.person.who, done },
        ];
      } else if (freeWho && freeWho.value.trim() !== "") {
        action.assignees = [{ whoId: "", who: freeWho.value.trim(), done }];
      } else {
        action.assignees = [];
      }
    },
  };
}

/**
 * A collapsed "＋ Add action" affordance for add dialogs: tapping it reveals
 * the action fields right there, so an action can be captured in the same
 * breath as the entry it belongs to — but it is never auto-prompted.
 */
export function addActionSection(
  people: Person[],
  label = "Action"
): { el: HTMLElement; form: ActionForm } {
  const form = buildActionForm(people);
  const wrap = el("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "12px";

  const btn = el("button", "ltk-btn ltk-btn-secondary", "＋ Add action");
  btn.type = "button";
  const section = el("div");
  section.style.display = "none";
  section.style.flexDirection = "column";
  section.style.gap = "12px";
  section.appendChild(sectionLabel(label));
  section.appendChild(form.el);
  btn.addEventListener("click", () => {
    btn.style.display = "none";
    section.style.display = "flex";
    form.focus();
  });

  wrap.append(btn, section);
  return { el: wrap, form };
}

export interface ActionRowOptions {
  doneColor: string;
  /** Show the issue as a small tag above the description (board views). */
  showIssue?: boolean;
  /** Show the PDCA quadrant disc beside the description (action cards). */
  showPdca?: boolean;
  readOnly?: boolean;
  /** Fired after the complete circle toggles (commit actions here). */
  onChanged: () => void;
  onEdit: (a: LtkAction) => void;
}

/**
 * The shared complete/not-complete circle. Toggling flips the action between
 * done and open, syncs the assignee done flags, then fires onToggled (commit +
 * re-render there). Colours are inline (Safari rule). Used by the list row and
 * by the kanban / gantt board views so completing an action looks identical
 * everywhere.
 */
/** The four-quadrant PDCA disc: quarters fill top-left → bottom-left →
 *  bottom-right → top-right (plan 0 … closed 4). */
export function pdcaDisc(state: ActionPdca, size = 16, fill = "#26241f"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "-10 -10 20 20");
  svg.classList.add("ltk-pdca-disc");
  const r = 8.6;
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("r", String(r));
  ring.style.fill = "none";
  ring.style.stroke = fill;
  ring.style.strokeWidth = "1.6";
  svg.appendChild(ring);
  // quadrant wedges, counter-clockwise from top-left
  const QUADS: [number, number, number, number][] = [
    [0, -r, -r, 0], // top-left
    [-r, 0, 0, r], // bottom-left
    [0, r, r, 0], // bottom-right
    [r, 0, 0, -r], // top-right
  ];
  if (state === "hold") {
    // on hold: a pause glyph inside the ring — beside the cycle, not on it
    for (const x of [-3.6, 1.2]) {
      const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bar.setAttribute("x", String(x));
      bar.setAttribute("y", "-4.2");
      bar.setAttribute("width", "2.4");
      bar.setAttribute("height", "8.4");
      bar.setAttribute("rx", "0.6");
      bar.style.fill = fill;
      svg.appendChild(bar);
    }
  }
  for (let i = 0; i < PDCA_QUARTERS[state]; i++) {
    const [x1, y1, x2, y2] = QUADS[i];
    const wedge = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wedge.setAttribute("d", `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2} Z`);
    wedge.style.fill = fill;
    svg.appendChild(wedge);
  }
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = PDCA_LABELS[state];
  svg.appendChild(title);
  return svg;
}

export function completeCircle(
  a: LtkAction,
  doneColor: string,
  onToggled: () => void,
  readOnly = false
): HTMLButtonElement {
  const circle = el("button", "ltk-action-circle") as HTMLButtonElement;
  circle.type = "button";
  const paint = () => {
    const waiting = a.status === "verify";
    const done = a.status === "done" || waiting;
    circle.textContent = waiting ? "◐" : done ? "✓" : "";
    circle.title = waiting ? "Awaiting endorsement — tick to reopen" : done ? "Mark not complete" : "Mark complete";
    circle.style.background = done ? doneColor : "";
    circle.style.borderColor = done ? doneColor : "";
    circle.style.color = done ? textOn(doneColor) : "transparent";
  };
  paint();
  if (!readOnly) {
    circle.addEventListener("click", (e) => {
      e.stopPropagation();
      const prior = a.status;
      // a tick on a WAITING action reopens it (its work was ticked done;
      // only an endorser closes it — through the dialog)
      const nowDone = a.status !== "done" && a.status !== "verify";
      a.status = nowDone ? "done" : "open";
      a.pdca = nowDone ? "closed" : "do"; // the PDCA disc follows completion
      for (const x of a.assignees) x.done = nowDone;
      const who = actionViewer();
      if (who !== null) applyEndorsementRule(a, prior, endorsementFor(a), who, new Date().toISOString());
      paint();
      onToggled();
    });
  }
  return circle;
}

/**
 * One action as a row: complete/not-complete circle (toggles live), the
 * description with who/due underneath, and an edit affordance.
 */
export function actionRow(a: LtkAction, opts: ActionRowOptions): HTMLElement {
  const row = el("div", "ltk-action-row");

  const descEl = el("div", "ltk-action-desc", a.description || a.issue);
  const strike = () => {
    descEl.style.textDecoration = a.status === "done" ? "line-through" : "";
  };
  strike();
  const circle = completeCircle(
    a,
    opts.doneColor,
    () => {
      strike();
      opts.onChanged();
    },
    opts.readOnly
  );

  // left: issue (caps) stacked over the description
  const main = el("div", "ltk-action-main");
  if (opts.showIssue && a.issue.trim() !== "") {
    main.appendChild(el("div", "ltk-action-issue", a.issue));
  }
  if (opts.showPdca) {
    const line = el("div", "ltk-action-descline");
    line.append(pdcaDisc(pdcaOf(a), 15), descEl);
    main.appendChild(line);
  } else main.appendChild(descEl);

  // right: who + date, prominent and right-aligned; the escalation flag
  // trails the date line
  const right = el("div", "ltk-action-right");
  const whoEl = el("div", "ltk-action-who");
  whoEl.appendChild(
    document.createTextNode(a.assignees[0]?.who ?? "Unassigned")
  );
  right.appendChild(whoEl);
  const dateText =
    a.due !== "" ? `Due ${a.due}` : a.start !== "" ? `From ${a.start}` : "";
  if (dateText !== "") {
    const dueEl = el("div", "ltk-action-due", dateText);
    if (a.due !== "" && isOverdue(a)) dueEl.classList.add("ltk-action-overdue");
    if (a.escalated) dueEl.appendChild(el("span", "ltk-action-flag", " ⚑"));
    right.appendChild(dueEl);
  } else if (a.escalated) {
    whoEl.appendChild(el("span", "ltk-action-flag", " ⚑"));
  }
  const said = commentGlyph(a);
  if (said) right.appendChild(said);
  const waits = endorseGlyph(a);
  if (waits) right.appendChild(waits);

  if (!opts.readOnly) {
    main.addEventListener("click", () => opts.onEdit(a));
    right.addEventListener("click", () => opts.onEdit(a));
    right.style.cursor = "pointer";
    const edit = el("button", "ltk-action-edit", "✎");
    edit.type = "button";
    edit.title = "Edit action";
    edit.addEventListener("click", () => opts.onEdit(a));
    row.append(circle, main, right, edit);
  } else {
    row.append(circle, main, right);
  }
  return row;
}

export interface ActionDialogOptions {
  host: HTMLElement;
  /** Mutated in place on save. For a new action, push it in onCommit. */
  action: LtkAction;
  people: Person[];
  isNew: boolean;
  onCommit: () => void;
  /** Board cards the action may link to instead (Ben, 2026-08-31: the
   *  discussion often reveals an action belongs to another card). Keys
   *  are instance keys ("board:card"); shown as a "Linked card" select. */
  linkTargets?: { key: string; label: string }[];
  /** The origin card's instance key — the select's initial value. */
  linkTarget?: string;
  /** What the action may be linked to — a ritual or an initiative, one
   *  at most (2026-09-29). Omitted: the host's registered provider
   *  answers; neither: no "Linked to" field. */
  links?: ActionLinkContext;
  /** A NEW action starts linked to the board on screen (quick add). */
  linkToOpenBoard?: boolean;
  /** Who is commenting. Omitted: the host's registered viewer answers;
   *  neither: comments show, and none can be added. */
  viewer?: { whoId: string; who: string };
}

/** "◐ Awaiting endorsement" for an action whose work is done and waits
 *  for its endorser, wherever a row shows one. */
export function endorseGlyph(a: Pick<LtkAction, "status">): HTMLElement | null {
  if (!awaitingEndorsement(a)) return null;
  const g = el("span", "ltk-endorse-glyph", "◐ Awaiting endorsement");
  g.title = "The work is done — it closes when the owner, the sponsor or an admin endorses it.";
  return g;
}

/** An inline bar that asks for a REASON before a step (one at a time). */
function reasonBar(body: HTMLElement, message: string, placeholder: string, yes: string, onYes: (reason: string) => void): void {
  body.querySelector(".ltk-confirm")?.remove();
  const bar = el("div", "ltk-confirm");
  bar.appendChild(el("div", "ltk-confirm-msg", message));
  const box = el("textarea", "ltk-input ltk-textarea") as HTMLTextAreaElement;
  box.rows = 2;
  box.placeholder = placeholder;
  box.setAttribute("aria-label", message);
  bar.appendChild(box);
  const err = el("div", "ltk-confirm-err", "");
  bar.appendChild(err);
  const row = el("div", "ltk-confirm-btns");
  const keep = el("button", "ltk-btn ltk-btn-secondary", "Cancel") as HTMLButtonElement;
  keep.type = "button";
  keep.addEventListener("click", () => bar.remove());
  const go = el("button", "ltk-btn ltk-btn-danger", yes) as HTMLButtonElement;
  go.type = "button";
  go.addEventListener("click", () => {
    if (box.value.trim() === "") {
      err.textContent = "A reason is needed.";
      box.focus();
      return;
    }
    bar.remove();
    onYes(box.value.trim());
  });
  row.append(keep, go);
  bar.appendChild(row);
  body.appendChild(bar);
  bar.scrollIntoView({ block: "nearest" });
  box.focus();
}

/** "💬 3" for an action that carries comments, wherever a row shows one. */
export function commentGlyph(a: Pick<LtkAction, "comments">): HTMLElement | null {
  if (a.comments.length === 0) return null;
  const g = el("span", "ltk-cmt-glyph", `💬 ${a.comments.length}`);
  const last = a.comments[a.comments.length - 1];
  g.title = `${a.comments.length} comment${a.comments.length === 1 ? "" : "s"} — latest: ${last.who ?? "someone"}, ${last.when}`;
  return g;
}

interface CommentField {
  el: HTMLElement;
  /** The comments written in this dialog, the box's text included. */
  added: () => ActionComment[];
  /** Something written that a plain Close would lose. */
  unsaved: () => boolean;
}

/** Comments on an action (2026-09-30): everything said so far, newest
 *  last, and a box to add to it. What is written here is saved with the
 *  dialog's own Save — Close asks before it is lost. */
function buildCommentField(o: ActionDialogOptions): CommentField {
  const viewer = o.viewer ?? actionViewer();
  const wrap = el("div", "ltk-cmt");
  const list = el("div", "ltk-cmt-list");
  const staged: ActionComment[] = [];
  const paint = () => {
    while (list.firstChild) list.removeChild(list.firstChild);
    const all = [...o.action.comments.map((c) => ({ c, fresh: false })), ...staged.map((c) => ({ c, fresh: true }))];
    if (all.length === 0) list.appendChild(el("div", "ltk-cmt-none", "No comments yet."));
    for (const { c, fresh } of all) {
      const row = el("div", "ltk-cmt-row" + (fresh ? " ltk-cmt-fresh" : ""));
      row.appendChild(el("div", "ltk-cmt-meta", `${c.who ?? "Someone"} · ${c.when}${fresh ? " · not saved yet" : ""}`));
      row.appendChild(el("div", "ltk-cmt-text", c.text));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  };
  wrap.appendChild(list);
  let box: HTMLTextAreaElement | null = null;
  if (viewer !== null && viewer.whoId !== "") {
    const entry = el("div", "ltk-cmt-entry");
    box = el("textarea", "ltk-input ltk-textarea ltk-cmt-box") as HTMLTextAreaElement;
    box.rows = 2;
    box.placeholder = "Add a comment…";
    box.setAttribute("aria-label", "Add a comment");
    const add = el("button", "ltk-btn ltk-btn-secondary ltk-cmt-add", "Add") as HTMLButtonElement;
    add.type = "button";
    add.title = "Add the comment to the list — it is saved with the action";
    const push = () => {
      const text = box!.value.trim();
      if (text === "") return;
      staged.push(newComment(viewer, text));
      box!.value = "";
      paint();
      box!.focus();
    };
    add.addEventListener("click", push);
    // Ctrl/⌘ + Enter adds; a bare Enter is a new line
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        push();
      }
    });
    entry.append(box, add);
    wrap.appendChild(entry);
  }
  paint();
  return {
    el: wrap,
    added: () => {
      const typed = box !== null && viewer !== null && box.value.trim() !== "" ? [newComment(viewer, box.value)] : [];
      return [...staged, ...typed];
    },
    unsaved: () => staged.length > 0 || (box !== null && box.value.trim() !== ""),
  };
}

/** An inline confirmation inside a dialog's body (one dialog at a time per
 *  host — a second dialog would replace the first). One bar at a time. */
function confirmBar(body: HTMLElement, message: string, yes: string, no: string, onYes: () => void): void {
  body.querySelector(".ltk-confirm")?.remove();
  const bar = el("div", "ltk-confirm");
  bar.setAttribute("role", "alertdialog");
  bar.appendChild(el("div", "ltk-confirm-msg", message));
  const row = el("div", "ltk-confirm-btns");
  const keep = el("button", "ltk-btn ltk-btn-secondary", no) as HTMLButtonElement;
  keep.type = "button";
  keep.addEventListener("click", () => bar.remove());
  const go = el("button", "ltk-btn ltk-btn-danger", yes) as HTMLButtonElement;
  go.type = "button";
  go.addEventListener("click", () => {
    bar.remove();
    onYes();
  });
  row.append(keep, go);
  bar.appendChild(row);
  body.appendChild(bar);
  bar.scrollIntoView({ block: "nearest" });
  keep.focus();
}

interface LinkField {
  el: HTMLElement;
  /** The user's choice: undefined = untouched; null = personal. */
  chosen: () => LinkTarget | null | undefined;
  origin: () => ActionLink | null;
  personalWho: () => string;
}

/** "Linked to": a chip naming the ritual or initiative the action belongs
 *  to (✕ unlinks), or a search over both. Taking an existing action off
 *  the card it hangs from is confirmed first. */
function buildLinkField(o: ActionDialogOptions, body: () => HTMLElement, onTouched: () => void): LinkField | null {
  const source = o.links ? () => Promise.resolve(o.links!) : actionLinkProvider();
  if (source === null) return null;
  const wrap = el("div", "ltk-link");
  let ctx: ActionLinkContext | null = null;
  let origin: ActionLink | null = null;
  let chosen: LinkTarget | null | undefined = undefined;

  const shown = (): ActionLink | null =>
    chosen === undefined ? origin : chosen === null ? { kind: "personal", target: null, cardId: "", cardLabel: "" } : { kind: chosen.kind, target: chosen, cardId: "", cardLabel: "" };

  const choose = (t: LinkTarget | null) => {
    chosen = t;
    onTouched();
    paint();
  };

  const hit = (t: LinkTarget): HTMLElement => {
    const b = el("button", "ltk-link-hit") as HTMLButtonElement;
    b.type = "button";
    b.appendChild(el("span", "ltk-link-hit-title", t.title));
    if (t.detail !== "") b.appendChild(el("span", "ltk-link-hit-detail", t.detail));
    b.addEventListener("click", () => choose(t));
    return b;
  };

  const paint = () => {
    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    const link = shown();
    if (ctx === null || link === null) {
      wrap.appendChild(el("div", "ltk-link-note", "Loading…"));
      return;
    }
    if (link.kind !== "personal") {
      const words = linkLabel(link);
      const chip = el("div", "ltk-link-chip");
      chip.appendChild(el("span", "ltk-link-kind", words.kind));
      chip.appendChild(el("span", "ltk-link-text", words.text));
      const x = el("button", "ltk-link-x", "✕") as HTMLButtonElement;
      x.type = "button";
      x.title = "Unlink";
      x.setAttribute("aria-label", `Unlink from ${words.text}`);
      x.addEventListener("click", () => {
        // an existing action leaves the card it hangs off — say so first
        const offCard = !o.isNew && chosen === undefined && isCardKeyed(o.action.instanceId);
        if (!offCard) return choose(null);
        confirmBar(body(), `Take this action off "${words.text}"? It will no longer show on that card.`, "Take it off", "Keep it there", () => choose(null));
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
      return;
    }
    wrap.appendChild(el("div", "ltk-link-note", "Personal — not linked to a ritual or an initiative."));
    const query = textInput("", { placeholder: "Search rituals and initiatives…" });
    const results = el("div", "ltk-link-results");
    const group = (label: string, list: LinkTarget[]) => {
      if (list.length === 0) return;
      results.appendChild(el("div", "ltk-link-group", label));
      for (const t of list) results.appendChild(hit(t));
    };
    const renderResults = () => {
      while (results.firstChild) results.removeChild(results.firstChild);
      if (ctx === null) return;
      // nothing until something is typed (Ben, 2026-09-29: a suggested
      // list cost the dialog too much height)
      if (query.value.trim() === "") return;
      const found = searchLinkTargets(ctx.targets, query.value);
      group("Rituals", found.rituals);
      group("Initiatives", found.initiatives);
      if (found.rituals.length + found.initiatives.length === 0) results.appendChild(el("div", "ltk-link-note", "Nothing matches."));
    };
    query.addEventListener("input", renderResults);
    renderResults();
    wrap.append(query, results);
  };

  paint();
  void source()
    .then((c) => {
      ctx = c;
      origin = currentLink(o.action, c.targets, o.linkTarget ?? c.openHome);
      if (o.isNew && o.linkToOpenBoard === true && c.openBoardId !== null) {
        const open = c.targets.find((t) => t.boardId === c.openBoardId);
        if (open) chosen = open;
      }
      paint();
    })
    .catch(() => {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el("div", "ltk-link-note", "Links could not be loaded — the action keeps its current one."));
    });
  return { el: wrap, chosen: () => chosen, origin: () => origin, personalWho: () => ctx?.personalWho ?? "" };
}

/** The raise/edit action dialog (with escalation, completion and cancel). */
/** A small lock for confidential actions, wherever a row or card shows one. */
export function confidentialGlyph(a: LtkAction): HTMLElement | null {
  if (a.confidential !== true) return null;
  const g = el("span", "ltk-conf-glyph", "🔒");
  g.title = "Confidential — seen only by whoever raised it, the people assigned, their leaders and super admins.";
  return g;
}

export function openActionDialog(o: ActionDialogOptions): void {
  const action = o.action;
  const issue = textInput(action.issue, { placeholder: "Issue" });
  const form = buildActionForm(o.people, o.isNew ? undefined : action);

  const escChk = checkItem("Escalated");
  escChk.box.checked = action.escalated;
  escChk.wrap.classList.toggle("ltk-check-on", action.escalated);
  // confidential (2026-09-16): creator, assignees, their leaders and super
  // admins only — the row helps say who
  const confChk = checkItem("Confidential");
  confChk.box.checked = action.confidential === true;
  confChk.wrap.classList.toggle("ltk-check-on", action.confidential === true);
  confChk.wrap.title = "Seen only by whoever raised it, the people assigned, their leaders and super admins.";

  const comments = buildCommentField(o);

  // the status the action arrived with — what "closing" and "reopening"
  // are measured against, and what the endorsement rule calls prior
  const prior = o.isNew ? null : action.status;
  const wasClosed = action.status === "done" || action.status === "verify";
  // PDCA toggle (Ben, 2026-08-31): disc + label each — replaces the old
  // Completed checkbox (Closed IS completion). On hold (2026-09-30)
  // pauses: the action stays open and is not overdue while held.
  let pdca: ActionPdca = o.isNew ? (action.pdca ?? "do") : pdcaOf(action);
  const pdcaWrap = el("div", "ltk-pdca-seg");
  const pdcaBtns = new Map<ActionPdca, HTMLButtonElement>();
  const paintPdca = () => {
    for (const [k, b] of pdcaBtns) b.classList.toggle("ltk-pdca-on", k === pdca);
  };
  for (const state of ACTION_PDCA) {
    const b = el("button", "ltk-pdca-btn") as HTMLButtonElement;
    b.type = "button";
    b.append(pdcaDisc(state, 18, "currentColor"), el("span", undefined, PDCA_LABELS[state]));
    b.addEventListener("click", () => {
      pdca = state;
      paintPdca();
    });
    pdcaBtns.set(state, b);
    pdcaWrap.appendChild(b);
  }
  paintPdca();

  // linked card: which card this action hangs off — re-linkable when the
  // host offers targets (the board's ＋ Action road)
  let linkSel: HTMLSelectElement | null = null;
  const origin = o.linkTarget ?? "";
  if (o.linkTargets !== undefined && o.linkTargets.length > 1) {
    // an origin the list doesn't know (a removed card, another board's
    // channel) stays selectable — otherwise an untouched save would
    // silently re-link to the first option
    const targets =
      origin !== "" && !o.linkTargets.some((t) => t.key === origin)
        ? [{ key: origin, label: "(current link)" }, ...o.linkTargets]
        : o.linkTargets;
    linkSel = selectInput(
      origin !== "" ? origin : targets[0].key,
      targets.map((t) => ({ value: t.key, label: t.label }))
    );
  }

  // linked to (2026-09-29): one ritual or one initiative, or nothing.
  // A changed link MOVES the action; the within-board card select then
  // has nothing to say and hides.
  let linkRow: HTMLElement | null = null;
  const linkField: LinkField | null = buildLinkField(
    o,
    () => dlg.body,
    () => {
      if (linkRow !== null) linkRow.style.display = "none";
    }
  );

  const save = () => {
    if (o.isNew && !form.hasContent() && issue.value.trim() === "") return;
    action.issue = issue.value.trim();
    action.pdca = pdca;
    // Closed IS completion; leaving Closed reopens. An untouched state
    // keeps the status (awaiting endorsement / in-progress survive).
    if (pdca === "closed" && !wasClosed && action.status !== "cancelled") action.status = "done";
    else if (pdca !== "closed" && wasClosed) action.status = "open";
    action.escalated = escChk.box.checked;
    action.confidential = confChk.box.checked ? true : undefined;
    form.apply(action); // after status, so assignee done flags match
    // what was written here, the box's text included
    const said = comments.added();
    if (said.length > 0) action.comments = [...action.comments, ...said];
    // endorsement: closing on an initiative that asks for it waits for
    // its endorser — unless an endorser is the one closing
    const who = o.viewer ?? actionViewer();
    if (who !== null) applyEndorsementRule(action, prior, endorsementFor(action), who, new Date().toISOString());
    const linkedNow = linkField?.origin() ?? null;
    const picked = linkField?.chosen();
    const moves = linkedNow !== null && picked !== undefined && linkChanges(linkedNow, picked);
    if (moves) {
      applyLink(action, picked, linkField!.personalWho());
    } else if (linkSel !== null) {
      action.instanceId = linkSel.value;
      // moved to another card: drop the origin's element context so it
      // reads as a card-level action of its new home
      if (linkSel.value !== origin) action.context = { source: "card", sourceId: "" };
    }
    dlg.close();
    o.onCommit();
    // an existing action that left its home: the list it left refreshes
    if (moves && !o.isNew) window.dispatchEvent(new CustomEvent(ACTION_MOVED_EVENT, { detail: { id: action.id } }));
  };

  const buttons = [];
  if (!o.isNew) {
    buttons.push({
      label: "Cancel action",
      kind: "danger" as const,
      // confirmed first (Ben, 2026-09-29) — one stray click used to
      // cancel the action outright
      onClick: () =>
        confirmBar(dlg.body, "Cancel this action? It is marked cancelled and leaves the open lists.", "Yes, cancel it", "Keep the action", () => {
          action.status = "cancelled";
          dlg.close();
          o.onCommit();
        }),
    });
  }
  buttons.push({
    label: o.isNew ? "Cancel" : "Close",
    kind: "secondary" as const,
    // a comment written and not saved is asked about, never lost quietly
    onClick: () => {
      if (!comments.unsaved()) return dlg.close();
      confirmBar(dlg.body, "A comment you wrote has not been saved. Leave without it?", "Leave without saving", "Keep editing", () => dlg.close());
    },
  });
  buttons.push({
    label: o.isNew ? "Raise" : "Save",
    kind: "primary" as const,
    onClick: save,
  });

  const dlg = openDialog({
    host: o.host,
    title: o.isNew ? "Raise action" : "Edit action",
    buttons,
  });
  dlg.body.appendChild(fieldRow("Issue", issue));
  if (linkField !== null) dlg.body.appendChild(fieldRow("Linked to", linkField.el));
  if (linkSel !== null) {
    linkRow = fieldRow("Linked card", linkSel);
    dlg.body.appendChild(linkRow);
  }
  dlg.body.appendChild(form.el);
  dlg.body.appendChild(sectionLabel("PDCA state"));
  dlg.body.appendChild(pdcaWrap);
  if (!o.isNew && awaitingEndorsement(action)) {
    // the work is done and waits: say so, and hand the endorser their
    // two steps (off an endorsing initiative anyone may verify, as the
    // board's Verify column always allowed)
    const ctx = endorsementFor(action);
    const who = o.viewer ?? actionViewer();
    const may = who !== null && (ctx === null || !ctx.on || ctx.mine);
    const wait = el("div", "ltk-endorse");
    wait.appendChild(el("div", "ltk-endorse-msg", "◐ Awaiting endorsement — the work is done."));
    if (may) {
      const row = el("div", "ltk-confirm-btns");
      const back = el("button", "ltk-btn ltk-btn-secondary", "Send back…") as HTMLButtonElement;
      back.type = "button";
      back.addEventListener("click", () =>
        reasonBar(dlg.body, "Send this action back? It reopens for the people assigned.", "What still needs doing", "Send back", (reason) => {
          sendBack(action, who!, new Date().toISOString(), reason);
          const said = comments.added();
          if (said.length > 0) action.comments = [...action.comments, ...said];
          dlg.close();
          o.onCommit();
        })
      );
      const ok = el("button", "ltk-btn ltk-btn-primary", "Endorse") as HTMLButtonElement;
      ok.type = "button";
      ok.addEventListener("click", () => {
        endorse(action, who!, new Date().toISOString());
        const said = comments.added();
        if (said.length > 0) action.comments = [...action.comments, ...said];
        dlg.close();
        o.onCommit();
      });
      row.append(back, ok);
      wait.appendChild(row);
    } else {
      wait.appendChild(el("div", "ltk-endorse-note", "It closes when the initiative's owner, its sponsor or an admin endorses it."));
    }
    dlg.body.appendChild(wait);
  } else if (!o.isNew && action.status === "done" && action.verified) {
    dlg.body.appendChild(el("div", "ltk-endorse-note", `✓ Endorsed${action.verified.who !== "" ? ` by ${action.verified.who}` : ""} · ${action.verified.when.slice(0, 10)}`));
  }
  dlg.body.appendChild(escChk.wrap);
  dlg.body.appendChild(confChk.wrap);
  const count = action.comments.length;
  dlg.body.appendChild(sectionLabel(count > 0 ? `Comments · ${count}` : "Comments"));
  dlg.body.appendChild(comments.el);
  form.focus();
}

export interface ActionManagerOptions {
  host: HTMLElement;
  /** Optional re-link targets, handed to the raise/edit dialogs. */
  linkTargets?: { key: string; label: string }[];
  linkTarget?: string;
  /** The card's action set — mutated in place (new pushed, edits applied). */
  actions: LtkAction[];
  /** Component kind stamped on new actions ("fishbone", "kpitrend"…). */
  source: string;
  /** The element the actions hang off — a cause / node id, "" for card-level. */
  sourceId: string;
  /** Prefill for a new action's issue (e.g. the cause text / node label). */
  seedIssue?: string;
  hint?: string;
  people: Person[];
  doneColor: string;
  readOnly?: boolean;
  /** The card's "Disable actions" setting: existing actions stay listed,
   *  completable and editable, but nothing new can be raised. */
  canRaise?: boolean;
  title?: string;
  /** Persist + refresh after any change (raise / edit / complete / cancel). */
  onChanged: () => void;
}

/**
 * The shared "actions for X" surface: lists this source's live actions with a
 * complete circle and edit, plus a Raise button. When there are none (and the
 * card is editable) it goes straight to the raise dialog. Used for per-element
 * actions (Fishbone causes, Process-map nodes) and card-level ones (KPI trend,
 * Pareto) alike — sourceId "" is the card bucket.
 */
export function openActionManager(o: ActionManagerOptions): void {
  const canRaise = (o.canRaise ?? true) && !o.readOnly;
  const live = o.actions.filter(
    (a) => a.context.sourceId === o.sourceId && a.status !== "cancelled"
  );
  const raise = () => {
    const action = newAction({ source: o.source, sourceId: o.sourceId, hint: o.hint });
    if (o.seedIssue) action.issue = o.seedIssue;
    openActionDialog({
      host: o.host,
      action,
      people: o.people,
      isNew: true,
      linkTargets: o.linkTargets,
      linkTarget: o.linkTarget,
      onCommit: () => {
        o.actions.push(action);
        o.onChanged();
      },
    });
  };
  if (live.length === 0 && canRaise) {
    raise();
    return;
  }
  const dlg = openDialog({
    host: o.host,
    title: o.title ?? "Actions",
    buttons: !canRaise
      ? [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }]
      : [
          { label: "Close", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "＋ Raise action",
            kind: "primary",
            onClick: () => {
              dlg.close();
              raise();
            },
          },
        ],
  });
  dlg.body.appendChild(sectionLabel(`Actions (${live.length})`));
  for (const a of live) {
    dlg.body.appendChild(
      actionRow(a, {
        doneColor: o.doneColor,
        readOnly: o.readOnly,
        onChanged: () => o.onChanged(),
        onEdit: (act) =>
          openActionDialog({
            host: o.host,
            action: act,
            people: o.people,
            isNew: false,
            linkTargets: o.linkTargets,
            linkTarget: act.instanceId !== "" ? act.instanceId : o.linkTarget,
            onCommit: () => o.onChanged(),
          }),
      })
    );
  }
}
