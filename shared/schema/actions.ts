// The canonical LeanToolKit action — one schema for every tool that captures
// or displays actions. Multi-assignee actions keep per-assignee done flags on
// ONE action (views render a row per assignee); overdue is always derived
// from `due`, never stored.

import { newId, todayIso } from "./id";

// "verify" (cascade/improvement P0, 2026-08-19): the assignee has finished
// but the initiative owner has not yet endorsed the completion — an
// initiative-level switch routes done → verify. Counts as NOT done for
// overdue purposes and as open work for the assignee's rollups.
export type ActionStatus = "open" | "in-progress" | "verify" | "done" | "cancelled";

export const ACTION_STATUSES: ActionStatus[] = [
  "open",
  "in-progress",
  "verify",
  "done",
  "cancelled",
];

/** One entry of an action's history: a due date moved out, a stop or a
 *  cancel — with the reason the brief requires (decision 6). */
export interface ActionHistoryEntry {
  kind: "rescheduled" | "cancelled" | "stopped" | "verified" | "reopened";
  whoId: string;
  who: string;
  when: string; // ISO timestamp
  from?: string; // rescheduled: previous due (yyyy-mm-dd)
  to?: string; // rescheduled: new due
  reason: string;
}

/** The initiative owner's endorsement of a completed action. */
export interface Verification {
  whoId: string;
  who: string;
  when: string; // ISO timestamp
}

export interface Assignee {
  whoId: string;
  who: string;
  done: boolean;
}

export interface ActionComment {
  whoId: string;
  who?: string;
  when: string; // yyyy-mm-dd
  text: string;
}

/** Receiving-board sign-off on an escalated action (EscalationViewer). */
export interface Acknowledgement {
  whoId: string;
  who: string;
  when: string; // ISO timestamp
}

/** Where an action came from, for provenance and in-component placement. */
export interface ActionContext {
  source: string; // component kind, e.g. "fivewhys"
  sourceId: string; // id of the element it hangs off, e.g. a cause id
  hint?: string; // free placement/visualisation hint
}

export interface LtkAction {
  id: string;
  /** The owning card instance — the lookup key into a central actions table. */
  instanceId: string;
  issue: string;
  description: string;
  assignees: Assignee[];
  start: string; // yyyy-mm-dd, "" = no start date (optional; used by Gantt)
  due: string; // yyyy-mm-dd, "" = no due date
  status: ActionStatus;
  comments: ActionComment[];
  escalated: boolean;
  /** Set when the receiving board acknowledges the escalation. */
  acknowledged?: Acknowledgement;
  context: ActionContext;
  /** Reschedule / stop / cancel / verify history (P0). Absent = none. */
  history?: ActionHistoryEntry[];
  /** The owner's endorsement once status left "verify" for "done". */
  verified?: Verification;
  /** The improvement initiative this action belongs to ("" = none). */
  initiativeId?: string;
}

export function newAction(context: ActionContext): LtkAction {
  return {
    id: newId("a"),
    instanceId: "",
    issue: "",
    description: "",
    assignees: [],
    start: "",
    due: "",
    status: "open",
    comments: [],
    escalated: false,
    context,
  };
}

function isStatus(v: unknown): v is ActionStatus {
  return (
    v === "open" ||
    v === "in-progress" ||
    v === "verify" ||
    v === "done" ||
    v === "cancelled"
  );
}

const HISTORY_KINDS = new Set(["rescheduled", "cancelled", "stopped", "verified", "reopened"]);

