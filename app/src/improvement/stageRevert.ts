// Initiative stages — going BACK (2026-09-29, Ben's decisions): a waiting
// gate request can be withdrawn; a declined one requested again; and an
// initiative reverted to ANY earlier stage (a completed one reopened into
// a stage) by its owner, its sponsor or an admin, with a required reason
// and no approval. Moving forward again passes each gate afresh. Card
// content, gate snapshots and history are left alone — a revert is one
// more entry in the log. Pure: the board, the band and the tests share it.

import type { Initiative } from "./initiativeModel";

type StageI = Pick<Initiative, "snapshot" | "stageId" | "status" | "singleAction" | "gate" | "stageTargets">;

export interface RevertTarget {
  id: string;
  name: string;
  /** 0-based position in the stage list. */
  index: number;
}

/** Where the initiative stands in its stage list; a completed one stands
 *  past the last stage. */
export function currentIndex(i: Pick<Initiative, "snapshot" | "stageId" | "status">): number {
  const stages = i.snapshot.stages;
  if (i.status === "completed") return stages.length;
  return Math.max(0, stages.findIndex((s) => s.id === i.stageId));
}

/** The stages an initiative can go back to: every one before where it
 *  stands — so a completed initiative can reopen into any stage, its last
 *  included. None for an archived or single-action initiative. */
export function revertTargets(i: StageI): RevertTarget[] {
  if (i.singleAction || i.status === "archived") return [];
  const at = currentIndex(i);
  return i.snapshot.stages.slice(0, at).map((s, index) => ({ id: s.id, name: s.name, index }));
}

export interface StageViewer {
  whoId: string;
  isAdmin: boolean;
  /** Everyone who may act as owner / sponsor on this initiative. */
  ownerIds: string[];
  sponsorIds: string[];
}

/** Owner, sponsor or an admin — and there is somewhere to go back to. */
export function mayRevert(i: StageI, v: StageViewer): boolean {
  if (revertTargets(i).length === 0 || v.whoId === "") return false;
  return v.isAdmin || v.ownerIds.includes(v.whoId) || v.sponsorIds.includes(v.whoId);
}

/** Whoever requested the gate, the owner, or an admin. */
export function mayWithdraw(i: Pick<Initiative, "gate" | "status">, v: StageViewer): boolean {
  if (i.gate === null || i.status !== "active" || v.whoId === "") return false;
  return v.isAdmin || i.gate.requestedById === v.whoId || v.ownerIds.includes(v.whoId);
}

/** Has any approver declined the waiting gate? */
export function gateDeclined(i: Pick<Initiative, "gate">): boolean {
  const g = i.gate;
  return g !== null && g.approverRoles.some((r) => g.decisions[r] !== undefined && !g.decisions[r].approved);
}

/** The approver roles whose sign-off a revert undoes: every enabled gate
 *  from the stage returned to up to where the initiative stands (the
 *  completion gate included when it is complete). These people are told. */
export function undoneApproverRoles(i: StageI, toStageId: string): string[] {
  const stages = i.snapshot.stages;
  const to = stages.findIndex((s) => s.id === toStageId);
  if (to < 0) return [];
  const at = currentIndex(i);
  const roles = new Set<string>();
  for (let n = to; n < at; n++) {
    const last = n === stages.length - 1;
    const gate = last ? i.snapshot.completeGate : stages[n].gate;
    if (gate.enabled) for (const r of gate.approverRoles) roles.add(r);
  }
  return [...roles];
}

/** Move the initiative back. Returns the names either side for the log,
 *  or null when the stage is not one it can go back to. A waiting gate
 *  request goes with it; an optional new target date replaces the stage's
 *  own (the others keep theirs). */
export function applyRevert(i: StageI, toStageId: string, newTarget: string): { from: string; to: string } | null {
  const target = revertTargets(i).find((t) => t.id === toStageId);
  if (!target) return null;
  const from = i.status === "completed" ? "Complete" : (i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? i.stageId);
  i.status = "active";
  i.stageId = target.id;
  i.gate = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(newTarget)) i.stageTargets = { ...i.stageTargets, [target.id]: newTarget };
  return { from, to: target.name };
}

interface EventLike {
  kind: string;
  detail: Record<string, unknown>;
  actorName: string;
  at: string;
}

export interface LastRevert {
  from: string;
  to: string;
  who: string;
  at: string;
  reason: string;
}

/** The revert the initiative is still standing on: its most recent stage
 *  move, when that move was a revert. A later move forward clears it.
 *  `events` in any order. */
export function standingRevert(events: EventLike[]): LastRevert | null {
  const moves = events.filter((e) => e.kind === "stagemove").sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const last = moves[0];
  if (!last || last.detail.revert !== true) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return { from: s(last.detail.from), to: s(last.detail.to), who: last.actorName, at: last.at, reason: s(last.detail.comment) };
}
