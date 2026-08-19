// Loading affordance — a spinner with a random quote underneath, shown
// while a board (and its calendar) loads or a meeting record is being
// created. Inline mode fills its host; overlay mode floats over it.

import { el } from "../../shared/ui/dom";
import { QUOTES } from "./quotesData";

/**
 * Catch handler for a screen's boot promise. A refused Dataverse call
 * RESOLVES with success:false and used to read as an empty table; since
 * dv.ts settle() it THROWS instead — so every routed screen's boot needs
 * a catch that paints the refusal, or a permission gap strands the
 * spinner (the 2026-08-05 "not set up yet" incident, made visible).
 */
export function bootFail(host: HTMLElement, what: string): (err: unknown) => void {
  return (err) => {
    // the spinner's stop closure usually lives inside the failed boot —
    // sweep any loading affordance under this host instead
    for (const spin of Array.from(host.querySelectorAll(".app-loading"))) spin.remove();
    const msg = err instanceof Error ? err.message : String(err);
    const box = el("pre", "app-missing");
    box.textContent =
      `${what} could not load:\n${msg}\n\n` +
      "If this mentions permission or privilege, the LeanBoard User " +
      "security role may be missing or incomplete for your account.";
    host.appendChild(box);
  };
}

export function showLoading(host: HTMLElement, overlay = false, quiet = false): () => void {
  const wrap = el(
    "div",
    overlay ? "app-loading app-loading-overlay" : "app-loading"
  );
  wrap.appendChild(el("div", "app-loading-spinner"));
  // quiet = spinner only — card tiles and small hosts, where the quote
  // would be the biggest thing on screen
  if (!quiet) {
    const pick = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    wrap.appendChild(el("div", "app-loading-quote", `“${pick.q}”`));
    wrap.appendChild(el("div", "app-loading-by", `— ${pick.by}`));
  }
  host.appendChild(wrap);
  return () => wrap.remove();
}
