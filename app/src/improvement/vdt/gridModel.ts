// Grid entry for KPI values (Ben, 2026-09-08): a column per period at the
// KPI's cadence, rows Date · Target · Lower · Upper · Actual. PURE — the
// component (grid.ts) and the KPI card lean on these; vitest covers them.
//
// Model decisions (all Ben's, the proposal of 2026-09-08):
//  · columns are the cadence BUCKETS intersecting a window — full buckets,
//    so a weekly column runs Monday→Sunday even at a period boundary; the
//    anchor (bucket start) is the date an entered value is written on;
//  · a column's Actual sits on the existing dated series: one point at the
//    anchor. Several finer points in a bucket → folded, read-only;
//  · Target / Lower / Upper are three more dated series on the same
//    location, CARRY-FORWARD: a column's spec is the latest spec point at
//    or before its anchor, else the single level target on the metric/card.

import { Aggregate, aggregateSeries, bucketKey, Cadence, SeriesPoint } from "./model";
import { isSpecSeriesKey, SPEC_SERIES_KEYS, specAtDate } from "../../../../shared/schema/specSeries";

/** Series keys of the per-bucket spec (shared with the KPI card). */
export const SPEC_KEYS = SPEC_SERIES_KEYS;
export type SpecKind = keyof typeof SPEC_KEYS;
export const SPEC_KINDS: SpecKind[] = ["target", "lsl", "usl"];
export const SPEC_LABELS: Record<SpecKind, string> = { target: "Target", lsl: "Lower", usl: "Upper" };
export const isSpecKey = isSpecSeriesKey;

