// RiskMatrix document — risks framed as hazard / risk / impact / controls and
// rated likelihood × consequence on a named 5×5 matrix. Each cell resolves to
// a risk class (I–IV) via a fixed lookup (not a raw score band). An optional
// post-control (residual) rating shows the risk moving after treatment.
// Treatments are canonical actions on the actions channel.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/riskmatrix@1";

/** Likelihood 1..5 (row) labels, low → high. */
export const LIKELIHOOD_LABELS = [
  "Rare",
  "Unlikely",
  "Possible",
  "Likely",
  "Almost certain",
];

/** Consequence / severity 1..5 (column) labels, low → high. */
export const CONSEQUENCE_LABELS = [
  "Very low",
  "Low",
  "Moderate",
  "High",
  "Very high",
];

/** Class roman numerals, indexed by class 1..4. */
export const CLASS_ROMAN = ["", "I", "II", "III", "IV"];

/**
 * Risk-class lookup [likelihood-1][consequence-1] → class 1..4, matching the
 * reference framework (Class I green, II yellow, III orange, IV red).
 *   rows bottom→top: Rare, Unlikely, Possible, Likely, Almost certain
 *   cols left→right: Very low, Low, Moderate, High, Very high
 */
const CLASS_MATRIX: number[][] = [
  [1, 1, 2, 3, 3], // Rare
  [1, 1, 2, 3, 4], // Unlikely
  [1, 2, 3, 4, 4], // Possible
  [2, 3, 3, 4, 4], // Likely
  [2, 3, 4, 4, 4], // Almost certain
];

export interface Risk {
  id: string;
  hazard: string; // the source of harm
  risk: string; // what could happen (the risk event)
  impact: string; // the consequence if it happens
  controls: string; // controls in place
  likelihood: number; // 1..5
  consequence: number; // 1..5 (severity)
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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseData(data: unknown): RiskMatrixData {
  if (!data || typeof data !== "object") return { risks: [] };
  const d = data as { risks?: unknown };
  const risks: Risk[] = [];
  if (Array.isArray(d.risks)) {
    for (const raw of d.risks) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<Risk> & { text?: unknown };
      // migration: a legacy `text` becomes the risk description
      const risk = str(o.risk) || str(o.text);
      const hazard = str(o.hazard);
      if (risk === "" && hazard === "") continue;
      risks.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("r"),
        hazard,
        risk,
        impact: str(o.impact),
        controls: str(o.controls),
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

function clamp5(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** Risk class (1..4) for a likelihood × consequence cell. */
export function riskClass(l: number, c: number): number {
  return CLASS_MATRIX[clamp5(l) - 1][clamp5(c) - 1];
}

/** Colour-band index (0..3) for a cell — driven by its risk class. */
export function band(l: number, c: number): 0 | 1 | 2 | 3 {
  return (riskClass(l, c) - 1) as 0 | 1 | 2 | 3;
}

/** A short label for a risk (register title). */
export function riskLabel(r: Risk): string {
  return r.risk || r.hazard || "(untitled risk)";
}
