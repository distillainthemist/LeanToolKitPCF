// Initiative commentary (2026-09-29): the trail, edits that keep the
// earlier wording, and the stale cue.
import { describe, expect, it } from "vitest";
import { ageLabel, daysBetween, editedDetail, isBlank, MAX_PREVIOUS, sameFields, staleDays, updatesFrom } from "../improvement/commentaryModel";

const ev = (id: string, at: string, detail: Record<string, unknown>, kind = "comment") => ({ id, kind, detail, actorId: "u1", actorName: "Jane Smith", at });

describe("updatesFrom", () => {
  it("keeps the comments, newest first, whatever order they arrive in", () => {
    const list = updatesFrom([ev("a", "2026-09-01T09:00:00Z", { high: "one" }), ev("g", "2026-09-10T09:00:00Z", { what: "requested" }, "gate"), ev("b", "2026-09-20T09:00:00Z", { high: "two", support: "cover" })]);
    expect(list.map((u) => u.id)).toEqual(["b", "a"]);
    expect(list[0].support).toBe("cover");
    expect(list[0].low).toBe("");
    expect(list[0].who).toBe("Jane Smith");
  });
  it("reads an edited update's stamp and earlier wording; junk reads as none", () => {
    const [u] = updatesFrom([ev("a", "2026-09-01T09:00:00Z", { high: "now", editedBy: "Sam Lee", editedAt: "2026-09-02T10:00:00Z", previous: [{ high: "before", who: "Jane Smith", at: "2026-09-01T09:00:00Z" }, null, "x"] })]);
    expect(u.editedBy).toBe("Sam Lee");
    expect(u.previous).toHaveLength(1);
    expect(u.previous[0].high).toBe("before");
    expect(updatesFrom([ev("b", "2026-09-01", { previous: "nope" })])[0].previous).toEqual([]);
  });
});

describe("editedDetail", () => {
  const [u] = updatesFrom([ev("a", "2026-09-01T09:00:00Z", { high: "first", next: "trial" })]);
  it("stamps the editor and keeps the wording it replaces", () => {
    const d = editedDetail(u, { high: " second ", low: "", next: "trial", support: "" }, "Sam Lee", "2026-09-03T08:00:00Z");
    expect(d.high).toBe("second");
    expect(d.editedBy).toBe("Sam Lee");
    expect(d.editedAt).toBe("2026-09-03T08:00:00Z");
    expect(d.previous).toEqual([{ high: "first", low: "", next: "trial", support: "", who: "Jane Smith", at: "2026-09-01T09:00:00Z" }]);
  });
  it("a second edit credits the first editor for the wording it replaces", () => {
    const d1 = editedDetail(u, { high: "second", low: "", next: "", support: "" }, "Sam Lee", "2026-09-03T08:00:00Z");
    const [u2] = updatesFrom([ev("a", "2026-09-01T09:00:00Z", d1)]);
    const d2 = editedDetail(u2, { high: "third", low: "", next: "", support: "" }, "Tom Hall", "2026-09-04T08:00:00Z");
    const prev = d2.previous as { high: string; who: string }[];
    expect(prev.map((p) => [p.high, p.who])).toEqual([["second", "Sam Lee"], ["first", "Jane Smith"]]);
  });
  it("caps the earlier wordings", () => {
    let cur = u;
    for (let n = 0; n < MAX_PREVIOUS + 4; n++) {
      const d = editedDetail(cur, { high: `v${n}`, low: "", next: "", support: "" }, "Sam Lee", `2026-09-${String(n + 2).padStart(2, "0")}T08:00:00Z`);
      [cur] = updatesFrom([ev("a", "2026-09-01T09:00:00Z", d)]);
    }
    expect(cur.previous).toHaveLength(MAX_PREVIOUS);
    expect(cur.high).toBe(`v${MAX_PREVIOUS + 3}`);
  });
});

describe("blank and unchanged", () => {
  it("knows an empty update and an untouched one", () => {
    expect(isBlank({ high: " ", low: "", next: "", support: "" })).toBe(true);
    expect(isBlank({ high: "", low: "", next: "x", support: "" })).toBe(false);
    expect(sameFields({ high: "a ", low: "", next: "", support: "" }, { high: "a", low: "", next: "", support: "" })).toBe(true);
    expect(sameFields({ high: "a", low: "", next: "", support: "" }, { high: "b", low: "", next: "", support: "" })).toBe(false);
  });
});

describe("age and staleness", () => {
  it("counts whole days, ignoring the time of day", () => {
    expect(daysBetween("2026-09-26T23:50:00Z", "2026-09-29")).toBe(3);
    expect(daysBetween("2026-09-29T01:00:00Z", "2026-09-29")).toBe(0);
    expect(daysBetween("junk", "2026-09-29")).toBe(0);
  });
  it("says the age in words", () => {
    expect(ageLabel("2026-09-29T08:00:00Z", "2026-09-29")).toBe("today");
    expect(ageLabel("2026-09-28", "2026-09-29")).toBe("yesterday");
    expect(ageLabel("2026-09-26", "2026-09-29")).toBe("3 days ago");
    expect(ageLabel("2026-09-01", "2026-09-29")).toBe("4 weeks ago");
    expect(ageLabel("2026-05-01", "2026-09-29")).toBe("5 months ago");
  });
  it("goes stale at 14 days — from the last update, or the start when there is none", () => {
    expect(staleDays("2026-09-16", "", "2026-09-29")).toBeNull();
    expect(staleDays("2026-09-15", "", "2026-09-29")).toBe(14);
    expect(staleDays("", "2026-09-01", "2026-09-29")).toBe(28);
    expect(staleDays("", "2026-09-25", "2026-09-29")).toBeNull();
    expect(staleDays("", "", "2026-09-29")).toBeNull();
  });
});
