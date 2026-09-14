// The initiative Metrics card (Ben, 2026-09-08): every metric on the
// initiative from its DEFINITION (so a metric added in Edit details is on
// the board at once), ★ first — latest value, this period's target, state
// dot, sparkline over the last page of buckets. A value row expands into
// the KPI chart (readings, per-reading actions, ⊞ Grid); good/bad and
// picklist rows enter directly in a bucket strip. Each row reads/writes
// its own location (metricLocation): the driver's series when linked,
// else the seeded single card's (older boards), else a sub-location under
// this card — so single KPI cards and the drivers tab show the same data.

import type { CardMount } from "../cardRegistry";
import { el, clear } from "../../../shared/ui/dom";
import { paletteMap } from "../../../shared/palette";
import { todayIso } from "../../../shared/schema/id";
import { KpiTrendEditor } from "../../../controls/KpiTrendCard/editor";
import { SCHEMA_ID } from "../../../controls/KpiTrendCard/types";
import { DEFAULT_ROWS_CARD, EMPTY_SPEC_SERIES } from "../../../shared/schema/specSeries";
import { listInitiatives } from "../store/initiatives";
import { getBoard } from "../store/boards";
import { parseManifest } from "../store/mappers";
import { appPalettes } from "../store/config";
import { listDrivers } from "../store/valueDrivers";
import { applySeries, listSeries } from "../store/series";
import { listSpecSeries } from "../store/driverSeries";
import { diffPoints, pointsFromCells } from "../store/seriesMap";
import { ragPaletteKey } from "../priorities/model";
import { normalizeMetrics, TemplateMetric } from "./templateModel";
import { metricLocation, MetricLocation } from "./metricLocation";
import { DriverNode, DriverTracking, driverDiffPoints, driverDiffStatePoints, driverPointsFromCells, driverStatePointsFromCells, stateOf, trackingOptions } from "./vdt/model";
import { GridSource, loadGridCells } from "./vdt/grid";
import { GridCell, pageColumns, pageOriginAround } from "./vdt/gridModel";
import { Initiative } from "./initiativeModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

interface Row {
  m: TemplateMetric;
  loc: MetricLocation;
  driver: DriverNode | null;
  source: GridSource;
  cells: GridCell[];
  /** Raw last value (own non-value metrics keep strings). */
  lastRaw: string;
  /** Non-numeric (good / bad, picklist): the driver's tracking, or the
   *  own metric's; null = a number. */
  tracking: DriverTracking | null;
}

/** The tracking a metric row is measured under. */
function trackingFor(m: TemplateMetric, d: DriverNode | null): DriverTracking | null {
  if (d && d.tracking.kind !== "value") return d.tracking;
  if (!d && m.tracking !== "value") return { kind: m.tracking, options: m.options ?? [] };
  return null;
}

