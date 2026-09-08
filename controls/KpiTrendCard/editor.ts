// The KpiTrendCard editor: a run chart (SVG) with an optional dashed target
// line and optional specification limits (USL/LSL). The latest value reads out
// large; readings go red only when they fall outside the spec limits. Tap a dot
// to edit it; ＋ adds a point. Target / spec limits / unit come from card
// settings (setSpec), with the card's own document as the legacy fallback.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet, svgEl } from "../../shared/ui/dom";
import { fieldRow, openDialog, textInput } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { openActionManager } from "../../shared/ui/actionUi";
import { LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso, todayIso } from "../../shared/schema/id";
import { KpiPoint, KpiTrendEnvelope, SCHEMA_ID } from "./types";
import { EMPTY_SPEC_SERIES, specFor, SpecSeries } from "../../shared/schema/specSeries";
import { KPITREND_CSS } from "./styles";

const VB_W = 640;
const VB_H = 300;
const M = { top: 14, right: 16, bottom: 34, left: 46 };

const DEFAULT_GHOST = [
  "No readings yet",
  "Add a value each day/week and watch the trend against target.",
];

/**
 * Target / spec limits / unit, sourced from the card's settings so they sit
 * with the rest of its configuration. A blank field falls back to the card's
 * own document, which keeps cards configured in-card before the settings
 * move rendering correctly.
 */
export interface KpiSpec {
  target: number | null;
  usl: number | null;
  lsl: number | null;
  unit: string;
}

