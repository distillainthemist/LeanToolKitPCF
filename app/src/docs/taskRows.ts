// Task rows — the R5 anatomy of the register's Document-tasks panel,
// extracted (doc-cards plan B3) so the board's Document-health card
// renders THE SAME rows: pill · name-over-meta · chevron, every row
// identical, the WHOLE row opens the overlay — decisions happen in the
// overlay's decision zone, never in divergent inline buttons. R6: due
// labels are PILLS (glyph + word), never bare red text.

import { el } from "../../../shared/ui/dom";

/** Group header: "Title (n)". */
export function taskGroupHeader(title: string, count: number): HTMLElement {
  return el("div", "app-docs-tasksgroup", `${title} (${count})`);
}

/** One R5 task row. The caller supplies the pill (tonePill or a
 *  register status chip) and what opening means. */
export function taskRowEl(opts: {
  pill: HTMLElement;
  name: string;
  meta: string;
  onOpen: () => void;
}): HTMLElement {
  const rowEl = el("div", "app-docs-taskrow");
  rowEl.setAttribute("role", "button");
  rowEl.tabIndex = 0;
  rowEl.addEventListener("click", opts.onOpen);
  rowEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") opts.onOpen();
  });
  const text = el("div", "app-docs-tasktext");
  text.append(
    el("div", "app-docs-taskname", opts.name),
    el("div", "app-field-hint", opts.meta)
  );
  rowEl.append(opts.pill, text, el("span", "app-docs-taskchev", "›"));
  return rowEl;
}
