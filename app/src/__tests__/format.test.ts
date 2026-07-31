// Humanizing helpers (design review Phase 0.4): relative due labels must
// be calendar-day exact at the boundaries and never call a future date
// overdue — the review's red-pill bug class.

import { describe, expect, it } from "vitest";
import { dueTone, relativeDue } from "../../../shared/ui/format";

// a fixed LOCAL "now": Wed 15 Jul 2026, 09:30 local time
const NOW = new Date(2026, 6, 15, 9, 30).getTime();
const local = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  new Date(y, m, d, hh, mm).toISOString();

describe("relativeDue", () => {
  it("handles the day boundaries exactly", () => {
    // due later TODAY (23:59) — not overdue, whatever the clock says
    expect(relativeDue(local(2026, 6, 15, 23, 59), NOW)).toEqual({
      label: "Due today",
      tone: "today",
    });
    // due EARLIER today (00:05) is still today, not overdue
    expect(relativeDue(local(2026, 6, 15, 0, 5), NOW)).toEqual({
      label: "Due today",
      tone: "today",
    });
    expect(relativeDue(local(2026, 6, 16), NOW)).toEqual({
      label: "Due tomorrow",
      tone: "future",
    });
    expect(relativeDue(local(2026, 6, 14, 23, 0), NOW)).toEqual({
      label: "1 day overdue",
      tone: "overdue",
    });
    expect(relativeDue(local(2026, 6, 10), NOW).label).toBe("5 days overdue");
  });

  it("a future date NEVER reads overdue (the red-pill bug)", () => {
    for (let d = 16; d <= 31; d++) {
      expect(relativeDue(local(2026, 6, d), NOW).tone).not.toBe("overdue");
    }
  });

  it("far dates show the weekday-day-month form, with year only when it differs", () => {
    const sameYear = relativeDue(local(2026, 7, 3), NOW); // Mon 3 Aug 2026
    expect(sameYear.tone).toBe("future");
    expect(sameYear.label).toMatch(/^Due /);
    expect(sameYear.label).toContain("3");
    expect(sameYear.label).not.toContain("2026");
    const nextYear = relativeDue(local(2027, 0, 4), NOW);
    expect(nextYear.label).toContain("2027");
  });

  it("degrades to 'No due date' on empty or garbage", () => {
    expect(relativeDue("", NOW)).toEqual({ label: "No due date", tone: "none" });
    expect(relativeDue("not a date", NOW)).toEqual({ label: "No due date", tone: "none" });
  });
});

describe("dueTone", () => {
  it("maps overdue→red, today→amber, everything else calm", () => {
    expect(dueTone("overdue")).toBe("red");
    expect(dueTone("today")).toBe("amber");
    expect(dueTone("future")).toBe("neutral");
    expect(dueTone("none")).toBe("neutral");
  });
});
