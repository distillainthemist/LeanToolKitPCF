// Initiative commentary — the shared UI (2026-09-29): one update's body,
// the trail (newest first, earlier wording behind "edited"), and the add /
// edit dialog. The status band, the details pane and the priority popup's
// Commentary tab all draw from here, so the three cannot drift apart.
// Data in, callbacks out — no store import (the harness mounts it).

import { el } from "../../../shared/ui/dom";
import { ageLabel, isBlank, sameFields, Update, UPDATE_LABELS, UpdateFields } from "./commentaryModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

/** "Jane Smith · 3 days ago · edited" */
export function updateMeta(u: Pick<Update, "who" | "at" | "editedAt">, today: string): string {
  return [u.who, ageLabel(u.at, today), u.editedAt !== "" ? "edited" : ""].filter((s) => s !== "").join(" · ");
}

/** The four labelled lines; blank ones are left out. `grid` lays them two
 *  by two (the band), otherwise one under another (pane, popup). */
export function renderUpdateBody(f: UpdateFields, grid = false): HTMLElement {
  const box = el("div", "app-cm-body" + (grid ? " app-cm-body-grid" : ""));
  for (const [key, label] of UPDATE_LABELS) {
    const text = f[key];
    if (text === "") continue;
    const line = el("div", "app-cm-line app-cm-line-" + key);
    line.append(el("span", "app-cm-k", label), el("span", "app-cm-v", text));
    box.appendChild(line);
  }
  return box;
}

export interface TrailOpts {
  list: Update[];
  today: string;
  canEdit: boolean;
  onEdit: (u: Update) => void;
  /** Leave the newest out (the band or the tab's lead already shows it). */
  skipLatest?: boolean;
}

/** Every update, newest first. An edited one opens its earlier wording. */
export function renderTrail(o: TrailOpts): HTMLElement {
  const box = el("div", "app-cm-trail");
  const list = o.skipLatest ? o.list.slice(1) : o.list;
  for (const u of list) box.appendChild(renderUpdateCard(u, o.today, o.canEdit ? () => o.onEdit(u) : null));
  return box;
}

/** One update as a card: who and when, Edit, the body, earlier wording. */
export function renderUpdateCard(u: Update, today: string, onEdit: (() => void) | null): HTMLElement {
  const card = el("div", "app-cm-card");
  const head = el("div", "app-cm-head");
  const meta = el("span", "app-cm-meta", updateMeta(u, today));
  meta.title = `${u.at.slice(0, 10)}${u.editedAt !== "" ? ` · edited by ${u.editedBy} on ${u.editedAt.slice(0, 10)}` : ""}`;
  head.appendChild(meta);
  head.appendChild(el("span", "app-bar-gap"));
  if (onEdit !== null && u.id !== "") {
    const edit = btn("Edit", "app-cp-ov-link");
    edit.addEventListener("click", onEdit);
    head.appendChild(edit);
  }
  card.appendChild(head);
  card.appendChild(renderUpdateBody(u));
  if (u.previous.length > 0) {
    const toggle = btn(`Earlier wording · ${u.previous.length}`, "app-cp-ov-link app-cm-prevtoggle");
    const prev = el("div", "app-cm-prev");
    prev.style.display = "none";
    for (const p of u.previous) {
      const v = el("div", "app-cm-prevone");
      v.appendChild(el("div", "app-cm-meta", `${p.who} · ${p.at.slice(0, 10)}`));
      v.appendChild(renderUpdateBody(p));
      prev.appendChild(v);
    }
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = prev.style.display === "none";
      prev.style.display = open ? "" : "none";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    card.append(toggle, prev);
  }
  return card;
}

export interface UpdateDialogOpts {
  /** Set when editing; absent when adding. */
  existing?: Update;
  /** Offer "Raise the ⚐ Needs support flag" (adding, flag not yet up). */
  offerFlag: boolean;
  onSave: (fields: UpdateFields, raiseFlag: boolean) => Promise<void>;
}

/** Add or edit an update — the app's modal, the four boxes. */
export function openUpdateDialog(o: UpdateDialogOpts): void {
  const scrim = el("div", "app-modal-overlay");
  const box = el("div", "app-modal");
  box.appendChild(el("div", "app-modal-title", o.existing ? "Edit update" : "Add update"));
  if (o.existing) box.appendChild(el("div", "app-modal-note", "The earlier wording is kept and stays viewable behind “edited”."));
  const inputs = new Map<keyof UpdateFields, HTMLTextAreaElement>();
  for (const [key, label, placeholder] of UPDATE_LABELS) {
    const ta = el("textarea", "app-input") as HTMLTextAreaElement;
    ta.rows = 2;
    ta.placeholder = placeholder;
    ta.value = o.existing ? o.existing[key] : "";
    const f = el("div", "app-field");
    f.append(el("span", "app-field-label", label), ta);
    box.appendChild(f);
    inputs.set(key, ta);
  }
  const read = (): UpdateFields => ({ high: inputs.get("high")!.value, low: inputs.get("low")!.value, next: inputs.get("next")!.value, support: inputs.get("support")!.value });
  // support text and the ⚐ flag must not silently disagree — the tick
  // pre-arms when support text exists, stays the author's call
  let flagBox: HTMLInputElement | null = null;
  if (o.offerFlag) {
    const flagWrap = el("label", "app-check app-ib-supportflag");
    flagBox = el("input") as HTMLInputElement;
    flagBox.type = "checkbox";
    flagWrap.append(flagBox, el("span", undefined, "Raise the ⚐ Needs support flag"));
    const support = inputs.get("support")!;
    const sync = () => {
      const has = support.value.trim() !== "";
      flagWrap.style.display = has ? "" : "none";
      if (has && !flagBox!.dataset.touched) flagBox!.checked = true;
    };
    sync();
    support.addEventListener("input", sync);
    flagBox.addEventListener("change", () => {
      flagBox!.dataset.touched = "1";
    });
    box.appendChild(flagWrap);
  }
  const err = el("div", "app-cp-err", "");
  box.appendChild(err);
  const foot = el("div", "app-modal-footer");
  const cancel = btn("Cancel", "app-link");
  cancel.addEventListener("click", () => scrim.remove());
  const save = btn("Save", "app-btn app-btn-primary");
  save.addEventListener("click", () => {
    const fields = read();
    if (isBlank(fields)) {
      err.textContent = "Write at least one of the four.";
      return;
    }
    if (o.existing && sameFields(fields, o.existing)) {
      scrim.remove();
      return;
    }
    save.disabled = true;
    void o
      .onSave(fields, flagBox?.checked === true && fields.support.trim() !== "")
      .then(() => scrim.remove())
      .catch(() => {
        save.disabled = false;
        err.textContent = "That could not be saved. Try again.";
      });
  });
  foot.append(cancel, save);
  box.appendChild(foot);
  scrim.appendChild(box);
  document.body.appendChild(scrim);
  inputs.get("high")!.focus();
}
