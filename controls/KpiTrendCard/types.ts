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
  direction: "up" | "down";
  unit: string;
}

export type KpiTrendEnvelope = Envelope<KpiTrendData>;

function parseData(data: unknown): KpiTrendData {
  if (!data || typeof data !== "object") {
    return { points: [], target: null, direction: "up", unit: "" };
  }
  const d = data as {
    points?: unknown;
    target?: unknown;
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
  const target = Number(d.target);
  return {
    points,
    target: Number.isFinite(target) ? target : null,
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
