// The ingestion grid's draft model (ingestionDraft.ts, 2026-10-09).
import { describe, expect, it } from "vitest";
import { applyToRows, dirtyRows, draftDisplay, effectiveValues, savedDisplay, setCell, writesFor, Draft } from "../docs/ingestionDraft";

const org = { internal: "DMSOrganisation", kind: "taxonomy" as const, label: "Pechey", termId: "t1" };
const owner = { internal: "DMSOwner", kind: "person" as const, people: [{ email: "ann@x.test", name: "Ann Ray" }] };
const eff = { internal: "DMSEffective", kind: "date" as const, text: "2026-10-09" };

describe("draftDisplay / savedDisplay", () => {
  it("reads a draft the way the register reads a saved value", () => {
    expect(draftDisplay(org)).toBe("Pechey");
    expect(draftDisplay(owner)).toBe("Ann Ray");
    expect(draftDisplay({ internal: "x", kind: "text", text: "  Hello " })).toBe("Hello");
    expect(savedDisplay({ "DMSEffective.": "2026-10-09T00:00:00Z", DMSEffective: "9 Oct 2026" }, "DMSEffective", "date")).toBe("2026-10-09");
  });
});

describe("setCell", () => {
  it("marks a changed cell dirty, drops a blank or unchanged one, and cleans up the row", () => {
    const d: Draft = new Map();
    const saved = { DMSOrganisation: "Pechey", DMSOwner: "" };
    expect(setCell(d, "a", saved, org)).toBe(false); // same as saved
    expect(d.size).toBe(0);
    expect(setCell(d, "a", saved, owner)).toBe(true);
    expect(dirtyRows(d)).toEqual(["a"]);
    expect(writesFor(d, "a")).toEqual([owner]);
    expect(setCell(d, "a", saved, { ...owner, people: [] })).toBe(false); // blanked = revert
    expect(d.size).toBe(0);
  });
});

describe("effectiveValues", () => {
  it("overlays the draft on the saved strings, dates with their ISO twin", () => {
    const d: Draft = new Map();
    const saved = { DMSOwner: "", DMSEffective: "" };
    setCell(d, "a", saved, owner);
    setCell(d, "a", saved, eff);
    const v = effectiveValues(saved, d.get("a"));
    expect(v.DMSOwner).toBe("Ann Ray");
    expect(v.DMSEffective).toBe("2026-10-09");
    expect(v["DMSEffective."]).toBe("2026-10-09");
    expect(effectiveValues(saved, undefined)).toBe(saved);
  });
});

describe("applyToRows", () => {
  it("sets every row, or only the blanks, and counts the rows it changed", () => {
    const rows = [
      { uniqueId: "a", values: { DMSOrganisation: "", DMSOwner: "Sam" } },
      { uniqueId: "b", values: { DMSOrganisation: "Other", DMSOwner: "" } },
    ];
    const d: Draft = new Map();
    expect(applyToRows(d, rows, [org, owner], true)).toBe(2); // a gets org, b gets owner
    expect(writesFor(d, "a").map((v) => v.internal)).toEqual(["DMSOrganisation"]);
    expect(writesFor(d, "b").map((v) => v.internal)).toEqual(["DMSOwner"]);
    const d2: Draft = new Map();
    expect(applyToRows(d2, rows, [org], false)).toBe(2);
    expect(writesFor(d2, "b")[0].label).toBe("Pechey");
    expect(applyToRows(d2, rows, [org], false)).toBe(0); // nothing new
  });
});
