// A past meeting reopened for editing (scheduler kebab → Edit meeting)
// stays editable only while you remain inside that meeting's screens —
// board, card walk, per-meeting adjust. Leaving them (Home, Settings,
// another board) locks it closed again; the board screen's auto-close
// sweep spares the marked meeting so card navigation can't re-lock it
// mid-edit. sessionStorage scope means an abandoned tab simply falls
// back to the sweep on the next visit.
import { closeInstance, getInstance } from "./store/instances";

const KEY = "leanboard.reopened";
/** Meetings lock this long after their scheduled time — the ONE copy of
 *  the policy (the board sweep, read-only derivation and re-lock all
 *  import it). */
export const STALE_MS = 24 * 3_600_000;

/**
 * The product rule, derivable without a sweep: a meeting is read-only
 * when its record says closed OR it is more than STALE_MS past — except
 * the one meeting this session deliberately reopened for editing. Every
 * surface (card editor, adjust screen) derives from this, so a cold
 * deep link to a board nobody has visited (status still "open") is
 * still locked.
 */
export function effectivelyClosed(inst: {
  id: string;
  status: string;
  when: string;
}): boolean {
  if (inst.id === reopenedForEditId()) return false;
  return (
    inst.status === "closed" || Date.parse(inst.when) < Date.now() - STALE_MS
  );
}

export function markReopenedForEdit(instanceId: string): void {
  sessionStorage.setItem(KEY, instanceId);
}

export function reopenedForEditId(): string {
  return sessionStorage.getItem(KEY) ?? "";
}

/** True while the current hash is one of this board's meeting screens. */
export function insideMeeting(boardId: string): boolean {
  const h = window.location.hash;
  return (
    h.startsWith(`#/board/${boardId}`) ||
    h.startsWith(`#/edit/${boardId}/`) ||
    h.startsWith(`#/adjust/${boardId}/`)
  );
}

/** Screen-cleanup hook: re-lock the reopened meeting when truly leaving.
 *  Runs during route changes, so the close is fire-and-forget. */
export function relockOnLeave(boardId: string): void {
  if (insideMeeting(boardId)) return;
  const id = reopenedForEditId();
  if (id === "") return;
  sessionStorage.removeItem(KEY);
  void (async () => {
    try {
      const inst = await getInstance(id);
      if (
        inst &&
        inst.status === "open" &&
        Date.parse(inst.when) < Date.now() - STALE_MS
      ) {
        await closeInstance(inst);
      }
    } catch {
      /* the next board visit's sweep will close it */
    }
  })();
}
