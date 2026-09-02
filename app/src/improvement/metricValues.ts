// Improvement — reading metric values off the initiative boards' KPI
// cards (P6c). The seeded KPI slots carry `settings.metric.key`; the live
// row's KpiTrend doc holds the charted points + target/limits. One boards
// read + one rows read cover every initiative; the result is a map the
// RAG rollups and the tab's metric column both use.

import { directionOf } from "./templateModel";
import { parseKpiTrend } from "../../../controls/KpiTrendCard/types";
import { parseManifest } from "../store/mappers";
import type { BoardSummary } from "../store/mappers";
import type { CardRow } from "../store/cards";
import { Initiative, MetricReading, metricRag, worstMetricRag } from "./initiativeModel";

export interface MetricValue {
  key: string;
  name: string;
  unit: string;
  last: number | null;
  target: number | null;
  rag: "green" | "amber" | "red" | null;
}

export interface InitiativeMetricState {
  values: MetricValue[];
  rag: "green" | "amber" | "red" | null;
}

export function buildMetricState(
  initiatives: Initiative[],
  boards: Pick<BoardSummary, "boardId" | "manifestRaw">[],
  rows: (CardRow & { boardId: string })[],
  /** Last recorded value per DRIVER — a driver-linked metric's points live
   *  on the driver's series, not the card's doc (metric rework). */
  driverLast: Map<string, number | null> = new Map()
): Map<string, InitiativeMetricState> {
  const byBoard = new Map(boards.map((b) => [b.boardId, b]));
  const rowByCard = new Map(rows.map((r) => [`${r.boardId}|${r.cardId}`, r]));
  const out = new Map<string, InitiativeMetricState>();
  for (const i of initiatives) {
    if (i.boardId === "") continue;
    const board = byBoard.get(i.boardId);
    if (!board) continue;
    const values: MetricValue[] = [];
    for (const slot of parseManifest(board.manifestRaw).slots) {
      if (slot.cardType !== "KpiTrendCard") continue;
      const metricCfg = (slot.settings.metric ?? {}) as Record<string, unknown>;
      const key = typeof metricCfg.key === "string" ? metricCfg.key : "";
      if (key === "") continue;
      const def = i.metrics.find((m) => m.key === key) ?? null;
      const row = rowByCard.get(`${i.boardId}|${slot.cardId}`);
      const doc = row ? parseKpiTrend(row.outputJson).envelope.data : null;
      const points = doc?.points ?? [];
      const last =
        def?.driverId && def.driverLink !== "leads" && driverLast.has(def.driverId)
          ? (driverLast.get(def.driverId) ?? null)
          : points.length > 0
            ? points[points.length - 1].value
            : null;
      const reading: MetricReading = {
        last,
        // the in-card target wins (owners tune it there); the definition's
        // target is the fallback
        target: doc?.target ?? def?.target ?? null,
        usl: doc?.usl ?? def?.usl ?? null,
        lsl: doc?.lsl ?? def?.lsl ?? null,
        goodDirection: def ? directionOf(def) : "up",
      };
      values.push({
        key,
        name: def?.name ?? slot.title,
        unit: def?.unit ?? doc?.unit ?? "",
        last,
        target: reading.target,
        rag: metricRag(reading),
      });
    }
    // ★ primary first — the register, tiles and roll-up read values[0]
    const primaryKey = i.metrics.find((m) => m.primary === true)?.key ?? i.metrics[0]?.key ?? "";
    values.sort((a, b) => (a.key === primaryKey ? -1 : b.key === primaryKey ? 1 : 0));
    out.set(i.id, { values, rag: worstMetricRag(values.map((v) => v.rag)) });
  }
  return out;
}

/** The last recorded point per driver the initiatives' metrics DRIVE —
 *  one wide read per driver (few, small). */
export async function loadDriverLasts(initiatives: Initiative[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(initiatives.flatMap((i) => i.metrics.filter((m) => m.driverId && m.driverLink !== "leads").map((m) => m.driverId as string)))];
  if (ids.length === 0) return new Map();
  const { listDriverPoints } = await import("../store/driverSeries");
  const got = await Promise.all(ids.map((id) => listDriverPoints(id, "1900-01-01", "2999-12-31").catch(() => [])));
  return new Map(ids.map((id, k) => {
    const pts = got[k];
    return [id, pts.length > 0 ? pts[pts.length - 1].value : null];
  }));
}
