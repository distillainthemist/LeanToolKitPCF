import { describe, expect, it } from "vitest";
import {
  canSee,
  groupInitiatives,
  Initiative,
  myRoles,
  nextGateFor,
  parsePendingGate,
  parseSnapshot,
  snapshotOf,
  stageTargetsFrom,
  validateNewInitiative,
} from "../improvement/initiativeModel";
import { newTemplate } from "../improvement/templateModel";

function init(over: Partial<Initiative> = {}): Initiative {
  const t = newTemplate("tpl");
  return {
    id: "in-1",
    title: "Cut changeover",
    templateId: "tpl",
    method: "A3",
    description: "",
    singleAction: false,
    org: { company: "Pechey", site: "Mine", department: "", area: "" },
    stageId: t.stages[0].id,
    status: "active",
    confidential: false,
    flag: "",
    flagNote: "",
    endorsement: false,
    period: "FY26",
    boardId: "b1",
    snapshot: snapshotOf(t),
    roles: { owner: [{ whoId: "p1", who: "A" }] },
    priorities: [],
    fieldValues: {},
    metrics: [],
    gate: null,
    stageTargets: {},
    ...over,
  };
}

describe("initiatives — model", () => {
  it("snapshot deep-copies the template and round-trips", () => {
    const t = newTemplate("x");
    t.stages[0].gate = { enabled: true, approverRoles: ["sponsor"] };
    const snap = snapshotOf(t);
    t.stages[0].gate.approverRoles.push("finance");
    expect(snap.stages[0].gate.approverRoles).toEqual(["sponsor"]);
    const back = parseSnapshot(JSON.stringify(snap));
    expect(back.stages.map((s) => s.name)).toEqual(["Understand", "Trial", "Confirm", "Embed"]);
    expect(back.completeGate).toEqual({ enabled: true, approverRoles: ["sponsor"] });
    expect(back.roleLabels.lead).toBe("Improvement lead");
  });
  it("stage targets accumulate weeks from creation; no hint = no date", () => {
    const t = newTemplate("x");
    t.stages[0].targetWeeks = 2;
    t.stages[1].targetWeeks = 4;
    const targets = stageTargetsFrom(t.stages, "2026-08-20");
    expect(targets[t.stages[0].id]).toBe("2026-09-03");
    expect(targets[t.stages[1].id]).toBe("2026-10-01");
    expect(targets[t.stages[2].id]).toBeUndefined();
  });
  it("nextGateFor names the boundary, its gate and target", () => {
    const i = init();
    i.snapshot.stages[0].gate = { enabled: true, approverRoles: ["sponsor"] };
    i.stageTargets = { [i.snapshot.stages[0].id]: "2026-09-03" };
    expect(nextGateFor(i)).toEqual({ fromName: "Understand", toName: "Trial", gated: true, approverRoles: ["sponsor"], target: "2026-09-03" });
    i.stageId = i.snapshot.stages[3].id;
    const last = nextGateFor(i);
    expect(last?.toName).toBe("Complete");
    expect(last?.gated).toBe(true); // the complete gate defaults on
    expect(nextGateFor({ ...i, status: "completed" })).toBeNull();
  });
  it("groups: mine by role, team by owned org keys, confidential hidden", () => {
    const a = init();
    const b = init({ id: "in-2", roles: { owner: [{ whoId: "p2", who: "B" }] }, org: { company: "Pechey", site: "Mine", department: "Ops", area: "" } });
    // c sits on a site the viewer does NOT own — org owners see their own
    // org's confidential initiatives by design
    const c = init({ id: "in-3", confidential: true, roles: { owner: [{ whoId: "p2", who: "B" }] }, org: { company: "Pechey", site: "Refinery", department: "", area: "" } });
    const viewer = { whoId: "p1", ownedOrgKeys: ["Pechey|Mine||"], isAdmin: false };
    const g = groupInitiatives([a, b, c], viewer);
    expect(g.mine.map((x) => x.id)).toEqual(["in-1"]);
    expect(g.team.map((x) => x.id)).toEqual(["in-1", "in-2"]);
    expect(g.hiddenConfidential).toBe(1);
    expect(canSee(c, { whoId: "p2", ownedOrgKeys: [], isAdmin: false })).toBe(true);
    expect(myRoles(a, "p1")).toEqual(["owner"]);
  });
  it("pending gate parses; validation catches the essentials", () => {
    expect(parsePendingGate("")).toBeNull();
    const g = parsePendingGate('{"from":"st-plan","to":"st-do","approverRoles":["sponsor"],"decisions":{"sponsor":{"by":"p1","byName":"A","at":"2026-08-20","approved":true,"comment":"ok"}}}');
    expect(g?.decisions.sponsor.approved).toBe(true);
    const bad = init({ title: " ", roles: {}, metrics: [{ key: "m", name: "OEE", unit: "%", target: null, goodDirection: "up", tracking: "value" }] });
    expect(validateNewInitiative(bad)).toEqual(["A title is needed.", "An owner is needed.", 'Metric "OEE" needs a target.']);
  });
});
