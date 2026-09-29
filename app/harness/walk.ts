// The cascaded priorities' present view, with stub data: two objective
// columns, priorities with starred metrics, the PREV / NEXT rails.
import "../src/style.css";
import { mountWalk } from "../src/priorities/walk";
import type { LifecycleCtx } from "../src/priorities/lifecycle";
import type { Pillar, Priority } from "../src/priorities/model";

const el = (tag: string, cls: string, text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const org = { company: "Pechey", site: "Bendigo", department: "Packaging", area: "" };
const pillar = (id: string, name: string, level: 1 | 2, parentId: string, color: string): Pillar => ({ id, name, level, parentId, color, order: 0, active: true, company: "Pechey" }) as Pillar;
const pillars = [pillar("L1", "Operational excellence", 1, "", "#1f6f5c"), pillar("S1", "Safety", 2, "L1", "#1f6f5c"), pillar("S2", "Delivery", 2, "L1", "#8a4b12"), pillar("S3", "Cost", 2, "L1", "")];
const pr = (id: string, statement: string, pillarId: string, ownerName: string, primaryInitiativeId: string, status = "active"): Priority =>
  ({ id, statement, org, pillarId, ownerId: "u", ownerName, period: "FY27", status, statusReason: "", parentId: "", primaryInitiativeId, order: 0, notes: "" }) as Priority;
const priorities = [
  pr("P1", "Zero lost-time injuries across the bottling hall by embedding the daily safety cross and closing every near miss within five working days", "S1", "Jane Smith", "I1"),
  pr("P2", "Guarding audit complete on every filler", "S1", "Sam Lee", "I2"),
  pr("P3", "Machine isolation refresher for all crews", "S1", "", ""),
  pr("P4", "Changeover under 25 minutes on line 2", "S2", "Tom Hall", "I3", "completed"),
];
type MV = { name: string; objective: string; target: number | null; unit: string; display: string; rag: "green" | "amber" | "red" | null };
const metrics: Record<string, MV[]> = {
  I1: [
    { name: "Lost-time injuries", objective: "None for twelve consecutive months", target: 0, unit: "", display: "1", rag: "red" },
    { name: "Near misses closed in 5 days", objective: "Every near miss actioned inside a working week", target: 95, unit: "%", display: "88%", rag: "amber" },
  ],
  I2: [],
  I3: [{ name: "Changeover time", objective: "", target: 25, unit: " min", display: "24 min", rag: "green" }],
};
const palette: Record<string, string> = { good: "#107c10", at_risk: "#c19c00", bad: "#d13438", green: "#107c10", amber: "#c19c00", red: "#d13438" };
const rags: Record<string, string[]> = { P1: ["green", "green", "amber", "red"], P2: ["green"], P3: [], P4: ["green", "green"] };

const objectiveLines = (p: Priority): HTMLElement[] => {
  const list = p.primaryInitiativeId !== "" ? (metrics[p.primaryInitiativeId] ?? []) : [];
  if (list.length === 0) {
    const line = el("div", "app-cp-objective");
    line.appendChild(el("span", "app-cp-muted", p.primaryInitiativeId !== "" ? "No metric value yet" : "No primary initiative"));
    return [line];
  }
  return list.map((mv) => {
    const line = el("div", "app-cp-objective");
    const light = el("span", "app-cp-objective-light");
    light.style.background = mv.rag ? palette[mv.rag] : "#d9d3c8";
    line.appendChild(light);
    const text = el("div", "app-cp-objective-text");
    const name = el("div", "app-cp-objective-name");
    name.appendChild(el("span", "", mv.name));
    if (mv.objective !== "") name.appendChild(el("span", "app-cp-objective-obj", `: ${mv.objective}`));
    text.appendChild(name);
    const nums = el("div", "app-cp-objective-nums");
    nums.append(el("span", "app-cp-objective-k", "Plan"), el("span", "app-cp-objective-v", mv.target !== null ? `${mv.target}${mv.unit}` : "—"), el("span", "app-cp-objective-k", "Actual"), el("span", "app-cp-objective-v app-cp-objective-actual", mv.display));
    text.appendChild(nums);
    line.appendChild(text);
    return line;
  });
};

const ctx = {
  data: () => ({ pillars, priorities, assignments: [] }),
  rule: () => "worst",
  settings: { ragRatioPct: 50 },
  palette,
  ragsFor: (p: Priority) => rags[p.id] ?? [],
} as unknown as LifecycleCtx;
const columns = pillars.filter((p) => p.level === 2);
const byColumn = new Map(columns.map((c) => [c.id, priorities.filter((p) => p.pillarId === c.id)]));
const log: string[] = [];
(window as unknown as { log: string[] }).log = log;
mountWalk({ host: document.getElementById("w")!, ctx, org, period: "FY27", columns, pillars, byColumn, adoptedIds: new Set(), objectiveLines, onExit: () => log.push("exit"), onOpen: (p) => log.push(`open ${p.id}`), onStep: (i) => log.push(`step ${i}`) });
