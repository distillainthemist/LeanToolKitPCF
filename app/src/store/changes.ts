// Cross-screen change signal (2026-09-09): a screen that memoises a read
// (the Priorities screen's 60s boot cache) checks the topic's version at
// hit time; a write anywhere bumps it, so a link made on the Improvement
// tab shows on Priorities at once instead of after a reload.

const versions = new Map<string, number>();

export function changeVersion(topic: string): number {
  return versions.get(topic) ?? 0;
}

export function bumpChange(topic: string): void {
  versions.set(topic, changeVersion(topic) + 1);
  for (const k of [...reads.keys()]) if (k.startsWith(`${topic}|`)) reads.delete(k);
}

/** A short read cache (60s) keyed by topic|key; a bump on the topic drops
 *  its entries, so a screen that opens the same reads in quick succession
 *  (the priority overlay's tabs, the Metrics card's rows) hits the
 *  network once. In-flight promises are shared. */
const READ_TTL_MS = 60_000;
const reads = new Map<string, { at: number; value: Promise<unknown> }>();
export function memoRead<T>(topic: string, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${topic}|${key}`;
  const hit = reads.get(k);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  reads.set(k, { at: Date.now(), value });
  value.catch(() => reads.delete(k));
  return value;
}
