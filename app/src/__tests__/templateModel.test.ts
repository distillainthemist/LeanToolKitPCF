import { describe, expect, it } from "vitest";
import {
  keyFor,
  newTemplate,
  parseFields,
  parseMetrics,
  parseRoles,
  parseStages,
  propagationNote,
  serializeStages,
  slotFlags,
  stepperChips,
  validateTemplate,
  withSlotFlags,
} from "../improvement/templateModel";

describe("initiative templates — model", () => {
  it("a new template is a usable PDCA skeleton bar the board", () => {
    const t = newTemplate("tpl-1");
    t.name = "A3";
    expect(t.stages.map((s) => s.pdca)).toEqual(["plan", "do", "check", "act"]);
    expect(t.roles.map((r) => r.key)).toEqual(["sponsor", "owner", "lead", "team", "support"]);
    expect(validateTemplate(t)).toEqual(["The initiative board has not been laid out yet (step 6)."]);
    t.singleAction = true;
    t.stages = [];
    expect(validateTemplate(t)).toEqual([]);
  });
  it("stages round-trip with gates; bad pdca falls to plan; complete gate default", () => {
    const t = newTemplate("x");
    t.stages[0].gate = { enabled: true, approverRoles: ["sponsor", "finance"] };
    const back = parseStages(serializeStages(t.stages, { enabled: false, approverRoles: [] }));
    expect(back.stages[0].gate).toEqual({ enabled: true, approverRoles: ["sponsor", "finance"] });
    expect(back.completeGate).toEqual({ enabled: false, approverRoles: [] });
    expect(parseStages('{"stages":[{"name":"Odd","pdca":"weird"}]}').stages[0].pdca).toBe("plan");
    expect(parseStages("garbage").completeGate).toEqual({ enabled: true, approverRoles: ["sponsor"] });
  });
  it("roles always include the five standard ones; fields/metrics parse defensively", () => {
    const roles = parseRoles('[{"key":"finance","label":"Finance lead","standard":false,"multi":false,"timeCommitment":false}]');
    expect(roles.map((r) => r.key)).toEqual(["finance", "sponsor", "owner", "lead", "team", "support"]);
    expect(parseFields('[{"key":"site_cost","label":"Cost centre","kind":"picklist","options":["A","B"],"required":true},{"label":"nokey"}]')).toEqual([
      { key: "site_cost", label: "Cost centre", kind: "picklist", options: ["A", "B"], required: true },
    ]);
    expect(parseMetrics('[{"key":"oee","name":"OEE","unit":"%","target":75,"goodDirection":"up","tracking":"value"}]')[0].target).toBe(75);
    expect(parseMetrics("nope")).toEqual([]);
  });
  it("validation catches gates without approvers, unknown roles, duplicate names", () => {
    const t = newTemplate("v");
    t.name = "DMAIC";
    t.boardId = "b1";
    t.stages[1].gate = { enabled: true, approverRoles: [] };
    t.completeGate = { enabled: true, approverRoles: ["ghost"] };
    t.stages[2].name = "Understand";
    expect(validateTemplate(t)).toEqual([
      "Every gate that is on needs at least one approver role.",
      'Gate approver "ghost" is not a role on this template.',
      "Stage names must be unique.",
    ]);
  });
  it("stepper chips: ⚑ on the chip entered through a gate; Complete always last", () => {
    const t = newTemplate("s");
    t.stages[0].gate = { enabled: true, approverRoles: ["sponsor"] };
    t.completeGate = { enabled: true, approverRoles: ["sponsor"] };
    const chips = stepperChips(t);
    expect(chips.map((c) => `${c.label}${c.gated ? "⚑" : ""}`)).toEqual(["Understand", "Trial⚑", "Confirm", "Embed", "Complete⚑"]);
    expect(chips[4].pdca).toBeNull();
  });
  it("keys, propagation words, slot flags", () => {
    expect(keyFor("Finance lead", ["sponsor"])).toBe("finance_lead");
    expect(keyFor("Finance lead", ["finance_lead"])).toBe("finance_lead_2");
    expect(propagationNote(3).headline).toBe("3 initiatives are running on this template.");
    expect(propagationNote(0).headline).toMatch(/No initiatives/);
    const s = withSlotFlags({ title: "x" }, { stage: "st-plan", mandatory: true });
    expect(slotFlags(s)).toEqual({ stage: "st-plan", mandatory: true });
    expect(withSlotFlags(s, { stage: "", mandatory: false })).toEqual({ title: "x" });
  });
});

describe("improvement settings (methods + standard roles)", () => {
  it("defaults, round-trips, and forces standard/multi flags", async () => {
    const m = await import("../improvement/templateModel");
    const d = m.parseImprovementSettings("");
    expect(d.methods).toEqual(m.METHODS);
    expect(d.standardRoles).toEqual([]);
    const s = m.parseImprovementSettings('{"methods":["A3","Just do it"],"standardRoles":[{"key":"finance","label":"Finance lead","multi":false,"timeCommitment":true},{"label":"nokey"}]}');
    expect(s.methods).toEqual(["A3", "Just do it"]);
    expect(s.standardRoles).toEqual([{ key: "finance", label: "Finance lead", standard: true, multi: false, timeCommitment: true, people: {} }]);
    const back = m.parseImprovementSettings(m.serializeImprovementSettings(s));
    expect(back).toEqual(s);
    expect(m.parseImprovementSettings("{oops").methods).toEqual(m.METHODS);
  });
});

describe("standard roles: people per site", () => {
  it("round-trips per-site people and resolves fillers", async () => {
    const m = await import("../improvement/templateModel");
    const raw = '{"standardRoles":[{"key":"finance","label":"Finance lead","people":{"Mine":[{"whoId":"p1","who":"A"},{"whoId":"p2","who":"B"}],"Refinery":[{"whoId":"","who":"bad"}]}}]}';
    const s = m.parseImprovementSettings(raw);
    expect(s.standardRoles[0].people).toEqual({ Mine: [{ whoId: "p1", who: "A" }, { whoId: "p2", who: "B" }] });
    expect(m.roleFillersAt(s.standardRoles[0], "Mine").map((p) => p.whoId)).toEqual(["p1", "p2"]);
    expect(m.roleFillersAt(s.standardRoles[0], "Elsewhere")).toEqual([]);
    const back = m.parseImprovementSettings(m.serializeImprovementSettings(s));
    expect(back.standardRoles[0].people).toEqual(s.standardRoles[0].people);
  });
});
