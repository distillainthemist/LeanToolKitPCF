// The KPI values GRID (Ben, 2026-09-08) — ONE component for the value
// driver tab (a drawer under a leaf) and the KPI card (a dialog): a column
// per cadence bucket, rows Date · Target · Lower · Upper · Actual (with
// its state dot).
// Sticky first column, horizontal scroll inside the grid (never the page),
// paged when the window holds more columns than fit. Excel-style paste,
// CSV out, Tab/Enter/arrow movement, blur saves; writes batch into one
// series call per grid (debounced), then the grid re-reads.
//
// The location abstraction (GridSource) is the only thing that differs
// between a driver (boardId "vdt" · cardId = driver id · actual key
// "actual") and an own KPI card (its board/card · point ids as keys).

import { el, clear } from "../../../../shared/ui/dom";
import { newId, todayIso } from "../../../../shared/schema/id";
import { applySeries } from "../../store/series";
import { loadGridCells } from "../../store/gridCells";
import { DEFAULT_ROWS_CARD, SPEC_LABELS, SPEC_SERIES_PREFIX, SpecRows } from "../../../../shared/schema/specSeries";
import { Aggregate, Cadence, CADENCE_LABELS, DriverTracking, NodeFormat, stateOf, trackingOptions } from "./model";
import {
  addBuckets,
  bucketSpan,
  foldValues,
  GridCell,
  GridColumn,
  gridCsv,
  GridLevel,
  GridLocation,
  GridRowKind,
  PAGE_BUCKETS,
  pageColumns,
  pageOriginAround,
  parsePasteBlock,
  ROW_ORDER,
  rowsFor,
  specCell,
  SpecKind,
} from "./gridModel";

export { loadGridCells };

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface GridSource extends GridLocation {
  unit: string;
  /** Display format; percent drivers store fractions and show ×100. */
  format?: NodeFormat;
  /** The cell a NEW reading in a column is written to. */
  newActual: (col: GridColumn) => { key: string; date: string; shift: string };
  readOnly: boolean;
}

/** A value driver's location (its rows from the driver's format). */
export function driverGridSource(n: { id: string; cadence: Cadence; aggregate: Aggregate; unit: string; format: NodeFormat; tracking?: DriverTracking }, level: GridLevel, readOnly: boolean): GridSource {
  return {
    boardId: "vdt",
    cardId: n.id,
    cadence: n.cadence,
    aggregate: n.aggregate,
    unit: n.unit,
    format: n.format,
    level,
    rows: n.format.rows,
    tracking: n.tracking,
    isActual: (k) => k === "actual",
    newActual: (col) => ({ key: "actual", date: col.anchor, shift: col.shift }),
    readOnly,
  };
}

/** An own KPI card's location: readings keyed by point id, whole days. */
export function cardGridSource(boardId: string, cardId: string, cadence: Cadence, unit: string, level: GridLevel, readOnly: boolean, rows: SpecRows = DEFAULT_ROWS_CARD): GridSource {
  return {
    boardId,
    cardId,
    cadence,
    aggregate: "last",
    unit,
    level,
    rows,
    isActual: (k) => k !== "" && !k.startsWith(SPEC_SERIES_PREFIX),
    newActual: (col) => ({ key: newId("k"), date: col.anchor, shift: "-" }),
    readOnly,
  };
}

export interface GridOpts {
  host: HTMLElement;
  source: GridSource;
  /** The home range (a period): the first page opens on today when today
   *  is inside it, else on its start; "Fill plan from targets" folds it.
   *  Paging itself is unbounded either way. */
  home?: { from: string; to: string };
  /** State colours — ALWAYS the site palette (the host resolves). */
  ragColor: (rag: "green" | "amber" | "red") => string;
  /** After a write lands. */
  onSaved?: () => void;
  /** Extra footer controls (e.g. Fill plan from targets). */
  footer?: (api: GridHandle) => HTMLElement[];
  /** CSV file name (without .csv). */
  csvName?: string;
}

export interface GridHandle {
  refresh: () => Promise<void>;
  /** Flushes any pending writes first. */
  destroy: () => Promise<void>;
  /** The page's columns, resolved. */
  cells: () => GridCell[];
  /** The targets of every bucket in [from, to] folded at the aggregate
   *  (Plan from targets) — loads that range. */
  foldTargets: (from: string, to: string) => Promise<number | null>;
}

