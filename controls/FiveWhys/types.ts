// FiveWhys data model — chains of shared CauseNodes. A chain starts at a
// top-level cause (parentId null) and follows parentId links; the last cause
// in a chain can be marked isRoot (the root cause). Uses the toolkit
// envelope: { schema: "ltk/fivewhys@1", meta, data: {problem, causes}, actions }.

import {
  CauseNode,
  chainFrom,
  parseCauses,
} from "../../shared/schema/causes";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/fivewhys@1";

export interface FiveWhysData {
  problem: string;
  causes: CauseNode[];
}

export type FiveWhysEnvelope = Envelope<FiveWhysData>;

function parseData(data: unknown): FiveWhysData {
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
export function parseFiveWhys(
  raw: string | null | undefined
): ParsedEnvelope<FiveWhysData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeFiveWhys(env: FiveWhysEnvelope): string {
  return serializeEnvelope(env);
}

/** The ordered chains: one per top-level cause, each following parentId. */
export function chains(data: FiveWhysData): CauseNode[][] {
  return data.causes
    .filter((c) => c.parentId === null)
    .map((start) => chainFrom(data.causes, start.id));
}
