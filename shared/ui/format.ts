// Humanizing helpers (design review Phase 0.4): relative due dates and
// glyph-and-word status chips. Dates never show as raw ISO in the UI —
// the ISO goes in a title attribute; colour never carries a state on its
// own — every chip pairs a glyph and a word so it reads under any
// colour-vision. Chips style INLINE so they render identically in live
// DOM and in stored SVG snapshots (which inline only the base CSS).

import { el } from "./dom";

export type DueTone = "overdue" | "today" | "future" | "none";

/** Local-calendar day difference (timezone-safe: both sides collapse to
 *  the LOCAL midnight before comparing, so "due today at 23:59" and a
 *  9am "now" are the same day everywhere). */
function dayDiff(dueMs: number, nowMs: number): number {
  const a = new Date(dueMs);
  const b = new Date(nowMs);
  const dueDay = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const nowDay = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dueDay - nowDay) / 86_400_000);
}

/** "5 days overdue" / "Due today" / "Due tomorrow" / "Due Mon 3 Aug".
 *  Put the exact ISO in `title=` wherever the label renders. */
export function relativeDue(
  dueIso: string,
  now: number = Date.now()
): { label: string; tone: DueTone } {
  const t = Date.parse(dueIso);
  if (dueIso.trim() === "" || Number.isNaN(t)) return { label: "No due date", tone: "none" };
  const days = dayDiff(t, now);
  if (days < 0) {
    const n = -days;
    return { label: `${n} day${n === 1 ? "" : "s"} overdue`, tone: "overdue" };
  }
  if (days === 0) return { label: "Due today", tone: "today" };
  if (days === 1) return { label: "Due tomorrow", tone: "future" };
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const label = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return { label: `Due ${label}`, tone: "future" };
}

export type ChipTone = "red" | "amber" | "green" | "neutral";

/** The review's tint pairs — AA against white, readable when filled. */
export const CHIP_TONES: Record<ChipTone, { bg: string; fg: string }> = {
  red: { bg: "#fdecec", fg: "#a02832" },
  amber: { bg: "#fef3e2", fg: "#92400e" },
  green: { bg: "#e3f4e8", fg: "#166534" },
  neutral: { bg: "#eceae5", fg: "#57534a" },
};

/** The due-pill mapping: overdue reads red, today amber, the rest calm. */
export function dueTone(tone: DueTone): ChipTone {
  return tone === "overdue" ? "red" : tone === "today" ? "amber" : "neutral";
}

/** A glyph-and-word pill ("● Recorded", "🔒 Closed", "⚑ 5 days overdue").
 *  Pass the glyph inside the text — the word is the accessible message,
 *  the glyph the at-a-distance one. */
export function statusChip(text: string, tone: ChipTone): HTMLElement {
  const chip = el("span", "ltk-status-chip", text);
  const c = CHIP_TONES[tone];
  chip.style.background = c.bg;
  chip.style.color = c.fg;
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.gap = "4px";
  chip.style.borderRadius = "999px";
  chip.style.padding = "2px 10px";
  chip.style.fontSize = "12px";
  chip.style.fontWeight = "600";
  chip.style.lineHeight = "1.6";
  chip.style.whiteSpace = "nowrap";
  return chip;
}
