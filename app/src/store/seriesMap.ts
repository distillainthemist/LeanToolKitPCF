// Pure conversions between card documents' ratings maps and Card Series
// rows (no SDK imports — unit-testable). The cards keep their document key
// convention "<entity>|<yyyy-mm-dd>[|D|N]" in memory; the table splits it
// into (serieskey, date, shift) with shift "-" for a whole day/week — a
// sentinel, not "", because Dataverse stores "" as null and null key
// columns break alternate-key upserts.

/** One table cell in app form (shift uses the stored sentinel form). */
export interface SeriesCell {
  key: string; // the entity: dimension letter, condition name, point id
  date: string; // yyyy-mm-dd (a week row uses its Monday)
  shift: string; // "-" | "D" | "N"
  value: string;
}

export const WHOLE_DAY = "-";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Doc key → cell fields (value supplied separately); null if unusable. */
export function splitDocKey(
  docKey: string
): { key: string; date: string; shift: string } | null {
  const parts = docKey.split("|");
  let shift = WHOLE_DAY;
  if (parts.length >= 2 && (parts[parts.length - 1] === "D" || parts[parts.length - 1] === "N")) {
    shift = parts.pop() as string;
  }
  const date = parts.pop() ?? "";
  const key = parts.join("|");
  if (key === "" || !DATE_RE.test(date)) return null;
  return { key, date, shift };
}

/** Cell → the document key the editors use. */
export function docKey(cell: { key: string; date: string; shift: string }): string {
  return cell.shift === WHOLE_DAY
    ? `${cell.key}|${cell.date}`
    : `${cell.key}|${cell.date}|${cell.shift}`;
}

/** A whole ratings map decomposed to cells (unusable keys skipped). */
export function cellsFromRatings(ratings: Record<string, string>): SeriesCell[] {
  const out: SeriesCell[] = [];
  for (const [k, value] of Object.entries(ratings)) {
    if (value === "") continue;
    const split = splitDocKey(k);
    if (split) out.push({ ...split, value });
  }
  return out;
}

/** Cells reassembled into the editors' ratings map. */
export function ratingsFromCells(cells: SeriesCell[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cells) {
    if (c.value !== "") out[docKey(c)] = c.value;
  }
  return out;
}

/**
 * The write set after an edit: cells whose value changed or appeared go to
 * `put`, keys that vanished (rating unset) go to `del`.
 */
export function diffRatings(
  prev: Record<string, string>,
  next: Record<string, string>
): { put: SeriesCell[]; del: SeriesCell[] } {
  const put: SeriesCell[] = [];
  const del: SeriesCell[] = [];
  for (const [k, value] of Object.entries(next)) {
    if (value === "") continue;
    if (prev[k] === value) continue;
    const split = splitDocKey(k);
    if (split) put.push({ ...split, value });
  }
  for (const k of Object.keys(prev)) {
    if (next[k] !== undefined && next[k] !== "") continue;
    const split = splitDocKey(k);
    if (split) del.push({ ...split, value: "" });
  }
  return { put, del };
}

/** The operational day of a meeting instance ("" / unparseable → today). */
export function instanceDay(when: string): string {
  const t = when.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const now = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** First and last day of the month containing `day` (inclusive window). */
export function monthWindow(day: string): { from: string; to: string } {
  const [y, m] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const last = new Date(y, m, 0).getDate(); // day 0 of next month
  const mm = day.slice(5, 7);
  return { from: `${day.slice(0, 4)}-${mm}-01`, to: `${day.slice(0, 4)}-${mm}-${String(last).padStart(2, "0")}` };
}

// ---- KPI trend (points keyed by stable point id) ----

export interface SeriesPoint {
  id: string;
  date: string; // yyyy-mm-dd
  value: number;
}

/** Points → cells: serieskey = the point's id (keeps per-point action
 *  linkage), value = the number as text. */
export function cellsFromPoints(points: SeriesPoint[]): SeriesCell[] {
  return points
    .filter((p) => p.id !== "" && DATE_RE.test(p.date) && Number.isFinite(p.value))
    .map((p) => ({ key: p.id, date: p.date, shift: WHOLE_DAY, value: String(p.value) }));
}

/** Cells → points, date-sorted; non-numeric values skipped. */
export function pointsFromCells(cells: SeriesCell[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const c of cells) {
    const value = Number(c.value);
    if (c.key !== "" && Number.isFinite(value)) {
      out.push({ id: c.key, date: c.date, value });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/**
 * The write set after a points edit, matched by id. A changed value
 * upserts in place; a changed DATE deletes the old row and writes a new
 * one (the date is part of the row key); a removed id deletes.
 */
export function diffPoints(
  prev: SeriesPoint[],
  next: SeriesPoint[]
): { put: SeriesCell[]; del: SeriesCell[] } {
  const before = new Map(prev.map((p) => [p.id, p]));
  const put: SeriesCell[] = [];
  const del: SeriesCell[] = [];
  for (const p of next) {
    if (p.id === "" || !DATE_RE.test(p.date) || !Number.isFinite(p.value)) continue;
    const old = before.get(p.id);
    before.delete(p.id);
    if (old && old.date === p.date && old.value === p.value) continue;
    if (old && old.date !== p.date) {
      del.push({ key: p.id, date: old.date, shift: WHOLE_DAY, value: "" });
    }
    put.push({ key: p.id, date: p.date, shift: WHOLE_DAY, value: String(p.value) });
  }
  for (const old of before.values()) {
    del.push({ key: old.id, date: old.date, shift: WHOLE_DAY, value: "" });
  }
  return { put, del };
}

/** Inclusive trailing window of `days` ending on `day`. */
export function trailingWindow(day: string, days: number): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00`);
  const from = new Date(d.getTime() - (Math.max(1, days) - 1) * 86_400_000);
  const p = (v: number) => String(v).padStart(2, "0");
  return {
    from: `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`,
    to: day,
  };
}

// ---- Pareto (day-count rows summed over the window) ----

export interface ParetoItemLike {
  id: string;
  label: string;
  count: number;
}

/** Window sums per category id. */
export function sumsByKey(cells: SeriesCell[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cells) {
    const n = Number(c.value);
    if (c.key !== "" && Number.isFinite(n)) out[c.key] = (out[c.key] ?? 0) + n;
  }
  return out;
}

/**
 * A Pareto edit split into its two halves: definition changes (labels,
 * added/removed categories — the document's business) and count deltas per
 * id (the series' business: the delta lands on the meeting-day row).
 */
export function diffParetoItems(
  prev: ParetoItemLike[],
  next: ParetoItemLike[]
): { defsChanged: boolean; deltas: Record<string, number> } {
  const before = new Map(prev.map((p) => [p.id, p]));
  const deltas: Record<string, number> = {};
  let defsChanged = false;
  for (const item of next) {
    const old = before.get(item.id);
    before.delete(item.id);
    if (!old || old.label !== item.label) defsChanged = true;
    const delta = item.count - (old?.count ?? 0);
    if (delta !== 0) deltas[item.id] = delta;
  }
  if (before.size > 0) defsChanged = true; // removals
  return { defsChanged, deltas };
}
