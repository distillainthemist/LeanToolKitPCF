// The KpiTrendCard editor: a run chart (SVG) with an optional dashed target
// line and optional specification limits (USL/LSL). The latest value reads out
// large; readings go red only when they fall outside the spec limits. Tap a dot
// to edit it; ＋ adds a point; the kebab holds target/spec-limit settings.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet, svgEl } from "../../shared/ui/dom";
import { fieldRow, openDialog, sectionLabel, textInput } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { openActionManager } from "../../shared/ui/actionUi";
import { LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso, todayIso } from "../../shared/schema/id";
import { KpiPoint, KpiTrendEnvelope, SCHEMA_ID } from "./types";
import { KPITREND_CSS } from "./styles";

const VB_W = 640;
const VB_H = 300;
const M = { top: 14, right: 16, bottom: 34, left: 46 };

const DEFAULT_GHOST = [
  "No readings yet",
  "Add a value each day/week and watch the trend against target.",
];

export interface KpiTrendEditorCallbacks {
  onChange: (env: KpiTrendEnvelope) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
  /** The full card-level action set on every change (already scoped). */
  onActions?: (actions: LtkAction[]) => void;
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
  private readonly png: SnapshotScheduler;

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
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: KpiTrendEnvelope): void {
    this.env = env;
    this.render();
    this.png.schedule();
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

  destroy(): void {
    this.png.cancel();
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

  /** Does `value` fall outside a set specification limit (> USL or < LSL)? */
  private outOfSpec(value: number): boolean {
    const { usl, lsl } = this.env.data;
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
      renderKebab(this.root, [
        { label: n > 0 ? `Actions (${n})…` : "Raise action…", onClick: () => this.manage("", this.cardTitle) },
        { label: "Target & spec limits", onClick: () => this.editSettings() },
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-kt-body");
    this.root.appendChild(body);

    const { points, target, unit } = this.env.data;
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
      return;
    }

    // readout: latest value, red only when it is out of spec
    const latest = points[points.length - 1];
    const readout = el("div", "ltk-kt-readout");
    const current = el(
      "div",
      "ltk-kt-current",
      `${latest.value}${unit ? " " + unit : ""}`
    );
    if (this.outOfSpec(latest.value)) current.style.color = this.badColor();
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
      const add = el("button", "ltk-kt-add", "＋ Add reading");
      add.type = "button";
      add.addEventListener("click", () => this.editPoint(null));
      body.appendChild(add);
    }
  }

  private renderChart(): SVGSVGElement {
    const svg = svgEl("svg", {
      class: "ltk-kt-svg",
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: "xMidYMid meet",
    });
    const { points, target, usl, lsl } = this.env.data;
    const plotW = VB_W - M.left - M.right;
    const plotH = VB_H - M.top - M.bottom;

    const values = points.map((pt) => pt.value);
    if (target !== null) values.push(target);
    if (usl !== null) values.push(usl);
    if (lsl !== null) values.push(lsl);
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

    // target line
    if (target !== null) {
      const tl = svgEl("line", {
        x1: M.left, y1: y(target), x2: M.left + plotW, y2: y(target),
        "stroke-dasharray": "6 4", "stroke-width": 2,
      });
      (tl as SVGElement & { style: CSSStyleDeclaration }).style.stroke =
        this.theme.accent;
      (tl as SVGElement & { style: CSSStyleDeclaration }).style.opacity = "0.6";
      svg.appendChild(tl);
    }

    // spec-limit lines + small right-hand labels
    const limitLine = (value: number, label: string) => {
      const ly = clampY(y(value));
      const ln = svgEl("line", {
        x1: M.left, y1: ly, x2: M.left + plotW, y2: ly,
        "stroke-dasharray": "2 3", "stroke-width": 1.5,
      });
      const s = (ln as SVGElement & { style: CSSStyleDeclaration }).style;
      s.stroke = this.badColor();
      s.opacity = "0.8";
      svg.appendChild(ln);
      const t = svgEl("text", {
        x: M.left + plotW, y: ly - 3, class: "ltk-kt-limit", "text-anchor": "end",
      });
      t.textContent = `${label} ${value}`;
      svg.appendChild(t);
    };
    if (usl !== null) limitLine(usl, "USL");
    if (lsl !== null) limitLine(lsl, "LSL");

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
      const oos = this.outOfSpec(pt.value);
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
    this.png.schedule();
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
    if (point && !this.readOnly) {
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
          `${point.date}: ${point.value}${this.env.data.unit ? " " + this.env.data.unit : ""}`
        );
      });
      dlg.body.appendChild(actBtn);
    }
    value.focus();
  }

  private editSettings(): void {
    const numInput = (v: number | null, placeholder: string) =>
      textInput(v === null ? "" : String(v), { type: "number", placeholder });
    const target = numInput(this.env.data.target, "No target");
    const unit = textInput(this.env.data.unit, { placeholder: "e.g. %, units/hr" });
    const usl = numInput(this.env.data.usl, "None");
    const lsl = numInput(this.env.data.lsl, "None");

    const readNum = (input: HTMLInputElement): number | null => {
      const n = Number(input.value);
      return input.value.trim() !== "" && Number.isFinite(n) ? n : null;
    };

    const dlg = openDialog({
      host: this.root,
      title: "Target & spec limits",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            this.env.data.target = readNum(target);
            this.env.data.unit = unit.value.trim();
            this.env.data.usl = readNum(usl);
            this.env.data.lsl = readNum(lsl);
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    const row = (a: HTMLElement, b: HTMLElement) => {
      const r = el("div");
      r.style.display = "flex";
      r.style.gap = "12px";
      a.classList.add("ltk-field-half");
      b.classList.add("ltk-field-half");
      r.append(a, b);
      return r;
    };
    dlg.body.appendChild(row(fieldRow("Target", target), fieldRow("Unit", unit)));
    dlg.body.appendChild(sectionLabel("Specification limits (optional)"));
    dlg.body.appendChild(
      row(fieldRow("Upper (USL)", usl), fieldRow("Lower (LSL)", lsl))
    );
    target.focus();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + KPITREND_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + KPITREND_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "kpi-trend.svg")
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
