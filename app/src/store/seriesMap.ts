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
