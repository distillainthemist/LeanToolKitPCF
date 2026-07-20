// App-styled modal prompts shared across screens (Settings, wizard).
// Both replace native dialogs: window.prompt/confirm popups carry the
// browser's "An embedded page says…" chrome inside the Power Apps host.

import { el } from "../../shared/ui/dom";

/** Save / Discard / Cancel prompt for leaving with unsaved edits. */
export function promptUnsaved(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay");
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
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", opts.title));
    if (opts.note) box.appendChild(el("div", "app-modal-note", opts.note));
    const input = el("input", "app-input") as HTMLInputElement;
    input.value = opts.initial ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    box.appendChild(input);
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    const ok = el(
      "button",
      "app-btn app-btn-primary",
      opts.confirmLabel ?? "Save"
    ) as HTMLButtonElement;
    footer.append(cancel, ok);
    box.appendChild(footer);
    const done = (v: string | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && document.activeElement === input) {
        e.stopPropagation();
        done(input.value);
      }
    };
    cancel.addEventListener("click", () => done(null));
    ok.addEventListener("click", () => done(input.value));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    input.focus();
    input.select();
  });
}
