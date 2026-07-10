// RiskMatrix document — risks rated likelihood × consequence on a 5×5
// matrix, with an optional post-control (residual) rating. Treatments are
// canonical actions on the actions channel.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/riskmatrix@1";

export interface Risk {
  id: string;
  text: string;
  likelihood: number; // 1..5
  consequence: number; // 1..5
  postLikelihood: number | null;
  postConsequence: number | null;
}

export interface RiskMatrixData {
  risks: Risk[];
}

export type RiskMatrixEnvelope = Envelope<RiskMatrixData>;

function rating(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
}

function parseData(data: unknown): RiskMatrixData {
  if (!data || typeof data !== "object") return { risks: [] };
  const d = data as { risks?: unknown };
  const risks: Risk[] = [];
  if (Array.isArray(d.risks)) {
    for (const raw of d.risks) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<Risk>;
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (text === "") continue;
      risks.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("r"),
        text,
        likelihood: rating(o.likelihood) ?? 3,
        consequence: rating(o.consequence) ?? 3,
        postLikelihood: rating(o.postLikelihood),
        postConsequence: rating(o.postConsequence),
      });
    }
  }
  return { risks };
}

export function parseRiskMatrix(
  raw: string | null | undefined
): ParsedEnvelope<RiskMatrixData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeRiskMatrix(env: RiskMatrixEnvelope): string {
  return serializeEnvelope(env);
}

/** Score band for a cell: low / medium / high / extreme. */
export function band(l: number, c: number): 0 | 1 | 2 | 3 {
  const score = l * c;
  if (score >= 15) return 3;
  if (score >= 10) return 2;
  if (score >= 5) return 1;
  return 0;
}