export interface GridColumn {
  /** The bucket key (`bucketKey` of any point in it). */
  key: string;
  /** Header: "Wk 37", "7 Sep", "7 Sep · D", "Sep 26", "2026". */
  label: string;
  /** Sub-header: the anchor date, "7 Sep 26". */
  dateLabel: string;
  /** Bucket span (inclusive). */
  from: string;
  to: string;
  /** The date an entered value is written on (= from). */
  anchor: string;
  /** "-" except shiftly. */
  shift: string;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Sep 26" */
export function shortDate(isoDate: string): string {
  const d = parse(isoDate);
  if (!Number.isFinite(d.getTime())) return isoDate;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** The bucket a date falls in at a cadence: its span. */
export function bucketSpan(date: string, cadence: Cadence): { from: string; to: string } {
  const d = parse(date);
  if (cadence === "shiftly" || cadence === "daily") return { from: iso(d), to: iso(d) };
  if (cadence === "weekly") {
    const day = (d.getDay() + 6) % 7; // Mon=0
    const from = new Date(d.getTime() - day * DAY);
    return { from: iso(from), to: iso(new Date(from.getTime() + 6 * DAY)) };
  }
  if (cadence === "monthly") {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to) };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}

function labelFor(span: { from: string; to: string }, cadence: Cadence, shift: string): string {
  const d = parse(span.from);
  if (cadence === "shiftly") return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${shift}`;
  if (cadence === "daily") return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (cadence === "weekly") return `Wk ${bucketKey({ date: span.from, shift: "-" }, "weekly").slice(6)}`;
  if (cadence === "monthly") return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return String(d.getFullYear());
}

/** The full buckets intersecting [from, to] at a cadence, ascending.
 *  Shiftly: one column per (day, shift) for the given shifts. */
export function gridColumns(cadence: Cadence, from: string, to: string, shifts: string[] = ["D", "N"]): GridColumn[] {
  const out: GridColumn[] = [];
  if (!(from <= to)) return out;
  let cur = bucketSpan(from, cadence);
  const cap = 400; // daily over a year; the component pages anyway
  while (cur.from <= to && out.length < cap) {
    const shiftsHere = cadence === "shiftly" ? (shifts.length > 0 ? shifts : ["-"]) : ["-"];
    for (const s of shiftsHere) {
      out.push({
        key: bucketKey({ date: cur.from, shift: s }, cadence),
        label: labelFor(cur, cadence, s),
        dateLabel: shortDate(cur.from),
        from: cur.from,
        to: cur.to,
        anchor: cur.from,
        shift: s,
      });
    }
    const next = new Date(parse(cur.to).getTime() + DAY);
    cur = bucketSpan(iso(next), cadence);
  }
  return out;
}

/** Buckets per page — the grid pages through time without bound (Ben,
 *  2026-09-08: a KPI is never bounded by a period). Shiftly pages by
 *  days (× the shifts). */
export const PAGE_BUCKETS: Record<Cadence, number> = { shiftly: 7, daily: 7, weekly: 13, monthly: 12, annually: 10 };

/** The anchor `n` buckets on from a bucket anchor (negative = back). */
export function addBuckets(anchor: string, cadence: Cadence, n: number): string {
  const d = parse(bucketSpan(anchor, cadence).from);
  if (cadence === "shiftly" || cadence === "daily") return iso(new Date(d.getTime() + n * DAY));
  if (cadence === "weekly") return iso(new Date(d.getTime() + n * 7 * DAY));
  if (cadence === "monthly") return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
  return `${d.getFullYear() + n}-01-01`;
}

/** The page's columns from its first anchor. */
export function pageColumns(cadence: Cadence, origin: string, shifts?: string[]): GridColumn[] {
  return gridColumns(cadence, origin, addBuckets(origin, cadence, PAGE_BUCKETS[cadence] - 1), shifts);
}

/** The page origin that puts `date`'s bucket third from the right. */
export function pageOriginAround(date: string, cadence: Cadence): string {
  return addBuckets(bucketSpan(date, cadence).from, cadence, -(PAGE_BUCKETS[cadence] - 3));
}

/** The read window covering every column (full buckets). */
export function columnsWindow(cols: GridColumn[]): { from: string; to: string } {
  if (cols.length === 0) return { from: "2999-12-31", to: "1900-01-01" };
  return { from: cols[0].from, to: cols[cols.length - 1].to };
}

/** Carry-forward: the latest spec point dated at or before `anchor`;
 *  null when none. Spec points are day-dated (shift "-"). */
export function specAt(points: SeriesPoint[], anchor: string): { value: number; date: string } | null {
  const hit = specAtDate(points, anchor);
  return hit ? { value: hit.value, date: hit.date } : null;
}

export interface GridSpecCell {
  value: number | null;
  /** True when the value is inherited (carried forward or the level
   *  target) rather than a point on this column. */
  inherited: boolean;
}

export interface GridActualCell {
  value: number | null;
  /** Points folded into this column. */
  count: number;
  /** Editable when the bucket holds at most one point (that point is
   *  overwritten in place; a new one lands on the anchor). */
  editable: boolean;
  /** The one existing point's cell (key/date/shift) when count === 1. */
  existing: { key: string; date: string; shift: string } | null;
}

export interface GridCell {
  column: GridColumn;
  target: GridSpecCell;
  lsl: GridSpecCell;
  usl: GridSpecCell;
  actual: GridActualCell;
  rag: "green" | "amber" | "red" | null;
}

export interface GridSpecPoints {
  target: SeriesPoint[];
  lsl: SeriesPoint[];
  usl: SeriesPoint[];
}

export interface GridLevel {
  target: number | null;
  lsl: number | null;
  usl: number | null;
}

export interface GridActualPoint extends SeriesPoint {
  /** The series key the point is stored under ("actual" on a driver; the
   *  point id on an own card). */
  key: string;
}

/** Direction from the column's own limits (the metric rule: lower only →
 *  higher is better; upper only → lower; both → within). */
export function ragFor(actual: number | null, target: number | null, lsl: number | null, usl: number | null): "green" | "amber" | "red" | null {
  if (actual === null) return null;
  if ((usl !== null && actual > usl) || (lsl !== null && actual < lsl)) return "red";
  if (target === null) return null;
  if (lsl !== null && usl !== null) return "green";
  if (usl !== null && lsl === null) return actual <= target ? "green" : "amber";
  return actual >= target ? "green" : "amber";
}

/** Resolve every column: actuals folded at the cadence, spec carried
 *  forward, RAG per column. */
export function resolveGrid(
  cols: GridColumn[],
  actuals: GridActualPoint[],
  spec: GridSpecPoints,
  level: GridLevel,
  cadence: Cadence,
  aggregate: Aggregate
): GridCell[] {
  const byBucket = new Map<string, GridActualPoint[]>();
  for (const p of actuals) {
    const k = bucketKey(p, cadence);
    byBucket.set(k, [...(byBucket.get(k) ?? []), p]);
  }
  const folded = new Map(aggregateSeries(actuals, cadence, aggregate).map((b) => [b.key, b.value]));
  const specCell = (kind: SpecKind, col: GridColumn): GridSpecCell => {
    const hit = specAt(spec[kind], col.anchor);
    if (hit) return { value: hit.value, inherited: hit.date !== col.anchor };
    return { value: level[kind], inherited: true };
  };
  return cols.map((col) => {
    const pts = byBucket.get(col.key) ?? [];
    const value = folded.has(col.key) ? (folded.get(col.key) as number) : null;
    const one = pts.length === 1 ? pts[0] : null;
    const actual: GridActualCell = {
      value,
      count: pts.length,
      editable: pts.length <= 1,
      existing: one ? { key: one.key, date: one.date, shift: one.shift } : null,
    };
    const target = specCell("target", col);
    const lsl = specCell("lsl", col);
    const usl = specCell("usl", col);
    return { column: col, target, lsl, usl, actual, rag: ragFor(value, target.value, lsl.value, usl.value) };
  });
}

/** Fold the columns' targets into ONE number at the aggregate — the
 *  period's Plan from its targets (on request, never automatic). */
export function foldValues(values: (number | null)[], aggregate: Aggregate): number | null {
  const vs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (vs.length === 0) return null;
  if (aggregate === "sum") return vs.reduce((a, b) => a + b, 0);
  if (aggregate === "avg") return vs.reduce((a, b) => a + b, 0) / vs.length;
  if (aggregate === "min") return Math.min(...vs);
  if (aggregate === "max") return Math.max(...vs);
  return vs[vs.length - 1];
}

// ---- paste (Excel-style) ----------------------------------------------------------

export type GridRowKind = SpecKind | "actual";
export const ROW_ORDER: GridRowKind[] = ["target", "lsl", "usl", "actual"];

export interface PastedRow {
  kind: GridRowKind;
  values: (number | null)[];
}

function rowKindOf(label: string): GridRowKind | "skip" | null {
  const l = label.trim().toLowerCase();
  if (l === "") return null;
  if (/^(period|date|wk|week|month|year|shift)/.test(l)) return "skip";
  if (/^target/.test(l)) return "target";
  if (/^(lower|lsl|min)/.test(l)) return "lsl";
  if (/^(upper|usl|max)/.test(l)) return "usl";
  if (/^actual/.test(l)) return "actual";
  return null;
}

function numOf(raw: string): number | null | "bad" {
  const t = raw.trim();
  if (t === "" || t === "—" || t === "-") return null;
  const n = Number(t.replace(/[,$%\s]/g, ""));
  return Number.isFinite(n) ? n : "bad";
}

/** Parse a pasted block (tab- or comma-separated). A row whose first
 *  cell is a label maps by it (Target / Lower / Upper / Actual; Period and
 *  Date rows are dropped); unlabeled rows map by position from `fromRow`.
 *  Non-numeric cells are skipped (kept as "no change"). */
export function parsePasteBlock(text: string, fromRow: GridRowKind = "target"): PastedRow[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const out: PastedRow[] = [];
  let pos = Math.max(0, ROW_ORDER.indexOf(fromRow));
  for (const line of lines) {
    const cells = line.includes("\t") ? line.split("\t") : line.split(",");
    const first = cells[0] ?? "";
    const labelled = numOf(first) === "bad";
    let kind: GridRowKind | "skip" | null;
    let vals: string[];
    if (labelled) {
      kind = rowKindOf(first);
      vals = cells.slice(1);
      if (kind === "skip") continue;
      if (kind === null) continue;
    } else {
      kind = ROW_ORDER[pos] ?? null;
      vals = cells;
      pos++;
      if (kind === null) continue;
    }
    const values = vals.map((v) => {
      const n = numOf(v);
      return n === "bad" ? null : n;
    });
    out.push({ kind, values });
  }
  return out;
}

/** CSV of the grid (the mock's layout: one row per line, a column per bucket). */
export function gridCsv(cells: GridCell[], unit: string): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const num = (v: number | null) => (v === null ? "" : String(v));
  const rows = [
    ["Period", ...cells.map((c) => c.column.label)],
    ["Date", ...cells.map((c) => c.column.anchor)],
    [`Target${unit ? ` (${unit})` : ""}`, ...cells.map((c) => num(c.target.value))],
    ["Lower limit", ...cells.map((c) => num(c.lsl.value))],
    ["Upper limit", ...cells.map((c) => num(c.usl.value))],
    ["Actual", ...cells.map((c) => num(c.actual.value))],
  ];
  return rows.map((r) => r.map(q).join(",")).join("\n");
}

/** The spec series' point for a column (write helper): day-dated at the
 *  anchor, shift "-"; a null value deletes. */
export function specCell(kind: SpecKind, col: GridColumn, value: number | null): { key: string; date: string; shift: string; value: string } {
  return { key: SPEC_KEYS[kind], date: col.anchor, shift: "-", value: value === null ? "" : String(value) };
}

/** Split a location's cells into the grid's inputs. `actualKeyOf` says
 *  which non-spec keys are actuals (a driver: "actual"; an own card: any
 *  point id). */
export function splitGridCells(
  cells: { key: string; date: string; shift: string; value: string }[],
  isActual: (key: string) => boolean
): { actuals: GridActualPoint[]; spec: GridSpecPoints } {
  const actuals: GridActualPoint[] = [];
  const spec: GridSpecPoints = { target: [], lsl: [], usl: [] };
  for (const c of cells) {
    const v = Number(c.value);
    if (!Number.isFinite(v) || c.value === "") continue;
    if (isSpecKey(c.key)) {
      const kind = SPEC_KINDS.find((k) => SPEC_KEYS[k] === c.key);
      if (kind) spec[kind].push({ date: c.date.slice(0, 10), shift: "-", value: v });
    } else if (isActual(c.key)) actuals.push({ key: c.key, date: c.date.slice(0, 10), shift: c.shift || "-", value: v });
  }
  return { actuals, spec };
}
