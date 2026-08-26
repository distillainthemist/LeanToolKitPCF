// Where an initiative board was opened FROM (Ben, 2026-08-27): the
// board header's crumb returns there — the Improvement tab, or the
// Priorities tab with its overlay reopened. sessionStorage, same
// handoff pattern as ltk-pending-init-priority.

export interface BoardOrigin {
  hash: string;
  /** Set when the origin is a priority overlay — reopened on return. */
  priorityId?: string;
}

const KEY = "ltk-init-board-origin";
export const REOPEN_PRIORITY_KEY = "ltk-reopen-priority";

export function rememberBoardOrigin(hash: string, priorityId?: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ hash, ...(priorityId ? { priorityId } : {}) }));
  } catch {
    /* the crumb falls back to Improvement */
  }
}

export function boardOrigin(): BoardOrigin | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const o = JSON.parse(raw) as BoardOrigin;
    return typeof o.hash === "string" && o.hash.startsWith("#/") ? o : null;
  } catch {
    return null;
  }
}
