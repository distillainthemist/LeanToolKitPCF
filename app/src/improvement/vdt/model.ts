// Value driver tree — the pure model (P9a, design spec §3 + the 2026-09-01
// review amendments). One tree per SITE. Structure is period-free (a
// driver is one persistent KPI); only VALUES are dated: four fixed series
// per period on each node. Leading nodes hang off a driver with a dashed
// edge and never enter a formula.

import { newId } from "../../../../shared/schema/id";
import { DEFAULT_ROWS_DRIVER, parseSpecRows, SpecRows } from "../../../../shared/schema/specSeries";

export type Cadence = "shiftly" | "daily" | "weekly" | "monthly" | "annually";
export const CADENCES: Cadence[] = ["shiftly", "daily", "weekly", "monthly", "annually"];
export const CADENCE_LABELS: Record<Cadence, string> = {
  shiftly: "Shiftly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annually: "Annually",
};
/** Coarseness rank — a node can never be FINER than a driver in its formula. */
export const CADENCE_RANK: Record<Cadence, number> = { shiftly: 0, daily: 1, weekly: 2, monthly: 3, annually: 4 };

export type Aggregate = "sum" | "avg" | "last" | "min" | "max";
export const AGGREGATES: Aggregate[] = ["sum", "avg", "last", "min", "max"];
export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  sum: "Sum",
  avg: "Average",
  last: "Last value",
  min: "Minimum",
  max: "Maximum",
};

/** The four fixed series. baseline/plan/forecast are PLANNED numbers per
 *  period on the node; "actual" is never stored on the node — it is the
 *  driver's dated series (store/driverSeries.ts) folded to the period at
 *  the node's cadence/aggregate (one store, written from the values tab
 *  or any linked KPI card — Ben, 2026-09-02). computeTree still takes
 *  "actual" as a series: the caller supplies folded actuals as overrides. */
export type Series = "baseline" | "plan" | "forecast" | "actual";
export const SERIES: Series[] = ["baseline", "plan", "forecast", "actual"];
export const PLANNED_SERIES: Exclude<Series, "actual">[] = ["baseline", "plan", "forecast"];

export type NodeKind = "driver" | "leading";

export interface NodeFormat {
  decimals: number;
  scale: "" | "k" | "m";
  percent: boolean;
  /** Which spec rows the driver's grid carries (2026-09-09); Actual
   *  always. Rides in the format JSON column. */
  rows: SpecRows;
}

/** One value-change log entry — the audit trail finance will ask for. */
export interface ValueChange {
  whoId: string;
  who: string;
  at: string; // ISO
  period: string;
  series: Series;
  from: number | null;
  to: number | null;
}

export interface DriverNode {
  rowId?: string;
  id: string;
  site: string;
  /** "" = the root. */
  parentId: string;
  name: string;
  definition: string;
  unit: string;
  /** Where the number comes from, in words ("payroll", "OEE model"). */
  source: string;
  /** …and the report it comes from (Ben, 2026-09-02) — the source line links. */
  sourceUrl: string;
  kind: NodeKind;
  /** "" = a leaf (values entered / fed). Leading nodes never have one. */
  formula: string;
  cadence: Cadence;
  aggregate: Aggregate;
  format: NodeFormat;
  order: number;
  /** period → series → value. */
  values: Record<string, Partial<Record<Series, number>>>;
  history: ValueChange[];
}

export const HISTORY_CAP = 50;

export function newNode(site: string, parentId: string, name: string): DriverNode {
  return {
    id: newId("vd"),
    site,
    parentId,
    name,
    definition: "",
    unit: "",
    source: "",
    sourceUrl: "",
    kind: "driver",
    formula: "",
    cadence: "monthly",
    aggregate: "sum",
    format: { decimals: 0, scale: "", percent: false, rows: { ...DEFAULT_ROWS_DRIVER } },
    order: 0,
    values: {},
    history: [],
  };
}

export interface ScenarioToggle {
  initiativeId: string;
  on: boolean;
  /** Forecast delta in the driven leaf's unit (null = not set). */
  delta: number | null;
  /** The leaf this initiative drives. */
  nodeId: string;
}

export interface AssumedEffect {
  nodeId: string;
  /** Judgement, in the driver's unit — always drawn dashed. */
  effect: number;
  initiativeId: string;
}

export interface Scenario {
  rowId?: string;
  id: string;
  site: string;
  period: string;
  name: string;
  authorId: string;
  author: string;
  at: string;
  toggles: ScenarioToggle[];
  assumed: AssumedEffect[];
}

// ---- tree helpers ------------------------------------------------------------

export function childrenOf(nodes: DriverNode[], parentId: string): DriverNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function rootOf(nodes: DriverNode[]): DriverNode | null {
  return nodes.find((n) => n.parentId === "") ?? null;
}

/** "EBITDA › Gross margin › Saleable volume" — the picker's disambiguator. */
export function pathOf(nodes: DriverNode[], id: string): string[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = by.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    out.unshift(cur.name);
    cur = cur.parentId !== "" ? by.get(cur.parentId) : undefined;
  }
  return out;
}

