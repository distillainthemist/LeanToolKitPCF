// The settings section strip (2026-10-07): the heading id and the
// scroll-spy's "which section is in view" rule — both pure.

import { describe, expect, it } from "vitest";
import { sectionId } from "../settingsSection";
import { STRIP_MIN_SECTIONS, currentSectionIndex } from "../settingsStrip";

describe("sectionId", () => {
  it("slugs a title, dropping punctuation and runs of separators", () => {
    expect(sectionId("Term sets & colours")).toBe("sec-term-sets-colours");
    expect(sectionId("SharePoint connection")).toBe("sec-sharepoint-connection");
    expect(sectionId("  Review   cadence ")).toBe("sec-review-cadence");
  });
  it("never yields a bare prefix", () => {
    expect(sectionId("&&&")).toBe("sec-section");
  });
});

describe("currentSectionIndex", () => {
  it("is the last head at or above the threshold", () => {
    expect(currentSectionIndex([-400, -100, 300, 900], 80)).toBe(1);
    expect(currentSectionIndex([-400, 60, 300, 900], 80)).toBe(1);
  });
  it("is the first head when none has scrolled past yet", () => {
    expect(currentSectionIndex([200, 600], 80)).toBe(0);
  });
  it("is the last head at the bottom of the page", () => {
    expect(currentSectionIndex([-900, -600, -200], 80)).toBe(2);
  });
  it("is -1 with no heads", () => {
    expect(currentSectionIndex([], 80)).toBe(-1);
  });
  it("needs three sections before a strip is worth a row", () => {
    expect(STRIP_MIN_SECTIONS).toBe(3);
  });
});
