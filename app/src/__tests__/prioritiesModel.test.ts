// Cascaded priorities — pure model (plan P0): org refs, matrix
// membership (own + adopted), lineage, tallies + roll-up rules,
// initiative RAG, periods, permissions.

import { describe, expect, it } from "vitest";
import {
  canManageOrg,
  descendantPriorities,
  initiativeRag,
  isDescendant,
  lineageFor,
  nextPeriod,
  objectiveColumns,
  orgFromKey,
  orgKey,
  orgLevel,
  orgName,
  orgParent,
  orgPath,
  orgRef,
  parsePrioritySettings,
  pendingCascades,
  periodFor,
  Priority,
  PriorityAssignment,
  prioritiesForOrg,
  rollup,
  rollupWords,
  strategyChips,
  tally,
} from "../priorities/model";

const co = orgRef("Pechey");
const site = orgRef("Pechey", "Bendigo");
const dept = orgRef("Pechey", "Bendigo", "Packaging");
const area = orgRef("Pechey", "Bendigo", "Packaging", "Line 2");

function pr(id: string, org = site, over: Partial<Priority> = {}): Priority {
  return {
    id,
    statement: id,
    org,
    pillarId: "p2",
    ownerId: "",
    ownerName: "",
    period: "FY26",
    status: "active",
    statusReason: "",
    parentId: "",
    primaryInitiativeId: "",
    order: 0,
    notes: "",
    ...over,
  };
}

function asg(
  id: string,
  priorityId: string,
  org: ReturnType<typeof orgRef>,
  status: PriorityAssignment["status"],
  child = ""
): PriorityAssignment {
  return {
    id,
    priorityId,
    org,
    status,
    reason: "",
    decidedById: "",
    decidedByName: "",
    decidedAt: "",
    childPriorityId: child,
  };
}

describe("org refs", () => {
  it("level, name, parent, key round-trip", () => {
    expect(orgLevel(co)).toBe("company");
    expect(orgLevel(area)).toBe("area");
    expect(orgName(dept)).toBe("Packaging");
    expect(orgParent(area)).toEqual(dept);
    expect(orgParent(co)).toBeNull();
    expect(orgFromKey(orgKey(area))).toEqual(area);
    expect(orgPath(area).map(orgName)).toEqual(["Pechey", "Bendigo", "Packaging", "Line 2"]);
  });

  it("descendant is strict and respects branches", () => {
    expect(isDescendant(area, site)).toBe(true);
    expect(isDescendant(site, site)).toBe(false);
    expect(isDescendant(orgRef("Pechey", "Melbourne"), site)).toBe(false);
    expect(isDescendant(dept, co)).toBe(true);
  });
});

describe("pillars", () => {
  const pillars = [
    { id: "s1", name: "Reliable supply", level: 1 as const, parentId: "", color: "", order: 2, active: true, company: "" },
    { id: "s0", name: "Safety & people", level: 1 as const, parentId: "", color: "", order: 1, active: true, company: "" },
    { id: "o1", name: "Operational excellence", level: 2 as const, parentId: "s1", color: "", order: 2, active: true, company: "" },
    { id: "o0", name: "People and safety first", level: 2 as const, parentId: "s0", color: "", order: 1, active: true, company: "" },
    { id: "ox", name: "Retired", level: 2 as const, parentId: "s0", color: "", order: 0, active: false, company: "" },
  ];
  it("chips and columns in order; inactive hidden; L1 filter narrows", () => {
    expect(strategyChips(pillars).map((p) => p.id)).toEqual(["s0", "s1"]);
    expect(objectiveColumns(pillars, null).map((p) => p.id)).toEqual(["o0", "o1"]);
    expect(objectiveColumns(pillars, "s1").map((p) => p.id)).toEqual(["o1"]);
  });
});

