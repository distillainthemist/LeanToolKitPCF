// The Documents tab's badge number, remembered between launches.
//
// The hub wants to say "3 things are waiting for you in Documents"
// without querying SharePoint on the landing path — the import gate
// keeps the documents chunk off that path deliberately, and a corpus
// sweep on every app open is a cost every user would pay whether or not
// they own a document.
//
// So the number is not computed twice: the Documents screen's OWN task
// selector (the one behind the panel badge — R7's single source) writes
// it here whenever it repaints, and the hub reads it back. Live while
// the app is open, remembered for the next launch.
//
// What that buys and what it does not: it reminds you of a backlog you
// have already seen. It cannot discover work that arrived since you
// last looked — that is what the Teams/Outlook notifications do, and
// they do it better than a badge could. Deliberately no SharePoint here.

const KEY = "ltk-doctasks";
/** Past this, a remembered count is too old to assert. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function rememberTaskCount(who: string, n: number): void {
  if (who === "") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ who, n, when: Date.now() }));
  } catch {
    /* storage unavailable — the badge simply starts blank */
  }
}

/** What this viewer last saw waiting; 0 when nothing is remembered, the
 *  record belongs to someone else, or it has aged out. */
export function readTaskCount(who: string): number {
  if (who === "") return 0;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 0;
    const o = JSON.parse(raw) as { who?: unknown; n?: unknown; when?: unknown };
    if (o.who !== who || typeof o.n !== "number" || o.n <= 0) return 0;
    if (typeof o.when === "number" && Date.now() - o.when > MAX_AGE_MS) return 0;
    return o.n;
  } catch {
    return 0;
  }
}

/** The tab's label for a count — one spelling, both callers. */
export function documentsTabLabel(n: number): string {
  return n > 0 ? `Documents · ${n}` : "Documents";
}
