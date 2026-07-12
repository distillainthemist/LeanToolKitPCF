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

/**
 * Parse the `categories` setting (settings config): a JSON array or CSV /
 * newline-separated text of bone names. Empty / unparsable = [].
 */
export function parseCategoriesSetting(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  if (t.startsWith("[")) {
    try {
      const data = JSON.parse(t) as unknown;
      if (Array.isArray(data)) return dedupe(data);
    } catch {
      /* fall through to CSV */
    }
  }
  return dedupe(t.split(/[,\n]/));
}

function parseData(data: unknown, defaultCategories: string[]): FishboneData {
  const fallback = defaultCategories.length ? defaultCategories : DEFAULT_CATEGORIES;
  if (!data || typeof data !== "object") {
    return { problem: "", categories: fallback.slice(), causes: [] };
  }
  const d = data as { problem?: unknown; categories?: unknown; causes?: unknown };
  const categories = Array.isArray(d.categories) ? dedupe(d.categories) : [];
  return {
    problem: typeof d.problem === "string" ? d.problem : "",
    categories: categories.length ? categories : fallback.slice(),
    causes: parseCauses(d.causes),
  };
}

/** `defaultCategories` (the `categories` setting) seeds NEW / empty documents;
 *  a document that already names its bones keeps them. */
export function parseFishbone(
  raw: string | null | undefined,
  defaultCategories: string[] = []
): ParsedEnvelope<FishboneData> {
  return parseEnvelope(raw, SCHEMA_ID, (data) => parseData(data, defaultCategories));
}

export function serializeFishbone(env: FishboneEnvelope): string {
  return serializeEnvelope(env);
}
