// Card chrome: the optional title bar + prompts machinery every control
// shares. Boards are laid out in any sequence, so a card must describe
// itself — title bar when cardTitle is set, coaching prompts as empty-state
// ghost text, an ⓘ popover once the card has content, and per-field hints.

import { el } from "./dom";

export interface Prompts {
  /** General coaching text (empty state + ⓘ popover). */
  general: string[];
  /** Per-field placeholder hints, keyed by field name. */
  fields: Record<string, string>;
}

/** Parse the prompts input: plain string, string array, or [{field, hint}]. */
export function parsePrompts(raw: string | null | undefined): Prompts {
  const out: Prompts = { general: [], fields: {} };
  const t = (raw ?? "").trim();
  if (t === "") return out;
  if (!t.startsWith("[") && !t.startsWith("{")) {
    out.general.push(t);
    return out;
  }
  try {
    const data = JSON.parse(t) as unknown;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (typeof item === "string") {
        if (item.trim() !== "") out.general.push(item.trim());
      } else if (item && typeof item === "object") {
        const o = item as { field?: unknown; hint?: unknown };
        const hint = typeof o.hint === "string" ? o.hint.trim() : "";
        if (hint === "") continue;
        if (typeof o.field === "string" && o.field !== "") {
          out.fields[o.field] = hint;
        } else {
          out.general.push(hint);
        }
      }
    }
  } catch {
    out.general.push(t);
  }
  return out;
}

/** Field hint with a fallback default. */
export function hintFor(prompts: Prompts, field: string, fallback: string): string {
  return prompts.fields[field] ?? fallback;
}

/**
 * Render the optional title bar. Returns the bar (already appended) or null
 * when no title is set — in which case the card has no chrome at all.
 */
export function renderTitleBar(
  host: HTMLElement,
  title: string,
  prompts: Prompts
): HTMLElement | null {
  const t = title.trim();
  if (t === "") return null;
  const bar = el("div", "ltk-titlebar");
  bar.appendChild(el("div", "ltk-titlebar-text", t));
  if (prompts.general.length > 0) {
    const info = el("button", "ltk-info-btn", "ⓘ");
    info.type = "button";
    info.setAttribute("aria-label", "Prompts");
    const pop = el("div", "ltk-info-pop");
    for (const g of prompts.general) pop.appendChild(el("div", "ltk-info-line", g));
    pop.style.display = "none";
    info.addEventListener("click", (e) => {
      e.stopPropagation();
      pop.style.display = pop.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("pointerdown", (e) => {
      if (!pop.contains(e.target as Node) && e.target !== info) {
        pop.style.display = "none";
      }
    });
    bar.append(info, pop);
  }
  host.appendChild(bar);
  return bar;
}

/** Instructive empty state — never render a blank rectangle. */
export function renderGhost(host: HTMLElement, lines: string[]): HTMLElement {
  const ghost = el("div", "ltk-ghost");
  for (const line of lines) ghost.appendChild(el("div", "ltk-ghost-line", line));
  host.appendChild(ghost);
  return ghost;
}
