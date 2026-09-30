// Writes in flight (2026-10-01). A screen that reads what another screen
// just wrote must not read before the write lands: the focused card view
// saves on a debounce and the board mounted and read its rows while the
// save was still travelling, so the overview showed the card one edit
// behind. Writers `track` their promise; a mounting screen awaits
// `whenSettled` before it reads. Pure bookkeeping.

const inflight = new Set<Promise<unknown>>();

/** Register a write; the same promise is returned. */
export function track<T>(p: Promise<T>): Promise<T> {
  inflight.add(p);
  const done = () => inflight.delete(p);
  p.then(done, done);
  return p;
}

/** Resolves once every write registered so far has settled (a write that
 *  starts while waiting is waited for too). Never rejects. */
export async function whenSettled(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}

/** How many writes are travelling (tests, diagnostics). */
export function inflightCount(): number {
  return inflight.size;
}
