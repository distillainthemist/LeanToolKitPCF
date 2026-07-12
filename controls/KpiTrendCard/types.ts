// KpiTrendCard document — a run chart of dated values with an optional target
// (a reference goal line) and optional specification limits (USL/LSL). A
// reading is flagged red only when it falls outside the spec limits.

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
  usl: number | null; // upper specification limit
  lsl: number | null; // lower specification limit
  unit: string;
}

export type KpiTrendEnvelope = Envelope<KpiTrendData>;

function parseData(data: unknown): KpiTrendData {
  if (!data || typeof data !== "object") {
    return { points: [], target: null, usl: null, lsl: null, unit: "" };
  }
  const d = data as {
    points?: unknown;
    target?: unknown;
    usl?: unknown;
    lsl?: unknown;
    ucl?: unknown; // legacy: control limits are read as spec limits
    lcl?: unknown;
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
    usl: num(d.usl ?? d.ucl),
    lsl: num(d.lsl ?? d.lcl),
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