describe("matrix membership (decision 2)", () => {
  const parent = pr("P1", site);
  const childRow = pr("C1", dept, { parentId: "P1", statement: "Improve production – rate" });
  const own = pr("D1", dept, { order: 1 });
  const all = [parent, childRow, own];
  const assignments = [
    asg("a1", "P1", dept, "accepted"), // adopted as-is → parent shows in dept
    asg("a2", "P1", orgRef("Pechey", "Bendigo", "Warehouse"), "proposed"),
    asg("a3", "P1", orgRef("Pechey", "Bendigo", "Maintenance"), "rejected"),
  ];

  it("own rows + adopted parents; customised rows come through own", () => {
    const { own: o, adopted } = prioritiesForOrg(dept, all, assignments);
    expect(o.map((p) => p.id)).toEqual(["C1", "D1"]);
    expect(adopted.map((p) => p.id)).toEqual(["P1"]);
    // an accepted assignment WITH a child is not adopted (the child is)
    const withChild = [asg("a1", "P1", dept, "accepted", "C1")];
    expect(prioritiesForOrg(dept, all, withChild).adopted).toEqual([]);
  });

  it("pending cascades count per org; lineage summarises assignments", () => {
    expect(pendingCascades(orgRef("Pechey", "Bendigo", "Warehouse"), assignments).length).toBe(1);
    expect(pendingCascades(dept, assignments).length).toBe(0);
    const l = lineageFor(parent, all, assignments);
    expect(l).toEqual({ from: null, sent: 3, accepted: 1, pending: 1, declined: 1, held: 0 });
    expect(lineageFor(childRow, all, assignments).from).toEqual(site);
  });

  it("descendants walk the whole cascade", () => {
    const grand = pr("G1", area, { parentId: "C1" });
    expect(descendantPriorities(parent, [...all, grand]).map((p) => p.id)).toEqual(["C1", "G1"]);
  });
});

describe("tallies and roll-up (decision 9)", () => {
  it("counts every state; grey stays out of the three but in the total", () => {
    expect(tally(["green", "amber", "red", "red", "grey"])).toEqual({
      green: 1,
      amber: 1,
      red: 2,
      grey: 1,
      total: 5,
    });
  });

  it("strict: any red is red; ratio: red above X% of coloured", () => {
    const t = tally(["green", "green", "green", "red"]);
    expect(rollup(t, "strict", 30)).toBe("red");
    expect(rollup(t, "ratio", 30)).toBe("green"); // 25% red ≤ 30%
    expect(rollup(t, "ratio", 20)).toBe("red"); // 25% > 20%
    expect(rollup(tally(["green", "amber", "amber"]), "ratio", 50)).toBe("amber"); // 66% amber+red > 50%
    expect(rollup(tally(["grey", "grey"]), "strict", 30)).toBe("grey");
    expect(rollupWords("red", "strict", 30)).toBe("Red — strict rule (any red)");
    expect(rollupWords("grey", "ratio", 25)).toBe("No data — ratio rule (red above 25%)");
  });

  it("initiative RAG = worst of metric and actions", () => {
    const base = { metric: null, escalated: false, needsSupport: false, overdueActions: 0, openActions: 0 };
    expect(initiativeRag({ ...base, metric: "green" })).toBe("green");
    expect(initiativeRag({ ...base, metric: "green", overdueActions: 1 })).toBe("amber");
    expect(initiativeRag({ ...base, metric: "amber", escalated: true })).toBe("red");
    expect(initiativeRag({ ...base, openActions: 2 })).toBe("green");
    expect(initiativeRag({ ...base, needsSupport: true })).toBe("amber");
    expect(initiativeRag(base)).toBe("grey");
  });
});

describe("periods (decision 10)", () => {
  it("settings parse with defaults and clamps", () => {
    const s = parsePrioritySettings("");
    expect(s).toEqual({ ragRatioPct: 30, period: { mode: "fy", startMonth: 7, prefix: "FY", currentPeriod: "" } });
    expect(parsePrioritySettings('{"ragRatioPct":140,"period":{"mode":"calendar","startMonth":99}}')).toEqual({
      ragRatioPct: 100,
      period: { mode: "calendar", startMonth: 12, prefix: "FY", currentPeriod: "" },
    });
  });

  it("FY names the year it ends in; calendar/custom behave", () => {
    const fy = { mode: "fy" as const, startMonth: 7, prefix: "FY", currentPeriod: "" };
    expect(periodFor(fy, "2025-08-15")).toBe("FY26");
    expect(periodFor(fy, "2026-06-30")).toBe("FY26");
    expect(periodFor(fy, "2026-07-01")).toBe("FY27");
    expect(periodFor({ ...fy, mode: "calendar", prefix: "" }, "2026-08-19")).toBe("2026");
    expect(periodFor({ ...fy, mode: "custom", currentPeriod: "H2 2026" }, "2026-08-19")).toBe("H2 2026");
    expect(nextPeriod(fy, "FY26")).toBe("FY27");
    expect(nextPeriod({ ...fy, prefix: "" }, "2026")).toBe("2027");
    expect(nextPeriod({ ...fy, mode: "custom" }, "H2 2026")).toBe("");
  });
});

