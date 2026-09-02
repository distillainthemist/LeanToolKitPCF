// Improvement — reading metric values off the initiative boards' KPI
// cards (P6c). The seeded KPI slots carry `settings.metric.key`; the live
// row's KpiTrend doc holds the charted points + target/limits. One boards
// read + one rows read cover every initiative; the result is a map the
// RAG rollups and the tab's metric column both use.

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
  rows: (CardRow & { boardId: string })[]
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
      const last = points.length > 0 ? points[points.length - 1].value : null;
      const reading: MetricReading = {
        last,
        // the in-card target wins (owners tune it there); the definition's
        // target is the fallback
        target: doc?.target ?? def?.target ?? null,
        usl: doc?.usl ?? null,
        lsl: doc?.lsl ?? null,
        goodDirection: def?.goodDirection ?? "up",
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
