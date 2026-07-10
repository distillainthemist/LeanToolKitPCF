// The ParetoCard editor: descending bars + cumulative % line, drawn in SVG
// with a fixed viewBox so it scales to the card. Tap a bar to edit, ＋ to add.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet, svgEl } from "../../shared/ui/dom";
import { fieldRow, openDialog, textInput } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import { ParetoEnvelope, ParetoItem, SCHEMA_ID } from "./types";
import { PARETO_CSS } from "./styles";

const VB_W = 640;
const VB_H = 340;
const M = { top: 16, right: 44, bottom: 58, left: 10 };

const DEFAULT_GHOST = [
  "No counts yet",
  "Add the categories and how often each occurs — the vital few sort themselves to the front.",
];

export interface ParetoEditorCallbacks {
  onChange: (env: ParetoEnvelope) => void;
  onPngReady?: (dataUri: string) => void;
}

export class ParetoEditor {
  private readonly root: HTMLElement;
  private env: ParetoEnvelope;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
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

  destroy(): void {
    this.png.cancel();
    this.root.remove();
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
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
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

      // label under the bar, trimmed
      const label = svgEl("text", {
        x: cx,
        y: M.top + plotH + 16,
        class: "ltk-pa-label",
        "text-anchor": "middle",
      });
      const maxChars = Math.max(4, Math.floor(slot / 6.2));
      label.textContent =
        item.label.length > maxChars
          ? item.label.slice(0, maxChars - 1) + "…"
          : item.label;
      const tip = svgEl("title", {});
      tip.textContent = `${item.label}: ${item.count}`;
      label.appendChild(tip);
      svg.appendChild(label);

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
    label.focus();
  }

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + PARETO_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
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
