// The toolkit's one modal dialog — every add/edit interaction in every
// control goes through this, so dialogs look and behave identically
// everywhere (Flat 2.0, keyboard + touch, Esc/underlay to cancel).

import { el } from "./dom";

export interface DialogButton {
  label: string;
  kind: "primary" | "secondary" | "danger";
  onClick: () => void; // call close() yourself if the dialog should shut
}

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

export interface DialogOptions {
  host: HTMLElement; // positioned container the overlay fills
  title: string;
  buttons: DialogButton[];
  onClose?: () => void;
}

export function openDialog(opts: DialogOptions): DialogHandle {
  // one dialog at a time per control — a second open replaces the first
  for (const existing of Array.from(
    opts.host.querySelectorAll(".ltk-dialog-overlay")
  )) {
    existing.remove();
  }
  const overlay = el("div", "ltk-dialog-overlay");
  const box = el("div", "ltk-dialog");
  const heading = el("div", "ltk-dialog-title", opts.title);
  const body = el("div", "ltk-dialog-body");
  const footer = el("div", "ltk-dialog-footer");

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (opts.onClose) opts.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  for (const b of opts.buttons) {
    const btn = el("button", `ltk-btn ltk-btn-${b.kind}`, b.label);
    btn.type = "button";
    btn.addEventListener("click", b.onClick);
    footer.appendChild(btn);
  }

  // dismiss on click (not pointerdown) so closing can never let the same
  // press fall through to whatever sits behind the overlay
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);

  box.append(heading, body, footer);
  overlay.appendChild(box);
  opts.host.appendChild(overlay);
  return { root: overlay, body, close };
}

// ---- field builders -------------------------------------------------------

export function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = el("div", "ltk-field");
  row.appendChild(el("label", "ltk-field-label", label));
  row.appendChild(control);
  return row;
}

export function textArea(
  value: string,
  opts: { placeholder?: string; maxLength?: number; rows?: number } = {}
): HTMLTextAreaElement {
  const ta = el("textarea", "ltk-input ltk-textarea");
  ta.value = value;
  ta.rows = opts.rows ?? 3;
  if (opts.placeholder) ta.placeholder = opts.placeholder;
  if (opts.maxLength) ta.maxLength = opts.maxLength;
  return ta;
}

export function textInput(
  value: string,
  opts: { placeholder?: string; type?: string } = {}
): HTMLInputElement {
  const input = el("input", "ltk-input");
  input.type = opts.type ?? "text";
  input.value = value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  return input;
}

export function selectInput(
  value: string,
  options: { value: string; label: string }[]
): HTMLSelectElement {
  const sel = el("select", "ltk-input ltk-select");
  for (const o of options) {
    const opt = el("option", undefined, o.label);
    opt.value = o.value;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

/** Uppercase section divider inside a dialog body ("Actions", "Who"…). */
export function sectionLabel(text: string): HTMLElement {
  return el("div", "ltk-section", text);
}

/** A bordered checkbox chip; highlights while ticked. */
export function checkItem(label: string): {
  wrap: HTMLLabelElement;
  box: HTMLInputElement;
} {
  const wrap = el("label", "ltk-check");
  const box = el("input");
  box.type = "checkbox";
  box.addEventListener("change", () => {
    wrap.classList.toggle("ltk-check-on", box.checked);
  });
  wrap.append(box, document.createTextNode(label));
  return { wrap, box };
}

/** Grid container for checkItem chips. */
export function checklist(): HTMLElement {
  return el("div", "ltk-checklist");
}

/** Character counter that live-tracks a textarea (the Fishbone `x/100`). */
export function charCounter(ta: HTMLTextAreaElement, max: number): HTMLElement {
  const counter = el("div", "ltk-char-counter", `${ta.value.length}/${max}`);
  ta.addEventListener("input", () => {
    counter.textContent = `${ta.value.length}/${max}`;
  });
  return counter;
}