export interface KpiTrendEditorCallbacks {
  onChange: (env: KpiTrendEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
  /** The full card-level action set on every change (already scoped). */
  onActions?: (actions: LtkAction[]) => void;
  /** Grid entry (a column per period) — the host opens it; the button
   *  shows only when set. */
  onGrid?: () => void;
}

export class KpiTrendEditor {
  private readonly root: HTMLElement;
  private env: KpiTrendEnvelope;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private people: Person[] = [];
  private actions: LtkAction[] = [];
  private canRaise = true;
  /** Host-supplied spec (see KpiSpec) — card settings are the only place
   *  these are set; blank fields fall back to the document. */
  private spec: KpiSpec = { target: null, usl: null, lsl: null, unit: "" };
  /** Per-period spec (grid entry): dated target/limit points that carry
   *  forward; the level spec above is the fallback. */
  private specSeries: SpecSeries = EMPTY_SPEC_SERIES;
  private readonly snapshots: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: KpiTrendEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-kpitrend-css", KPITREND_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { points: [], target: null, usl: null, lsl: null, unit: "" },
    };
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    this.render();
  }

  setEnvelope(env: KpiTrendEnvelope): void {
    this.env = env;
    this.render();
    this.snapshots.schedule();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) {
      return;
    }
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  /** The roster for the action assignee picker. */
  setPeople(people: Person[]): void {
    this.people = people;
  }

  /** This card's actions from the central table (drives the badge). */
  setActions(actions: LtkAction[]): void {
    this.actions = actions;
    this.render();
  }

  /** Target / spec limits / unit from the card's settings. */
  setSpec(spec: KpiSpec): void {
    if (JSON.stringify(spec) === JSON.stringify(this.spec)) return;
    this.spec = spec;
    this.render();
    this.snapshots.schedule();
  }

  /** The dated per-period spec (target / limits that change over time). */
  setSpecSeries(series: SpecSeries): void {
    if (JSON.stringify(series) === JSON.stringify(this.specSeries)) return;
    this.specSeries = series;
    this.render();
    this.snapshots.schedule();
  }

  /** The spec in force on a date: the latest dated point at or before it,
   *  else the level spec. */
  private specAt(date: string): KpiSpec {
    const level = this.effectiveSpec();
    return { ...specFor(this.specSeries, date, level), unit: level.unit };
  }

  private hasSpecSeries(): boolean {
    return this.specSeries.target.length + this.specSeries.usl.length + this.specSeries.lsl.length > 0;
  }

  /**
   * The values actually drawn: settings first, document as the fallback.
   * The fallback is for cards configured in-card before the settings move —
   * legacy data, not a second owner.
   */
  private effectiveSpec(): KpiSpec {
    const d = this.env.data;
    return {
      target: this.spec.target ?? d.target,
      usl: this.spec.usl ?? d.usl,
      lsl: this.spec.lsl ?? d.lsl,
      unit: this.spec.unit !== "" ? this.spec.unit : d.unit,
    };
  }

  /** The card's "Disable actions" setting (raise hidden, existing stay). */
  setCanRaise(on: boolean): void {
    if (this.canRaise !== on) {
      this.canRaise = on;
      this.render();
    }
  }

  destroy(): void {
    this.snapshots.cancel();
    this.root.remove();
  }

  /** Live (open) actions for a source — "" is the card bucket, a point id
   *  is that reading's. Drives the kebab and per-dot badges. */
  private openFor(sourceId: string): number {
    return this.actions.filter(
      (a) =>
        a.context.sourceId === sourceId &&
        a.status !== "cancelled" &&
        a.status !== "done"
    ).length;
  }

  /** The actions surface for a source (card-level or one reading). */
  private manage(sourceId: string, label: string): void {
    openActionManager({
      host: this.root,
      actions: this.actions,
      source: "kpitrend",
      sourceId,
      seedIssue: label,
      people: this.people,
      doneColor: this.goodColor(),
      readOnly: this.readOnly,
      canRaise: this.canRaise,
      onChanged: () => {
        this.cb.onActions?.(this.actions);
        this.render();
      },
    });
  }

  // ---- theming ----

  private goodColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }
  private badColor(): string {
    return this.theme.legend[2] ?? "#d13438";
  }

  /** Does a reading fall outside the specification limits in force on
   *  its date (> USL or < LSL)? */
  private outOfSpec(value: number, date: string): boolean {
    const { usl, lsl } = this.specAt(date);
    return (usl !== null && value > usl) || (lsl !== null && value < lsl);
  }

  // ---- rendering ----

  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      const n = this.openFor("");
      const items = [];
      if (n > 0 || this.canRaise) {
        items.push({
          label: n > 0 ? `Actions (${n})…` : "Raise action…",
          onClick: () => this.manage("", this.cardTitle),
        });
      }
      items.push(
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() }
      );
      renderKebab(this.root, items);
    }

    const body = el("div", "ltk-kt-body");
    this.root.appendChild(body);

    const { points } = this.env.data;
    const gridBtn = (): HTMLElement | null => {
      if (this.readOnly || !this.cb.onGrid) return null;
      const g = el("button", "ltk-kt-add ltk-kt-grid", "⊞ Grid…");
      g.type = "button";
      g.title = "Enter targets, limits and actuals period by period";
      g.addEventListener("click", () => this.cb.onGrid?.());
      return g;
    };
    if (points.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(
        body,
        this.readOnly ? lines : [...lines, "Tap to add the first reading"]
      );
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editPoint(null));
      }
      const g = gridBtn();
      if (g) body.appendChild(g);
      return;
    }

    // readout: latest value, red only when it is out of the spec in force
    // on its date; the target shown is that date's too
    const latest = points[points.length - 1];
    const { target, unit } = this.specAt(latest.date);
    const readout = el("div", "ltk-kt-readout");
    const current = el(
      "div",
      "ltk-kt-current",
      `${latest.value}${unit ? " " + unit : ""}`
    );
    if (this.outOfSpec(latest.value, latest.date)) current.style.color = this.badColor();
    readout.appendChild(current);
    if (target !== null) {
      readout.appendChild(
        el(
          "div",
          "ltk-kt-target",
          `Target ${target}${unit ? " " + unit : ""}`
        )
      );
    }
    body.appendChild(readout);

    body.appendChild(this.renderChart());

    if (!this.readOnly) {
      const acts = el("div", "ltk-kt-acts");
      const add = el("button", "ltk-kt-add", "＋ Add reading");
      add.type = "button";
      add.addEventListener("click", () => this.editPoint(null));
      acts.appendChild(add);
      const g = gridBtn();
      if (g) acts.appendChild(g);
      body.appendChild(acts);
    }
  }

  private renderChart(): SVGSVGElement {
    const svg = svgEl("svg", {
      class: "ltk-kt-svg",
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: "xMidYMid meet",
    });
    const { points } = this.env.data;
    // the spec in force at each reading (a step function when the grid
    // has set per-period targets; flat otherwise)
    const specs = points.map((pt) => this.specAt(pt.date));
    const latestSpec = specs[specs.length - 1] ?? this.effectiveSpec();
    const { target, usl, lsl } = latestSpec;
    const plotW = VB_W - M.left - M.right;
    const plotH = VB_H - M.top - M.bottom;

    const values = points.map((pt) => pt.value);
    for (const sp of specs) {
      if (sp.target !== null) values.push(sp.target);
      if (sp.usl !== null) values.push(sp.usl);
      if (sp.lsl !== null) values.push(sp.lsl);
    }
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;

    const x = (i: number) =>
      M.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;

    // spec-limit zones (drawn first, behind everything): the band between the
    // limits reads as "in spec" (faint good tint); beyond a limit is
    // "out of spec" (faint bad tint)
    const topY = M.top;
    const botY = M.top + plotH;
    const clampY = (v: number) => Math.max(topY, Math.min(botY, v));
    if (usl !== null || lsl !== null) {
      const zone = (y1: number, y2: number, colour: string, opacity: number) => {
        if (y2 - y1 <= 0.5) return;
        const rect = svgEl("rect", {
          x: M.left, y: y1, width: plotW, height: y2 - y1,
        });
        const s = (rect as SVGElement & { style: CSSStyleDeclaration }).style;
        s.fill = colour;
        s.opacity = String(opacity);
        svg.appendChild(rect);
      };
      const bandTop = usl !== null ? clampY(y(usl)) : topY;
      const bandBot = lsl !== null ? clampY(y(lsl)) : botY;
      zone(bandTop, bandBot, this.goodColor(), 0.08); // in-spec band
      if (usl !== null) zone(topY, clampY(y(usl)), this.badColor(), 0.1); // above USL
      if (lsl !== null) zone(clampY(y(lsl)), botY, this.badColor(), 0.1); // below LSL
    }

    // axes + y ticks
    svg.appendChild(
      svgEl("line", {
        x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH,
        class: "ltk-kt-axis",
      })
    );
    for (const v of [lo + pad, (lo + hi) / 2, hi - pad]) {
      const t = svgEl("text", {
        x: M.left - 6, y: y(v) + 3, class: "ltk-kt-tick", "text-anchor": "end",
      });
      t.textContent = String(Math.round(v * 100) / 100);
      svg.appendChild(t);
    }
    // x tick labels: first + last dates
    const first = svgEl("text", {
      x: x(0), y: VB_H - 12, class: "ltk-kt-tick", "text-anchor": "start",
    });
    first.textContent = points[0].date.slice(5);
    svg.appendChild(first);
    if (points.length > 1) {
      const last = svgEl("text", {
        x: x(points.length - 1), y: VB_H - 12, class: "ltk-kt-tick", "text-anchor": "end",
      });
      last.textContent = points[points.length - 1].date.slice(5);
      svg.appendChild(last);
    }

    // a spec line: flat across the plot when constant, a step through the
    // readings' dates when the grid has set per-period values
    const stepPath = (valueAt: (i: number) => number | null): string => {
      const vals = points.map((_, i) => valueAt(i));
      const first = vals.find((v) => v !== null);
      if (first === undefined || first === null) return "";
      const constant = vals.every((v) => v === null || v === first);
      if (constant || points.length === 1) {
        const ly = clampY(y(first));
        return `M ${M.left} ${ly} H ${M.left + plotW}`;
      }
      let d = "";
      let cur: number | null = null;
      vals.forEach((v, i) => {
        const val = v ?? cur;
        if (val === null) return;
        const ly = clampY(y(val));
        const px = x(i);
        if (d === "") d = `M ${M.left} ${ly} H ${px}`;
        else if (cur !== null && val !== cur) d += ` H ${px} V ${ly}`;
        cur = val;
      });
      if (cur !== null) d += ` H ${M.left + plotW}`;
      return d;
    };
    // target line
    const targetD = stepPath((i) => specs[i].target);
    if (targetD !== "") {
      const tl = svgEl("path", {
        d: targetD, fill: "none",
        "stroke-dasharray": "6 4", "stroke-width": 2,
      });
      (tl as SVGElement & { style: CSSStyleDeclaration }).style.stroke =
        this.theme.accent;
      (tl as SVGElement & { style: CSSStyleDeclaration }).style.opacity = "0.6";
      svg.appendChild(tl);
    }

    // spec-limit lines + small right-hand labels (the latest value)
    const limitLine = (valueAt: (i: number) => number | null, latest: number, label: string) => {
      const d = stepPath(valueAt);
      if (d === "") return;
      const ln = svgEl("path", {
        d, fill: "none",
        "stroke-dasharray": "2 3", "stroke-width": 1.5,
      });
      const s = (ln as SVGElement & { style: CSSStyleDeclaration }).style;
      s.stroke = this.badColor();
      s.opacity = "0.8";
      svg.appendChild(ln);
      const t = svgEl("text", {
        x: M.left + plotW, y: clampY(y(latest)) - 3, class: "ltk-kt-limit", "text-anchor": "end",
      });
      t.textContent = `${label} ${latest}`;
      svg.appendChild(t);
    };
    if (usl !== null) limitLine((i) => specs[i].usl, usl, "USL");
    if (lsl !== null) limitLine((i) => specs[i].lsl, lsl, "LSL");

    // the line + dots
    const line = svgEl("polyline", {
      points: points.map((pt, i) => `${x(i)},${y(pt.value)}`).join(" "),
      fill: "none",
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    });
    (line as SVGElement & { style: CSSStyleDeclaration }).style.stroke =
      this.theme.foreground;
    svg.appendChild(line);

    points.forEach((pt, i) => {
      // a reading is flagged red (and larger) only when it is out of spec;
      // otherwise it stays neutral
      const oos = this.outOfSpec(pt.value, pt.date);
      const dot = svgEl("circle", {
        cx: x(i), cy: y(pt.value), r: oos ? 7 : 5,
        class: "ltk-kt-dot" + (this.readOnly ? " ltk-readonly" : ""),
      });
      (dot as SVGElement & { style: CSSStyleDeclaration }).style.fill = oos
        ? this.badColor()
        : this.theme.foreground;
      const nAct = this.openFor(pt.id);
      const tip = svgEl("title", {});
      tip.textContent =
        `${pt.date}: ${pt.value}` +
        (oos ? " — out of spec" : "") +
        (nAct > 0 ? ` — ${nAct} open action${nAct === 1 ? "" : "s"}` : "");
      dot.appendChild(tip);
      // a reading with open actions gets an accent ring
      if (nAct > 0) {
        const ring = svgEl("circle", {
          cx: x(i), cy: y(pt.value), r: (oos ? 7 : 5) + 3,
          fill: "none", "stroke-width": 2,
        });
        (ring as SVGElement & { style: CSSStyleDeclaration }).style.stroke =
          this.theme.accent;
        (ring as SVGElement & { style: CSSStyleDeclaration }).style.pointerEvents = "none";
        svg.appendChild(ring);
      }
      if (!this.readOnly) {
        dot.addEventListener("click", () => this.editPoint(pt));
      }
      svg.appendChild(dot);
    });
    return svg;
  }

  // ---- mutations ----

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.env.data.points.sort((a, b) => (a.date < b.date ? -1 : 1));
    this.render();
    this.cb.onChange(this.env);
    this.snapshots.schedule();
  }

  private editPoint(point: KpiPoint | null): void {
    const date = textInput(point?.date ?? todayIso(), { type: "date" });
    const value = textInput(point !== null ? String(point.value) : "", {
      type: "number",
    });
    const buttons = [];
    if (point) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.points = this.env.data.points.filter((p) => p !== point);
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({
      label: "Cancel",
      kind: "secondary" as const,
      onClick: () => dlg.close(),
    });
    buttons.push({
      label: point ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const v = Number(value.value);
        if (date.value === "" || !Number.isFinite(v)) return;
        if (point) {
          point.date = date.value;
          point.value = v;
        } else {
          // one reading per date — a re-entry updates in place (keeping its
          // id, so any actions on it survive) rather than replacing
          const existing = this.env.data.points.find((p) => p.date === date.value);
          if (existing) {
            existing.value = v;
          } else {
            this.env.data.points.push({ id: newId("k"), date: date.value, value: v });
          }
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: point ? "Edit reading" : "Add reading",
      buttons,
    });
    const dateRow = fieldRow("Date", date);
    dateRow.classList.add("ltk-field-half");
    dlg.body.appendChild(dateRow);
    const valueRow = fieldRow("Value", value);
    valueRow.classList.add("ltk-field-half");
    dlg.body.appendChild(valueRow);
    // per-reading actions (existing readings only)
    if (point && !this.readOnly && (this.canRaise || this.openFor(point.id) > 0)) {
      const n = this.openFor(point.id);
      const actBtn = el(
        "button",
        "ltk-btn ltk-btn-secondary",
        n > 0 ? `Actions (${n})…` : "＋ Raise action on this reading"
      );
      (actBtn as HTMLButtonElement).type = "button";
      actBtn.addEventListener("click", () => {
        dlg.close();
        this.manage(
          point.id,
          `${point.date}: ${point.value}${this.effectiveSpec().unit ? " " + this.effectiveSpec().unit : ""}`
        );
      });
      dlg.body.appendChild(actBtn);
    }
    value.focus();
  }

  // ---- snapshot + downloads ----

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, LTK_BASE_CSS + KPITREND_CSS, this.theme.background, (svg) =>
      this.cb.onSnapshot!(svg)
    );
  }

    private downloadSvg(): void {
    htmlToSvg(this.root, LTK_BASE_CSS + KPITREND_CSS, this.theme.background, (svg) =>
      saveSvg(svg, "kpi-trend.svg")
    );
  }

private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + KPITREND_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "kpi-trend.png";
      link.click();
    });
  }
}
