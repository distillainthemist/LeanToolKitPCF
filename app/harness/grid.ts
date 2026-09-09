import "../src/style.css";
import { seed } from "./seriesStub";
import { cardGridSource, driverGridSource, renderValueGrid } from "../src/improvement/vdt/grid";

seed("vdt", "oee", [
  { key: "actual", date: "2026-07-06", shift: "-", value: "0.61" },
  { key: "actual", date: "2026-07-13", shift: "-", value: "0.63" },
  { key: "actual", date: "2026-07-20", shift: "-", value: "0.59" },
  { key: "actual", date: "2026-07-27", shift: "-", value: "0.66" },
  { key: "actual", date: "2026-08-03", shift: "-", value: "0.64" },
  { key: "actual", date: "2026-08-10", shift: "-", value: "0.68" },
  { key: "actual", date: "2026-08-17", shift: "-", value: "0.67" },
  { key: "actual", date: "2026-08-24", shift: "-", value: "0.65" },
  { key: "actual", date: "2026-08-25", shift: "-", value: "0.71" },
  { key: "actual", date: "2026-08-31", shift: "-", value: "0.7" },
  { key: "actual", date: "2026-09-07", shift: "-", value: "0.69" },
  { key: "spec:target", date: "2026-07-06", shift: "-", value: "0.62" },
  { key: "spec:target", date: "2026-08-03", shift: "-", value: "0.66" },
  { key: "spec:lsl", date: "2026-07-06", shift: "-", value: "0.58" },
  { key: "spec:forecast", date: "2026-08-17", shift: "-", value: "0.69" },
]);
const ragColor = (r: "green" | "amber" | "red") => (r === "green" ? "#2e7d32" : r === "amber" ? "#c77800" : "#c62828");
renderValueGrid({
  host: document.getElementById("weekly")!,
  source: driverGridSource({ id: "oee", cadence: "weekly", aggregate: "avg", unit: "%", format: { decimals: 1, scale: "", percent: true, rows: { plan: true, forecast: true, lsl: true, usl: false } } }, { target: null, lsl: null, usl: null }, false),
  home: { from: "2026-07-01", to: "2026-09-30" },
  ragColor,
});
seed("b1", "kpi-1", [
  { key: "k1", date: "2026-09-01", shift: "-", value: "42" },
  { key: "k2", date: "2026-09-03", shift: "-", value: "45" },
  { key: "k3", date: "2026-09-07", shift: "-", value: "39" },
]);
renderValueGrid({
  host: document.getElementById("daily")!,
  source: cardGridSource("b1", "kpi-1", "daily", "min", { target: 40, lsl: null, usl: 48 }, false, { plan: true, forecast: false, lsl: false, usl: true }),
  home: { from: "2026-08-25", to: "2026-09-14" },
  ragColor,
});