/** The driver children a formula may reference (leading nodes excluded). */
export function formulaChildren(nodes: DriverNode[], parentId: string): DriverNode[] {
  return childrenOf(nodes, parentId).filter((n) => n.kind === "driver");
}

export function isLeaf(nodes: DriverNode[], n: DriverNode): boolean {
  return n.kind === "leading" || n.formula.trim() === "" || formulaChildren(nodes, n.id).length === 0;
}

// ---- values -------------------------------------------------------------------

export function valueOf(n: DriverNode, period: string, series: Series): number | null {
  const v = n.values[period]?.[series];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Set a value with its audit entry (history capped, newest first). */
export function setValue(
  n: DriverNode,
  period: string,
  series: Series,
  value: number | null,
  actor: { whoId: string; who: string },
  at: string
): void {
  const from = valueOf(n, period, series);
  if (from === value) return;
  const row = n.values[period] ?? {};
  if (value === null) delete row[series];
  else row[series] = value;
  n.values[period] = row;
  n.history = [{ whoId: actor.whoId, who: actor.who, at, period, series, from, to: value }, ...n.history].slice(0, HISTORY_CAP);
}

// ---- display ------------------------------------------------------------------

/** "$7.91m", "62.5%", "1,240 kL" — the node's own format. */
export function formatValue(v: number | null, unit: string, f: NodeFormat): string {
  if (v === null) return "—";
  let n = v;
  let suffix = "";
  if (f.percent) {
    n = v * 100;
    suffix = "%";
  } else if (f.scale === "k") {
    n = v / 1e3;
    suffix = "k";
  } else if (f.scale === "m") {
    n = v / 1e6;
    suffix = "m";
  }
  const num = n.toLocaleString(undefined, { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals });
  if (f.percent) return `${num}%`;
  const currency = unit.startsWith("$");
  if (currency) return `${unit.slice(0, 1)}${num}${suffix}${unit.length > 1 ? " " + unit.slice(1) : ""}`;
  return `${num}${suffix}${unit !== "" ? " " + unit : ""}`;
}

// ---- cadence bucketing (actuals fed from a KPI series) ------------------------

export interface SeriesPoint {
  date: string; // yyyy-mm-dd
  shift: string; // "-" = none
  value: number;
}

/** The bucket key a point falls in at a cadence: "2026-08-26|A" (shiftly),
 *  "2026-08-26", "2026-W35", "2026-08", "2026". */
export function bucketKey(p: { date: string; shift: string }, cadence: Cadence): string {
  const d = p.date.slice(0, 10);
  if (cadence === "shiftly") return `${d}|${p.shift || "-"}`;
  if (cadence === "daily") return d;
  if (cadence === "monthly") return d.slice(0, 7);
  if (cadence === "annually") return d.slice(0, 4);
  // ISO week
  const t = Date.parse(`${d}T00:00:00`);
  if (!Number.isFinite(t)) return d;
  const dt = new Date(t);
  const day = (dt.getDay() + 6) % 7; // Mon=0
  const thu = new Date(dt);
  thu.setDate(dt.getDate() - day + 3);
  const y = thu.getFullYear();
  const jan4 = new Date(y, 0, 4);
  const week = 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

/** Bucket a series at a cadence and fold each bucket by the aggregate.
 *  Returns buckets in ascending key order. */
export function aggregateSeries(points: SeriesPoint[], cadence: Cadence, agg: Aggregate): { key: string; value: number }[] {
  const buckets = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    const k = bucketKey(p, cadence);
    buckets.set(k, [...(buckets.get(k) ?? []), p]);
  }
  const out: { key: string; value: number }[] = [];
  for (const [key, ps] of [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const vs = ps.map((p) => p.value);
    let value: number;
    if (agg === "sum") value = vs.reduce((a, b) => a + b, 0);
    else if (agg === "avg") value = vs.reduce((a, b) => a + b, 0) / vs.length;
    else if (agg === "min") value = Math.min(...vs);
    else if (agg === "max") value = Math.max(...vs);
    else {
      const last = [...ps].sort((a, b) => (a.date + a.shift < b.date + b.shift ? -1 : 1)).pop();
      value = last ? last.value : vs[vs.length - 1];
    }
    out.push({ key, value });
  }
  return out;
}

/** Fold a whole series into ONE number at the node's aggregate — the
 *  period's actual from a fed metric (points already limited to the period). */
export function foldSeries(points: SeriesPoint[], cadence: Cadence, agg: Aggregate): number | null {
  const buckets = aggregateSeries(points, cadence, agg);
  if (buckets.length === 0) return null;
  const vs = buckets.map((b) => b.value);
  if (agg === "sum") return vs.reduce((a, b) => a + b, 0);
  if (agg === "avg") return vs.reduce((a, b) => a + b, 0) / vs.length;
  if (agg === "min") return Math.min(...vs);
  if (agg === "max") return Math.max(...vs);
  return vs[vs.length - 1];
}

// ---- parsing (defensive, JSON columns) ----------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseValues(raw: string): DriverNode["values"] {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, Record<string, unknown>>;
    if (!o || typeof o !== "object") return {};
    const out: DriverNode["values"] = {};
    for (const [period, row] of Object.entries(o)) {
      if (!row || typeof row !== "object") continue;
      const r: Partial<Record<Series, number>> = {};
      for (const s of SERIES) {
        const v = num((row as Record<string, unknown>)[s]);
        if (v !== null) r[s] = v;
      }
      out[period] = r;
    }
    return out;
  } catch {
    return {};
  }
}

