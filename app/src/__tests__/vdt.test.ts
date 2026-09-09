// Value driver tree — the pure model + formula engine (P9a).
import { describe, expect, it } from "vitest";
import {
  aggregateSeries,
  bucketKey,
  DriverNode,
  foldSeries,
  formatValue,
  newNode,
  pathOf,
  setValue,
  driverPointsFromCells,
  driverDiffPoints,
  parseTracking,
  stateOf,
  driverStatePointsFromCells,
  driverDiffStatePoints,
} from "../improvement/vdt/model";
import {
  checkFormula,
  combineUnits,
  computeTree,
  evaluate,
  formulaInWords,
  parseFormula,
  pathToRoot,
} from "../improvement/vdt/formula";

const mk = (id: string, parentId: string, name: string, over: Partial<DriverNode> = {}): DriverNode => ({
  ...newNode("Mine", parentId, name),
  id,
  ...over,
});

/** EBITDA = margin − cost; margin = volume × price. */
const tree = (): DriverNode[] => [
  mk("ebitda", "", "EBITDA", { unit: "$", formula: "{margin} - {cost}", cadence: "annually" }),
  mk("margin", "ebitda", "Gross margin", { unit: "$", formula: "{vol} * {price}", cadence: "annually" }),
  mk("cost", "ebitda", "Fixed cost", { unit: "$", cadence: "annually", values: { FY26: { plan: 200, actual: 210 } } }),
  mk("vol", "margin", "Saleable volume", { unit: "kL", cadence: "monthly", aggregate: "sum", values: { FY26: { plan: 100, actual: 90 } } }),
  mk("price", "margin", "Unit margin", { unit: "$/kL", cadence: "annually", values: { FY26: { plan: 5, actual: 5.5 } } }),
  mk("obs", "vol", "Safety observations", { kind: "leading", unit: "count", cadence: "weekly" }),
];

describe("formula parser + evaluator", () => {
  const ev = (src: string, refs: Record<string, number | null> = {}, children: string[] = []) =>
    evaluate(parseFormula(src), { ref: (id) => refs[id] ?? null, children });
  it("arithmetic, precedence, power, unary minus, percent", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("2 ^ 3 ^ 2")).toBe(512); // right-assoc
    expect(ev("-4 + 6")).toBe(2);
    expect(ev("200 * 5%")).toBe(10);
    expect(ev("10 ÷ 4 × 2")).toBe(5);
  });
  it("references and functions", () => {
    expect(ev("{a} * {b}", { a: 3, b: 4 })).toBe(12);
    expect(ev("SUM({a}, {b}, 1)", { a: 3, b: 4 })).toBe(8);
    expect(ev("AVG(CHILDREN)", { a: 2, b: 4 }, ["a", "b"])).toBe(3);
    expect(ev("MIN({a}, {b})", { a: 3, b: 4 })).toBe(3);
    expect(ev("MAX(CHILDREN)", { a: 3, b: 9 }, ["a", "b"])).toBe(9);
    expect(ev("ABS(-{a})", { a: 3 })).toBe(3);
    expect(ev("ROUND({a} / 3, 2)", { a: 10 })).toBe(3.33);
    expect(ev("round({a} / 3)", { a: 10 })).toBe(3);
  });
  it("missing inputs and divide-by-zero yield null, never throw", () => {
    expect(ev("{a} + 1", { a: null })).toBeNull();
    expect(ev("{a} / {b}", { a: 1, b: 0 })).toBeNull();
    expect(ev("SUM({a}, {b})", { a: 1, b: null })).toBe(1); // aggregates skip unknowns
  });
  it("rejects garbage in words", () => {
    expect(() => parseFormula("{a} +")).toThrow(/ends early/);
    expect(() => parseFormula("foo({a})")).toThrow(/not a function/);
    expect(() => parseFormula("({a}")).toThrow(/closing parenthesis/);
  });
});

