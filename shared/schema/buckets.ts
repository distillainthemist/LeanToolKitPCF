// Cadence buckets (grid entry, 2026-09-08) — shared so the KPI card
// (controls/) and the app agree on what "this week" means: ISO weeks
// Monday→Sunday, calendar months, calendar years; shiftly and daily are
// single days.

export type BucketCadence = "shiftly" | "daily" | "weekly" | "monthly" | "annually";

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00`);

/** The bucket a date falls in at a cadence: its span (inclusive). */
export function bucketSpan(date: string, cadence: BucketCadence): { from: string; to: string } {
  const d = parseDay(date);
  if (cadence === "shiftly" || cadence === "daily") return { from: isoDate(d), to: isoDate(d) };
  if (cadence === "weekly") {
    const day = (d.getDay() + 6) % 7; // Mon=0
    const from = new Date(d.getTime() - day * DAY);
    return { from: isoDate(from), to: isoDate(new Date(from.getTime() + 6 * DAY)) };
  }
  if (cadence === "monthly") {
    return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}

/** The anchor `n` buckets on from a date's bucket (negative = back). */
export function addBuckets(anchor: string, cadence: BucketCadence, n: number): string {
  const d = parseDay(bucketSpan(anchor, cadence).from);
  if (cadence === "shiftly" || cadence === "daily") return isoDate(new Date(d.getTime() + n * DAY));
  if (cadence === "weekly") return isoDate(new Date(d.getTime() + n * 7 * DAY));
  if (cadence === "monthly") return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1));
  return `${d.getFullYear() + n}-01-01`;
}

/** The reading date to offer by default (Ben, 2026-09-08): the current
 *  bucket's start, or the next bucket's when the current one already
 *  holds a reading (on that shift, when shifts apply). */
export function defaultReadingDate(today: string, cadence: BucketCadence, taken: (date: string) => boolean): string {
  const cur = bucketSpan(today, cadence).from;
  return taken(cur) ? addBuckets(cur, cadence, 1) : cur;
}
