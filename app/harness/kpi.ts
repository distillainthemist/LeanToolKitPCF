import { KpiTrendEditor } from "../../controls/KpiTrendCard/editor";
import { SCHEMA_ID } from "../../controls/KpiTrendCard/types";

const points = [
  ["2026-07-06", 61], ["2026-07-13", 63], ["2026-07-20", 59], ["2026-07-27", 66], ["2026-08-03", 64],
  ["2026-08-10", 68], ["2026-08-17", 67], ["2026-08-24", 65], ["2026-08-31", 70], ["2026-09-07", 69],
].map(([date, value], i) => ({ id: `k${i}`, date: String(date), value: Number(value) }));
const mk = (host: HTMLElement, stepped: boolean) => {
  const ed = new KpiTrendEditor(host, { onChange: () => undefined, onGrid: () => alert("grid") });
  ed.setChrome(stepped ? "OEE · VDT\nWeekly · from value driver OEE" : "OEE (flat spec)", "");
  ed.setSpec({ target: 62, usl: null, lsl: 58, unit: "%" });
  if (stepped) ed.setSpecSeries({ plan: [{ date: "2026-08-03", value: 66 }, { date: "2026-08-31", value: 70 }], forecast: [{ date: "2026-08-10", value: 68 }], lsl: [{ date: "2026-08-17", value: 66 }], usl: [] });
  ed.setEnvelope({ schema: SCHEMA_ID, meta: { title: "", updated: "" }, data: { points, target: null, usl: null, lsl: null, unit: "" } });
};
mk(document.getElementById("stepped")!, true);
mk(document.getElementById("flat")!, false);
// a Metrics-card row: no chrome, shiftly reading mode (shift select on Add reading)
const rowHost = document.createElement("div");
rowHost.style.cssText = "height:360px;background:#fff;border:1px solid #e4dfd6;border-radius:10px;overflow:hidden";
document.querySelector("div[style*='grid']")!.appendChild(rowHost);
const row = new KpiTrendEditor(rowHost, { onChange: () => undefined, onGrid: () => undefined });
row.setChrome("", "");
row.setSpec({ target: 62, usl: null, lsl: 58, unit: "%" });
row.setReadingMode({ cadence: "shiftly", shifts: ["D", "N"] });
row.setEnvelope({ schema: SCHEMA_ID, meta: { title: "", updated: "" }, data: { points: points.slice(0, 6).map((p, i) => ({ ...p, shift: i % 2 ? "N" : "D" })), target: null, usl: null, lsl: null, unit: "" } });