function sanitizeHistory(raw: unknown): ActionHistoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ActionHistoryEntry[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const o = h as Partial<ActionHistoryEntry>;
    if (typeof o.kind !== "string" || !HISTORY_KINDS.has(o.kind)) continue;
    if (typeof o.when !== "string" || o.when === "") continue;
    out.push({
      kind: o.kind as ActionHistoryEntry["kind"],
      whoId: typeof o.whoId === "string" ? o.whoId : "",
      who: typeof o.who === "string" ? o.who : "",
      when: o.when,
      from: typeof o.from === "string" ? o.from : undefined,
      to: typeof o.to === "string" ? o.to : undefined,
      reason: typeof o.reason === "string" ? o.reason : "",
    });
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeAction(a: Partial<LtkAction>): LtkAction {
  const assignees: Assignee[] = Array.isArray(a.assignees)
    ? a.assignees
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          whoId: typeof x.whoId === "string" ? x.whoId : "",
          who: typeof x.who === "string" ? x.who : "",
          done: x.done === true,
        }))
        .filter((x) => x.who !== "" || x.whoId !== "")
    : [];
  const comments: ActionComment[] = Array.isArray(a.comments)
    ? a.comments
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          whoId: typeof c.whoId === "string" ? c.whoId : "",
          who: typeof c.who === "string" ? c.who : undefined,
          when: typeof c.when === "string" ? c.when : "",
          text: typeof c.text === "string" ? c.text : "",
        }))
        .filter((c) => c.text !== "")
    : [];
  const ackRaw = (a.acknowledged ?? null) as Partial<Acknowledgement> | null;
  const acknowledged: Acknowledgement | undefined =
    ackRaw && typeof ackRaw === "object" && typeof ackRaw.when === "string" && ackRaw.when !== ""
      ? {
          whoId: typeof ackRaw.whoId === "string" ? ackRaw.whoId : "",
          who: typeof ackRaw.who === "string" ? ackRaw.who : "",
          when: ackRaw.when,
        }
      : undefined;
  const ctx = (a.context ?? {}) as Partial<ActionContext>;
  const verRaw = (a.verified ?? null) as Partial<Verification> | null;
  const verified: Verification | undefined =
    verRaw && typeof verRaw === "object" && typeof verRaw.when === "string" && verRaw.when !== ""
      ? {
          whoId: typeof verRaw.whoId === "string" ? verRaw.whoId : "",
          who: typeof verRaw.who === "string" ? verRaw.who : "",
          when: verRaw.when,
        }
      : undefined;
  const history = sanitizeHistory(a.history);
  const initiativeId =
    typeof a.initiativeId === "string" && a.initiativeId !== "" ? a.initiativeId : undefined;
  return {
    id: typeof a.id === "string" && a.id !== "" ? a.id : newId("a"),
    instanceId: typeof a.instanceId === "string" ? a.instanceId : "",
    issue: typeof a.issue === "string" ? a.issue : "",
    description: typeof a.description === "string" ? a.description : "",
    assignees,
    start: typeof a.start === "string" ? a.start : "",
    due: typeof a.due === "string" ? a.due : "",
    status: isStatus(a.status) ? a.status : "open",
    comments,
    escalated: a.escalated === true,
    acknowledged,
    context: {
      source: typeof ctx.source === "string" ? ctx.source : "",
      sourceId: typeof ctx.sourceId === "string" ? ctx.sourceId : "",
      hint: typeof ctx.hint === "string" ? ctx.hint : undefined,
    },
    ...(history ? { history } : {}),
    ...(verified ? { verified } : {}),
    ...(initiativeId ? { initiativeId } : {}),
  };
}

/** Parse an actions array defensively; never throws. */
export function parseActions(data: unknown): LtkAction[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((a) => a && typeof a === "object")
    .map((a) => sanitizeAction(a as Partial<LtkAction>));
}

/** Parse an actionsInputJSON string defensively; never throws. */
export function parseActionsJson(raw: string | null | undefined): LtkAction[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    return parseActions(JSON.parse(t));
  } catch {
    return [];
  }
}

/**
 * Serialize the actions channel. When a non-empty instanceId is given, every
 * action is stamped with it, so the app can upsert into the central table
 * keyed by (instanceId, action id).
 */
export function serializeActions(
  actions: LtkAction[],
  instanceId?: string
): string {
  const out =
    instanceId !== undefined && instanceId !== ""
      ? actions.map((a) => ({ ...a, instanceId }))
      : actions;
  return JSON.stringify(out);
}

/** Overdue is derived: due in the past and the action still open. */
export function isOverdue(a: LtkAction, today = todayIso()): boolean {
  // "verify" is finished work awaiting endorsement — the assignee's part is
  // done, so it is not overdue (it is the owner's queue, not theirs)
  return (
    a.due !== "" &&
    a.due < today &&
    a.status !== "done" &&
    a.status !== "verify" &&
    a.status !== "cancelled"
  );
}

/** Action fully done when every assignee has ticked off (or status says so). */
export function isComplete(a: LtkAction): boolean {
  if (a.status === "done") return true;
  return a.assignees.length > 0 && a.assignees.every((x) => x.done);
}
