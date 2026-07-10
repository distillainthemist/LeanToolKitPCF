// The canonical LeanToolKit action — one schema for every tool that captures
// or displays actions. Multi-assignee actions keep per-assignee done flags on
// ONE action (views render a row per assignee); overdue is always derived
// from `due`, never stored.

import { newId, todayIso } from "./id";

export type ActionStatus = "open" | "in-progress" | "done" | "cancelled";

export const ACTION_STATUSES: ActionStatus[] = [
  "open",
  "in-progress",
  "done",
  "cancelled",
];

export interface Assignee {
  whoId: string;
  who: string;
  done: boolean;
}

export interface ActionComment {
  whoId: string;
  when: string; // yyyy-mm-dd
  text: string;
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
  due: string; // yyyy-mm-dd, "" = no due date
  status: ActionStatus;
  comments: ActionComment[];
  escalated: boolean;
  context: ActionContext;
}

export function newAction(context: ActionContext): LtkAction {
  return {
    id: newId("a"),
    instanceId: "",
    issue: "",
    description: "",
    assignees: [],
    due: "",
    status: "open",
    comments: [],
    escalated: false,
    context,
  };
}

function isStatus(v: unknown): v is ActionStatus {
  return (
    v === "open" || v === "in-progress" || v === "done" || v === "cancelled"
  );
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
          when: typeof c.when === "string" ? c.when : "",
          text: typeof c.text === "string" ? c.text : "",
        }))
        .filter((c) => c.text !== "")
    : [];
  const ctx = (a.context ?? {}) as Partial<ActionContext>;
  return {
    id: typeof a.id === "string" && a.id !== "" ? a.id : newId("a"),
    instanceId: typeof a.instanceId === "string" ? a.instanceId : "",
    issue: typeof a.issue === "string" ? a.issue : "",
    description: typeof a.description === "string" ? a.description : "",
    assignees,
    due: typeof a.due === "string" ? a.due : "",
    status: isStatus(a.status) ? a.status : "open",
    comments,
    escalated: a.escalated === true,
    context: {
      source: typeof ctx.source === "string" ? ctx.source : "",
      sourceId: typeof ctx.sourceId === "string" ? ctx.sourceId : "",
      hint: typeof ctx.hint === "string" ? ctx.hint : undefined,
    },
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
  return (
    a.due !== "" && a.due < today && a.status !== "done" && a.status !== "cancelled"
  );
}

/** Action fully done when every assignee has ticked off (or status says so). */
export function isComplete(a: LtkAction): boolean {
  if (a.status === "done") return true;
  return a.assignees.length > 0 && a.assignees.every((x) => x.done);
}
