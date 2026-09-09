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
import { el, clear, svgEl } from "../../../shared/ui/dom";
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
import { metricLocation, MetricLocation, trackingDisplay } from "./metricLocation";
import { DriverNode, driverDiffPoints, driverPointsFromCells, formatValue } from "./vdt/model";
import { GridSource, loadGridCells } from "./vdt/grid";
import { GridCell, pageColumns, pageOriginAround, PAGE_BUCKETS } from "./vdt/gridModel";
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
}

export function mountMetricsCard(opts: CardMount): () => void {
  const wrap = el("div", "app-mc");
  opts.host.appendChild(wrap);
  wrap.appendChild(el("div", "app-cp-muted app-mc-note", "Loading…"));
  let dead = false;
  let editor: KpiTrendEditor | null = null;
  let expanded = "";
  const today = todayIso();
  let ragColor = (rag: "green" | "amber" | "red"): string => (rag === "green" ? "#2e7d32" : rag === "amber" ? "#c77800" : "#c62828");
  let initiative: Initiative | null = null;
  let rows: Row[] = [];
  let slots: { cardType: string; cardId: string; settings: Record<string, unknown> }[] = [];
  let drivers: DriverNode[] = [];

  const level = (m: TemplateMetric) => ({ target: m.target, lsl: m.lsl ?? null, usl: m.usl ?? null });

  const sourceFor = (m: TemplateMetric, loc: MetricLocation, d: DriverNode | null): GridSource => ({
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
    let cells: GridCell[] = [];
    let lastRaw = "";
    if (m.tracking === "value") {
      cells = await loadGridCells(source, cols[0].from, cols[cols.length - 1].to).catch(() => []);
    } else {
      // non-value metrics: raw strings per bucket, no folding
      const raw = await listSeries(loc.boardId, loc.cardId, cols[0].from, cols[cols.length - 1].to).catch(() => []);
      const byDate = new Map(raw.filter((c) => loc.isActual(c.key)).map((c) => [c.date, c]));
      cells = cols.map((column) => {
        const c = byDate.get(column.anchor);
        const disp = c ? trackingDisplay(m, c.value) : { label: "", rag: null };
        return { column, plan: { value: null, inherited: true }, forecast: { value: null, inherited: true }, lsl: { value: null, inherited: true }, usl: { value: null, inherited: true }, actual: { value: c ? Number(c.value) : null, count: c ? 1 : 0, editable: true, existing: c ? { key: c.key, date: c.date, shift: c.shift } : null }, rag: disp.rag };
      });
      const last = [...raw.filter((c) => loc.isActual(c.key))].sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
      lastRaw = last ? last.value : "";
    }
    return { m, loc, driver: d, source, cells, lastRaw };
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

  const latestCell = (r: Row): GridCell | null => [...r.cells].reverse().find((c) => c.actual.value !== null) ?? null;

  const sparkline = (r: Row): SVGSVGElement => {
    const W = 120;
    const H = 28;
    const svg = svgEl("svg", { class: "app-mc-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    const vals = r.cells.map((c) => c.actual.value);
    const tg = r.cells.map((c) => c.plan.value);
    const nums = [...vals, ...tg].filter((v): v is number => v !== null);
    if (nums.length === 0) return svg;
    let lo = Math.min(...nums);
    let hi = Math.max(...nums);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const x = (i: number) => (r.cells.length === 1 ? W / 2 : (i / (r.cells.length - 1)) * (W - 4) + 2);
    const y = (v: number) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
    // target as a faint step
    let d = "";
    tg.forEach((v, i) => {
      if (v === null) return;
      d += (d === "" ? "M" : "L") + `${x(i)} ${y(v)}`;
    });
    if (d !== "") {
      const t = svgEl("path", { d, fill: "none", "stroke-dasharray": "3 2", "stroke-width": 1 });
      (t as SVGElement & { style: CSSStyleDeclaration }).style.stroke = "#9a948a";
      svg.appendChild(t);
    }
    let pts = "";
    vals.forEach((v, i) => {
      if (v !== null) pts += `${x(i)},${y(v)} `;
    });
    const line = svgEl("polyline", { points: pts.trim(), fill: "none", "stroke-width": 1.8, "stroke-linejoin": "round" });
    (line as SVGElement & { style: CSSStyleDeclaration }).style.stroke = "#26241f";
    svg.appendChild(line);
    r.cells.forEach((c, i) => {
      if (c.actual.value === null || !c.rag) return;
      const dot = svgEl("circle", { cx: x(i), cy: y(c.actual.value), r: 2.2 });
      (dot as SVGElement & { style: CSSStyleDeclaration }).style.fill = ragColor(c.rag);
      svg.appendChild(dot);
    });
    return svg;
  };

  const fmt = (r: Row, v: number | null): string => (r.driver ? formatValue(v, r.driver.unit, r.driver.format) : v === null ? "—" : `${Math.round(v * 100) / 100}${r.m.unit ? " " + r.m.unit : ""}`);

  const paint = () => {
    clear(wrap);
    if (rows.length === 0) {
      wrap.appendChild(el("div", "app-cp-muted app-mc-note", "No metrics on this initiative yet — add them in Edit details."));
      return;
    }
    for (const r of rows) {
      const row = el("div", "app-mc-row" + (expanded === r.m.key ? " app-mc-row-open" : ""));
      const head = el("div", "app-mc-head");
      const name = el("div", "app-mc-name");
      if (r.m.primary) name.appendChild(el("span", "app-mc-star", "★"));
      name.appendChild(el("span", undefined, r.m.name));
      if (r.driver) name.appendChild(el("span", "app-mc-kind", "· VDT"));
      head.appendChild(name);
      if (r.m.tracking === "value") {
        const last = latestCell(r);
        head.appendChild(sparkline(r));
        const val = el("div", "app-mc-val");
        const dot = el("span", "app-mc-dot");
        if (last?.rag) dot.style.background = ragColor(last.rag);
        else dot.classList.add("app-mc-dot-none");
        val.appendChild(dot);
        val.appendChild(el("span", "app-mc-num", last ? fmt(r, last.actual.value) : "—"));
        const tcell = r.cells.find((c) => today >= c.column.from && today <= c.column.to) ?? last;
        if (tcell && tcell.plan.value !== null) val.appendChild(el("span", "app-mc-tgt", `/ ${fmt(r, tcell.plan.value)}`));
        head.appendChild(val);
        head.addEventListener("click", () => {
          expanded = expanded === r.m.key ? "" : r.m.key;
          paint();
        });
        head.classList.add("app-mc-head-click");
      } else {
        head.appendChild(stripFor(r));
        const disp = trackingDisplay(r.m, r.lastRaw);
        const val = el("div", "app-mc-val");
        const dot = el("span", "app-mc-dot");
        if (disp.rag) dot.style.background = ragColor(disp.rag);
        else dot.classList.add("app-mc-dot-none");
        val.append(dot, el("span", "app-mc-num", disp.label || "—"));
        head.appendChild(val);
      }
      row.appendChild(head);
      if (expanded === r.m.key && r.m.tracking === "value") row.appendChild(expandedFor(r));
      wrap.appendChild(row);
    }
  };

  /** Good/bad and picklist: the last buckets as a strip of cells. */
  const stripFor = (r: Row): HTMLElement => {
    const strip = el("div", "app-mc-strip");
    const show = r.cells.slice(-Math.min(r.cells.length, PAGE_BUCKETS[r.loc.cadence]));
    for (const c of show) {
      const cell = el("button", "app-mc-cell" + (today >= c.column.from && today <= c.column.to ? " app-mc-cell-today" : "")) as HTMLButtonElement;
      cell.type = "button";
      cell.title = `${c.column.label}${c.column.dateLabel !== c.column.label ? " · " + c.column.dateLabel : ""}`;
      if (c.rag) {
        cell.style.background = ragColor(c.rag);
        cell.classList.add("app-mc-cell-on");
        cell.textContent = r.m.tracking === "goodbad" ? (c.rag === "green" ? "✓" : "✗") : "";
      }
      cell.disabled = opts.readOnly;
      cell.addEventListener("click", () => void enterState(r, c, cell));
      strip.appendChild(cell);
    }
    return strip;
  };

  /** Good/bad cycles none → good → bad → none; picklist opens a select. */
  const enterState = async (r: Row, c: GridCell, cell: HTMLButtonElement) => {
    const write = async (value: string | null) => {
      const at = c.actual.existing ?? r.source.newActual(c.column);
      if (value === null) {
        if (c.actual.existing) await applySeries(r.loc.boardId, r.loc.cardId, [], [{ ...c.actual.existing, value: "" }]);
      } else await applySeries(r.loc.boardId, r.loc.cardId, [{ ...at, value }]);
      const fresh = await loadRow(r.m);
      const k = rows.findIndex((x) => x.m.key === r.m.key);
      if (k >= 0) rows[k] = fresh;
      if (!dead) paint();
    };
    if (r.m.tracking === "goodbad") {
      const cur = c.actual.existing ? String(c.actual.value) : "";
      await write(cur === "" ? "1" : cur === "1" ? "0" : null);
      return;
    }
    const sel = el("select", "app-input app-mc-pick") as HTMLSelectElement;
    const none = el("option", "", "—") as HTMLOptionElement;
    none.value = "";
    sel.appendChild(none);
    for (const op of r.m.options ?? []) {
      const o = el("option", "", op.label) as HTMLOptionElement;
      o.value = op.label;
      if (c.rag && op.state === c.rag) o.selected = true;
      sel.appendChild(o);
    }
    cell.replaceWith(sel);
    sel.focus();
    sel.addEventListener("change", () => void write(sel.value === "" ? null : sel.value));
    sel.addEventListener("blur", () => {
      if (sel.isConnected) sel.replaceWith(cell);
    });
  };

  /** A value row's chart: the KPI editor bound to the row's location. */
  const expandedFor = (r: Row): HTMLElement => {
    const host = el("div", "app-mc-expand");
    editor?.destroy();
    const window = { from: r.cells[0]?.column.from ?? today, to: r.cells[r.cells.length - 1]?.column.to ?? today };
    const prefix = `${r.m.key}:`;
    let lastPoints: { id: string; date: string; value: number; shift?: string }[] = [];
    const ed = new KpiTrendEditor(host, {
      onChange: (env2) => {
        const next = env2.data.points.map((p) => ({ ...p }));
        if (r.driver) {
          const strip = (p: { id: string; date: string; value: number; shift?: string }) => ({ ...p, id: p.id.startsWith(prefix) ? p.id.slice(prefix.length) : p.id });
          const { put, del } = driverDiffPoints(lastPoints.map(strip), next.map(strip));
          void applySeries(r.loc.boardId, r.loc.cardId, put, del).catch((err) => console.warn("metrics card save failed", err));
        } else {
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
            driver: r.driver ? { id: r.driver.id, cadence: r.driver.cadence, aggregate: r.driver.aggregate, unit: r.driver.unit, format: r.driver.format } : null,
            cadence: r.loc.cadence,
            unit: r.driver ? r.driver.unit : r.m.unit,
            level: level(r.m),
            rows: r.source.rows,
            window,
            readOnly: opts.readOnly,
            onClosed: (changed) => {
              if (changed) void reloadRow(r);
            },
          });
        })();
      },
    });
    editor = ed;
    ed.setTheme(opts.theme);
    ed.setChrome("", "");
    ed.setReadOnly(opts.readOnly);
    ed.setPeople(opts.people);
    ed.setActions(opts.actions);
    ed.setCanRaise(opts.designTime !== true);
    ed.setSpec({ target: r.m.target, usl: r.m.usl ?? null, lsl: r.m.lsl ?? null, unit: r.driver ? r.driver.unit : r.m.unit });
    const shifts = r.loc.cadence === "shiftly" ? ["D", "N"] : null;
    ed.setReadingMode({ cadence: r.loc.cadence, shifts });
    void (async () => {
      const [cells, spec] = await Promise.all([
        listSeries(r.loc.boardId, r.loc.cardId, window.from, window.to),
        listSpecSeries(r.loc.boardId, r.loc.cardId, window.to).catch(() => EMPTY_SPEC_SERIES),
      ]);
      if (dead || editor !== ed) return;
      const points = r.driver ? driverPointsFromCells(cells).map((p) => ({ ...p, id: prefix + p.id })) : pointsFromCells(cells);
      lastPoints = points.map((p) => ({ ...p }));
      if (shifts) ed.setReadingMode({ cadence: r.loc.cadence, shifts: [...new Set([...shifts, ...points.map((p) => (p as { shift?: string }).shift ?? "").filter((x) => x !== "")])] });
      ed.setSpecSeries(spec);
      ed.setEnvelope({ schema: SCHEMA_ID, meta: { title: "", updated: "" }, data: { points, target: null, usl: null, lsl: null, unit: "" } });
    })();
    const foot = el("div", "app-mc-expandfoot");
    const close = btn("Collapse", "app-link");
    close.addEventListener("click", () => {
      expanded = "";
      void reloadRow(r);
    });
    foot.appendChild(close);
    host.appendChild(foot);
    return host;
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
    editor?.destroy();
    wrap.remove();
  };
}
