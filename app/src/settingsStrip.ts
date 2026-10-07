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

/** Fewer sections than this: no strip (a row for two pills is noise). */
export const STRIP_MIN_SECTIONS = 3;

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
  let card: HTMLElement | null = null;
  for (const child of Array.from(body.children) as HTMLElement[]) {
    if (child.classList.contains(CARD)) {
      card = child;
      continue;
    }
    const isHead = child.classList.contains("app-pr-section");
    if (isHead || card === null) {
      const next = el("div", CARD + (isHead ? "" : ` ${CARD}-lead`));
      body.insertBefore(next, child);
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
  destroy: () => void;
}

export function mountSectionStrip(host: HTMLElement, body: HTMLElement): SectionStrip {
  host.classList.add("app-settings-strip");
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
    if (on && typeof on.scrollIntoView === "function" && host.scrollWidth > host.clientWidth) {
      on.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  };
  const onScroll = () => {
    if (raf === 0) raf = requestAnimationFrame(spy);
  };

  const refresh = () => {
    groupSections(body);
    heads = Array.from(body.querySelectorAll<HTMLElement>("h3.app-pr-h3"));
    const sig = heads.map((h) => h.textContent ?? "").join("\u0001");
    if (sig === signature && host.childElementCount === pills.length) return;
    signature = sig;
    clear(host);
    pills = [];
    current = -1;
    const show = heads.length >= STRIP_MIN_SECTIONS;
    host.classList.toggle("app-settings-strip-on", show);
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
      host.appendChild(pill);
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

  return {
    refresh,
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