describe("permissions (decision 7)", () => {
  const owners = {
    [orgKey(site)]: [{ whoId: "gm", who: "GM" }],
    [orgKey(dept)]: [{ whoId: "dm", who: "Dept mgr" }],
  };
  it("owners govern their node and below; areas fall to the department", () => {
    const user = (whoId: string) => ({ whoId, role: "user" as const, site: "" });
    expect(canManageOrg(user("dm"), dept, owners)).toBe(true);
    expect(canManageOrg(user("dm"), area, owners)).toBe(true); // area → its department's owners
    expect(canManageOrg(user("dm"), site, owners)).toBe(false);
    expect(canManageOrg(user("gm"), area, owners)).toBe(true); // site owner governs beneath
    expect(canManageOrg(user("nobody"), dept, owners)).toBe(false);
  });
  it("siteadmins in their site; superadmins everywhere", () => {
    expect(canManageOrg({ whoId: "x", role: "siteadmin", site: "Bendigo" }, dept, {})).toBe(true);
    expect(canManageOrg({ whoId: "x", role: "siteadmin", site: "Melbourne" }, dept, {})).toBe(false);
    expect(canManageOrg({ whoId: "x", role: "siteadmin", site: "Bendigo" }, co, {})).toBe(false);
    expect(canManageOrg({ whoId: "x", role: "superadmin", site: "" }, co, {})).toBe(true);
  });
});

describe("matrix helpers", () => {
  it("groups by column and parks unplaced", async () => {
    const m = await import("../priorities/model");
    const cols = [
      { id: "o1", name: "A", level: 2 as const, parentId: "s", color: "", order: 1, active: true, company: "" },
      { id: "o2", name: "B", level: 2 as const, parentId: "s", color: "", order: 2, active: true, company: "" },
    ];
    const ps = [pr("x", site, { pillarId: "o1" }), pr("y", site, { pillarId: "o2" }), pr("z", site, { pillarId: "gone" })];
    const { byColumn, unplaced } = m.groupByColumn(cols, ps);
    expect(byColumn.get("o1")?.map((p) => p.id)).toEqual(["x"]);
    expect(unplaced.map((p) => p.id)).toEqual(["z"]);
    expect(m.densityFor(4)).toBe("comfortable");
    expect(m.densityFor(6)).toBe("compact");
    expect(m.densityFor(7)).toBe("scroll");
    expect(m.ragPaletteKey("red")).toBe("issue");
    expect(m.tallyLine(tally(["green", "red"])).map((t) => `${t.glyph}${t.count}`)).toEqual(["✓1", "!0", "✕1"]);
    expect(
      m.lineageWords({ from: site, sent: 3, accepted: 1, pending: 1, declined: 1, held: 0 }, "area")
    ).toEqual(["↑ Bendigo", "↓ 3 areas · 1 pending · 1 declined"]);
  });
});

describe("pillar order and spans", () => {
  const P = (id: string, level: 1 | 2, order: number, parentId = "", active = true) => ({
    id, name: id, level, parentId, color: "", order, active, company: "",
  });
  const pillars = [P("s2", 1, 2), P("s1", 1, 1), P("s2b", 2, 1, "s2"), P("s1b", 2, 2, "s1"), P("s1a", 2, 1, "s1"), P("orphan", 2, 1, "gone")];
  it("columns walk pillars in settings order, sub-pillars within; orphans trail", async () => {
    const m = await import("../priorities/model");
    const cols = m.objectiveColumns(pillars, null);
    expect(cols.map((c) => c.id)).toEqual(["s1a", "s1b", "s2b", "orphan"]);
    expect(m.pillarSpans(pillars, cols).map((x) => `${x.pillar?.id ?? "-"}:${x.span}`)).toEqual(["s1:2", "s2:1", "-:1"]);
    expect(m.objectiveColumns(pillars, "s1").map((c) => c.id)).toEqual(["s1a", "s1b"]);
  });
});

