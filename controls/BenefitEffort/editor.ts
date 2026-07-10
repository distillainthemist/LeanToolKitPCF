// The BenefitEffort editor: a 2×2 canvas (benefit up, effort right). Drag a
// chip to reposition it; tap to edit. Quadrant labels are overridable via
// prompts fields (quadTL, quadTR, quadBL, quadBR).

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, textArea } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { makeInteractive } from "../../shared/interact/drag";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso } from "../../shared/schema/id";
import { BenefitEffortEnvelope, BenefitEffortItem, SCHEMA_ID } from "./types";
import { BENEFITEFFORT_CSS } from "./styles";

const DEFAULT_GHOST = [
  "Nothing to prioritise yet",
  "Add the candidate solutions, then drag them by benefit and effort — quick wins rise to the top left.",
];

export interface BenefitEffortEditorCallbacks {
  onChange: (env: BenefitEffortEnvelope) => void;
  onPngReady?: (dataUri: string) => void;
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

    const canvas = el("div", "ltk-be-canvas");
    this.canvas = canvas;
    canvas.append(el("div", "ltk-be-mid-h"), el("div", "ltk-be-mid-v"));

    const quads: [string, string, Partial<CSSStyleDeclaration>][] = [
      [hintFor(this.prompts, "quadTL", "Quick wins"), "ltk-be-quad", { top: "0", left: "0" }],
      [hintFor(this.prompts, "quadTR", "Major projects"), "ltk-be-quad", { top: "0", right: "0" }],
      [hintFor(this.prompts, "quadBL", "Fill-ins"), "ltk-be-quad", { bottom: "0", left: "0" }],
      [hintFor(this.prompts, "quadBR", "Thankless"), "ltk-be-quad", { bottom: "0", right: "0" }],
    ];
    for (const [text, cls, pos] of quads) {
      const q = el("div", cls, text);
      Object.assign(q.style, pos);
      canvas.appendChild(q);
    }
    const axisB = el("div", "ltk-be-axis", "▲ Benefit");
    Object.assign(axisB.style, { left: "6px", top: "50%", transform: "translateY(-140%)" });
    canvas.appendChild(axisB);
    const axisE = el("div", "ltk-be-axis", "Effort ▶");
    Object.assign(axisE.style, { left: "50%", bottom: "4px", transform: "translateX(8px)" });
    canvas.appendChild(axisE);

    for (const item of this.env.data.items) {
      canvas.appendChild(this.renderChip(item));
    }
    body.appendChild(canvas);

    if (!this.readOnly) {
      const add = el("button", "ltk-be-add", "＋ Add item");
      add.type = "button";
      add.addEventListener("click", () => this.editItem(null));
      body.appendChild(add);
    }
  }

  private renderChip(item: BenefitEffortItem): HTMLElement {
    const chip = el("div", "ltk-be-chip", item.text);
    chip.title = item.text;
    if (this.readOnly) chip.classList.add("ltk-readonly");
    chip.style.left = `${item.effort * 100}%`;
    chip.style.top = `${(1 - item.benefit) * 100}%`;

    if (!this.readOnly) {
      makeInteractive(chip, {
        onTap: () => this.editItem(item),
        onStart: () => {
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

  private editItem(item: BenefitEffortItem | null): void {
    const ta = textArea(item?.text ?? "", {
      placeholder: hintFor(this.prompts, "item", "Solution / idea"),
      rows: 2,
    });
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
        } else {
          this.env.data.items.push({
            id: newId("b"),
            text,
            benefit: 0.5,
            effort: 0.5,
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
    ta.focus();
  }

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + BENEFITEFFORT_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
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
