import { describe, expect, it } from "vitest";
import { decodePrioritiesView, emptyPrioritiesViewLink, encodePrioritiesView } from "../priorities/viewLink";

describe("a Priorities view as a link", () => {
  it("round-trips every field", () => {
    const v = { org: "Pechey|Bendigo|Packaging|", period: "FY27", status: "completed" as const, view: "dynamic" as const, l1: "s1", focus: ["o1", "o2"], rule: "ratio" as const, showOther: true, groupByPillar: false };
    expect(decodePrioritiesView(encodePrioritiesView(v))).toEqual(v);
  });
  it("an empty view encodes to nothing much and decodes to defaults", () => {
    expect(encodePrioritiesView(emptyPrioritiesViewLink())).toBe("{}");
    expect(decodePrioritiesView("")).toEqual(emptyPrioritiesViewLink());
    expect(decodePrioritiesView("not json")).toEqual(emptyPrioritiesViewLink());
    expect(decodePrioritiesView('{"s":"bogus","v":3,"so":"yes"}')).toEqual(emptyPrioritiesViewLink());
  });
});
