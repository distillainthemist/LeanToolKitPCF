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
import { EMPTY_SPEC_SERIES, specFor, SpecSeries } from "../../../shared/schema/specSeries";
import { metricLocation, trackingDisplay } from "./metricLocation";
import type { DriverNode } from "./vdt/model";

/** A metric's last reading + its spec history (grid entry: per-period
 *  targets carry forward, so the RAG reads the spec in force on the
 *  reading's date). Keyed by `<initiativeId>|<metricKey>` (and, for
 *  driver-linked metrics, by the driver id as well). */
export interface DriverLast {
  last: number | null;
  /** The raw stored value (good/bad and picklist metrics). */
  raw: string;
  date: string;
  spec: SpecSeries;
  /** A good / bad or picklist DRIVER's reading as label + state. */
  display?: { label: string; rag: "green" | "amber" | "red" | null };
}

export interface MetricValue {
  key: string;
  name: string;
  unit: string;
  last: number | null;
  /** What to show for the last reading (good/bad and picklist metrics
   *  have a label, not a number); "" = nothing recorded. */
  display: string;
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
  driverLast: Map<string, DriverLast> = new Map()
): Map<string, InitiativeMetricState> {
  const byBoard = new Map(boards.map((b) => [b.boardId, b]));
  const rowByCard = new Map(rows.map((r) => [`${r.boardId}|${r.cardId}`, r]));
  const out = new Map<string, InitiativeMetricState>();
  for (const i of initiatives) {
    if (i.boardId === "") continue;
    const board = byBoard.get(i.boardId);
    if (!board) continue;
    const values: MetricValue[] = [];
    const slots = parseManifest(board.manifestRaw).slots;
    for (const def of i.metrics) {
      const key = def.key;
      // the seeded single card (older boards) still carries the in-card doc
      const slot = slots.find((sl) => sl.cardType === "KpiTrendCard" && String(((sl.settings.metric ?? {}) as Record<string, unknown>).key ?? "") === key) ?? null;
      const row = slot ? rowByCard.get(`${i.boardId}|${slot.cardId}`) : undefined;
      const doc = row ? parseKpiTrend(row.outputJson).envelope.data : null;
      const points = doc?.points ?? [];
      const ml = driverLast.get(`${i.id}|${key}`) ?? (def.driverId && def.driverLink !== "leads" ? driverLast.get(def.driverId) : undefined) ?? null;
      if (ml?.display) {
        values.push({ key, name: def.name, unit: "", last: null, display: ml.display.label, target: null, rag: ml.display.rag });
        continue;
      }
      if (def.tracking !== "value") {
        const disp = trackingDisplay(def, ml?.raw ?? "");
        values.push({ key, name: def.name, unit: "", last: null, display: disp.label, target: null, rag: disp.rag });
        continue;
      }
      const last = ml ? ml.last : points.length > 0 ? points[points.length - 1].value : null;
      // the in-card target wins (owners tune it there); the definition's
      // target is the fallback — and a per-period spec point in force on
      // the reading's date beats both
      const level = {
        target: doc?.target ?? def.target ?? null,
        usl: doc?.usl ?? def.usl ?? null,
        lsl: doc?.lsl ?? def.lsl ?? null,
      };
      const spec = ml && ml.date !== "" ? specFor(ml.spec, ml.date, level) : specFor(EMPTY_SPEC_SERIES, "", level);
      const reading: MetricReading = {
        last,
        ...spec,
        goodDirection: directionOf(def),
      };
      values.push({
        key,
        name: def.name,
        unit: def.unit ?? doc?.unit ?? "",
        last,
        display: last === null ? "" : `${last}${def.unit}`,
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

/** The last recorded reading per metric, read from wherever it lives
 *  (metricLocation): the driver's series, the seeded single card, or the
 *  Metrics card's sub-location. Reads coalesce per board. */
export async function loadMetricLasts(
  initiatives: Initiative[],
  boards: Pick<BoardSummary, "boardId" | "manifestRaw">[] = []
): Promise<Map<string, DriverLast>> {
  const out = new Map<string, DriverLast>();
  const { listDriverPoints, listDriverRaw, listSpecSeries } = await import("../store/driverSeries");
  const { stateOf } = await import("./vdt/model");
  const { listSeries } = await import("../store/series");
  const { listDrivers } = await import("../store/valueDrivers");
  const byBoard = new Map(boards.map((b) => [b.boardId, b]));
  const driverCache = new Map<string, Promise<DriverNode[]>>();
  const driversFor = (site: string) => {
    if (!driverCache.has(site)) driverCache.set(site, listDrivers(site).catch(() => []));
    return driverCache.get(site)!;
  };
  await Promise.all(
    initiatives.map(async (i) => {
      if (i.boardId === "") return;
      const board = byBoard.get(i.boardId);
      const slots = board ? parseManifest(board.manifestRaw).slots : [];
      const metricsCardId = slots.find((sl) => sl.cardType === "MetricsCard")?.cardId ?? "";
      const drivers = i.metrics.some((m) => m.driverId) ? await driversFor(i.org.site) : [];
      await Promise.all(
        i.metrics.map(async (m) => {
          const d = m.driverId ? (drivers.find((x) => x.id === m.driverId) ?? null) : null;
          const loc = metricLocation(m, i.boardId, metricsCardId, slots, d);
          try {
            if (loc.driverId !== "" && d && d.tracking.kind !== "value") {
              // a good / bad or picklist driver: the latest label + its state
              const raw = await listDriverRaw(loc.driverId, "1900-01-01", "2999-12-31");
              const lastPt = [...raw].sort((a, b) => (a.date + a.shift < b.date + b.shift ? -1 : 1)).pop() ?? null;
              const st = stateOf(d.tracking, lastPt ? lastPt.value : "");
              const v: DriverLast = { last: null, raw: lastPt ? lastPt.value : "", date: lastPt ? lastPt.date : "", spec: EMPTY_SPEC_SERIES, display: st };
              out.set(`${i.id}|${m.key}`, v);
              out.set(loc.driverId, v);
            } else if (loc.driverId !== "") {
              const [pts, spec] = await Promise.all([listDriverPoints(loc.driverId, "1900-01-01", "2999-12-31"), listSpecSeries("vdt", loc.driverId, "2999-12-31").catch(() => EMPTY_SPEC_SERIES)]);
              const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
              const v = { last: lastPt ? lastPt.value : null, raw: lastPt ? String(lastPt.value) : "", date: lastPt ? lastPt.date : "", spec };
              out.set(`${i.id}|${m.key}`, v);
              out.set(loc.driverId, v);
            } else {
              const [cells, spec] = await Promise.all([listSeries(loc.boardId, loc.cardId, "1900-01-01", "2999-12-31"), listSpecSeries(loc.boardId, loc.cardId, "2999-12-31").catch(() => EMPTY_SPEC_SERIES)]);
              const pts = cells.filter((c) => loc.isActual(c.key) && c.value !== "").sort((a, b) => (a.date + a.shift < b.date + b.shift ? -1 : 1));
              const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
              const n = lastPt ? Number(lastPt.value) : NaN;
              out.set(`${i.id}|${m.key}`, { last: Number.isFinite(n) ? n : null, raw: lastPt ? lastPt.value : "", date: lastPt ? lastPt.date : "", spec });
            }
          } catch {
            /* no reading */
          }
        })
      );
    })
  );
  return out;
}

/** @deprecated use loadMetricLasts — kept for the callers' shape. */
export const loadDriverLasts = loadMetricLasts;
