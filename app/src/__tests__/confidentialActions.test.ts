// Confidential actions (2026-09-16): who may see one, and the stored set.
import { describe, expect, it } from "vitest";
import { actionVisibleTo, newAction, sanitizeAction, visibleSetFor } from "../../../shared/schema/actions";

const base = () => ({ ...newAction({ source: "card", sourceId: "" }), assignees: [{ whoId: "u2", who: "Two", done: false }], createdBy: "u1" });

describe("confidential actions", () => {
  it("non-confidential: everyone", () => {
    expect(actionVisibleTo(base(), "", false)).toBe(true);
    expect(actionVisibleTo(base(), "u9", false)).toBe(true);
  });
  it("confidential: creator, assignees, the stored set, super admins", () => {
    const a = { ...base(), confidential: true, visibleTo: ["u1", "u2", "m2"] };
    expect(actionVisibleTo(a, "u1", false)).toBe(true);
    expect(actionVisibleTo(a, "u2", false)).toBe(true);
    expect(actionVisibleTo(a, "m2", false)).toBe(true);
    expect(actionVisibleTo(a, "u9", false)).toBe(false);
    expect(actionVisibleTo(a, "u9", true)).toBe(true);
    expect(actionVisibleTo(a, "", false)).toBe(false);
    // a stale stored set never hides the creator or an assignee
    expect(actionVisibleTo({ ...a, visibleTo: [] }, "u2", false)).toBe(true);
  });
  it("visibleSetFor: creator + assignees + managers + extras, de-duplicated", () => {
    const a = { ...base(), confidential: true, assignees: [{ whoId: "u2", who: "Two", done: false }, { whoId: "u3", who: "Three", done: false }] };
    expect(visibleSetFor(a, (id) => (id === "u2" ? "m2" : id === "u3" ? "m2" : ""), ["owner9", ""])).toEqual(["u1", "u2", "m2", "u3", "owner9"]);
  });
});

describe("sanitizeAction keeps the confidential fields", () => {
  it("passes confidential, createdBy and visibleTo through the whitelist", () => {
    const a = sanitizeAction({ ...base(), confidential: true, visibleTo: ["u1", "", "m2"] });
    expect(a.confidential).toBe(true);
    expect(a.createdBy).toBe("u1");
    expect(a.visibleTo).toEqual(["u1", "m2"]);
    expect(sanitizeAction(base()).confidential).toBeUndefined();
  });
});
