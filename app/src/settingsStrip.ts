// The settings section strip (docs/settings-nav-proposal-2026-10.md,
// built 2026-10-07): a second, smaller row of section pills under the
// tabs that sticks to the top of the window scroll. It is DERIVED: after
// a tab renders, the strip reads the body's `h3.app-pr-h3` heads
// (settingsSection) and shows one pill per section — only when there
// are STRIP_MIN_SECTIONS or more, so a two-heading tab stays as it is.
// Scroll-spy tints the section in view; a click scrolls to its head.
// The hash is never written: the unsaved-changes guard and the router
// stay out of it.

import { el, clear } from "../../shared/ui/dom";

/** Fewer sections than this: no strip. Two since 2026-10-08 (Ben asked
 *  for the chips on Priorities, which has pillars and the period rule);
 *  a one-section tab still shows none. */
export const STRIP_MIN_SECTIONS = 2;

/** Which section is "in view": the LAST head whose top is at or above
 *  the threshold (the strip's bottom edge plus a little), else the first.
 *  -1 for no heads. Pure. */
export function currentSectionIndex(tops: number[], threshold: number): number {
  if (tops.length === 0) return -1;
  let current = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= threshold) current = i;
  return current;
}

const CARD = "app-settings-sectioncard";

/**
 * Section cards (Ben, 2026-10-08 — "hard to delineate the sections"):
 * each section head and the siblings that follow it, up to the next
 * head, are folded into one white card on the body's tinted ground;
 * content before the first head gets a leading card of its own. The
 * tabs never change: this runs after a render and again on repaints,
 * and is IDEMPOTENT — a child already in a card is left where it is,
 * a child appended later lands in the last card.
 */
export function groupSections(body: HTMLElement): void {
  groupWithin(body);
}

function groupWithin(host: HTMLElement): void {
  // a leading card made before a container inside it had its sections
  // (Site cadence's pane fills after its picker is on the page): take
  // it apart so the pass below can card what is there NOW
  for (const lead of Array.from(host.querySelectorAll<HTMLElement>(`:scope > .${CARD}-lead`))) {
    if (lead.querySelector(".app-pr-section") === null) continue;
    for (const c of Array.from(lead.children)) host.insertBefore(c, lead);
    lead.remove();
  }
  let card: HTMLElement | null = null;
  for (const child of Array.from(host.children) as HTMLElement[]) {
    if (child.classList.contains(CARD)) {
      card = child;
      continue;
    }
    const isHead = child.classList.contains("app-pr-section");
    // a container with sections of its OWN (Site cadence's pane under
    // its site picker): the cards go inside it and the container stays
    // on the ground — never a card around a column of cards
    // …and once grouped, its children are CARDS, not heads: the test
    // must see both, or the next pass wraps the container, the pass
    // after unwraps it, and every refresh moves the DOM under a focused
    // field (Site cadence's inputs lost focus on click, 2026-10-08)
    if (!isHead && child.querySelector(`:scope > .app-pr-section, :scope > .${CARD}`) !== null) {
      groupWithin(child);
      card = null;
      continue;
    }
    if (isHead || card === null) {
      const next = el("div", CARD + (isHead ? "" : ` ${CARD}-lead`));
      host.insertBefore(next, child);
      next.appendChild(child);
      card = next;
      continue;
    }
    card.appendChild(child);
  }
}

export interface SectionStrip {
  /** Re-read the body's headings (a tab rendered, or repainted). */
  refresh: () => void;
  /** The tab is leaving: drop its lifted tools and pills before the
   *  body is cleared (a tool lives in the strip, not the body). */
  reset: () => void;
  destroy: () => void;
}

/** A tab marks a control row with this class (Site cadence's site
 *  picker) and the strip lifts it into its right end — the row the
 *  eye already reads for "which section", now also "which site". */
export const STRIP_TOOL = "app-settings-striptool";

export function mountSectionStrip(host: HTMLElement, body: HTMLElement): SectionStrip {
  host.classList.add("app-settings-strip");
  const pillsBox = el("div", "app-settings-strip-pills");
  const tools = el("div", "app-settings-strip-tools");
  host.append(pillsBox, tools);
  let heads: HTMLElement[] = [];
  let pills: HTMLButtonElement[] = [];
  let current = -1;
  let signature = "";
  let raf = 0;

  const spy = () => {
    raf = 0;
    if (heads.length === 0) return;
    const threshold = host.getBoundingClientRect().bottom + 24;
    const next = currentSectionIndex(
      heads.map((h) => h.getBoundingClientRect().top),
      threshold
    );
    if (next === current) return;
    current = next;
    pills.forEach((p, i) => {
      p.classList.toggle("app-settings-pill-on", i === current);
      p.setAttribute("aria-current", i === current ? "true" : "false");
    });
    // a phone's strip scrolls sideways: keep the current pill in view
    const on = pills[current];
    if (on && typeof on.scrollIntoView === "function" && pillsBox.scrollWidth > pillsBox.clientWidth) {
      on.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  };
  const onScroll = () => {
    if (raf === 0) raf = requestAnimationFrame(spy);
  };

  const refresh = () => {
    // tools first, before grouping would card them: a tab's marked rows
    // move into the strip; a new tab (new heads) starts with none
    const lifted = Array.from(body.querySelectorAll<HTMLElement>(`.${STRIP_TOOL}`));
    const nextHeads = Array.from(body.querySelectorAll<HTMLElement>("h3.app-pr-h3"));
    const sig = nextHeads.map((h) => h.textContent ?? "").join("\u0001");
    // never cleared here: a tab's rows can land before its headings do
    // (Site cadence's picker, then the pane) — the shell resets on leave
    for (const t of lifted) tools.appendChild(t);
    groupSections(body);
    heads = nextHeads;
    const hasTools = tools.childElementCount > 0;
    if (sig === signature && pillsBox.childElementCount === pills.length) {
      host.classList.toggle("app-settings-strip-on", heads.length >= STRIP_MIN_SECTIONS || hasTools);
      return;
    }
    signature = sig;
    clear(pillsBox);
    pills = [];
    current = -1;
    const show = heads.length >= STRIP_MIN_SECTIONS || hasTools;
    host.classList.toggle("app-settings-strip-on", show);
    pillsBox.style.display = heads.length >= STRIP_MIN_SECTIONS ? "" : "none";
    if (!show) return;
    for (const h of heads) {
      const pill = el("button", "app-settings-pill", h.textContent ?? "") as HTMLButtonElement;
      pill.type = "button";
      pill.title = `Go to ${h.textContent ?? "this section"}`;
      pill.addEventListener("click", () => {
        // the strip wraps to two rows on Documents: offset by its LIVE
        // height, not a fixed margin, so the head lands under it
        const offset = host.getBoundingClientRect().height + 12;
        const top = h.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      });
      pillsBox.appendChild(pill);
      pills.push(pill);
    }
    onScroll();
  };

  // a tab that repaints itself (a list redrawn, a card added) keeps the
  // strip honest without being asked
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const mo =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
          if (debounce !== null) clearTimeout(debounce);
          debounce = setTimeout(refresh, 150);
        })
      : null;
  mo?.observe(body, { childList: true, subtree: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  const reset = () => {
    clear(tools);
    clear(pillsBox);
    pills = [];
    heads = [];
    current = -1;
    signature = "";
    host.classList.remove("app-settings-strip-on");
  };

  return {
    refresh,
    reset,
    destroy: () => {
      mo?.disconnect();
      if (debounce !== null) clearTimeout(debounce);
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      clear(host);
    },
  };
}
