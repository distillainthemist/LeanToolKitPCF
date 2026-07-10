// HeatmapCard document — issues pinned onto a fixed image (a floor plan,
// machine photo, body map…). Pin coordinates are normalised 0..1 relative to
// the image so they survive any rendering size. The image itself comes from
// the `image` input property (data URI or URL), not the document.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/heatmap@1";

export interface HeatmapPin {
  id: string;
  x: number; // 0..1 across the image
  y: number; // 0..1 down the image
  note: string;
  severity: number; // 1 low, 2 medium, 3 high
}

export interface HeatmapData {
  pins: HeatmapPin[];
}

export type HeatmapEnvelope = Envelope<HeatmapData>;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function parseData(data: unknown): HeatmapData {
  if (!data || typeof data !== "object") return { pins: [] };
  const d = data as { pins?: unknown };
  const pins: HeatmapPin[] = [];
  if (Array.isArray(d.pins)) {
    for (const raw of d.pins) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<HeatmapPin>;
      const x = Number(o.x);
      const y = Number(o.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const severity = Number(o.severity);
      pins.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("h"),
        x: clamp01(x),
        y: clamp01(y),
        note: typeof o.note === "string" ? o.note : "",
        severity:
          Number.isFinite(severity) && severity >= 1 && severity <= 3
            ? Math.round(severity)
            : 2,
      });
    }
  }
  return { pins };
}

export function parseHeatmap(
  raw: string | null | undefined
): ParsedEnvelope<HeatmapData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeHeatmap(env: HeatmapEnvelope): string {
  return serializeEnvelope(env);
}