export function mountMetricsCard(opts: CardMount): () => void {
  const wrap = el("div", "app-mc");
  opts.host.appendChild(wrap);
  wrap.appendChild(el("div", "app-cp-muted app-mc-note", "Loading…"));
  let dead = false;
  const editors: KpiTrendEditor[] = [];
  const today = todayIso();
  let ragColor = (rag: "green" | "amber" | "red"): string => (rag === "green" ? "#2e7d32" : rag === "amber" ? "#c77800" : "#c62828");
  let initiative: Initiative | null = null;
  let rows: Row[] = [];
  let slots: { cardType: string; cardId: string; settings: Record<string, unknown> }[] = [];
  let drivers: DriverNode[] = [];

  const level = (m: TemplateMetric) => ({ target: m.target, lsl: m.lsl ?? null, usl: m.usl ?? null });

  const sourceFor = (m: TemplateMetric, loc: MetricLocation, d: DriverNode | null): GridSource => ({
    tracking: trackingFor(m, d) ?? undefined,
    boardId: loc.boardId,
    cardId: loc.cardId,
    cadence: loc.cadence,
    aggregate: loc.aggregate,
    unit: d ? d.unit : m.unit,
    format: d ? d.format : undefined,
    level: level(m),
    rows: d ? d.format.rows : (m.rows ?? DEFAULT_ROWS_CARD),
    isActual: loc.isActual,
    newActual: (col) => (loc.actualKey !== "" ? { key: loc.actualKey, date: col.anchor, shift: col.shift } : { key: `k${Math.random().toString(36).slice(2, 10)}`, date: col.anchor, shift: "-" }),
    readOnly: opts.readOnly,
  });

  const loadRow = async (m: TemplateMetric): Promise<Row> => {
    const d = m.driverId ? (drivers.find((x) => x.id === m.driverId) ?? null) : null;
    const loc = metricLocation(m, opts.boardId, opts.cardId, slots, d);
    const source = sourceFor(m, loc, d);
    const origin = pageOriginAround(today, loc.cadence);
    const cols = pageColumns(loc.cadence, origin);
    const tracking = trackingFor(m, d);
    // numeric: folded per bucket with spec; non-numeric: one label per bucket
    const cells = await loadGridCells(source, cols[0].from, cols[cols.length - 1].to).catch(() => []);
    let lastRaw = "";
    if (tracking) {
      const raw = await listSeries(loc.boardId, loc.cardId, "1900-01-01", "2999-12-31").catch(() => []);
      const last = [...raw.filter((c) => loc.isActual(c.key) && c.value !== "")].sort((a, b) => (a.date + a.shift < b.date + b.shift ? -1 : 1)).pop();
      lastRaw = last ? last.value : "";
    }
    return { m, loc, driver: d, source, cells, lastRaw, tracking };
  };

  const load = async () => {
    const [inits, board, palettes] = await Promise.all([listInitiatives().catch(() => []), getBoard(opts.boardId).catch(() => null), appPalettes().catch(() => ({ states: [], titles: [] }))]);
    if (dead) return;
    const stateColors = paletteMap(palettes.states);
    ragColor = (rag) => stateColors[ragPaletteKey(rag)] ?? "#9a948a";
    initiative = inits.find((i) => i.boardId === opts.boardId) ?? null;
    if (!initiative) {
      clear(wrap);
      wrap.appendChild(el("div", "app-cp-muted app-mc-note", "This card lists an initiative's metrics — it belongs on an initiative board."));
      return;
    }
    slots = board ? parseManifest(board.manifestRaw).slots : [];
    drivers = await listDrivers(initiative.org.site).catch(() => []);
    const metrics = normalizeMetrics(initiative.metrics);
    metrics.sort((a, b) => (a.primary ? -1 : b.primary ? 1 : 0));
    rows = await Promise.all(metrics.map(loadRow));
    if (dead) return;
    paint();
  };

  /** A metric's full trend (the KPI editor) mounted into `host` — a numeric
   *  run chart or, for good / bad and picklist, the category trend. The
   *  grid dialog ("Update values…") is the one place values are entered. */
  const mountChart = (host: HTMLElement, r: Row): KpiTrendEditor => {
    const window = { from: r.cells[0]?.column.from ?? today, to: r.cells[r.cells.length - 1]?.column.to ?? today };
    const prefix = `${r.m.key}:`;
    let lastPoints: { id: string; date: string; value: number; shift?: string; label?: string }[] = [];
    const ed = new KpiTrendEditor(host, {
      onChange: (env2) => {
        // values change only through the grid; this covers a stray edit
        const next = env2.data.points.map((p) => ({ ...p }));
        if (r.driver && r.tracking) {
          const strip = (p: { id: string; date: string; value: number; shift?: string; label?: string }) => ({ ...p, id: p.id.startsWith(prefix) ? p.id.slice(prefix.length) : p.id });
          const { put, del } = driverDiffStatePoints(lastPoints.map(strip), next.map(strip), r.tracking);
          void applySeries(r.loc.boardId, r.loc.cardId, put, del).catch((err) => console.warn("metrics card save failed", err));
        } else if (r.driver) {
          const strip = (p: { id: string; date: string; value: number; shift?: string }) => ({ ...p, id: p.id.startsWith(prefix) ? p.id.slice(prefix.length) : p.id });
          const { put, del } = driverDiffPoints(lastPoints.map(strip), next.map(strip));
          void applySeries(r.loc.boardId, r.loc.cardId, put, del).catch((err) => console.warn("metrics card save failed", err));
        } else if (!r.tracking) {
          const { put, del } = diffPoints(lastPoints, next);
          void applySeries(r.loc.boardId, r.loc.cardId, put, del).catch((err) => console.warn("metrics card save failed", err));
        }
        lastPoints = next;
      },
      onActions: (actions) => opts.onActions(actions.map((a) => (a.instanceId === "" ? { ...a, instanceId: opts.instanceKey } : a))),
      onGrid: () => {
        void (async () => {
          const { openValueGridDialog } = await import("./vdt/gridDialog");
          await openValueGridDialog({
            title: r.m.name,
            location: { boardId: r.loc.boardId, cardId: r.loc.cardId },
            driver: r.driver ? { id: r.driver.id, cadence: r.driver.cadence, aggregate: r.driver.aggregate, unit: r.driver.unit, format: r.driver.format, tracking: r.driver.tracking } : null,
            cadence: r.loc.cadence,
            unit: r.driver ? r.driver.unit : r.m.unit,
            level: level(r.m),
            rows: r.source.rows,
            tracking: r.tracking ?? undefined,
            window,
            readOnly: opts.readOnly,
            onClosed: (changed) => {
              if (changed) void reloadRow(r);
            },
          });
        })();
      },
    });
    editors.push(ed);
    ed.setTheme(opts.theme);
    ed.setChrome(`${r.m.primary ? "★ " : ""}${r.m.name}${r.driver ? " · VDT" : ""}\n${r.loc.cadence}${r.driver ? ` · from value driver ${r.driver.name}` : ""}`, "");
    ed.setReadOnly(opts.readOnly);
    ed.setPeople(opts.people);
    ed.setActions(opts.actions);
    ed.setCanRaise(opts.designTime !== true);
    ed.setSpec({ target: r.m.target, usl: r.m.usl ?? null, lsl: r.m.lsl ?? null, unit: r.driver ? r.driver.unit : r.m.unit });
    const shifts = r.loc.cadence === "shiftly" ? ["D", "N"] : null;
    ed.setReadingMode({ cadence: r.loc.cadence, shifts });
    if (r.tracking) {
      const t = r.tracking;
      ed.setTracking({ kind: t.kind === "goodbad" ? "goodbad" : "picklist", options: trackingOptions(t), color: (st) => ragColor(st) });
    }
    void (async () => {
      const [cells, spec] = await Promise.all([
        listSeries(r.loc.boardId, r.loc.cardId, window.from, window.to),
        listSpecSeries(r.loc.boardId, r.loc.cardId, window.to).catch(() => EMPTY_SPEC_SERIES),
      ]);
      if (dead || !editors.includes(ed)) return;
      let points: { id: string; date: string; value: number; shift?: string; label?: string }[];
      if (r.tracking && r.driver) points = driverStatePointsFromCells(cells, r.tracking).map((p) => ({ ...p, id: prefix + p.id }));
      else if (r.tracking) {
        const t = r.tracking;
        const optsList = trackingOptions(t);
        points = cells
          .filter((c) => r.loc.isActual(c.key) && c.value !== "")
          .map((c) => {
            const st = stateOf(t, c.value);
            const idx = optsList.findIndex((o) => o.label === st.label);
            return { id: c.key, date: c.date, value: idx >= 0 ? idx : 0, label: st.label, ...(c.shift && c.shift !== "-" ? { shift: c.shift } : {}) };
          })
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      } else points = r.driver ? driverPointsFromCells(cells).map((p) => ({ ...p, id: prefix + p.id })) : pointsFromCells(cells);
      lastPoints = points.map((p) => ({ ...p }));
      if (shifts) ed.setReadingMode({ cadence: r.loc.cadence, shifts: [...new Set([...shifts, ...points.map((p) => p.shift ?? "").filter((x) => x !== "")])] });
      ed.setSpecSeries(spec);
      ed.setEnvelope({ schema: SCHEMA_ID, meta: { title: "", updated: "" }, data: { points, target: null, usl: null, lsl: null, unit: "" } });
    })();
    return ed;
  };

  const destroyEditors = () => {
    for (const e of editors) e.destroy();
    editors.length = 0;
  };

  /** The chart grid (Ben, 2026-09-14): every metric's full trend, 1 / 2 / 3
   *  columns by count (1 · 2–4 · 5+), rows sharing the card's height; a
   *  click on a chart pops it out large. */
  const paint = () => {
    destroyEditors();
    clear(wrap);
    if (rows.length === 0) {
      wrap.appendChild(el("div", "app-cp-muted app-mc-note", "No metrics on this initiative yet — add them in Edit details."));
      return;
    }
    const cols = rows.length <= 1 ? 1 : rows.length <= 4 ? 2 : 3;
    const grid = el("div", `app-mc-chartgrid app-mc-cols-${cols}`);
    grid.style.gridTemplateRows = `repeat(${Math.ceil(rows.length / cols)}, minmax(0, 1fr))`;
    for (const r of rows) {
      const cell = el("div", "app-mc-cell" + (r.m.primary ? " app-mc-cell-primary" : ""));
      grid.appendChild(cell);
      mountChart(cell, r);
      cell.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button, .ltk-dialog-overlay, .ltk-kebab, .ltk-menu, circle")) return;
        popOut(r);
      });
    }
    wrap.appendChild(grid);
  };

  /** One metric's trend, large, with the same Update values road. */
  const popOut = (r: Row) => {
    const scrim = el("div", "app-modal-overlay");
    const box = el("div", "app-modal app-modal-wide app-mc-dialog");
    const host = el("div", "app-mc-dialoghost");
    box.appendChild(host);
    scrim.appendChild(box);
    document.body.appendChild(scrim);
    const ed = mountChart(host, r);
    const foot = el("div", "app-modal-footer");
    const done = btn("Done", "app-btn app-btn-primary");
    done.addEventListener("click", () => {
      ed.destroy();
      editors.splice(editors.indexOf(ed), 1);
      scrim.remove();
      void reloadRow(r);
    });
    foot.appendChild(done);
    box.appendChild(foot);
  };

  const reloadRow = async (r: Row) => {
    const fresh = await loadRow(r.m);
    const k = rows.findIndex((x) => x.m.key === r.m.key);
    if (k >= 0) rows[k] = fresh;
    if (!dead) paint();
  };

  void load().catch((err) => {
    clear(wrap);
    wrap.appendChild(el("div", "app-board-note", `Metrics could not load: ${err instanceof Error ? err.message : String(err)}`));
  });
  return () => {
    dead = true;
    destroyEditors();
    wrap.remove();
  };
}
