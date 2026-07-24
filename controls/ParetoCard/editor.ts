// The ParetoCard editor: descending bars + cumulative % line, drawn in SVG
// with a fixed viewBox so it scales to the card. Tap a bar to edit, ＋ to add.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet, svgEl } from "../../shared/ui/dom";
import { fieldRow, openDialog, textInput } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { openActionManager } from "../../shared/ui/actionUi";
import { LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import { ParetoEnvelope, ParetoItem, SCHEMA_ID } from "./types";
import { PARETO_CSS } from "./styles";

const VB_W = 640;
const VB_H = 340;
const M = { top: 16, right: 44, bottom: 100, left: 10 };
const LABEL_BAND = 54; // vertical room for the wrapped, auto-scaled label

const DEFAULT_GHOST = [
  "No counts yet",
  "Add the categories and how often each occurs — the vital few sort themselves to the front.",
];

export interface ParetoEditorCallbacks {
  onChange: (env: ParetoEnvelope) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
  /** The full card-level action set on every change (already scoped). */
  onActions?: (actions: LtkAction[]) => void;
}

export class ParetoEditor {
  private readonly root: HTMLElement;
  private env: ParetoEnvelope;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private people: Person[] = [];
  private actions: LtkAction[] = [];
  private canRaise = true;
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: ParetoEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-pareto-css", PARETO_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { items: [], unit: "" },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: ParetoEnvelope): void {
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

  /** The card's "Disable actions" setting (raise hidden, existing stay). */
  setCanRaise(on: boolean): void {
    if (this.canRaise !== on) {
      this.canRaise = on;
      this.render();
    }
  }

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  /** Live (open) actions for a source — "" is the card bucket, an item id
   *  is that bar's. Drives the kebab and per-bar badges. */
  private openFor(sourceId: string): number {
    return this.actions.filter(
      (a) =>
        a.context.sourceId === sourceId &&
        a.status !== "cancelled" &&
        a.status !== "done"
    ).length;
  }

  /** The actions surface for a source (card-level or one bar). */
  private manage(sourceId: string, label: string): void {
    openActionManager({
      host: this.root,
      actions: this.actions,
      source: "pareto",
      sourceId,
      seedIssue: label,
      people: this.people,
      doneColor: this.theme.legend[1] ?? "#107c10",
      readOnly: this.readOnly,
      canRaise: this.canRaise,
      onChanged: () => {
        this.cb.onActions?.(this.actions);
        this.render();
      },
    });
  }

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

    const body = el("div", "ltk-pa-body");
    this.root.appendChild(body);

    if (this.env.data.items.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(
        body,
        this.readOnly ? lines : [...lines, "Tap to add the first item"]
      );
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editItem(null));
      }
      return;
    }

    body.appendChild(this.renderChart());

    if (!this.readOnly) {
      const add = el("button", "ltk-pa-add", "＋ Add item");
      add.type = "button";
      add.addEventListener("click", () => this.editItem(null));
      body.appendChild(add);
    }
  }

  /**
   * Greedy word-wrap into lines no wider than `maxChars`; over-long single
   * words are hard-broken so nothing overflows.
   */
  private wrapLabel(text: string, maxChars: number): string[] {
    const lines: string[] = [];
    let cur = "";
    const flush = () => {
      if (cur !== "") {
        lines.push(cur);
        cur = "";
      }
    };
    for (let word of text.split(/\s+/).filter(Boolean)) {
      while (word.length > maxChars) {
        flush();
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (cur === "") cur = word;
      else if ((cur + " " + word).length <= maxChars) cur += " " + word;
      else {
        flush();
        cur = word;
      }
    }
    flush();
    return lines.length ? lines : [text];
  }

  /**
   * Pick the largest font (down to 8px) at which the wrapped label fits the
   * available width × the label band. Never truncates — at the floor size it
   * simply wraps to as many lines as it needs.
   */
  private fitLabel(text: string, widthPx: number): { lines: string[]; fontPx: number } {
    let result = { lines: [text], fontPx: 8 };
    for (let f = 12; f >= 8; f--) {
      const charsPerLine = Math.max(3, Math.floor(widthPx / (f * 0.56)));
      const lines = this.wrapLabel(text, charsPerLine);
      const maxLines = Math.max(1, Math.floor(LABEL_BAND / Math.round(f * 1.2)));
      result = { lines, fontPx: f };
      if (lines.length <= maxLines) break;
    }
    return result;
  }

  private renderChart(): SVGSVGElement {
    const svg = svgEl("svg", {
      class: "ltk-pa-svg",
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: "xMidYMid meet",
    });
    const items = this.env.data.items
      .slice()
      .sort((a, b) => b.count - a.count);
    const total = items.reduce((s, i) => s + i.count, 0) || 1;
    const maxCount = Math.max(...items.map((i) => i.count), 1);

    const plotW = VB_W - M.left - M.right;
    const plotH = VB_H - M.top - M.bottom;
    const slot = plotW / items.length;
    const barW = Math.min(64, slot * 0.7);
    const barColour = this.theme.legend[0] ?? this.theme.accent;
    const lineColour = this.theme.legend[2] ?? "#d13438";

    // baseline
    svg.appendChild(
      svgEl("line", {
        x1: M.left,
        y1: M.top + plotH,
        x2: M.left + plotW,
        y2: M.top + plotH,
        class: "ltk-pa-axis",
      })
    );

    let cumulative = 0;
    const linePoints: string[] = [];
    items.forEach((item, i) => {
      const cx = M.left + slot * i + slot / 2;
      const h = (item.count / maxCount) * (plotH - 14);
      const y = M.top + plotH - h;

      const bar = svgEl("rect", {
        x: cx - barW / 2,
        y,
        width: barW,
        height: Math.max(2, h),
        rx: 4,
        class: "ltk-pa-bar" + (this.readOnly ? " ltk-readonly" : ""),
      });
      (bar as SVGElement & { style: CSSStyleDeclaration }).style.fill = barColour;
      if (!this.readOnly) {
        bar.addEventListener("click", () => this.editItem(item));
      }
      svg.appendChild(bar);

      const value = svgEl("text", {
        x: cx,
        y: y - 5,
        class: "ltk-pa-value",
        "text-anchor": "middle",
      });
      value.textContent = String(item.count);
      svg.appendChild(value);

      // open-action badge on the bar's top-right corner
      const nAct = this.openFor(item.id);
      if (nAct > 0) {
        const bx = cx + barW / 2;
        const badge = svgEl("circle", {
          cx: bx, cy: y, r: 8, class: "ltk-pa-actbadge",
        });
        (badge as SVGElement & { style: CSSStyleDeclaration }).style.fill =
          this.theme.accent;
        svg.appendChild(badge);
        const bt = svgEl("text", {
          x: bx, y: y + 3.5, "text-anchor": "middle", class: "ltk-pa-actbadge-t",
        });
        bt.textContent = String(nAct);
        svg.appendChild(bt);
      }

      // label under the bar: wraps to multiple lines and scales its font
      // down so the whole text shows without truncation (tap to edit)
      const labelTop = M.top + plotH + 6;
      const { lines, fontPx } = this.fitLabel(item.label, slot - 6);
      const label = svgEl("text", {
        x: cx,
        class: "ltk-pa-label" + (this.readOnly ? "" : " ltk-pa-labelclick"),
        "text-anchor": "middle",
      });
      // inline style beats the class' font-size so the scaling actually applies
      (label as SVGElement & { style: CSSStyleDeclaration }).style.fontSize =
        `${fontPx}px`;
      lines.forEach((ln, li) => {
        const ts = svgEl("tspan", {
          x: cx,
          y: labelTop + fontPx + li * Math.round(fontPx * 1.2),
        });
        ts.textContent = ln;
        label.appendChild(ts);
      });
      const tip = svgEl("title", {});
      tip.textContent = `${item.label}: ${item.count}`;
      label.appendChild(tip);
      if (!this.readOnly) {
        label.addEventListener("click", () => this.editItem(item));
      }
      svg.appendChild(label);

      // quick-tally increment button beneath the label band — bump the
      // count live from the chart (a Pareto often builds up during a huddle)
      if (!this.readOnly) {
        const by = M.top + plotH + LABEL_BAND + 20;
        const inc = svgEl("g", { class: "ltk-pa-inc" });
        inc.appendChild(svgEl("circle", { cx, cy: by, r: 11, class: "ltk-pa-inc-circle" }));
        inc.appendChild(
          svgEl("path", {
            d: `M ${cx - 4} ${by} H ${cx + 4} M ${cx} ${by - 4} V ${by + 4}`,
            class: "ltk-pa-inc-plus",
          })
        );
        // transparent circle on top widens the tap target to ~30px
        inc.appendChild(svgEl("circle", { cx, cy: by, r: 15, class: "ltk-pa-inc-hit" }));
        const itip = svgEl("title", {});
        itip.textContent = `Add one to "${item.label}"`;
        inc.appendChild(itip);
        inc.addEventListener("click", (e) => {
          e.stopPropagation();
          item.count += 1;
          this.commit();
        });
        svg.appendChild(inc);
      }

      cumulative += item.count;
      const py = M.top + plotH - (cumulative / total) * plotH;
      linePoints.push(`${cx},${py}`);
    });

    // cumulative % line + right-hand scale
    if (items.length > 1) {
      const line = svgEl("polyline", {
        points: linePoints.join(" "),
        fill: "none",
        "stroke-width": 2,
        "stroke-linejoin": "round",
      });
      (line as SVGElement & { style: CSSStyleDeclaration }).style.stroke =
        lineColour;
      svg.appendChild(line);
      linePoints.forEach((pt) => {
        const [x, y] = pt.split(",").map(Number);
        const dot = svgEl("circle", { cx: x, cy: y, r: 3 });
        (dot as SVGElement & { style: CSSStyleDeclaration }).style.fill =
          lineColour;
        svg.appendChild(dot);
      });
      for (const pct of [0, 50, 100]) {
        const t = svgEl("text", {
          x: VB_W - M.right + 8,
          y: M.top + plotH - (pct / 100) * plotH + 3,
          class: "ltk-pa-pct",
        });
        t.textContent = `${pct}%`;
        svg.appendChild(t);
      }
    }
    return svg;
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.png.schedule();
  }

  private editItem(item: ParetoItem | null): void {
    const label = textInput(item?.label ?? "", {
      placeholder: hintFor(this.prompts, "label", "Category"),
    });
    const count = textInput(String(item?.count ?? ""), { type: "number" });
    const buttons = [];
    if (item) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.items = this.env.data.items.filter(
            (i) => i.id !== item.id
          );
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
      label: item ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const text = label.value.trim();
        const n = Math.max(0, Math.round(Number(count.value) || 0));
        if (text === "") return;
        if (item) {
          item.label = text;
          item.count = n;
        } else {
          this.env.data.items.push({ id: newId("p"), label: text, count: n });
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: item ? "Edit item" : "Add item",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Category", label));
    const countRow = fieldRow("Count", count);
    countRow.classList.add("ltk-field-half");
    dlg.body.appendChild(countRow);
    // per-category actions (existing items only)
    if (item && !this.readOnly && (this.canRaise || this.openFor(item.id) > 0)) {
      const n = this.openFor(item.id);
      const actBtn = el(
        "button",
        "ltk-btn ltk-btn-secondary",
        n > 0 ? `Actions (${n})…` : "＋ Raise action on this category"
      );
      (actBtn as HTMLButtonElement).type = "button";
      actBtn.addEventListener("click", () => {
        dlg.close();
        this.manage(item.id, item.label);
      });
      dlg.body.appendChild(actBtn);
    }
    label.focus();
  }

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + PARETO_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + PARETO_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "pareto.svg")
    );
  }

private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + PARETO_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "pareto.png";
      link.click();
    });
  }
}
