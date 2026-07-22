// Loading affordance — a spinner with a random quote underneath, shown
// while a board (and its calendar) loads or a meeting record is being
// created. Inline mode fills its host; overlay mode floats over it.

import { el } from "../../shared/ui/dom";
import { QUOTES } from "./quotesData";

export function showLoading(host: HTMLElement, overlay = false): () => void {
  const wrap = el(
    "div",
    overlay ? "app-loading app-loading-overlay" : "app-loading"
  );
  wrap.appendChild(el("div", "app-loading-spinner"));
  const pick = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  wrap.appendChild(el("div", "app-loading-quote", `“${pick.q}”`));
  wrap.appendChild(el("div", "app-loading-by", `— ${pick.by}`));
  host.appendChild(wrap);
  return () => wrap.remove();
}
