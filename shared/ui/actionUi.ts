// Shared action UI: the form (what / who / due), the list row with a
// complete/not-complete circle, and the raise/edit dialog. Every
// action-capable control uses these, so raising, editing, completing and
// cancelling an action looks and behaves identically toolkit-wide.
//
// Conventions carried here: single assignee (chips act as a radio group);
// actions are never hard-deleted (the danger button cancels); Done/Due/
// Overdue are capitalised; circle colours are set inline (Safari rule).

import { isOverdue, LtkAction } from "../schema/actions";
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
  // supplied, one free-text name otherwise
  const whoWrap = people.length > 0 ? checklist() : el("div");
  const checks: { box: HTMLInputElement; wrap: HTMLElement; person: Person }[] = [];
  let freeWho: HTMLInputElement | null = null;
  if (people.length > 0) {
    for (const person of people) {
      const item = checkItem(person.who);
      if (
        currentWho &&
        (currentWho.whoId === person.whoId || currentWho.who === person.who)
      ) {
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
    }
  } else {
    freeWho = textInput(currentWho?.who ?? "", { placeholder: "Who" });
    whoWrap.appendChild(freeWho);
  }

  wrap.appendChild(fieldRow("Action", desc));
  wrap.appendChild(sectionLabel("Who"));
  wrap.appendChild(whoWrap);
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
 * A collapsed action-capture section revealed the moment a trigger checkbox
 * is ticked (e.g. "This is the root cause") — capture happens right there in
 * the same dialog.
 */
export function inlineActionSection(
  trigger: HTMLInputElement,
  people: Person[],
  label = "Action on this root cause"
): { el: HTMLElement; form: ActionForm } {
  const form = buildActionForm(people);
  const section = el("div");
  section.style.display = "none";
  section.style.flexDirection = "column";
  section.style.gap = "12px";
  section.appendChild(sectionLabel(label));
  section.appendChild(form.el);
  trigger.addEventListener("change", () => {
    section.style.display = trigger.checked ? "flex" : "none";
    if (trigger.checked) form.focus();
  });
  return { el: section, form };
}

export interface ActionRowOptions {
  doneColor: string;
  /** Show the issue as a small tag above the description (board views). */
  showIssue?: boolean;
  readOnly?: boolean;
  /** Fired after the complete circle toggles (commit actions here). */
  onChanged: () => void;
  onEdit: (a: LtkAction) => void;
}

/**
 * One action as a row: complete/not-complete circle (toggles live), the
 * description with who/due underneath, and an edit affordance.
 */
export function actionRow(a: LtkAction, opts: ActionRowOptions): HTMLElement {
  const row = el("div", "ltk-action-row");
  const dc = opts.doneColor;

  const circle = el("button", "ltk-action-circle");
  circle.type = "button";
  const descEl = el("div", "ltk-action-desc", a.description || a.issue);
  const paint = () => {
    const done = a.status === "done";
    circle.textContent = done ? "✓" : "";
    circle.title = done ? "Mark not complete" : "Mark complete";
    circle.style.background = done ? dc : "";
    circle.style.borderColor = done ? dc : "";
    circle.style.color = done ? textOn(dc) : "transparent";
    descEl.style.textDecoration = done ? "line-through" : "";
  };
  paint();
  if (!opts.readOnly) {
    circle.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowDone = a.status !== "done";
      a.status = nowDone ? "done" : "open";
      for (const x of a.assignees) x.done = nowDone;
      paint();
      opts.onChanged();
    });
  }

  // left: issue (caps) stacked over the description
  const main = el("div", "ltk-action-main");
  if (opts.showIssue && a.issue.trim() !== "") {
    main.appendChild(el("div", "ltk-action-issue", a.issue));
  }
  main.appendChild(descEl);

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
}

/** The raise/edit action dialog (with escalation, completion and cancel). */
export function openActionDialog(o: ActionDialogOptions): void {
  const action = o.action;
  const issue = textInput(action.issue, { placeholder: "Issue" });
  const form = buildActionForm(o.people, o.isNew ? undefined : action);

  const escChk = checkItem("Escalated");
  escChk.box.checked = action.escalated;
  escChk.wrap.classList.toggle("ltk-check-on", action.escalated);

  const wasDone = action.status === "done";
  const doneChk = checkItem("Completed");
  doneChk.box.checked = wasDone;
  doneChk.wrap.classList.toggle("ltk-check-on", wasDone);

  const save = () => {
    if (o.isNew && !form.hasContent() && issue.value.trim() === "") return;
    action.issue = issue.value.trim();
    if (!o.isNew && doneChk.box.checked !== wasDone) {
      // only flatten the status when the user actually toggled Completed —
      // an untouched in-progress action keeps its status
      action.status = doneChk.box.checked ? "done" : "open";
    }
    action.escalated = escChk.box.checked;
    form.apply(action); // after status, so assignee done flags match
    dlg.close();
    o.onCommit();
  };

  const buttons = [];
  if (!o.isNew) {
    buttons.push({
      label: "Cancel action",
      kind: "danger" as const,
      onClick: () => {
        action.status = "cancelled";
        dlg.close();
        o.onCommit();
      },
    });
  }
  buttons.push({
    label: o.isNew ? "Cancel" : "Close",
    kind: "secondary" as const,
    onClick: () => dlg.close(),
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
  dlg.body.appendChild(form.el);
  if (!o.isNew) dlg.body.appendChild(doneChk.wrap);
  dlg.body.appendChild(escChk.wrap);
  form.focus();
}
