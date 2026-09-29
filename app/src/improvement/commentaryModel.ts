// Initiative commentary — the pure model (2026-09-29). An update is one
// "comment" event: High / Low / Next / Support needed. It can be EDITED
// by the initiative team: the same row is rewritten, stamped with who
// edited and when, and the earlier wording is kept behind "edited" (no
// update is ever deleted). Pure — the status band, the details pane, the
// priority popup and the tests share it.

export interface UpdateFields {
  high: string;
  low: string;
  next: string;
  support: string;
}

export interface UpdateVersion extends UpdateFields {
  who: string;
  at: string;
}

export interface Update extends UpdateFields {
  /** The event row's GUID ("" = not editable: no row to write to). */
  id: string;
  who: string;
  whoId: string;
  at: string;
  editedBy: string;
  editedAt: string;
  /** Earlier wordings, newest first. */
  previous: UpdateVersion[];
}

export const UPDATE_LABELS: [keyof UpdateFields, string, string][] = [
  ["high", "High", "What went well"],
  ["low", "Low", "What hurt"],
  ["next", "Next", "What happens next"],
  ["support", "Support needed", "What would unblock this"],
];

/** No update for this long and the band says so. */
export const STALE_DAYS = 14;
/** Earlier wordings kept per update. */
export const MAX_PREVIOUS = 10;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const fieldsOf = (d: Record<string, unknown>): UpdateFields => ({ high: str(d.high), low: str(d.low), next: str(d.next), support: str(d.support) });

interface EventLike {
  id?: string;
  kind: string;
  detail: Record<string, unknown>;
  actorId: string;
  actorName: string;
  at: string;
}

/** The commentary trail from an initiative's events, newest first. */
export function updatesFrom(events: EventLike[]): Update[] {
  return events
    .filter((e) => e.kind === "comment")
    .map((e) => ({
      ...fieldsOf(e.detail),
      id: e.id ?? "",
      who: e.actorName,
      whoId: e.actorId,
      at: e.at,
      editedBy: str(e.detail.editedBy),
      editedAt: str(e.detail.editedAt),
      previous: (Array.isArray(e.detail.previous) ? e.detail.previous : [])
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
        .map((p) => ({ ...fieldsOf(p), who: str(p.who), at: str(p.at) })),
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function trimFields(f: UpdateFields): UpdateFields {
  return { high: f.high.trim(), low: f.low.trim(), next: f.next.trim(), support: f.support.trim() };
}

export function isBlank(f: UpdateFields): boolean {
  const t = trimFields(f);
  return t.high === "" && t.low === "" && t.next === "" && t.support === "";
}

export function sameFields(a: UpdateFields, b: UpdateFields): boolean {
  const x = trimFields(a);
  const y = trimFields(b);
  return x.high === y.high && x.low === y.low && x.next === y.next && x.support === y.support;
}

/** The detail an edit writes: the new wording, who edited and when, and
 *  the wording it replaces pushed onto `previous` (capped). */
export function editedDetail(u: Update, next: UpdateFields, editor: string, now: string): Record<string, unknown> {
  const was: UpdateVersion = { high: u.high, low: u.low, next: u.next, support: u.support, who: u.editedBy !== "" ? u.editedBy : u.who, at: u.editedAt !== "" ? u.editedAt : u.at };
  return { ...trimFields(next), editedBy: editor, editedAt: now, previous: [was, ...u.previous].slice(0, MAX_PREVIOUS) };
}

const dayOf = (iso: string): number => {
  const d = iso.slice(0, 10);
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : NaN;
};

/** Whole days between two ISO dates (time of day ignored); 0 when either
 *  is unreadable. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = dayOf(fromIso);
  const b = dayOf(toIso);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
}

/** "today", "yesterday", "3 days ago", "5 weeks ago". */
export function ageLabel(atIso: string, todayIso: string): string {
  const d = daysBetween(atIso, todayIso);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 70) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/** Days since the last update when the commentary has gone stale, else
 *  null. `sinceIso` stands in when there is no update at all (the day the
 *  initiative started). */
export function staleDays(latestAtIso: string, sinceIso: string, todayIso: string): number | null {
  const from = latestAtIso !== "" ? latestAtIso : sinceIso;
  if (from === "") return null;
  const d = daysBetween(from, todayIso);
  return d >= STALE_DAYS ? d : null;
}
