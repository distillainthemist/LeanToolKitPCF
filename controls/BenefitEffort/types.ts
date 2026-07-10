// BenefitEffort document — items positioned on a benefit (y) × effort (x)
// canvas, both normalised 0..1. Priority order falls out of the quadrants:
// quick wins (high benefit, low effort) first.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/benefiteffort@1";

export interface BenefitEffortItem {
  id: string;
  text: string;
  benefit: number; // 0..1 (1 = high benefit)
  effort: number; // 0..1 (1 = high effort)
  priority: boolean; // flagged as an idea to take forward
}

export interface BenefitEffortData {
  items: BenefitEffortItem[];
}

export type BenefitEffortEnvelope = Envelope<BenefitEffortData>;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function parseData(data: unknown): BenefitEffortData {
  if (!data || typeof data !== "object") return { items: [] };
  const d = data as { items?: unknown };
  const items: BenefitEffortItem[] = [];
  if (Array.isArray(d.items)) {
    for (const raw of d.items) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as {
        id?: unknown;
        text?: unknown;
        benefit?: unknown;
        effort?: unknown;
        priority?: unknown;
      };
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (text === "") continue;
      const benefit = Number(o.benefit);
      const effort = Number(o.effort);
      items.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("b"),
        text,
        benefit: Number.isFinite(benefit) ? clamp01(benefit) : 0.5,
        effort: Number.isFinite(effort) ? clamp01(effort) : 0.5,
        priority: o.priority === true,
      });
    }
  }
  return { items };
}

export function parseBenefitEffort(
  raw: string | null | undefined
): ParsedEnvelope<BenefitEffortData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeBenefitEffort(env: BenefitEffortEnvelope): string {
  return serializeEnvelope(env);
}
