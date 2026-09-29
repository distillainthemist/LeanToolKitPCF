// Action endorsement (2026-09-30, Ben's decisions). On an initiative with
// endorsement ON, an action closed by anyone who is not an endorser — the
// initiative's owner, its sponsor, an admin — does not close: it WAITS
// (status "verify", shown as Closed with an "Awaiting endorsement"
// marker). An endorser endorses it (it closes, stamped who and when) or
// sends it back (it reopens, with a required reason). An endorser closing
// an action closes it directly. Actions closed before the switch went on
// are left as they are; single-action initiatives are exempt.
//
// ONE rule, applied at every save: the dialog and the tick apply it for
// an honest screen, the store applies it again as the backstop — so no
// closing road can skip it. Pure.

import { ActionStatus, LtkAction } from "./actions";

export interface EndorseContext {
  /** The action's initiative has endorsement on (and is not single-action). */
  on: boolean;
  /** The person saving may endorse: owner, sponsor or admin. */
  mine: boolean;
}

export interface Endorser {
  whoId: string;
  who: string;
}

export function awaitingEndorsement(a: Pick<LtkAction, "status">): boolean {
  return a.status === "verify";
}

const log = (a: LtkAction, kind: "verified" | "reopened", by: Endorser, when: string, reason: string) => {
  a.history = [...(a.history ?? []), { kind, whoId: by.whoId, who: by.who, when, reason }];
};

/** Endorse: the action closes, stamped. */
export function endorse(a: LtkAction, by: Endorser, nowIso: string): void {
  a.status = "done";
  a.pdca = "closed";
  for (const x of a.assignees) x.done = true;
  a.verified = { whoId: by.whoId, who: by.who, when: nowIso };
  log(a, "verified", by, nowIso, "");
}

/** Send back: the action reopens into Do, the reason on its history. */
export function sendBack(a: LtkAction, by: Endorser, nowIso: string, reason: string): void {
  a.status = "open";
  a.pdca = "do";
  for (const x of a.assignees) x.done = false;
  a.verified = undefined;
  log(a, "reopened", by, nowIso, reason.trim());
}

/** The rule at a save. `prior` is the status the action had before this
 *  save (null = it is new). Returns true when it changed the action.
 *  No context, or endorsement off: nothing is enforced (a board's
 *  voluntary Verify column keeps working as it did). */
export function applyEndorsementRule(a: LtkAction, prior: ActionStatus | null, ctx: EndorseContext | null, by: Endorser, nowIso: string): boolean {
  if (ctx === null || !ctx.on) return false;
  // an endorsement belongs to a closed action only
  if (a.status !== "done") {
    if (a.verified === undefined) return false;
    a.verified = undefined;
    return true;
  }
  // closed before this save (the switch may have come on since): left alone
  if (prior === "done") return false;
  if (ctx.mine) {
    // an endorser closing, or moving a waiting action to done, endorses it
    if (a.verified !== undefined && a.verified.whoId === by.whoId) return false;
    endorse(a, by, nowIso);
    return true;
  }
  // anyone else: it waits — and a waiting action cannot be closed by them
  a.status = "verify";
  a.pdca = "closed";
  a.verified = undefined;
  for (const x of a.assignees) x.done = true;
  return true;
}
