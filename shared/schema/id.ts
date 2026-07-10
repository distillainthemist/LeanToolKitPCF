/** Short unique id for elements created inside a control. */
export function newId(prefix = "n"): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

/** Today's date as yyyy-mm-dd (local time) — the toolkit's date format. */
export function todayIso(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Current instant as an ISO timestamp, for envelope meta.updated. */
export function nowIso(): string {
  return new Date().toISOString();
}
