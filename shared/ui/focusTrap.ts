// Modal focus handling for the app's overlays (the card studio, the add-card
// picker). Without it, Tab walks straight out of the dialog into the board
// behind it — which is both a keyboard trap in reverse and a way to type into
// a card you cannot see.
//
// Also restores focus to whatever opened the dialog, so closing one does not
// dump the caret back at the top of the document.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Focusable descendants that are actually on screen, in tab order. */
function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((elem) => {
    // an element inside a display:none parent reports its OWN display, so
    // checkVisibility is the only reliable test (see the tile-mode audit).
    // PROBED, not assumed: this file is shared with the control suite,
    // which compiles against an older DOM lib that has never heard of it
    // (root typecheck, 2026-08-08) — and older browsers have not either.
    const probe = elem as HTMLElement & { checkVisibility?: () => boolean };
    return typeof probe.checkVisibility === "function" ? probe.checkVisibility() : true;
  });
}

/**
 * Keep Tab inside `container` until the returned function is called, which
 * also returns focus to the element that had it beforehand.
 */
export function trapFocus(container: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = focusable(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !container.contains(active);
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    }
  };

  document.addEventListener("keydown", onKey, true);
  return () => {
    document.removeEventListener("keydown", onKey, true);
    // the opener may have gone (a tile that was archived); guard the call
    if (previous && previous.isConnected) previous.focus();
  };
}

/** Mark an overlay panel as a modal dialog for assistive technology. */
export function markDialog(panel: HTMLElement, label: string): void {
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", label);
}
