// Shareable deep links. A ritual's link points at the "latest" token
// rather than a fixed occurrence, so a URL pasted into Teams or an email
// keeps opening the ritual's most recent meeting instead of going stale.

/** Route token in place of an occurrence iso: resolve when the board opens. */
export const LATEST = "latest";

export function boardHash(boardId: string): string {
  return `#/board/${boardId}/${LATEST}`;
}

/** The absolute URL to paste elsewhere (host page + the ritual's hash). */
export function boardUrl(boardId: string): string {
  return `${window.location.href.split("#")[0]}${boardHash(boardId)}`;
}

/**
 * The occurrence a "latest" link lands on: the most recent record at or
 * before now, otherwise the next one ahead (a ritual whose first meeting
 * is still to come). "" when the ritual has no records at all — the board
 * then opens with the schedule showing, which is the only way to start one.
 */
export function latestInstanceIso(
  instances: { when: string }[],
  now: number = Date.now()
): string {
  let past = Number.NEGATIVE_INFINITY;
  let future = Number.POSITIVE_INFINITY;
  let pick = "";
  let ahead = "";
  for (const inst of instances) {
    const t = Date.parse(inst.when);
    if (Number.isNaN(t)) continue;
    if (t <= now) {
      if (t > past) {
        past = t;
        pick = inst.when;
      }
    } else if (t < future) {
      future = t;
      ahead = inst.when;
    }
  }
  const when = pick !== "" ? pick : ahead;
  return when === "" ? "" : when.slice(0, 16);
}
