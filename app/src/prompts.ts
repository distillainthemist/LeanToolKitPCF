// App-styled modal prompts shared across screens (Settings, wizard).
// Both replace native dialogs: window.prompt/confirm popups carry the
// browser's "An embedded page says…" chrome inside the Power Apps host.

import { el } from "../../shared/ui/dom";

/** Save / Discard / Cancel prompt for leaving with unsaved edits. */
// Every prompt here is the TOPMOST layer (`.app-modal-top`): a
// confirmation is asked from inside other layers — the card picker, the
// studio, a form's own modal — and must never open behind the one that
// asked (2026-09-29: the picker sat above the plain modal layer).
export function promptUnsaved(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay app-modal-top");
    const box = el("div", "app-modal");
    box.append(
      el("div", "app-modal-title", "Unsaved changes"),
      el(
        "div",
        "app-modal-note",
        "You've made changes here that haven't been saved. Save them before leaving, or discard them?"
      )
    );
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    const discard = el("button", "app-btn app-btn-danger", "Discard") as HTMLButtonElement;
    const save = el("button", "app-btn app-btn-primary", "Save changes") as HTMLButtonElement;
    footer.append(cancel, discard, save);
    box.appendChild(footer);
    const done = (r: "save" | "discard" | "cancel") => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done("cancel");
      }
    };
    cancel.addEventListener("click", () => done("cancel"));
    discard.addEventListener("click", () => done("discard"));
    save.addEventListener("click", () => done("save"));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
  });
}

/**
 * Single-input dialog (replaces window.prompt). Resolves the entered
 * string, or null on cancel/Escape. Enter confirms.
 */
export function promptText(opts: {
  title: string;
  note?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** A few lines rather than one (a reason, a comment for the log). */
  multiline?: boolean;
  /** Refuse an empty answer, saying what is needed. */
  required?: string;
  /** The confirm button is a destructive step. */
  danger?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay app-modal-top");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", opts.title));
    if (opts.note) box.appendChild(el("div", "app-modal-note", opts.note));
    const input = (opts.multiline ? el("textarea", "app-input") : el("input", "app-input")) as HTMLInputElement | HTMLTextAreaElement;
    if (input instanceof HTMLTextAreaElement) input.rows = 3;
    input.value = opts.initial ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    box.appendChild(input);
    const err = el("div", "app-cp-err", "");
    box.appendChild(err);
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    const ok = el(
      "button",
      "app-btn " + (opts.danger ? "app-btn-danger" : "app-btn-primary"),
      opts.confirmLabel ?? "Save"
    ) as HTMLButtonElement;
    ok.type = "button";
    footer.append(cancel, ok);
    box.appendChild(footer);
    const done = (v: string | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const submit = () => {
      if (opts.required !== undefined && input.value.trim() === "") {
        err.textContent = opts.required;
        input.focus();
        return;
      }
      done(input.value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && document.activeElement === input && !(input instanceof HTMLTextAreaElement)) {
        // Enter saves a one-line answer; in a text area it is a new line
        e.stopPropagation();
        submit();
      }
    };
    input.addEventListener("input", () => {
      err.textContent = "";
    });
    cancel.addEventListener("click", () => done(null));
    ok.addEventListener("click", submit);
    // typed text is never lost to a click outside (Ben, 2026-10-07)
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    input.focus();
    input.select();
  });
}

/** A yes/no confirmation — centred modal, Esc/click-out = no. */
/** The confirmation every settings delete that WRITES AT ONCE asks
 *  (Ben, 2026-10-08: a standard role went with one click). Draft lists
 *  that save from the bar keep their plain × — Discard is their undo. */
export function confirmRemoval(what: string, note = "This removes it straight away."): Promise<boolean> {
  return promptConfirm({ title: `Remove ${what}?`, note, confirmLabel: "Remove", danger: true });
}

export function promptConfirm(opts: {
  title: string;
  note?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay app-modal-top");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", opts.title));
    if (opts.note) box.appendChild(el("div", "app-modal-note", opts.note));
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    const ok = el("button", "app-btn " + (opts.danger ? "app-btn-danger" : "app-btn-primary"), opts.confirmLabel ?? "OK") as HTMLButtonElement;
    ok.type = "button";
    footer.append(cancel, ok);
    box.appendChild(footer);
    const done = (v: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    ok.focus();
  });
}
