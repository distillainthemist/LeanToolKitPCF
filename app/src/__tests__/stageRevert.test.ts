// Going back a stage (2026-09-29): where an initiative may return to, who
// may send it there, whose sign-off that undoes, and what it changes.
import { describe, expect, it } from "vitest";
import { applyRevert, currentIndex, gateDeclined, mayRevert, mayWithdraw, revertTargets, standingRevert, undoneApproverRoles } from "../improvement/stageRevert";

const gate = (enabled: boolean, approverRoles: string[] = []) => ({ enabled, approverRoles });
const make = (stageId: string, status = "active", over: Record<string, unknown> = {}) =>
  ({
    snapshot: {
      stages: [
        { id: "plan", name: "Plan", pdca: "plan", gate: gate(true, ["owner"]) },
        { id: "do", name: "Do", pdca: "do", gate: gate(false) },
        { id: "check", name: "Check", pdca: "check", gate: gate(true, ["sponsor", "owner"]) },
        { id: "act", name: "Act", pdca: "act", gate: gate(false) },
      ],
      completeGate: gate(true, ["sponsor"]),
      roleLabels: {},
    },
    stageId,
    status,
    singleAction: false,
    gate: null,
    stageTargets: { plan: "2026-08-01", do: "2026-09-01", check: "2026-10-01", act: "2026-11-01" },
    ...over,
  }) as never as Parameters<typeof revertTargets>[0];
const viewer = (whoId: string, over: Record<string, unknown> = {}) => ({ whoId, isAdmin: false, ownerIds: ["own"], sponsorIds: ["spo"], ...over });
const pending = (decisions: Record<string, unknown> = {}) => ({ from: "check", to: "act", requestedById: "req", requestedByName: "Req", requestedAt: "2026-09-20", decisions, approverRoles: ["sponsor", "owner"] });

describe("where it may go back to", () => {
  it("every stage before where it stands", () => {
    expect(revertTargets(make("check")).map((t) => t.id)).toEqual(["plan", "do"]);
    expect(revertTargets(make("plan"))).toEqual([]);
  });
  it("a completed initiative reopens into any stage, its last included", () => {
    expect(currentIndex(make("act", "completed"))).toBe(4);
    expect(revertTargets(make("act", "completed")).map((t) => t.id)).toEqual(["plan", "do", "check", "act"]);
  });
  it("nowhere for an archived or single-action initiative", () => {
    expect(revertTargets(make("check", "archived"))).toEqual([]);
    expect(revertTargets(make("check", "active", { singleAction: true }))).toEqual([]);
  });
});

describe("who may", () => {
  it("revert: owner, sponsor or an admin — not the rest of the team", () => {
    const i = make("check");
    expect(mayRevert(i, viewer("own"))).toBe(true);
    expect(mayRevert(i, viewer("spo"))).toBe(true);
    expect(mayRevert(i, viewer("adm", { isAdmin: true }))).toBe(true);
    expect(mayRevert(i, viewer("member"))).toBe(false);
    expect(mayRevert(i, viewer(""))).toBe(false);
    expect(mayRevert(make("plan"), viewer("own"))).toBe(false);
  });
  it("withdraw: whoever requested it, the owner or an admin — and only a waiting gate", () => {
    const i = make("check", "active", { gate: pending() });
    expect(mayWithdraw(i, viewer("req"))).toBe(true);
    expect(mayWithdraw(i, viewer("own"))).toBe(true);
    expect(mayWithdraw(i, viewer("adm", { isAdmin: true }))).toBe(true);
    expect(mayWithdraw(i, viewer("spo"))).toBe(false);
    expect(mayWithdraw(make("check"), viewer("own"))).toBe(false);
  });
  it("knows a declined gate", () => {
    expect(gateDeclined(make("check"))).toBe(false);
    expect(gateDeclined(make("check", "active", { gate: pending({ owner: { approved: true } }) }))).toBe(false);
    expect(gateDeclined(make("check", "active", { gate: pending({ sponsor: { approved: false } }) }))).toBe(true);
  });
});

describe("whose sign-off a revert undoes", () => {
  it("the enabled gates between the stage returned to and where it stands", () => {
    expect(undoneApproverRoles(make("check"), "plan")).toEqual(["owner"]);
    expect(undoneApproverRoles(make("check"), "do")).toEqual([]);
    expect(undoneApproverRoles(make("act"), "plan").sort()).toEqual(["owner", "sponsor"]);
  });
  it("the completion gate too, when it is complete", () => {
    expect(undoneApproverRoles(make("act", "completed"), "act")).toEqual(["sponsor"]);
    expect(undoneApproverRoles(make("act", "completed"), "nope")).toEqual([]);
  });
});

describe("applyRevert", () => {
  it("moves back, clears the waiting gate, keeps the target dates", () => {
    const i = make("check", "active", { gate: pending() });
    expect(applyRevert(i, "plan", "")).toEqual({ from: "Check", to: "Plan" });
    expect(i.stageId).toBe("plan");
    expect(i.gate).toBeNull();
    expect(i.stageTargets.plan).toBe("2026-08-01");
  });
  it("takes a new target date for the stage returned to, and only that one", () => {
    const i = make("check");
    applyRevert(i, "do", "2026-10-20");
    expect(i.stageTargets.do).toBe("2026-10-20");
    expect(i.stageTargets.check).toBe("2026-10-01");
    applyRevert(make("check"), "do", "next week");
    const j = make("check");
    applyRevert(j, "do", "next week");
    expect(j.stageTargets.do).toBe("2026-09-01");
  });
  it("reopens a completed initiative", () => {
    const i = make("act", "completed");
    expect(applyRevert(i, "act", "")).toEqual({ from: "Complete", to: "Act" });
    expect(i.status).toBe("active");
    expect(i.stageId).toBe("act");
  });
  it("refuses a stage it cannot go back to", () => {
    const i = make("do");
    expect(applyRevert(i, "check", "")).toBeNull();
    expect(applyRevert(i, "do", "")).toBeNull();
    expect(i.stageId).toBe("do");
  });
});

describe("standingRevert", () => {
  const ev = (at: string, detail: Record<string, unknown>, kind = "stagemove") => ({ kind, detail, actorName: "Jane Smith", at });
  it("is the latest stage move when that move was a revert", () => {
    const r = standingRevert([ev("2026-09-01", { from: "Plan", to: "Do" }), ev("2026-09-20", { from: "Do", to: "Plan", revert: true, comment: "Scope changed" }), ev("2026-09-25", { high: "x" }, "comment")]);
    expect(r).toEqual({ from: "Do", to: "Plan", who: "Jane Smith", at: "2026-09-20", reason: "Scope changed" });
  });
  it("is cleared by a later move forward", () => {
    expect(standingRevert([ev("2026-09-20", { from: "Do", to: "Plan", revert: true }), ev("2026-09-28", { from: "Plan", to: "Do" })])).toBeNull();
    expect(standingRevert([])).toBeNull();
  });
});
