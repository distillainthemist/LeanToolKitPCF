// Fishbone envelope — the LeanToolKit document for the Ishikawa diagram:
//   data: { problem, categories, causes: CauseNode[] }
// Causes use the shared cause model (category set, parentId null), so a
// fishbone's causes paste into a fault tree or five-whys and vice versa.
// A legacy Fishbone PCF combined blob ({problem, categories, causes}) has the
// same keys, so the bare-document fallback migrates it transparently.

import { CauseNode, parseCauses } from "../../shared/schema/causes";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";
import { DEFAULT_CATEGORIES } from "./model";

export const SCHEMA_ID = "ltk/fishbone@1";

export interface FishboneData {
  problem: string;
  categories: string[];
  causes: CauseNode[];
}

export type FishboneEnvelope = Envelope<FishboneData>;

function dedupe(names: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function parseData(data: unknown): FishboneData {
  if (!data || typeof data !== "object") {
    return { problem: "", categories: DEFAULT_CATEGORIES.slice(), causes: [] };
  }
  const d = data as { problem?: unknown; categories?: unknown; causes?: unknown };
  const categories = Array.isArray(d.categories) ? dedupe(d.categories) : [];
  return {
    problem: typeof d.problem === "string" ? d.problem : "",
    categories: categories.length ? categories : DEFAULT_CATEGORIES.slice(),
    causes: parseCauses(d.causes),
  };
}

export function parseFishbone(
  raw: string | null | undefined
): ParsedEnvelope<FishboneData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeFishbone(env: FishboneEnvelope): string {
  return serializeEnvelope(env);
}
