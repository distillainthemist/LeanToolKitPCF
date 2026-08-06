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
let lastLaunchDebug = "launchTarget has not run";

/** What the boot saw (hash, host params, search) — diagnostics only. */
export function launchDebug(): string {
  return lastLaunchDebug;
}

export function setAppHost(info: AppHost | null): void {
  host = info;
}

/** Route token in place of an occurrence iso: resolve when the board opens. */
export const LATEST = "latest";

/** Player query parameter naming the ritual to open on launch. */
export const LAUNCH_PARAM = "ritual";

/** Player query parameter carrying a shared Documents view. It carries
 *  the view STATE itself — saved views are per person, so a link with an
 *  id would be dead for the recipient. */
export const DOCVIEW_PARAM = "docview";
let pendingDocView = "";

/** The docview payload the launch delivered — consumed once, by the
 *  Documents screen when it mounts. */
export function takePendingDocView(): string {
  const v = pendingDocView;
  pendingDocView = "";
  return v;
}

/** Non-consuming peek: the hub uses it to front its Documents tab, whose
 *  mount then consumes the payload. */
export function hasPendingDocView(): boolean {
  return pendingDocView !== "";
}

/** The absolute player URL for a Documents view (encoded via
 *  encodeDocView). Dev server: the page's own URL with the query param —
 *  launchTarget reads the iframe's own search string as its fallback. */
export function docsViewUrl(encoded: string): string {
  if (!host || host.appId === "" || host.environmentId === "") {
    const base = window.location.href.split("#")[0].split("?")[0];
    return `${base}?${DOCVIEW_PARAM}=${encodeURIComponent(encoded)}#/`;
  }
  const q = new URLSearchParams();
  if (host.tenantId !== "") q.set("tenantId", host.tenantId);
  q.set(DOCVIEW_PARAM, encoded);
  return `${PLAYER}/e/${host.environmentId}/app/${host.appId}?${q.toString()}#/`;
}

/** Player query parameter carrying ONE document (5I): `${listId}:${itemId}`.
 *  The link opens the app on the document overlay alone — preview up,
 *  details collapsed — the share-a-procedure permalink/QR target. */
export const DOC_PARAM = "ltkdoc";
let pendingDoc = "";

/** The document payload the launch delivered — consumed once by the
 *  Documents screen when it mounts. */
export function takePendingDoc(): string {
  const v = pendingDoc;
  pendingDoc = "";
  return v;
}

export function hasPendingDoc(): boolean {
  return pendingDoc !== "";
}

/** The last ltkdoc payload this session ACTED on — resume dedupe. */
let lastDocHandled = "";

/**
 * The resume trail (5I debugging, 2026-08-07): whether the mobile host
 * fires visibility events and refreshes launch parameters is only
 * observable ON the phone, and the kiosk blocks navigation — so every
 * resume step writes a line HERE, in localStorage, where Access
 * diagnostics can read it after a restart.
 */
export function logResume(entry: string): void {
  try {
    const key = "ltk-resume-log";
    const prior = (localStorage.getItem(key) ?? "").split("\n").filter((s) => s !== "");
    prior.push(`${new Date().toISOString().slice(11, 19)} ${entry}`);
    localStorage.setItem(key, prior.slice(-8).join("\n"));
  } catch {
    /* storage unavailable = no trail, nothing else breaks */
  }
}

export function readResumeLog(): string {
  try {
    return localStorage.getItem("ltk-resume-log") ?? "(empty)";
  } catch {
    return "(unavailable)";
  }
}

/**
 * A RESUMED deep link (5I): after refreshHostParams, does the host now
 * carry a document launch this session has not handled? True = the
 * payload is pending and the caller should route to the kiosk. Stale
 * parameters (the host re-reporting the boot's own scan) dedupe away.
 */
export function resumeDocLaunch(): boolean {
  const params = host?.queryParams ?? {};
  const named = Object.entries(params).find(([key]) => key.toLowerCase() === DOC_PARAM);
  const doc = (named?.[1] ?? "").trim();
  logResume(
    `resume check: params=[${Object.keys(params).join(",") || "none"}] doc="${doc.slice(-24)}" handled="${lastDocHandled.slice(-24)}"`
  );
  if (doc === "" || doc === lastDocHandled) return false;
  pendingDoc = doc;
  lastDocHandled = doc;
  logResume("→ routing to the kiosk");
  return true;
}

/** The absolute player URL for one document. */
export function docLinkUrl(listId: string, itemId: number): string {
  const payload = `${listId}:${itemId}`;
  if (!host || host.appId === "" || host.environmentId === "") {
    const base = window.location.href.split("#")[0].split("?")[0];
    return `${base}?${DOC_PARAM}=${encodeURIComponent(payload)}#/`;
  }
  const q = new URLSearchParams();
  if (host.tenantId !== "") q.set("tenantId", host.tenantId);
  q.set(DOC_PARAM, payload);
  return `${PLAYER}/e/${host.environmentId}/app/${host.appId}?${q.toString()}#/`;
}

/**
 * The POWER APPS MOBILE deep link for one document ("" when the host
 * never answered). A scanned https player URL opens the phone's
 * BROWSER (the web interface, Ben 2026-08-07); the documented
 * ms-apps scheme opens Power Apps mobile directly, launch parameters
 * intact — the right payload for a QR that lives on a printed
 * procedure. Needs the mobile app installed.
 */
export function docLinkUrlMobile(listId: string, itemId: number): string {
  if (!host || host.appId === "") return "";
  const q = new URLSearchParams();
  if (host.tenantId !== "") q.set("tenantId", host.tenantId);
  q.set(DOC_PARAM, `${listId}:${itemId}`);
  return `ms-apps:///providers/Microsoft.PowerApps/apps/${host.appId}?${q.toString()}`;
}

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
  // the mobile deep-link mystery kit (2026-08-07): WHAT this boot
  // actually saw, replayed by Access diagnostics — a phone scan that
  // lands on the hub instead of the kiosk is diagnosed from this line
  // ltkdoc's DELIVERY CHANNEL is the diagnosis (measured 2026-08-07:
  // mobile hands parameters in the webview URL at boot, never in the
  // SDK context — which is why a warm re-scan cannot reach a running
  // app: a foregrounded page's URL is immutable)
  const inHost = Object.keys(params).some((k) => k.toLowerCase() === DOC_PARAM);
  const inSearch = new URLSearchParams(search).get(DOC_PARAM) !== null;
  lastLaunchDebug =
    `hash="${typeof window === "undefined" ? "" : window.location.hash.slice(0, 40)}" ` +
    `hostParams=[${Object.keys(params).join(", ") || "none"}] ` +
    `ltkdoc=${inHost ? "host" : inSearch ? "search" : "absent"}`;
  const query = new URLSearchParams(search);
  const param = (name: string): string => {
    const named = Object.entries(params).find(
      ([key]) => key.toLowerCase() === name
    );
    return ((named?.[1] ?? "").trim() || (query.get(name) ?? "").trim());
  };
  const dv = param(DOCVIEW_PARAM);
  if (dv !== "") {
    pendingDocView = dv;
    // land on the hub — its Documents tab fronts itself and consumes the
    // payload (the standalone #/docs page has no app chrome around it)
    return "#/";
  }
  const doc = param(DOC_PARAM);
  if (doc !== "") {
    pendingDoc = doc;
    lastDocHandled = doc;
    // the KIOSK route (5I): only the document, no app chrome — a
    // scanned code in the field reads a procedure, nothing else
    return "#/doc";
  }
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
