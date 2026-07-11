// The shared cause model for every RCA tool: a cause is a node, and the tools
// differ only in how nodes are arranged —
//   fishbone   = depth-1 nodes grouped by `category`
//   five whys  = linear chains via `parentId` (isRoot marks the chain's answer)
//   fault tree = arbitrary tree via `parentId` (gate/probability reserved)

import { newId } from "./id";

export type CauseStatus = "Hypothesis" | "Confirmed" | "Rejected";

export const CAUSE_STATUSES: CauseStatus[] = [
  "Hypothesis",
  "Confirmed",
  "Rejected",
];

/** Hard cap on a cause description's length (Fishbone convention, kept). */
export const MAX_CAUSE_CHARS = 140;

export interface CauseNode {
  id: string;
  text: string;
  status: CauseStatus;
  votes: number;
  isRoot: boolean; // selected as a root cause
  category: string; // fishbone bone name; "" elsewhere
  parentId: string | null; // tree/chain parent; null = top level
  gate?: "and" | "or"; // reserved: detailed fault tree
  probability?: number; // reserved: detailed fault tree
}

export function newCause(partial: Partial<CauseNode> = {}): CauseNode {
  return sanitizeCause({ id: newId("c"), ...partial });
}

function isStatus(v: unknown): v is CauseStatus {
  return v === "Hypothesis" || v === "Confirmed" || v === "Rejected";
}

export function sanitizeCause(c: Partial<CauseNode>): CauseNode {
  const votes = Number(c.votes);
  const prob = Number(c.probability);
  const gate = typeof c.gate === "string" ? c.gate.toLowerCase() : "";
  return {
    id: typeof c.id === "string" && c.id !== "" ? c.id : newId("c"),
    text: typeof c.text === "string" ? c.text.slice(0, MAX_CAUSE_CHARS) : "",
    status: isStatus(c.status) ? c.status : "Hypothesis",
    votes: Number.isFinite(votes) ? Math.max(0, Math.round(votes)) : 0,
    isRoot: c.isRoot === true,
    category: typeof c.category === "string" ? c.category : "",
    parentId:
      typeof c.parentId === "string" && c.parentId !== "" ? c.parentId : null,
    gate: gate === "and" || gate === "or" ? gate : undefined,
    probability: Number.isFinite(prob)
      ? Math.max(0, Math.min(1, prob))
      : undefined,
  };
}

/** Parse a causes array defensively; never throws. */
export function parseCauses(data: unknown): CauseNode[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((c) => c && typeof c === "object")
    .map((c) => sanitizeCause(c as Partial<CauseNode>));
}

export function childrenOf(causes: CauseNode[], parentId: string | null): CauseNode[] {
  return causes.filter((c) => c.parentId === parentId);
}

/**
 * Follow a linear chain from a starting cause (five-whys shape). Stops on a
 * cycle or after `max` hops, so malformed data cannot hang the render.
 */
export function chainFrom(causes: CauseNode[], startId: string, max = 25): CauseNode[] {
  const out: CauseNode[] = [];
  const seen = new Set<string>();
  let current = causes.find((c) => c.id === startId);
  while (current && !seen.has(current.id) && out.length < max) {
    out.push(current);
    seen.add(current.id);
    const id: string = current.id;
    current = causes.find((c) => c.parentId === id);
  }
  return out;
}

/** All descendants of a cause (fault-tree delete/collapse helper). */
export function descendantsOf(causes: CauseNode[], id: string): CauseNode[] {
  const out: CauseNode[] = [];
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    if (seen.has(parent)) continue;
    seen.add(parent);
    for (const c of causes) {
      if (c.parentId === parent) {
        out.push(c);
        queue.push(c.id);
      }
    }
  }
  return out;
}
