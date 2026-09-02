import "../src/style.css";
import { DriverNode, newNode } from "../src/improvement/vdt/model";
import { computeTree } from "../src/improvement/vdt/formula";
import { renderTree } from "../src/improvement/vdt/tree";

const mk = (id: string, parentId: string, name: string, over: Partial<DriverNode>): DriverNode => ({ ...newNode("Mine", parentId, name), id, ...over });
const $ = (v: Partial<Record<"baseline" | "plan", number>>) => ({ FY26: v });
const nodes: DriverNode[] = [
  mk("ebitda", "", "EBITDA", { unit: "$", cadence: "annually", formula: "{margin} - {fixed}", format: { decimals: 2, scale: "m", percent: false } }),
  mk("margin", "ebitda", "Gross margin", { unit: "$", cadence: "annually", formula: "{vol} * {unitm}", format: { decimals: 2, scale: "m", percent: false } }),
  mk("fixed", "ebitda", "Fixed cost", { unit: "$", cadence: "monthly", source: "$ / yr · payroll", format: { decimals: 2, scale: "m", percent: false }, values: $({ baseline: 3100000, plan: 3000000 }) }),
  mk("vol", "margin", "Saleable volume", { unit: "kL", cadence: "daily", aggregate: "sum", source: "kL / yr · from OEE model", values: $({ baseline: 1800, plan: 2000 }) }),
  mk("unitm", "margin", "Unit margin", { unit: "$/kL", cadence: "monthly", source: "$ / kL · sales ledger", values: $({ baseline: 5300, plan: 5450 }) }),
  mk("oee", "vol", "OEE", { unit: "%", cadence: "shiftly", aggregate: "avg", source: "% · line PLC", format: { decimals: 1, scale: "", percent: true }, values: $({ baseline: 0.61, plan: 0.66 }) }),
  mk("obs", "oee", "Safety observations", { kind: "leading", unit: "count", cadence: "weekly", source: "count / wk · Vault" }),
  mk("changeover", "oee", "Changeover time", { kind: "leading", unit: "min", cadence: "daily", aggregate: "avg", source: "min · SMED log" }),
];
renderTree(nodes, { host: document.getElementById("structure")!, mode: "structure", selectedId: "margin", onSelect: () => undefined, initiativeCounts: new Map([["oee", 2], ["fixed", 1]]) });
renderTree(nodes, {
  host: document.getElementById("values")!,
  mode: "values",
  values: computeTree(nodes, "FY26", "plan"),
  compare: computeTree(nodes, "FY26", "baseline"),
  compareLabel: "baseline",
  initiativeCounts: new Map([["oee", 2], ["fixed", 1]]),
});
