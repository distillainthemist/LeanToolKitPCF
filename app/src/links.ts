// Shareable deep links. A ritual's link points at the "latest" token
// rather than a fixed occurrence, so a URL pasted into Teams or an email
// keeps opening the ritual's most recent meeting instead of going stale.
//
// Inside Power Apps the address bar shows the storage-proxy URL of the
// iframe the app runs in — it carries a per-publish token, so it dies at
// the next release and nobody else can open it. The link to share is the
// player URL, and because the player's fragment does not reach the app,
// the ritual travels as a launch parameter the host hands back through
// the SDK context (queryParams).

/** What a shareable player URL needs, plus the launch parameters the
 *  player passed in. Pushed in by runtime.ts once the host answers —
 *  this module pulls in nothing, so links stay testable without the SDK. */
export interface AppHost {
  appId: string;
  environmentId: string;
  tenantId: string;
  queryParams: Record<string, string>;
}

let host: AppHost | null = null;

export function setAppHost(info: AppHost | null): void {
  host = info;
}

/** Route token in place of an occurrence iso: resolve when the board opens. */
export const LATEST = "latest";

/** Player query parameter naming the ritual to open on launch. */
export const LAUNCH_PARAM = "ritual";

/** Player query parameter pinning one occurrence ("yyyy-mm-ddTHH:MM"). */
export const AT_PARAM = "at";

/** Where the Power Apps player lives (commercial cloud, region "prod"). */
const PLAYER = "https://apps.powerapps.com/play";

/** Route for a ritual: one occurrence when `iso` is given, else its latest. */
export function boardHash(boardId: string, iso = ""): string {
  const at = iso === "" ? LATEST : encodeURIComponent(iso);
  return `#/board/${boardId}/${at}`;
}

/** The absolute URL to paste elsewhere. */
export function boardUrl(boardId: string, iso = ""): string {
  if (!host || host.appId === "" || host.environmentId === "") {
    // dev server (or the context never answered): the page's own URL is
    // the only honest link we can offer
    return `${window.location.href.split("#")[0]}${boardHash(boardId, iso)}`;
  }
  const q = new URLSearchParams();
  if (host.tenantId !== "") q.set("tenantId", host.tenantId);
  q.set(LAUNCH_PARAM, boardId);
  if (iso !== "") q.set(AT_PARAM, iso);
  // the fragment is ignored by the player but honoured by any host that
  // does forward it, and it makes the link readable
  return (
    `${PLAYER}/e/${host.environmentId}/app/${host.appId}?${q.toString()}` +
    boardHash(boardId, iso)
  );
}

/**
 * The route a launch parameter asks for, "" when the app was opened
 * plainly. Reads the host's parameters, falling back to the iframe's own
 * query string for hosts that append them there.
 */
export function launchTarget(): string {
  const params = host?.queryParams ?? {};
  const search = typeof window === "undefined" ? "" : window.location.search;
  const query = new URLSearchParams(search);
  const param = (name: string): string => {
    const named = Object.entries(params).find(
      ([key]) => key.toLowerCase() === name
    );
    return ((named?.[1] ?? "").trim() || (query.get(name) ?? "").trim());
  };
  const boardId = param(LAUNCH_PARAM);
  return boardId === "" ? "" : boardHash(boardId, param(AT_PARAM));
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
