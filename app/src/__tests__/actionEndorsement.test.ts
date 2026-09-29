// Action endorsement (2026-09-30): on an initiative that asks for it, a
// close by anyone but an endorser waits; an endorser endorses or sends
// back; what was closed before is left alone.
import { describe, expect, it } from "vitest";
import { newAction, pdcaOf, isOverdue, LtkAction } from "../../../shared/schema/actions";
import { applyEndorsementRule, awaitingEndorsement, endorse, sendBack } from "../../../shared/schema/actionEndorsement";
import { endorsementOn, endorserIds } from "../improvement/endorsers";

const NOW = "2026-09-30T09:00:00.000Z";
const jane = { whoId: "u1", who: "Jane Smith" };
const owner = { whoId: "own", who: "Olive Owner" };
const act = (over: Partial<LtkAction> = {}): LtkAction => ({ ...newAction({ source: "card", sourceId: "" }), assignees: [{ whoId: "u1", who: "Jane Smith", done: false }], due: "2026-09-01", ...over });
const ON = { on: true, mine: false };
const ON_MINE = { on: true, mine: true };

describe("closing on an initiative that asks for endorsement", () => {
  it("by anyone else: it waits, reads Closed, and is not overdue", () => {
    const a = act({ status: "done", pdca: "closed" });
    expect(applyEndorsementRule(a, "open", ON, jane, NOW)).toBe(true);
    expect(a.status).toBe("verify");
    expect(awaitingEndorsement(a)).toBe(true);
    expect(pdcaOf(a)).toBe("closed");
    expect(a.verified).toBeUndefined();
    expect(a.assignees[0].done).toBe(true);
    expect(isOverdue(a, "2026-09-30")).toBe(false);
  });
  it("by an endorser: it closes directly, stamped", () => {
    const a = act({ status: "done", pdca: "closed" });
    expect(applyEndorsementRule(a, "open", ON_MINE, owner, NOW)).toBe(true);
    expect(a.status).toBe("done");
    expect(a.verified).toEqual({ whoId: "own", who: "Olive Owner", when: NOW });
    expect(a.history?.at(-1)?.kind).toBe("verified");
  });
  it("a new action raised already closed waits too", () => {
    const a = act({ status: "done" });
    applyEndorsementRule(a, null, ON, jane, NOW);
    expect(a.status).toBe("verify");
  });
  it("applied twice changes nothing the second time (the dialog, then the store)", () => {
    const a = act({ status: "done" });
    applyEndorsementRule(a, "open", ON, jane, NOW);
    expect(applyEndorsementRule(a, "open", ON, jane, NOW)).toBe(false);
    const b = act({ status: "done" });
    applyEndorsementRule(b, "open", ON_MINE, owner, NOW);
    const stamped = JSON.stringify(b);
    expect(applyEndorsementRule(b, "verify", ON_MINE, owner, NOW)).toBe(false);
    expect(JSON.stringify(b)).toBe(stamped);
  });
});

describe("a waiting action", () => {
  it("cannot be closed by someone who may not endorse", () => {
    const a = act({ status: "done" });
    expect(applyEndorsementRule(a, "verify", ON, jane, NOW)).toBe(true);
    expect(a.status).toBe("verify");
  });
  it("closes when an endorser moves it to done", () => {
    const a = act({ status: "done" });
    applyEndorsementRule(a, "verify", ON_MINE, owner, NOW);
    expect(a.status).toBe("done");
    expect(a.verified?.whoId).toBe("own");
  });
  it("endorse closes it; send back reopens it with the reason on its history", () => {
    const a = act({ status: "verify", pdca: "closed" });
    endorse(a, owner, NOW);
    expect([a.status, a.pdca, a.verified?.who]).toEqual(["done", "closed", "Olive Owner"]);
    const b = act({ status: "verify", pdca: "closed", assignees: [{ whoId: "u1", who: "Jane Smith", done: true }] });
    sendBack(b, owner, NOW, "  Torque values not recorded ");
    expect([b.status, b.pdca, b.assignees[0].done]).toEqual(["open", "do", false]);
    expect(b.verified).toBeUndefined();
    expect(b.history?.at(-1)).toEqual({ kind: "reopened", whoId: "own", who: "Olive Owner", when: NOW, reason: "Torque values not recorded" });
  });
});

describe("what the rule leaves alone", () => {
  it("an action closed before (the switch may have come on since)", () => {
    const a = act({ status: "done" });
    expect(applyEndorsementRule(a, "done", ON, jane, NOW)).toBe(false);
    expect(a.status).toBe("done");
  });
  it("everything when endorsement is off, or the action is on no initiative", () => {
    const a = act({ status: "done" });
    expect(applyEndorsementRule(a, "open", { on: false, mine: false }, jane, NOW)).toBe(false);
    expect(applyEndorsementRule(a, "open", null, jane, NOW)).toBe(false);
    const v = act({ status: "verify" });
    expect(applyEndorsementRule(v, "open", { on: false, mine: false }, jane, NOW)).toBe(false);
    expect(v.status).toBe("verify");
  });
  it("an open action — but a stale endorsement on one is cleared", () => {
    expect(applyEndorsementRule(act({ status: "open" }), "open", ON, jane, NOW)).toBe(false);
    const a = act({ status: "open", verified: { whoId: "own", who: "Olive Owner", when: NOW } });
    expect(applyEndorsementRule(a, "done", ON, jane, NOW)).toBe(true);
    expect(a.verified).toBeUndefined();
  });
});

describe("who endorses, and where", () => {
  const std = [{ key: "sponsor", label: "Sponsor", multi: false, people: { Bendigo: [{ whoId: "sp2", who: "Site Sponsor" }], Melbourne: [{ whoId: "sp3", who: "Other Site" }] } }] as never;
  it("owner and sponsor — assigned on the initiative, or the site's standard-role fillers", () => {
    const ids = endorserIds({ roles: { owner: [{ whoId: "own", who: "O" }], sponsor: [{ whoId: "spo", who: "S" }], lead: [{ whoId: "lead", who: "L" }] }, org: { company: "", site: "Bendigo", department: "", area: "" } }, std);
    expect(ids).toContain("own");
    expect(ids).toContain("spo");
    expect(ids).toContain("sp2");
    expect(ids).not.toContain("sp3");
    expect(ids).not.toContain("lead");
  });
  it("not on a single-action initiative, nor with the switch off", () => {
    expect(endorsementOn({ endorsement: true, singleAction: false })).toBe(true);
    expect(endorsementOn({ endorsement: true, singleAction: true })).toBe(false);
    expect(endorsementOn({ endorsement: false, singleAction: false })).toBe(false);
  });
});
