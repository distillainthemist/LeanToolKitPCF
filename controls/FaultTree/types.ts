// FaultTree data model — the same shared CauseNode tree as FiveWhys (a cause
// is a node; here parentId forms an arbitrary branching tree under one top
// event). Because the shape matches, a five-whys document pastes straight
// into a fault tree and vice versa. gate/probability fields are reserved on
// CauseNode for the future detailed mode.

import { CauseNode, parseCauses } from "../../shared/schema/causes";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/faulttree@1";

export interface FaultTreeData {
  problem: string;
  causes: CauseNode[];
}

export type FaultTreeEnvelope = Envelope<FaultTreeData>;

function parseData(data: unknown): FaultTreeData {
  if (!data || typeof data !== "object") {
    return { problem: "", causes: [] };
  }
  const d = data as { problem?: unknown; causes?: unknown };
  return {
    problem: typeof d.problem === "string" ? d.problem : "",
    causes: parseCauses(d.causes),
  };
}

/** Parse the card document; legacy embedded actions come back separately. */
export function parseFaultTree(
  raw: string | null | undefined
): ParsedEnvelope<FaultTreeData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeFaultTree(env: FaultTreeEnvelope): string {
  return serializeEnvelope(env);
}
