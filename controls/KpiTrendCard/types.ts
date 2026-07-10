// KpiTrendCard document — a run chart of dated values with an optional
// target. `direction` says which side of the target is good ("up" = higher
// is better). The latest point drives the RAG readout.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/kpitrend@1";

export interface KpiPoint {
  date: string; // yyyy-mm-dd
  value: number;
}

export interface KpiTrendData {
  points: KpiPoint[];
  target: number | null;
  ucl: number | null; // upper control limit
  lcl: number | null; // lower control limit
  direction: "up" | "down";
  unit: string;
}

export type KpiTrendEnvelope = Envelope<KpiTrendData>;

function parseData(data: unknown): KpiTrendData {
  if (!data || typeof data !== "object") {
    return { points: [], target: null, ucl: null, lcl: null, direction: "up", unit: "" };
  }
  const d = data as {
    points?: unknown;
    target?: unknown;
    ucl?: unknown;
    lcl?: unknown;
    direction?: unknown;
    unit?: unknown;
  };
  const points: KpiPoint[] = [];
  if (Array.isArray(d.points)) {
    for (const raw of d.points) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as { date?: unknown; value?: unknown };
      const value = Number(o.value);
      if (typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number.isFinite(value)) {
        points.push({ date: o.date, value });
      }
    }
  }
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    points,
    target: num(d.target),
    ucl: num(d.ucl),
    lcl: num(d.lcl),
    direction: d.direction === "down" ? "down" : "up",
    unit: typeof d.unit === "string" ? d.unit : "",
  };
}

export function parseKpiTrend(
  raw: string | null | undefined
): ParsedEnvelope<KpiTrendData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeKpiTrend(env: KpiTrendEnvelope): string {
  return serializeEnvelope(env);
}