export function parseHistory(raw: string): ValueChange[] {
  try {
    const arr = JSON.parse(raw || "[]") as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        whoId: str(x.whoId),
        who: str(x.who),
        at: str(x.at),
        period: str(x.period),
        series: (SERIES.includes(x.series as Series) ? x.series : "plan") as Series,
        from: num(x.from),
        to: num(x.to),
      }))
      .slice(0, HISTORY_CAP);
  } catch {
    return [];
  }
}

export function parseFormat(raw: string): NodeFormat {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    const scale = o.scale === "k" || o.scale === "m" ? o.scale : "";
    const decimals = num(o.decimals);
    return { decimals: decimals !== null ? Math.max(0, Math.min(4, Math.round(decimals))) : 0, scale, percent: o.percent === true, rows: parseSpecRows(o.rows, DEFAULT_ROWS_DRIVER) };
  } catch {
    return { decimals: 0, scale: "", percent: false, rows: { ...DEFAULT_ROWS_DRIVER } };
  }
}

export function parseScenarioToggles(raw: string): ScenarioToggle[] {
  try {
    const arr = JSON.parse(raw || "[]") as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ initiativeId: str(x.initiativeId), nodeId: str(x.nodeId), on: x.on === true, delta: num(x.delta) }))
      .filter((t) => t.initiativeId !== "");
  } catch {
    return [];
  }
}

export function parseAssumed(raw: string): AssumedEffect[] {
  try {
    const arr = JSON.parse(raw || "[]") as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ nodeId: str(x.nodeId), effect: num(x.effect) ?? 0, initiativeId: str(x.initiativeId) }))
      .filter((a) => a.nodeId !== "");
  } catch {
    return [];
  }
}

// ---- a linked KPI card's points ↔ the driver's cells (P9e, pure) ------------------
// The KPI editor keys points by a stable id (actions hang off it); the
// driver series is keyed by DATE. A linked card therefore uses the date as
// the id ("actual@2026-08-26"), so a point's identity survives reloads and
// two cards on the same driver agree on it.

export interface KpiLikePoint {
  id: string;
  date: string;
  value: number;
  shift?: string;
}

export function driverPointsFromCells(cells: { key: string; date: string; shift: string; value: string }[]): KpiLikePoint[] {
  const out: KpiLikePoint[] = [];
  for (const c of cells) {
    if (c.key !== "actual") continue;
    const v = Number(c.value);
    if (!Number.isFinite(v)) continue;
    out.push({ id: `actual@${c.date}${c.shift && c.shift !== "-" ? "|" + c.shift : ""}`, date: c.date, value: v, ...(c.shift && c.shift !== "-" ? { shift: c.shift } : {}) });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** The write set after a points edit on a linked card: moved dates delete
 *  the old cell; new/changed values upsert on their date. */
export function driverDiffPoints(
  prev: KpiLikePoint[],
  next: KpiLikePoint[]
): { put: { key: string; date: string; shift: string; value: string }[]; del: { key: string; date: string; shift: string; value: string }[] } {
  const shiftOf = (p: KpiLikePoint) => (p.shift && p.shift !== "" ? p.shift : p.id.includes("|") ? p.id.slice(p.id.indexOf("|") + 1) : "-");
  const before = new Map(prev.map((p) => [p.id, p]));
  const put: { key: string; date: string; shift: string; value: string }[] = [];
  const del: { key: string; date: string; shift: string; value: string }[] = [];
  for (const p of next) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(p.value)) continue;
    const old = before.get(p.id);
    before.delete(p.id);
    if (old && old.date === p.date && old.value === p.value && shiftOf(old) === shiftOf(p)) continue;
    if (old && (old.date !== p.date || shiftOf(old) !== shiftOf(p))) del.push({ key: "actual", date: old.date, shift: shiftOf(old), value: "" });
    put.push({ key: "actual", date: p.date, shift: shiftOf(p), value: String(p.value) });
  }
  for (const gone of before.values()) del.push({ key: "actual", date: gone.date, shift: shiftOf(gone), value: "" });
  return { put, del };
}

/** Window days a linked card shows, by the driver's cadence. */
export function windowDaysForCadence(c: Cadence): number {
  return c === "shiftly" || c === "daily" ? 28 : c === "weekly" ? 91 : c === "monthly" ? 365 : 1000;
}