describe("lifecycle (P2)", () => {
  it("carry-forward copies into the next period without lineage", async () => {
    const m = await import("../priorities/model");
    const src = pr("A", dept, { parentId: "P", primaryInitiativeId: "i1", status: "active", order: 3 });
    const copy = m.carryForwardCopy(src, "FY27", "B");
    expect(copy).toMatchObject({ id: "B", period: "FY27", parentId: "", primaryInitiativeId: "", status: "active", order: 3, org: dept });
    expect(copy.rowId).toBeUndefined();
  });
  it("parent-closed prompt only for active children of closed parents", async () => {
    const m = await import("../priorities/model");
    const parent = pr("P", site, { status: "completed" });
    const child = pr("C", dept, { parentId: "P" });
    expect(m.parentClosed(child, [parent, child])?.id).toBe("P");
    expect(m.parentClosed({ ...child, status: "completed" }, [parent, child])).toBeNull();
    expect(m.parentClosed(child, [{ ...parent, status: "active" }, child])).toBeNull();
  });
  it("sender flags and review queue", async () => {
    const m = await import("../priorities/model");
    const as = [
      { ...asg("1", "P", dept, "rejected"), reason: "no capacity" },
      { ...asg("2", "P", area, "onhold"), reason: "Q3" },
      asg("3", "P", orgRef("Pechey", "Bendigo", "Warehouse"), "proposed"),
    ];
    expect(m.senderFlags(pr("P", site), as).map((f) => `${f.kind}:${f.reason}`)).toEqual(["declined:no capacity", "parked:Q3"]);
    expect(m.reviewQueue(area, as).map((a) => a.status)).toEqual(["onhold"]);
    expect(m.reviewQueue(dept, as).map((a) => a.status)).toEqual(["rejected"].filter(() => false));
  });
});

describe("priority prefs (P3)", () => {
  it("parses the priorities key inside ben_preferences and ignores the hub's keys", async () => {
    const { parsePriorityPrefs } = await import("../priorities/model");
    const raw = JSON.stringify({ scopeKind: "org", priorities: { viewByOrg: { "Pechey|Bendigo||": "dynamic", x: "nope" }, lastOrg: "Pechey|Bendigo||", rule: "ratio", showOther: true } });
    expect(parsePriorityPrefs(raw)).toEqual({ viewByOrg: { "Pechey|Bendigo||": "dynamic" }, lastOrg: "Pechey|Bendigo||", rule: "ratio", showOther: true, groupByPillar: false });
    expect(parsePriorityPrefs("")).toEqual({ viewByOrg: {}, lastOrg: "", rule: "strict", showOther: false, groupByPillar: false });
    expect(parsePriorityPrefs("{bad")).toEqual(parsePriorityPrefs(""));
  });
});

describe("rotation focus (P4)", () => {
  const P = (id: string, level: 1 | 2, order: number, parentId = "") => ({ id, name: id, level, parentId, color: "", order, active: true, company: "" });
  const pillars = [P("s1", 1, 1), P("s2", 1, 2), P("s1a", 2, 1, "s1"), P("s1b", 2, 2, "s1"), P("s2a", 2, 1, "s2")];
  it("a focus set keeps a pillar's sub-pillars and named sub-pillars", async () => {
    const m = await import("../priorities/model");
    expect(m.objectiveColumns(pillars, ["s2"]).map((c) => c.id)).toEqual(["s2a"]);
    expect(m.objectiveColumns(pillars, ["s1b", "s2"]).map((c) => c.id)).toEqual(["s1b", "s2a"]);
    expect(m.objectiveColumns(pillars, "s1").map((c) => c.id)).toEqual(["s1a", "s1b"]);
  });
  it("topic map parses and matches loosely; blank / unknown → no focus", async () => {
    const m = await import("../priorities/model");
    const map = m.parseTopicMap('{"Safety":["s1"],"Ops":["s2","s1b"],"":["s2"],"bad":"x"}');
    expect(map).toEqual({ Safety: ["s1"], Ops: ["s2", "s1b"], "": ["s2"] });
    expect(m.focusForTopic(map, " safety ")).toEqual(["s1"]);
    expect(m.focusForTopic(map, "")).toEqual(["s2"]);
    expect(m.focusForTopic(map, "Quality")).toBeNull();
    expect(m.focusForTopic(m.parseTopicMap("{oops"), "Safety")).toBeNull();
  });
});