export function renderValueGrid(o: GridOpts): GridHandle {
  const src = o.source;
  const scale = src.format?.percent ? 100 : 1;
  const decimals = src.format?.decimals ?? (src.format?.percent ? 1 : 2);
  const wrap = el("div", "app-vg");
  o.host.appendChild(wrap);
  const perPageEarly = (): number => {
    const width = o.host.clientWidth;
    if (width <= 0) return PAGE_BUCKETS[src.cadence];
    const fit = Math.floor((width - 132) / 64);
    const shifts = src.cadence === "shiftly" ? Math.max(1, (src.shifts ?? ["D", "N"]).length) : 1;
    return Math.max(2, Math.min(PAGE_BUCKETS[src.cadence], Math.floor(fit / shifts)));
  };
  let dead = false;
  /** The page's cells. */
  let all: GridCell[] = [];
  /** The page's first bucket anchor — moves without bound. */
  const today = todayIso();
  let origin = o.home && !(today >= o.home.from && today <= o.home.to) ? bucketSpan(o.home.from, src.cadence).from : pageOriginAround(today, src.cadence, perPageEarly());
  let pending: { put: Map<string, { key: string; date: string; shift: string; value: string }>; del: Map<string, { key: string; date: string; shift: string; value: string }> } = { put: new Map(), del: new Map() };
  let flushTimer: number | null = null;
  let flushing: Promise<void> = Promise.resolve();
  let focusAfter: { row: GridRowKind; col: number; value: string; sel: number } | null = null;

  const fmt = (v: number | null): string => {
    if (v === null) return "";
    const n = v * scale;
    const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
    return String(r);
  };
  const shiftsOf = (actuals: { shift: string }[]): string[] => {
    const set = new Set(src.shifts ?? ["D", "N"]);
    for (const a of actuals) if (a.shift && a.shift !== "-") set.add(a.shift);
    return [...set];
  };

  const resolveRange = (from: string, to: string): Promise<GridCell[]> => loadGridCells(src, from, to, shiftsOf);

  /** Buckets per page: the cadence's default, trimmed to what fits the
   *  host's width without scrolling (Ben, 2026-09-09 — ‹ › move through
   *  time instead). Unknown width (not yet on the page) = the default. */
  const MIN_COL = 64;
  const HEAD_COL = 130;
  const perPage = (): number => {
    const width = wrap.clientWidth;
    if (width <= 0) return PAGE_BUCKETS[src.cadence];
    const fit = Math.floor((width - HEAD_COL - 2) / MIN_COL);
    const shifts = src.cadence === "shiftly" ? Math.max(1, (src.shifts ?? ["D", "N"]).length) : 1;
    return Math.max(2, Math.min(PAGE_BUCKETS[src.cadence], Math.floor(fit / shifts)));
  };
  let pageSize = PAGE_BUCKETS[src.cadence];

  const load = async () => {
    pageSize = perPage();
    const cols = pageColumns(src.cadence, origin, undefined, pageSize);
    const got = await resolveRange(cols[0].from, cols[cols.length - 1].to);
    if (dead) return;
    all = got;
  };

  const queue = (cell: { key: string; date: string; shift: string; value: string }, del: boolean) => {
    const k = `${cell.key}|${cell.date}|${cell.shift}`;
    if (del) {
      pending.put.delete(k);
      pending.del.set(k, cell);
    } else {
      pending.del.delete(k);
      pending.put.set(k, cell);
    }
    if (flushTimer !== null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), 500);
  };

  const flush = async () => {
    flushTimer = null;
    const put = [...pending.put.values()];
    const del = [...pending.del.values()];
    pending = { put: new Map(), del: new Map() };
    if (put.length === 0 && del.length === 0) return;
    flushing = flushing.then(async () => {
      try {
        await applySeries(src.boardId, src.cardId, put, del);
      } catch (err) {
        console.warn("grid save failed", err);
        note.textContent = "Some values did not save — check the connection and try again.";
        return;
      }
      await load();
      if (dead) return;
      // a repaint must not eat what the typist is doing in another cell
      const active = document.activeElement as HTMLInputElement | null;
      if (active && wrap.contains(active) && active.dataset.row) {
        focusAfter = { row: active.dataset.row as GridRowKind, col: Number(active.dataset.col), value: active.value, sel: active.selectionStart ?? 0 };
      }
      paint();
      o.onSaved?.();
    });
    await flushing;
  };

  const stateMode = src.tracking !== undefined && src.tracking.kind !== "value";
  const stateOptions = src.tracking ? trackingOptions(src.tracking) : [];

  /** A non-numeric reading: the option label, or null to clear. */
  const enterState = (cell: GridCell, label: string | null) => {
    if (label === null) {
      if (cell.actual.existing) queue({ ...cell.actual.existing, value: "" }, true);
      return;
    }
    const at = cell.actual.existing ?? src.newActual(cell.column);
    queue({ ...at, value: label }, false);
  };

  /** Apply one entry to a column/row: the write set + an optimistic cell. */
  const enter = (cell: GridCell, row: GridRowKind, raw: number | null) => {
    const v = raw === null ? null : raw / scale;
    if (row === "actual") {
      if (!cell.actual.editable) return;
      if (v === null) {
        if (cell.actual.existing) queue({ ...cell.actual.existing, value: "" }, true);
      } else {
        const at = cell.actual.existing ?? src.newActual(cell.column);
        queue({ ...at, value: String(v) }, false);
      }
      return;
    }
    const kind: SpecKind = row;
    if (v === null) {
      if (!cell[kind].inherited) queue(specCell(kind, cell.column, null), true);
    } else queue(specCell(kind, cell.column, v), false);
  };

  const note = el("div", "app-vg-note app-cp-muted", "");

  /** Move the page by whole pages (after committing the focused cell). */
  const turn = (dir: -1 | 1) => {
    const active = document.activeElement as HTMLInputElement | null;
    if (active && wrap.contains(active) && active.dataset.row) active.dispatchEvent(new Event("change"));
    origin = addBuckets(origin, src.cadence, dir * pageSize);
    void flushing.then(load).then(() => {
      if (!dead) paint();
    });
  };

  const paint = () => {
    clear(wrap);
    const cells = all;
    // the pager: top, either side of the grid — unbounded through time
    const strip = el("div", "app-vg-strip");
    const prev = btn("‹", "app-btn app-vg-pgbtn");
    prev.title = "Earlier";
    prev.addEventListener("click", () => turn(-1));
    const next = btn("›", "app-btn app-vg-pgbtn");
    next.title = "Later";
    next.addEventListener("click", () => turn(1));
    const first = cells[0]?.column.label ?? "";
    const last = cells[cells.length - 1]?.column.label ?? "";
    const y0 = cells[0]?.column.anchor.slice(0, 4) ?? "";
    const y1 = cells[cells.length - 1]?.column.anchor.slice(0, 4) ?? "";
    const lbl = el("span", "app-vg-pagelbl", src.cadence === "annually" ? `${first} – ${last}` : y0 === y1 ? `${first} – ${last} · ${y0}` : `${first} ${y0} – ${last} ${y1}`);
    const onPage = cells.some((c) => today >= c.column.from && today <= c.column.to);
    const mid = el("span", "app-vg-stripmid");
    mid.appendChild(lbl);
    if (!onPage) {
      const home = btn("Today", "app-link");
      home.addEventListener("click", () => {
        origin = pageOriginAround(today, src.cadence, pageSize);
        void flushing.then(load).then(() => {
          if (!dead) paint();
        });
      });
      mid.appendChild(home);
    }
    strip.append(prev, mid, next);
    wrap.appendChild(strip);
    const scroll = el("div", "app-vg-scroll");
    const table = el("table", "app-vg-table") as HTMLTableElement;
    const inputs = new Map<string, HTMLInputElement>();
    const rowLabel = (label: string, sub = "") => {
      const th = el("th", "app-vg-rowhead");
      th.appendChild(el("span", undefined, label));
      if (sub !== "") th.appendChild(el("span", "app-vg-rowsub", sub));
      return th;
    };
    const colClass = (c: GridCell) => (today >= c.column.from && today <= c.column.to ? " app-vg-today" : c.column.from > today ? " app-vg-future" : "");
    // header: period labels
    const head = el("thead");
    const hr = el("tr");
    hr.appendChild(rowLabel("Period"));
    for (const c of cells) hr.appendChild(el("th", "app-vg-col" + colClass(c), c.column.label));
    head.appendChild(hr);
    const dr = el("tr", "app-vg-daterow");
    dr.appendChild(rowLabel("Date"));
    for (const c of cells) dr.appendChild(el("th", "app-vg-col app-vg-date" + colClass(c), c.column.dateLabel));
    head.appendChild(dr);
    table.appendChild(head);
    const body = el("tbody");
    // the configured rows, then Actual (a non-numeric driver: the state alone)
    const rows: [GridRowKind, string, string][] = stateMode
      ? [["actual", src.tracking?.kind === "goodbad" ? "Good / bad" : "State", CADENCE_LABELS[src.cadence].toLowerCase()]]
      : rowsFor(src.rows).map((r) =>
          r === "actual" ? ["actual", "Actual", CADENCE_LABELS[src.cadence].toLowerCase()] : r === "plan" ? ["plan", "Plan", src.unit] : [r, SPEC_LABELS[r], ""]
        );
    const ragDot = (c: GridCell): HTMLElement | null => {
      if (!c.rag) return null;
      const dot = el("span", "app-vg-dot");
      dot.style.background = o.ragColor(c.rag);
      dot.title = c.rag === "red" ? "Outside the limits" : c.rag === "amber" ? "Short of target" : "On target";
      return dot;
    };
    for (const [kind, label, sub] of rows) {
      const tr = el("tr", `app-vg-row app-vg-row-${kind}`);
      tr.appendChild(rowLabel(label, sub));
      cells.forEach((c, ci) => {
        const td = el("td", "app-vg-cell" + colClass(c));
        const spec = kind === "actual" ? null : c[kind];
        const editable = !src.readOnly && (kind === "actual" ? c.actual.editable : true);
        // the state indicator rides in the Actual cell once a value is in
        if (kind === "actual") {
          td.classList.add("app-vg-actcell");
          const dot = ragDot(c);
          if (dot) td.appendChild(dot);
        }
        if (stateMode && kind === "actual") {
          // good / bad cycles on click; a picklist is a select
          const cur = c.actual.raw ?? "";
          if (src.readOnly) td.appendChild(el("span", "app-vg-ro", cur || ""));
          else if (src.tracking?.kind === "goodbad") {
            const b = btn(cur || "—", "app-vg-statebtn" + (cur === "" ? " app-vg-statebtn-none" : ""));
            b.title = "Click to cycle: Good → Bad → none";
            b.addEventListener("click", () => {
              const next = cur === "" ? "Good" : cur === "Good" ? "Bad" : null;
              enterState(c, next);
            });
            td.appendChild(b);
          } else {
            const sel = el("select", "app-vg-in app-vg-statesel") as HTMLSelectElement;
            const none = el("option", "", "—") as HTMLOptionElement;
            none.value = "";
            sel.appendChild(none);
            for (const op of stateOptions) {
              const o2 = el("option", "", op.label) as HTMLOptionElement;
              o2.value = op.label;
              if (op.label === cur) o2.selected = true;
              sel.appendChild(o2);
            }
            sel.dataset.row = kind;
            sel.dataset.col = String(ci);
            sel.addEventListener("change", () => enterState(c, sel.value === "" ? null : sel.value));
            sel.addEventListener("paste", (e) => {
              const text = e.clipboardData?.getData("text/plain") ?? "";
              const labels = text.replace(/\r/g, "").split(/\t|\n|,/).map((x) => x.trim());
              if (labels.length < 2) return;
              e.preventDefault();
              let n = 0;
              labels.forEach((l, k) => {
                const target = all[ci + k];
                if (!target || l === "") return;
                const st = src.tracking ? stateOf(src.tracking, l) : { label: l, rag: null };
                if (st.rag === null) return;
                enterState(target, st.label);
                n++;
              });
              note.textContent = `${n} value${n === 1 ? "" : "s"} pasted.`;
            });
            td.appendChild(sel);
          }
        } else if (!editable) {
          const ro = el("span", "app-vg-ro", kind === "actual" ? fmt(c.actual.value) : fmt(spec?.value ?? null));
          if (kind === "actual" && c.actual.count > 1) {
            ro.classList.add("app-vg-folded");
            ro.title = `${c.actual.count} readings in this ${CADENCE_LABELS[src.cadence].toLowerCase().replace(/ly$/, "")} — folded by ${src.aggregate}. Edit them individually on the card.`;
            ro.textContent = `${fmt(c.actual.value)} ·${c.actual.count}`;
          }
          td.appendChild(ro);
        } else {
          const inp = el("input", "app-vg-in") as HTMLInputElement;
          inp.type = "text";
          inp.inputMode = "decimal";
          inp.autocomplete = "off";
          const value = kind === "actual" ? c.actual.value : (spec?.value ?? null);
          inp.value = fmt(value);
          if (spec?.inherited && spec.value !== null) {
            inp.classList.add("app-vg-inherited");
            inp.title = "Carried forward — type here to set a new value from this period on";
          }
          inp.dataset.row = kind;
          inp.dataset.col = String(ci);
          inputs.set(`${kind}|${ci}`, inp);
          inp.addEventListener("focus", () => inp.select());
          inp.addEventListener("change", () => {
            const t = inp.value.trim();
            if (t === "") {
              // clearing an inherited value: nothing to delete
              if (spec?.inherited) {
                inp.value = fmt(spec.value);
                return;
              }
              enter(c, kind, null);
              return;
            }
            const n = Number(t.replace(/[,$%\s]/g, ""));
            if (!Number.isFinite(n)) {
              inp.value = fmt(value);
              return;
            }
            inp.classList.remove("app-vg-inherited");
            enter(c, kind, n);
          });
          inp.addEventListener("keydown", (e) => {
            const move = (dr2: number, dc: number) => {
              const ri = ROW_ORDER.indexOf(kind) + dr2;
              const target = inputs.get(`${ROW_ORDER[ri]}|${ci + dc}`);
              if (target) {
                e.preventDefault();
                inp.dispatchEvent(new Event("change"));
                target.focus();
              }
            };
            if (e.key === "Enter" || e.key === "ArrowDown") move(1, 0);
            else if (e.key === "ArrowUp") move(-1, 0);
            else if (e.key === "ArrowRight" && inp.selectionStart === inp.value.length) move(0, 1);
            else if (e.key === "ArrowLeft" && inp.selectionStart === 0) move(0, -1);
          });
          inp.addEventListener("paste", (e) => {
            const text = e.clipboardData?.getData("text/plain") ?? "";
            const block = parsePasteBlock(text, kind);
            const multi = block.length > 1 || (block[0]?.values.length ?? 0) > 1;
            if (!multi) return;
            e.preventDefault();
            const startCol = ci;
            let n = 0;
            const shown = new Set(rowsFor(src.rows));
            for (const r of block) {
              if (!shown.has(r.kind)) continue;
              r.values.forEach((v, k) => {
                const target = all[startCol + k];
                if (!target || v === null) return;
                enter(target, r.kind, v);
                n++;
              });
            }
            note.textContent = `${n} value${n === 1 ? "" : "s"} pasted.`;
          });
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    table.appendChild(body);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    // footer: paste hint · csv · host extras
    const foot = el("div", "app-vg-foot");
    foot.appendChild(el("span", "app-cp-muted app-vg-hint", src.readOnly ? "Read-only." : stateMode ? (src.tracking?.kind === "goodbad" ? "Click a period to cycle Good → Bad → none." : "Pick a state per period; paste a row of labels from Excel into any cell.") : "Grey = carried forward from the previous period (or the level plan). Paste a block from Excel into any cell."));
    const csv = btn("CSV", "app-link");
    csv.addEventListener("click", () => {
      const text = stateMode
        ? [["Period", ...all.map((c) => c.column.label)], ["Date", ...all.map((c) => c.column.anchor)], ["State", ...all.map((c) => c.actual.raw ?? "")]].map((r) => r.join(",")).join("\n")
        : gridCsv(all, src.unit, src.rows);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${o.csvName ?? "kpi-values"}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    foot.appendChild(csv);
    for (const x of o.footer?.(handle) ?? []) foot.appendChild(x);
    wrap.appendChild(foot);
    wrap.appendChild(note);
    if (focusAfter) {
      const inp = inputs.get(`${focusAfter.row}|${focusAfter.col}`);
      if (inp) {
        inp.focus();
        inp.value = focusAfter.value;
        inp.setSelectionRange(focusAfter.sel, focusAfter.sel);
      }
      focusAfter = null;
    }
    // keep today's column in view
    const todayCell = scroll.querySelector(".app-vg-today") as HTMLElement | null;
    if (todayCell) {
      // today's column near the right edge, snapped to a column boundary
      const headW = (scroll.querySelector(".app-vg-rowhead") as HTMLElement | null)?.offsetWidth ?? 0;
      const want = todayCell.offsetLeft + todayCell.offsetWidth * 3 - scroll.clientWidth;
      const cols = [...scroll.querySelectorAll("thead tr:first-child th.app-vg-col")] as HTMLElement[];
      const snap = cols.find((c) => c.offsetLeft - headW >= want);
      scroll.scrollLeft = Math.max(0, snap ? snap.offsetLeft - headW : want);
    }
  };

  const handle: GridHandle = {
    refresh: async () => {
      await load();
      if (!dead) paint();
    },
    destroy: async () => {
      // commit the focused cell, then whatever is queued
      const active = document.activeElement as HTMLInputElement | null;
      if (active && wrap.contains(active) && active.dataset.row) active.dispatchEvent(new Event("change"));
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        await flush();
      }
      await flushing;
      dead = true;
      wrap.remove();
    },
    cells: () => all,
    foldTargets: async (from, to) => foldValues((await resolveRange(from, to)).map((c) => c.plan.value), src.aggregate),
  };

  wrap.appendChild(el("div", "app-cp-muted", "Loading…"));
  void load()
    .then(() => {
      if (dead) return;
      paint();
    })
    .catch((err) => {
      clear(wrap);
      wrap.appendChild(el("div", "app-board-note", `Values could not load: ${err instanceof Error ? err.message : String(err)}`));
    });
  return handle;
}

