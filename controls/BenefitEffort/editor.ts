// The BenefitEffort editor: a 2×2 canvas (benefit up, effort right). Drag a
// chip to reposition it; tap to edit. Quadrant labels are overridable via
// prompts fields (quadTL, quadTR, quadBL, quadBR).

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { checkItem, fieldRow, openDialog, textArea } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import { BenefitEffortEnvelope, BenefitEffortItem, SCHEMA_ID } from "./types";
import { BENEFITEFFORT_CSS } from "./styles";

export interface BenefitEffortEditorCallbacks {
  onChange: (env: BenefitEffortEnvelope) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

export class BenefitEffortEditor {
  private readonly root: HTMLElement;
  private env: BenefitEffortEnvelope;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  private canvas: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  // set while dragging a chip so the drop's trailing click doesn't add an item
  private suppressCanvasClick = false;

  constructor(
    host: HTMLElement,
    private readonly cb: BenefitEffortEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-benefiteffort-css", BENEFITEFFORT_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { items: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: BenefitEffortEnvelope): void {
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

  // quadrant priority colours (opacity applied in CSS)
  private goodColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }
  private warnColor(): string {
    return this.theme.legend[0] ?? "#f2c811";
  }
  private badColor(): string {
    return this.theme.legend[2] ?? "#d13438";
  }
  private infoColor(): string {
    return this.theme.legend[3] ?? "#2b88d8";
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

    const body = el("div", "ltk-be-body");
    this.root.appendChild(body);

    // plot = a grid with a left gutter for the (rotated) Benefit label and a
    // bottom gutter for the Effort label, so both axes read outside the canvas.
    // The grid is always shown (even empty) so it can be tapped to place items.
    const plot = el("div", "ltk-be-plot");
    const yaxis = el("div", "ltk-be-yaxis");
    yaxis.appendChild(el("span", undefined, "Benefit →"));
    plot.appendChild(yaxis);

    const canvas = el("div", "ltk-be-canvas");
    if (!this.readOnly) canvas.classList.add("ltk-be-canvas-live");
    this.canvas = canvas;

    // quadrant priority shading (behind the grid lines and chips):
    // quick wins green, major projects blue, fill-ins amber, thankless red
    const shades: [Partial<CSSStyleDeclaration>, string][] = [
      [{ top: "0", left: "0" }, this.goodColor()],
      [{ top: "0", right: "0" }, this.infoColor()],
      [{ bottom: "0", left: "0" }, this.warnColor()],
      [{ bottom: "0", right: "0" }, this.badColor()],
    ];
    for (const [pos, colour] of shades) {
      const s = el("div", "ltk-be-shade");
      Object.assign(s.style, pos);
      s.style.background = colour;
      canvas.appendChild(s);
    }

    canvas.append(el("div", "ltk-be-mid-h"), el("div", "ltk-be-mid-v"));

    const quads: [string, Partial<CSSStyleDeclaration>][] = [
      [hintFor(this.prompts, "quadTL", "Quick wins"), { top: "0", left: "0" }],
      [hintFor(this.prompts, "quadTR", "Major projects"), { top: "0", right: "0" }],
      [hintFor(this.prompts, "quadBL", "Fill-ins"), { bottom: "0", left: "0" }],
      [hintFor(this.prompts, "quadBR", "Thankless"), { bottom: "0", right: "0" }],
    ];
    for (const [text, pos] of quads) {
      const q = el("div", "ltk-be-quad", text);
      Object.assign(q.style, pos);
      canvas.appendChild(q);
    }

    // tap any blank spot on the grid to add an item positioned there
    if (!this.readOnly) {
      canvas.addEventListener("click", (e) => {
        // ignore the click that trails a chip drop
        if (this.suppressCanvasClick) return;
        if ((e.target as HTMLElement).closest(".ltk-be-chip")) return;
        const r = canvas.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const effort = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const benefit = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
        this.editItem(null, { benefit, effort });
      });
      if (this.env.data.items.length === 0) {
        canvas.appendChild(
          el("div", "ltk-be-emptyhint", "Tap anywhere on the grid to add an item")
        );
      }
    }

    for (const item of this.env.data.items) {
      canvas.appendChild(this.renderChip(item));
    }
    plot.appendChild(canvas);
    plot.appendChild(el("div", "ltk-be-xaxis", "Effort →"));
    body.appendChild(plot);

    if (!this.readOnly) {
      const add = el("button", "ltk-be-add", "＋ Add item");
      add.type = "button";
      add.addEventListener("click", () => this.editItem(null));
      body.appendChild(add);
    }
  }

  private renderChip(item: BenefitEffortItem): HTMLElement {
    const chip = el("div", "ltk-be-chip");
    if (item.priority) {
      chip.classList.add("ltk-be-priority");
      chip.style.borderLeftColor = this.theme.accent;
      const star = el("span", "ltk-be-star", "★");
      star.style.color = this.theme.accent;
      chip.appendChild(star);
    }
    chip.appendChild(document.createTextNode(item.text));
    chip.title = item.priority ? `★ ${item.text}` : item.text;
    if (this.readOnly) chip.classList.add("ltk-readonly");
    chip.style.left = `${item.effort * 100}%`;
    chip.style.top = `${(1 - item.benefit) * 100}%`;

    if (!this.readOnly) {
      makeInteractive(chip, {
        onTap: () => this.editItem(item),
        onStart: () => {
          this.suppressCanvasClick = true;
          const ghost = chip.cloneNode(true) as HTMLElement;
          ghost.classList.add("ltk-be-ghost");
          this.root.appendChild(ghost);
          this.ghost = ghost;
          chip.classList.add("ltk-be-dragging");
        },
        onMove: (e) => {
          if (!this.ghost) return;
          this.ghost.style.left = `${e.clientX}px`;
          this.ghost.style.top = `${e.clientY}px`;
        },
        onEnd: (e) => {
          if (this.ghost) this.ghost.remove();
          this.ghost = null;
          chip.classList.remove("ltk-be-dragging");
          if (!this.canvas) return;
          const r = this.canvas.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          item.effort = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          item.benefit = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
          this.commit();
          // release the click guard once the drop's trailing click has passed
          setTimeout(() => {
            this.suppressCanvasClick = false;
          }, 250);
        },
      });
    }
    return chip;
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.png.schedule();
  }

  private editItem(
    item: BenefitEffortItem | null,
    at?: { benefit: number; effort: number }
  ): void {
    const ta = textArea(item?.text ?? "", {
      placeholder: hintFor(this.prompts, "item", "Solution / idea"),
      rows: 2,
    });
    const priorityChk = checkItem("Take forward (priority)");
    priorityChk.box.checked = item?.priority ?? false;
    priorityChk.wrap.classList.toggle("ltk-check-on", priorityChk.box.checked);

    const buttons = [];
    if (item) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.items = this.env.data.items.filter((i) => i.id !== item.id);
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
        const text = ta.value.trim();
        if (text === "") return;
        if (item) {
          item.text = text;
          item.priority = priorityChk.box.checked;
        } else {
          this.env.data.items.push({
            id: newId("b"),
            text,
            benefit: at?.benefit ?? 0.5,
            effort: at?.effort ?? 0.5,
            priority: priorityChk.box.checked,
          });
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
    dlg.body.appendChild(fieldRow("Item", ta));
    dlg.body.appendChild(priorityChk.wrap);
    ta.focus();
  }

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + BENEFITEFFORT_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + BENEFITEFFORT_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "benefit-effort.png";
      link.click();
    });
  }
}
