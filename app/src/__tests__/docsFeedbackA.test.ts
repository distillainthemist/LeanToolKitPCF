// Feedback round 1, Tranche A — the pure parts (plan: docs/user-feedback-plan-2026-10.md).
import { describe, expect, it } from "vitest";
import { newDocumentWrites, prefillFromItem, splitAddWrites, taxonomyTermsOf, SpField } from "../docs/model";

const field = (over: Partial<SpField>): SpField => ({
  internal: "X",
  title: "X",
  type: "Text",
  choices: [],
  isTaxonomy: false,
  termSetId: "",
  required: false,
  ...over,
});

describe("A3 — a date-only column prefills as the site's day, not the UTC day", () => {
  it("reads 19 Aug for an Australian site's midnight expressed in UTC", () => {
    // the test runner's zone decides the local day; build the instant from local parts
    const local = new Date(2026, 7, 19, 0, 0, 0);
    const got = prefillFromItem({ ReviewDate: local.toISOString() }, [field({ internal: "ReviewDate", type: "DateTime" })]);
    expect(got.get("ReviewDate")?.text).toBe("2026-08-19");
  });
  it("keeps an unparseable value's first ten characters", () => {
    const got = prefillFromItem({ D: "not-a-date-at-all" }, [field({ internal: "D", type: "DateTime" })]);
    expect(got.get("D")?.text).toBe("not-a-date");
  });
});

describe("A9 — multi-value tags keep every term", () => {
  const tags = field({ internal: "Tags", type: "TaxonomyFieldTypeMulti", isTaxonomy: true, termSetId: "s" });
  it("prefills every term, the first as the single twin", () => {
    const got = prefillFromItem(
      { Tags: [{ Label: "Crane Ops", TermGuid: "g1" }, { Label: "Night shift", TermGuid: "g2" }, { Label: "", TermGuid: "" }] },
      [tags]
    );
    expect(got.get("Tags")?.terms?.map((t) => t.label)).toEqual(["Crane Ops", "Night shift"]);
    expect(got.get("Tags")?.term?.termId).toBe("g1");
  });
  it("writes every term — an array for the patch, ';'-joined for the forms engine", () => {
    const v = { internal: "Tags", kind: "taxonomy" as const, label: "Crane Ops", termId: "g1", multi: true, terms: [{ label: "Crane Ops", termId: "g1" }, { label: "Night shift", termId: "g2" }] };
    expect(taxonomyTermsOf(v).length).toBe(2);
    const add = splitAddWrites([v]);
    expect(add.patch.Tags).toEqual([{ Value: "Crane Ops", TermGuid: "g1", WssId: -1 }, { Value: "Night shift", TermGuid: "g2", WssId: -1 }]);
    const edit = newDocumentWrites([v], 1033);
    expect(edit.formValues.find((f) => f.FieldName === "Tags")?.FieldValue).toBe("Crane Ops|g1;Night shift|g2");
    expect(edit.taxInternals).toEqual(["Tags"]);
  });
  it("a single column still writes one term; an empty multi writes nothing", () => {
    const one = { internal: "Area", kind: "taxonomy" as const, label: "Safety", termId: "g9" };
    expect(splitAddWrites([one]).patch.Area).toEqual({ Value: "Safety", TermGuid: "g9", WssId: -1 });
    const none = { internal: "Tags", kind: "taxonomy" as const, label: "", termId: "", multi: true, terms: [] };
    expect(splitAddWrites([none]).patch.Tags).toBeUndefined();
  });
});
