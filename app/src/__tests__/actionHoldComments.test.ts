// On hold and comments (2026-09-30): a held action stays open and is not
// overdue; comments are stamped with who and the day, and survive the
// sanitiser.
import { describe, expect, it } from "vitest";
import { ACTION_PDCA, isOnHold, isOverdue, newAction, newComment, PDCA_LABELS, pdcaOf, sanitizeAction } from "../../../shared/schema/actions";
import { ragInputsFor } from "../improvement/initiativeModel";

const act = (over: Record<string, unknown> = {}) => ({ ...newAction({ source: "card", sourceId: "" }), due: "2026-09-01", ...over });

describe("On hold", () => {
  it("is a PDCA state, listed after Closed", () => {
    expect(ACTION_PDCA).toEqual(["plan", "do", "check", "act", "closed", "hold"]);
    expect(PDCA_LABELS.hold).toBe("On hold");
  });
  it("shows as held while open; done or cancelled reads as closed", () => {
    expect(pdcaOf(act({ pdca: "hold" }))).toBe("hold");
    expect(pdcaOf(act({ pdca: "hold", status: "done" }))).toBe("closed");
    expect(isOnHold(act({ pdca: "hold" }))).toBe(true);
    expect(isOnHold(act({ pdca: "hold", status: "cancelled" }))).toBe(false);
    expect(isOnHold(act({ pdca: "do" }))).toBe(false);
  });
  it("is not overdue while held — and is again once resumed", () => {
    expect(isOverdue(act({ pdca: "do" }), "2026-09-30")).toBe(true);
    expect(isOverdue(act({ pdca: "hold" }), "2026-09-30")).toBe(false);
    expect(isOverdue(act({ pdca: "check" }), "2026-09-30")).toBe(true);
  });
  it("survives the sanitiser", () => {
    expect(sanitizeAction({ ...act({ pdca: "hold" }) }).pdca).toBe("hold");
    expect(sanitizeAction({ ...act({ pdca: "paused" }) }).pdca).toBeUndefined();
  });
  it("counts as open but not overdue in an initiative's roll-up", () => {
    const i = { id: "I1", boardId: "init-I1", flag: "" } as never as Parameters<typeof ragInputsFor>[0];
    const r = ragInputsFor(i, [{ initiativeId: "I1", status: "open", pdca: "hold", due: "2026-09-01", assignees: [] }, { initiativeId: "I1", status: "open", pdca: "do", due: "2026-09-01", assignees: [] }], "2026-09-30");
    expect(r.openActions).toBe(2);
    expect(r.overdueActions).toBe(1);
  });
});

describe("comments", () => {
  it("are stamped with who and the day, trimmed", () => {
    expect(newComment({ whoId: "u1", who: "Jane Smith" }, "  Parts arrive Friday \n", "2026-09-30")).toEqual({ whoId: "u1", who: "Jane Smith", when: "2026-09-30", text: "Parts arrive Friday" });
    expect(newComment({ whoId: "u1", who: "" }, "x", "2026-09-30").who).toBeUndefined();
  });
  it("survive the sanitiser in order; empty ones are dropped", () => {
    const a = sanitizeAction({ ...act(), comments: [newComment({ whoId: "u1", who: "Jane" }, "first", "2026-09-29"), { whoId: "u2", when: "2026-09-30", text: "" }, newComment({ whoId: "u2", who: "Sam" }, "second", "2026-09-30")] });
    expect(a.comments.map((c) => c.text)).toEqual(["first", "second"]);
  });
});