describe("unit algebra", () => {
  const warns: string[] = [];
  const w = (m: string) => warns.push(m);
  it("cancels and combines", () => {
    expect(combineUnits("*", "kL", "$/kL", w)).toBe("$");
    expect(combineUnits("*", "$/kL", "kL", w)).toBe("$");
    expect(combineUnits("/", "$", "kL", w)).toBe("$/kL");
    expect(combineUnits("/", "$", "$", w)).toBe("");
    expect(combineUnits("+", "$", "$", w)).toBe("$");
    expect(combineUnits("*", "", "kL", w)).toBe("kL");
  });
  it("mismatches warn, never block", () => {
    warns.length = 0;
    expect(combineUnits("+", "$", "kL", w)).toBe("$");
    expect(warns[0]).toMatch(/check the units/);
  });
});

describe("checkFormula (the editor's sentences)", () => {
  it("a healthy formula resolves with its unit and child usage", () => {
    const nodes = tree();
    const c = checkFormula(nodes[1], nodes); // margin
    expect(c.ok).toBe(true);
    expect(c.unit).toBe("$");
    expect(c.used.sort()).toEqual(["price", "vol"]);
    expect(c.unused).toEqual([]);
  });
  it("names a non-child, a leading indicator and a missing driver", () => {
    const nodes = tree();
    const bad = { ...nodes[0], formula: "{vol} - {obs} - {gone}" };
    const c = checkFormula(bad, nodes);
    expect(c.ok).toBe(false);
    expect(c.errors.join("|")).toMatch(/'Saleable volume' is not a child/);
    expect(c.errors.join("|")).toMatch(/'Safety observations' is a leading indicator/);
    expect(c.errors.join("|")).toMatch(/no longer exists/);
  });
  it("a node can't be finer than its drivers; unit drift and ÷0 only warn", () => {
    const nodes = tree();
    const weeklyMargin = { ...nodes[1], cadence: "weekly" as const, formula: "{vol} / {price}", unit: "kL" };
    const c = checkFormula(weeklyMargin, nodes);
    expect(c.errors.join("|")).toMatch(/'Saleable volume' is monthly — this weekly node/);
    expect(c.warnings.join("|")).toMatch(/Divides by 'Unit margin'/);
    expect(c.warnings.join("|")).toMatch(/kL\/\$\/kL from the formula/);
  });
  it("reports unused children and an empty formula on a parent", () => {
    const nodes = tree();
    const c = checkFormula({ ...nodes[1], formula: "{vol}" }, nodes);
    expect(c.unused).toEqual(["price"]);
    const empty = checkFormula({ ...nodes[1], formula: "" }, nodes);
    expect(empty.warnings[0]).toMatch(/won't roll its children up/);
  });
  it("a leading node with a formula is refused; CHILDREN outside an aggregate too", () => {
    const nodes = tree();
    expect(checkFormula({ ...nodes[5], formula: "1" }, nodes).errors[0]).toMatch(/leading indicator has no formula/);
    expect(checkFormula({ ...nodes[1], formula: "CHILDREN * 2" }, nodes).errors[0]).toMatch(/only works inside/);
  });
});

describe("computeTree", () => {
  it("rolls leaves up through formulas per series; leading nodes never feed", () => {
    const nodes = tree();
    const plan = computeTree(nodes, "FY26", "plan");
    expect(plan.get("margin")).toBe(500);
    expect(plan.get("ebitda")).toBe(300);
    const actual = computeTree(nodes, "FY26", "actual");
    expect(actual.get("ebitda")).toBeCloseTo(90 * 5.5 - 210);
    expect(actual.get("obs")).toBeNull();
  });
  it("overrides inject simulation deltas at the leaf and flow up", () => {
    const nodes = tree();
    const sim = computeTree(nodes, "FY26", "plan", new Map([["vol", 120]]));
    expect(sim.get("margin")).toBe(600);
    expect(sim.get("ebitda")).toBe(400);
  });
  it("a missing period gives null without throwing; a cycle is refused", () => {
    const nodes = tree();
    expect(computeTree(nodes, "FY99", "plan").get("ebitda")).toBeNull();
    const loop = [mk("a", "", "A", { formula: "{b}" }), mk("b", "a", "B", { formula: "{a}" })];
    expect(computeTree(loop, "FY26", "plan").get("a")).toBeNull();
  });
  it("formula in words and paths", () => {
    const nodes = tree();
    expect(formulaInWords(nodes[1].formula, nodes)).toBe("Saleable volume × Unit margin");
    expect(pathOf(nodes, "vol")).toEqual(["EBITDA", "Gross margin", "Saleable volume"]);
    expect(pathToRoot(nodes, "vol").map((n) => n.id)).toEqual(["vol", "margin", "ebitda"]);
  });
});

describe("values, history and display", () => {
  it("setValue logs the change newest-first and caps", () => {
    const n = mk("x", "", "X");
    const actor = { whoId: "u", who: "Ben" };
    setValue(n, "FY26", "plan", 10, actor, "2026-09-01T00:00:00Z");
    setValue(n, "FY26", "plan", 12, actor, "2026-09-02T00:00:00Z");
    setValue(n, "FY26", "plan", 12, actor, "2026-09-03T00:00:00Z"); // no-op
    expect(n.values.FY26?.plan).toBe(12);
    expect(n.history.length).toBe(2);
    expect(n.history[0]).toMatchObject({ from: 10, to: 12, series: "plan" });
  });
  it("formats currency, scale and percent", () => {
    expect(formatValue(7910000, "$", { decimals: 2, scale: "m", percent: false, rows: { plan: true, forecast: true, lsl: false, usl: false } })).toBe("$7.91m");
    expect(formatValue(0.625, "", { decimals: 1, scale: "", percent: true, rows: { plan: true, forecast: true, lsl: false, usl: false } })).toBe("62.5%");
    expect(formatValue(1240, "kL", { decimals: 0, scale: "", percent: false, rows: { plan: true, forecast: true, lsl: false, usl: false } })).toBe("1,240 kL");
    expect(formatValue(null, "$", { decimals: 0, scale: "", percent: false, rows: { plan: true, forecast: true, lsl: false, usl: false } })).toBe("—");
  });
});

describe("cadence bucketing", () => {
  const pts = [
    { date: "2026-08-24", shift: "A", value: 10 }, // Mon W35
    { date: "2026-08-24", shift: "B", value: 20 },
    { date: "2026-08-30", shift: "A", value: 5 }, // Sun W35
    { date: "2026-09-01", shift: "A", value: 7 }, // Tue W36
  ];
  it("keys by shift, day, ISO week, month, year", () => {
    expect(bucketKey(pts[0], "shiftly")).toBe("2026-08-24|A");
    expect(bucketKey(pts[0], "daily")).toBe("2026-08-24");
    expect(bucketKey(pts[0], "weekly")).toBe("2026-W35");
    expect(bucketKey(pts[2], "weekly")).toBe("2026-W35");
    expect(bucketKey(pts[3], "weekly")).toBe("2026-W36");
    expect(bucketKey(pts[3], "monthly")).toBe("2026-09");
    expect(bucketKey(pts[3], "annually")).toBe("2026");
  });
  it("aggregates per bucket by rule", () => {
    expect(aggregateSeries(pts, "weekly", "sum")).toEqual([
      { key: "2026-W35", value: 35 },
      { key: "2026-W36", value: 7 },
    ]);
    expect(aggregateSeries(pts, "daily", "avg")[0]).toEqual({ key: "2026-08-24", value: 15 });
    expect(aggregateSeries(pts, "daily", "last")[0]).toEqual({ key: "2026-08-24", value: 20 });
  });
  it("folds a period into one actual", () => {
    expect(foldSeries(pts, "weekly", "sum")).toBe(42);
    expect(foldSeries(pts, "weekly", "avg")).toBeCloseTo((35 / 3 + 7) / 2); // bucket averages, then averaged
    expect(foldSeries([], "weekly", "sum")).toBeNull();
  });
});

describe("linked KPI card ↔ driver series adapters (P9e)", () => {
  it("cells become date-keyed points (only the actual key, numeric)", () => {
    const pts = driverPointsFromCells([
      { key: "actual", date: "2026-08-26", shift: "-", value: "12" },
      { key: "actual", date: "2026-08-25", shift: "A", value: "9" },
      { key: "other", date: "2026-08-24", shift: "-", value: "1" },
      { key: "actual", date: "2026-08-23", shift: "-", value: "x" },
    ]);
    expect(pts.map((p) => p.id)).toEqual(["actual@2026-08-25|A", "actual@2026-08-26"]);
  });
  it("diff upserts changed values, deletes moved dates and removed points", () => {
    const prev = [{ id: "actual@2026-08-25", date: "2026-08-25", value: 9 }, { id: "actual@2026-08-26", date: "2026-08-26", value: 12 }];
    const next = [{ id: "actual@2026-08-25", date: "2026-08-27", value: 9 }, { id: "n1", date: "2026-08-28", value: 3 }];
    const { put, del } = driverDiffPoints(prev, next);
    expect(put.map((c) => `${c.date}=${c.value}`)).toEqual(["2026-08-27=9", "2026-08-28=3"]);
    expect(del.map((c) => c.date).sort()).toEqual(["2026-08-25", "2026-08-26"]);
  });
});

describe("non-numeric drivers (good / bad, picklist)", () => {
  it("parses tracking defensively", () => {
    expect(parseTracking("")).toEqual({ kind: "value", options: [] });
    expect(parseTracking(JSON.stringify({ kind: "goodbad", options: [{ label: "x", state: "red" }] }))).toEqual({ kind: "goodbad", options: [] });
    expect(parseTracking(JSON.stringify({ kind: "picklist", options: [{ label: "Late", state: "red" }, { label: "", state: "green" }] }))).toEqual({ kind: "picklist", options: [{ label: "Late", state: "red" }] });
  });
  it("stateOf reads labels and the initiative form's 1/0", () => {
    const gb = { kind: "goodbad" as const, options: [] };
    expect(stateOf(gb, "Good")).toEqual({ label: "Good", rag: "green" });
    expect(stateOf(gb, "0")).toEqual({ label: "Bad", rag: "red" });
    const pl = { kind: "picklist" as const, options: [{ label: "On track", state: "green" as const }] };
    expect(stateOf(pl, "on track")).toEqual({ label: "On track", rag: "green" });
    expect(stateOf(pl, "??")).toEqual({ label: "??", rag: null });
    expect(stateOf(pl, "")).toEqual({ label: "", rag: null });
  });
  it("a non-numeric leaf computes as null and is refused in a formula", () => {
    const nodes = [
      mk("r", "", "Root", { formula: "{a} + {b}" }),
      mk("a", "r", "A", { values: { FY26: { plan: 5 } } }),
      mk("b", "r", "B", { tracking: { kind: "goodbad", options: [] }, values: { FY26: { plan: 9 } } }),
    ];
    expect(computeTree(nodes, "FY26", "plan").get("b")).toBeNull();
    const chk = checkFormula(nodes[0], nodes);
    expect(chk.ok).toBe(false);
    expect(chk.errors.join(" ")).toMatch(/B is measured as good \/ bad/);
  });
  it("state points carry the label; the diff writes labels", () => {
    const t = { kind: "picklist" as const, options: [{ label: "Late", state: "red" as const }, { label: "On time", state: "green" as const }] };
    const pts = driverStatePointsFromCells([{ key: "actual", date: "2026-09-07", shift: "-", value: "On time" }], t);
    expect(pts[0]).toMatchObject({ id: "actual@2026-09-07", value: 1, label: "On time" });
    const { put } = driverDiffStatePoints(pts, [...pts, { id: "k9", date: "2026-09-14", value: 0, label: "Late" }], t);
    expect(put).toEqual([{ key: "actual", date: "2026-09-14", shift: "-", value: "Late" }]);
  });
});
