// The ONE settings section head (ui-standard §6; settings navigation,
// 2026-10-07). Every settings module builds its page sections through
// this, so the section strip (settingsStrip.ts) can be DERIVED from the
// headings after a tab renders — nothing is listed by hand, and a section
// added tomorrow is in the strip tomorrow. Card titles inside a section
// (an access card's "Add people") are not sections and keep their own
// small-caps divider (.app-section).

import { el } from "../../shared/ui/dom";

/** A stable, readable id for a section heading — "Term sets & colours"
 *  → "sec-term-sets-colours". Pure. */
export function sectionId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sec-${slug === "" ? "section" : slug}`;
}

/** `.app-pr-section > h3.app-pr-h3 [+ .app-settings-note]` — the heading
 *  carries the id and the title the strip reads. */
export function settingsSection(title: string, note?: string): HTMLElement {
  const wrap = el("div", "app-pr-section");
  const h = el("h3", "app-pr-h3", title);
  h.id = sectionId(title);
  h.dataset.section = title;
  wrap.appendChild(h);
  if (note) wrap.appendChild(el("div", "app-settings-note", note));
  return wrap;
}
