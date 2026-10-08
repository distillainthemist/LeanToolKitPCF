// The initiative header form's pure parts (initiativeForm.ts, 2026-10-08).
import { describe, expect, it } from "vitest";
import { alsoSummary, groupFor, isShortKind, pairFields } from "../improvement/initiativeFormModel";
import type { FieldKind } from "../improvement/templateModel";

const f = (kind: FieldKind, key = kind) => ({ key, kind });

describe("pairFields", () => {
  it("pairs consecutive short kinds and leaves prose and links alone", () => {
    const rows = pairFields([f("url"), f("date"), f("rating"), f("longtext"), f("picklist"), f("text"), f("integer"), f("number"), f("percent")]);
    expect(rows.map((r) => r.map((x) => x.key))).toEqual([["url"], ["date", "rating"], ["longtext"], ["picklist"], ["text"], ["integer", "number"], ["percent"]]);
  });
  it("keeps order and handles an empty list", () => {
    expect(pairFields([])).toEqual([]);
    expect(pairFields([f("date")]).length).toBe(1);
  });
  it("knows the short kinds", () => {
    expect(isShortKind("date")).toBe(true);
    expect(isShortKind("person")).toBe(true);
    expect(isShortKind("richtext")).toBe(false);
    expect(isShortKind("url")).toBe(false);
    expect(isShortKind("people")).toBe(false);
  });
});

describe("alsoSummary", () => {
  it("names the most specific level of each extra org", () => {
    expect(alsoSummary([])).toBe("only its own organisation");
    expect(alsoSummary([{ site: "Bendigo", department: "Packaging", area: "" }, { site: "Geelong", department: "", area: "" }, { site: "Bendigo", department: "Ops", area: "Line 2" }])).toBe("Packaging, Geelong, Line 2");
  });
});

describe("groupFor", () => {
  it("sends each model message to its group", () => {
    expect(groupFor("A title is needed.")).toBe("About");
    expect(groupFor("Pick the org this initiative belongs to.")).toBe("Organisation");
    expect(groupFor("An owner is needed.")).toBe("Priorities & people");
    expect(groupFor('Metric "OEE" needs a target.')).toBe("Metrics");
    expect(groupFor("Star at least one metric.")).toBe("Metrics");
    expect(groupFor("This template asks for at least one metric.")).toBe("Metrics");
  });
});
