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
/** Writes travelling per topic (see `writing`). */
const writesInFlight = new Map<string, number>();

export function memoRead<T>(topic: string, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${topic}|${key}`;
  const hit = reads.get(k);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  // a read that starts while a write on its topic is travelling may come
  // back with the row as it was BEFORE the write — served, never kept
  // (2026-10-01: a linked charter field read its initiative through such
  // an entry for a minute after the edit)
  const stale = (writesInFlight.get(topic) ?? 0) > 0;
  if (!stale) {
    const startedAt = changeVersion(topic);
    reads.set(k, { at: Date.now(), value });
    value.then(
      () => {
        // a write started while this read was travelling: drop it too
        if (changeVersion(topic) !== startedAt && reads.get(k)?.value === value) reads.delete(k);
      },
      () => reads.delete(k)
    );
  }
  return value;
}

/** A write on a topic: the cache is dropped as it starts AND as it lands,
 *  and no read on the topic is kept while it travels. Every store writer
 *  that bumps a topic goes through here; the same promise is returned. */
export function writing<T>(topic: string, p: Promise<T>): Promise<T> {
  bumpChange(topic);
  writesInFlight.set(topic, (writesInFlight.get(topic) ?? 0) + 1);
  const done = () => {
    writesInFlight.set(topic, Math.max(0, (writesInFlight.get(topic) ?? 1) - 1));
    bumpChange(topic);
  };
  p.then(done, done);
  return p;
}
