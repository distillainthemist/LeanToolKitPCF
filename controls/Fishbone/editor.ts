// Self-contained SVG fishbone / Ishikawa editor. No external runtime deps.
//
// Layout: a horizontal spine runs into the "fish head" (the effect / problem)
// on the right. Categories are paired — each pair shares one attachment point
// on the spine, with one bone angling up and its partner angling down. Root-
// cause "chips" hang off each bone, alternating to either side, and show the
// description (up to two lines), a vote tally and a status colour.

import {
  FishboneModel,
  Cause,
  CauseStatus,
  StyleConfig,
  STATUSES,
  MAX_CAUSE_CHARS,
  emptyModel,
  defaultStyle,
  newId,
} from "./model";
import { mix as mixHex, textOn } from "../../shared/tokens";
import { FISHBONE_CSS } from "./styles";

const STYLE_TAG_ID = "pech-fishbone-styles";

/**
 * Inject the stylesheet from the bundle. Canvas apps sometimes fail to load a
 * PCF's separate CSS resource, which silently kills hover states and cursor
 * affordances — bundling the CSS makes the control self-sufficient in every
 * host. Idempotent across multiple control instances; updates the tag when a
 * newer bundle loads.
 */
function ensureStylesInjected(doc: Document): void {
  let tag = doc.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = doc.createElement("style");
    tag.id = STYLE_TAG_ID;
    doc.head.appendChild(tag);
  }
  if (tag.textContent !== FISHBONE_CSS) {
    tag.textContent = FISHBONE_CSS;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

export interface EditorOptions {
  onChange: (model: FishboneModel) => void;
  /** Called (debounced) with a PNG data URI after the diagram changes. */
  onPngReady?: (dataUri: string) => void;
  /** Open the toolkit's action management for a cause (LeanToolKit port). */
  onManageActions?: (causeId: string) => void;
  /** Open (non-cancelled) action count for a cause, drawn as a chip badge. */
  getActionBadge?: (causeId: string) => number;
}

/** Status glyphs: tick = Confirmed, cross = Rejected, question = Hypothesis. */
const STATUS_GLYPH: Record<CauseStatus, string> = {
  Hypothesis: "?",
  Confirmed: "✓",
  Rejected: "✕",
};

interface CauseLayout {
  cause: Cause;
  px: number; // anchor point on the bone
  py: number;
  chipX: number;
  chipY: number;
  chipW: number;
  chipH: number;
  lines: string[];
  leaderX: number; // where the leader line meets the chip
}

interface BoneLayout {
  category: string;
  ax: number; // shared attachment point on the spine
  ay: number;
  ex: number; // outer tip of the bone
  ey: number;
  side: "top" | "bottom";
  causes: CauseLayout[];
}

interface Layout {
  W: number;
  H: number;
  spineY: number;
  spineStartX: number;
  headX: number;
  head: { x: number; y: number; w: number; h: number };
  bones: BoneLayout[];
}

const CHAR_W = 6.6;
const LINE_H = 16;
const CHIP_PAD_Y = 7;
const CHIP_PAD_L = 22; // status dot + gap
const CHIP_PAD_R = 10;
const MAX_CHIP_W = 260; // hard cap on chip width
const CHIP_STACK_GAP = 10; // minimum vertical gap between chips on one side
const CHIP_GAP_X = 16; // gap between the bone anchor and the chip

export class FishboneEditor {
  private root: HTMLDivElement;
  private roBadge!: HTMLSpanElement;
  private stage!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private scene!: SVGGElement;

  private model: FishboneModel = emptyModel();
  private style: StyleConfig = defaultStyle();
  private readOnly = false;
  private onChange: (model: FishboneModel) => void;
  private onPngReady?: (dataUri: string) => void;
  private onManageActions?: (causeId: string) => void;
  private getActionBadge?: (causeId: string) => number;
  private measurer: SVGTextElement | null = null;
  private lastLayout: Layout | null = null;
  private pngTimer: ReturnType<typeof setTimeout> | null = null;

  // drag & drop state
  private drag: {
    id: string;
    g: SVGGElement;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  private onDragMove = (e: PointerEvent) => this.handleDragMove(e);
  private onDragUp = (e: PointerEvent) => this.handleDragUp(e);

  constructor(container: HTMLDivElement, opts: EditorOptions) {
    this.onChange = opts.onChange;
    this.onPngReady = opts.onPngReady;
    this.onManageActions = opts.onManageActions;
    this.getActionBadge = opts.getActionBadge;
    ensureStylesInjected(container.ownerDocument || document);
    this.root = document.createElement("div");
    this.root.className = "fb-root";
    container.appendChild(this.root);
    this.buildChrome();
    this.applyStyleVars();
    this.render();
  }

  // ---------- public API ----------

  setModel(model: FishboneModel): void {
    this.model = model;
    this.render();
  }

  getModel(): FishboneModel {
    return this.model;
  }

  setStyle(style: StyleConfig): void {
    if (
      style.fontFamily === this.style.fontFamily &&
      style.diagramColor === this.style.diagramColor &&
      style.backgroundColor === this.style.backgroundColor &&
      style.effectLabel === this.style.effectLabel &&
      style.statusColors.Hypothesis === this.style.statusColors.Hypothesis &&
      style.statusColors.Confirmed === this.style.statusColors.Confirmed &&
      style.statusColors.Rejected === this.style.statusColors.Rejected
    ) {
      return;
    }
    this.style = style;
    this.applyStyleVars();
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly === ro) return;
    this.readOnly = ro;
    this.root.classList.toggle("fb-readonly", ro);
    this.roBadge.style.display = ro ? "" : "none";
    this.render();
  }

  resize(width: number, height: number): void {
    if (width > 0) this.root.style.width = width + "px";
    if (height > 0) this.root.style.height = height + "px";
  }

  destroy(): void {
    if (this.pngTimer) clearTimeout(this.pngTimer);
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragUp);
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  // ---------- style ----------

  private applyStyleVars(): void {
    this.root.style.fontFamily = this.style.fontFamily;
    this.root.style.background = this.style.backgroundColor;
    this.stage.style.background = this.style.backgroundColor;
    this.root.style.setProperty("--fb-diagram", this.style.diagramColor);
    this.root.style.setProperty(
      "--fb-diagram-tint",
      mix(this.style.diagramColor, 6, "white")
    );
  }

  private statusStyle(status: CauseStatus): {
    border: string;
    bg: string;
    fg: string;
  } {
    const c = this.style.statusColors[status];
    return {
      border: c,
      bg: mix(c, 20, "white"),
      fg: mix(c, 72, "black"),
    };
  }

  // ---------- DOM construction ----------

  private buildChrome(): void {
    this.roBadge = document.createElement("span");
    this.roBadge.className = "fb-ro-badge";
    this.roBadge.textContent = "Read only";
    this.roBadge.style.display = "none";
    this.root.appendChild(this.roBadge);

    this.stage = document.createElement("div");
    this.stage.className = "fb-stage";
    this.root.appendChild(this.stage);

    this.svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.svg.setAttribute("class", "fb-svg");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.stage.appendChild(this.svg);

    this.scene = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.svg.appendChild(this.scene);
  }

  // ---------- text measurement ----------

  /**
   * Measure rendered text width in SVG user units using a hidden text node
   * that inherits the control's actual font. Falls back to a per-character
   * estimate if the control isn't attached to the document yet.
   */
  private measureText(text: string, className: string): number {
    if (!this.measurer) {
      this.measurer = document.createElementNS(SVG_NS, "text") as SVGTextElement;
      this.measurer.setAttribute("x", "-10000");
      this.measurer.setAttribute("y", "-10000");
      this.measurer.style.visibility = "hidden";
      this.svg.appendChild(this.measurer);
    }
    this.measurer.setAttribute("class", className);
    this.measurer.textContent = text;
    let w = 0;
    try {
      w = this.measurer.getComputedTextLength();
    } catch {
      w = 0;
    }
    return w > 0 ? w : text.length * CHAR_W;
  }

  /** Trim `text` (with ellipsis) until it measures within `maxW`. */
  private fitToWidth(text: string, className: string, maxW: number): string {
    if (this.measureText(text, className) <= maxW) return text;
    let t = text;
    while (t.length > 1) {
      t = t.slice(0, -1);
      if (this.measureText(t.trimEnd() + "…", className) <= maxW) {
        return t.trimEnd() + "…";
      }
    }
    return "…";
  }

  /**
   * Greedy word-wrap driven by real rendered widths (not character counts),
   * so lines use all the width the chip is allowed to grow to. Only the last
   * line is ellipsized, and only when the text truly cannot fit.
   */
  private wrapMeasured(
    text: string,
    className: string,
    maxW: number,
    maxLines: number
  ): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const candidate = cur ? cur + " " + words[i] : words[i];
      if (cur && this.measureText(candidate, className) > maxW) {
        lines.push(cur);
        if (lines.length === maxLines) {
          // Out of lines — pack the remainder into the last one, ellipsized.
          const rest = words.slice(i).join(" ");
          lines[maxLines - 1] = this.fitToWidth(
            lines[maxLines - 1] + " " + rest,
            className,
            maxW
          );
          return lines;
        }
        cur = words[i];
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    // Safety net for single words longer than the whole line.
    return lines.map((l) => this.fitToWidth(l, className, maxW));
  }

  // ---------- layout ----------

  private computeLayout(): Layout {
    const cats = this.model.categories.length
      ? this.model.categories
      : ["Category"];
    const n = cats.length;
    const slots = Math.ceil(n / 2); // each slot carries a top + bottom bone

    const H = 680;
    const spineY = H / 2;
    const mLeft = 60;
    const headW = 270;
    const headH = 140;
    const mRight = 24;

    const boneDX = 170; // horizontal reach (slant)
    const boneDY = H / 2 - 74; // vertical reach

    // Width grows with the number of pairs so bones/causes have room.
    const W = Math.max(1120, 300 * slots + 300);
    const headX = W - mRight - headW;

    const attachStart = mLeft + boneDX + 30;
    const attachEnd = headX - 40;
    // The spine begins exactly at the first pair's junction — no tail stub.
    const spineStartX = attachStart;

    const bones: BoneLayout[] = [];
    for (let s = 0; s < slots; s++) {
      const t = slots > 1 ? s / (slots - 1) : 0.5;
      const ax = attachStart + (attachEnd - attachStart) * t;

      for (const side of ["top", "bottom"] as const) {
        const idx = side === "top" ? 2 * s : 2 * s + 1;
        if (idx >= n) continue;
        const category = cats[idx];
        const dir = side === "top" ? -1 : 1;
        const ex = ax - boneDX;
        const ey = spineY + dir * boneDY;
        const causes = this.model.causes.filter((c) => c.category === category);
        bones.push({
          category,
          ax,
          ay: spineY,
          ex,
          ey,
          side,
          causes: this.layoutCauses(causes, ax, spineY, ex, ey),
        });
      }
    }

    const head = { x: headX, y: spineY - headH / 2, w: headW, h: headH };
    this.resolveCollisions(bones, spineY, head);

    return {
      W,
      H,
      spineY,
      spineStartX,
      headX,
      head,
      bones,
    };
  }

  /**
   * Global anti-overlap pass. Per-bone stacking cannot see chips from the
   * neighbouring bone (whose left column reaches into this bone's area on
   * the diagonal), so resolve collisions across each half of the diagram:
   * chips closest to the spine keep their spot, everything else is pushed
   * outward (up in the top half, down in the bottom half) until clear.
   * Category labels, add buttons and a strip around the spine are obstacles.
   */
  private resolveCollisions(
    bones: BoneLayout[],
    spineY: number,
    head: { x: number; y: number; w: number; h: number }
  ): void {
    interface Rect {
      x: number;
      y: number;
      w: number;
      h: number;
    }
    const GAP = CHIP_STACK_GAP;
    const PAD_X = 4;

    for (const half of ["top", "bottom"] as const) {
      const chips: CauseLayout[] = [];
      const placed: Rect[] = [
        // keep every chip clear of the spine
        { x: -1e6, y: spineY - 10, w: 2e6, h: 20 },
        // ...and of the head box (x inflated to cover the mouth triangle)
        { x: head.x - 26, y: head.y - 4, w: head.w + 30, h: head.h + 8 },
      ];
      for (const b of bones) {
        if (b.side !== half) continue;
        chips.push(...b.causes);
        const labelW =
          this.measureText(b.category.toUpperCase(), "fb-cat-label") + 12;
        const ly = b.ey + (half === "top" ? -24 : 40);
        placed.push({ x: b.ex - labelW / 2, y: ly - 20, w: labelW, h: 26 });
        placed.push({ x: b.ex - 13, y: b.ey - 13, w: 26, h: 26 });
      }
      // nearest-to-spine first: inner chips keep position, outer ones move
      chips.sort(
        (a, b) =>
          Math.abs(a.chipY + a.chipH / 2 - spineY) -
          Math.abs(b.chipY + b.chipH / 2 - spineY)
      );
      for (const cl of chips) {
        let guard = 0;
        let hit = true;
        while (hit && guard++ < 300) {
          hit = false;
          for (const p of placed) {
            const xHit =
              cl.chipX < p.x + p.w + PAD_X && p.x < cl.chipX + cl.chipW + PAD_X;
            const yHit =
              cl.chipY < p.y + p.h + GAP && p.y < cl.chipY + cl.chipH + GAP;
            if (xHit && yHit) {
              cl.chipY =
                half === "top" ? p.y - cl.chipH - GAP : p.y + p.h + GAP;
              hit = true;
            }
          }
        }
        placed.push({ x: cl.chipX, y: cl.chipY, w: cl.chipW, h: cl.chipH });
      }
    }
  }

  private layoutCauses(
    causes: Cause[],
    ax: number,
    ay: number,
    ex: number,
    ey: number
  ): CauseLayout[] {
    const K = causes.length;
    if (K === 0) return [];
    const tOuter = 0.82;
    const tInner = 0.14;
    const gap = K > 1 ? Math.min(0.15, (tOuter - tInner) / (K - 1)) : 0;

    const layouts = causes.map((cause, k) => {
      const t = tOuter - k * gap;
      const px = ax + (ex - ax) * t;
      const py = ay + (ey - ay) * t;

      const voteW = cause.votes > 0 ? 28 : 0;
      // Wrap against the real rendered width (the font is user-configurable,
      // so character counts are unreliable). Up to three lines; only the last
      // is ellipsized, and only when the text truly cannot fit.
      const maxTextW = MAX_CHIP_W - CHIP_PAD_L - CHIP_PAD_R - voteW;
      const lines = this.wrapMeasured(
        cause.text || "(empty)",
        "fb-chip-text",
        maxTextW,
        3
      );
      const textW = lines.reduce(
        (m, l) => Math.max(m, this.measureText(l, "fb-chip-text")),
        0
      );
      const chipW = clamp(
        70,
        Math.ceil(CHIP_PAD_L + textW + CHIP_PAD_R + voteW),
        MAX_CHIP_W
      );
      const chipH = lines.length * LINE_H + CHIP_PAD_Y * 2;
      const chipY = py - chipH / 2;

      return { cause, px, py, chipX: 0, chipY, chipW, chipH, lines, leaderX: 0 };
    });

    // Side assignment: fill the LEFT column first (away from the head and
    // the neighbouring bone — keeps each category's causes in one tidy
    // column), spilling to the right only once the left column would
    // outgrow the bone's vertical span.
    const span =
      Math.abs(ey - ay) * (tOuter - tInner) + 30; // usable height beside the bone
    let leftH = 0;
    const onRight: boolean[] = layouts.map((cl) => {
      if (leftH + cl.chipH <= span) {
        leftH += cl.chipH + CHIP_STACK_GAP;
        return false;
      }
      return true;
    });
    layouts.forEach((cl, k) => {
      const rightSide = onRight[k];
      cl.chipX = rightSide ? cl.px + CHIP_GAP_X : cl.px - CHIP_GAP_X - cl.chipW;
      cl.leaderX = rightSide ? cl.chipX : cl.chipX + cl.chipW;
    });

    // Auto-layout: chips on the same side of a bone must not overlap.
    // Chips are ordered tip → spine; py moves down for top bones and up for
    // bottom bones, so push each chip past the previous one in that direction.
    const dirDown = ay > ey; // top bones: stacking proceeds downwards
    for (const rightSide of [true, false]) {
      const sideChips = layouts.filter((_, k) => onRight[k] === rightSide);
      let edge = dirDown ? -Infinity : Infinity;
      for (const cl of sideChips) {
        if (dirDown) {
          const minTop = edge + CHIP_STACK_GAP;
          if (cl.chipY < minTop && edge !== -Infinity) cl.chipY = minTop;
          edge = cl.chipY + cl.chipH;
        } else {
          const maxBottom = edge - CHIP_STACK_GAP;
          if (cl.chipY + cl.chipH > maxBottom && edge !== Infinity) {
            cl.chipY = maxBottom - cl.chipH;
          }
          edge = cl.chipY;
        }
      }
    }
    return layouts;
  }

  // ---------- rendering ----------

  private render(): void {
    const layout = this.computeLayout();
    this.lastLayout = layout;
    while (this.scene.firstChild) this.scene.removeChild(this.scene.firstChild);

    this.drawSpine(layout);
    for (const bone of layout.bones) this.drawBone(bone);
    this.drawHead(layout);
    this.schedulePng();

    // Fit the viewBox to the actual content so nothing (e.g. a left-side chip
    // on the leftmost bone) is clipped, and the diagram stays centred.
    const b = this.contentBounds(layout);
    const pad = 20;
    this.svg.setAttribute(
      "viewBox",
      `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${
        b.maxY - b.minY + pad * 2
      }`
    );
  }

  private contentBounds(layout: Layout): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const inc = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };

    inc(layout.spineStartX, layout.spineY - 3);
    inc(layout.spineStartX, layout.spineY + 3);
    inc(layout.head.x, layout.head.y);
    inc(layout.head.x + layout.head.w, layout.head.y + layout.head.h);

    for (const bone of layout.bones) {
      inc(bone.ax, bone.ay);
      inc(bone.ex, bone.ey);
      // large uppercase label — measure the real rendered width
      const half =
        this.measureText(bone.category.toUpperCase(), "fb-cat-label") / 2 + 6;
      const ly = bone.ey + (bone.side === "top" ? -24 : 40);
      inc(bone.ex - half, ly - 20);
      inc(bone.ex + half, ly + 6);
      // add button centred on the bone tip
      inc(bone.ex - 13, bone.ey - 13);
      inc(bone.ex + 13, bone.ey + 13);
      for (const cl of bone.causes) {
        inc(cl.chipX, cl.chipY);
        inc(cl.chipX + cl.chipW, cl.chipY + cl.chipH);
      }
    }
    return { minX, minY, maxX, maxY };
  }

  private drawSpine(layout: Layout): void {
    const dc = this.style.diagramColor;
    const spine = svgEl("line", {
      x1: layout.spineStartX,
      y1: layout.spineY,
      x2: layout.headX,
      y2: layout.spineY,
      class: "fb-spine",
    });
    spine.style.stroke = dc;
    this.scene.appendChild(spine);
  }

  private drawHead(layout: Layout): void {
    const { x, y, w, h } = layout.head;
    const dc = this.style.diagramColor;
    const g = svgEl("g", { class: "fb-head" });

    const mouth = svgEl("path", {
      d: `M ${x} ${layout.spineY} l -18 -14 l 0 28 Z`,
    });
    mouth.style.fill = dc;
    g.appendChild(mouth);

    const rect = svgEl("rect", {
      x,
      y,
      width: w,
      height: h,
      rx: 10,
      ry: 10,
      class: "fb-head-box",
    });
    rect.style.stroke = dc;
    rect.style.fill = mix(dc, 6, "white");
    g.appendChild(rect);

    // The box title matches the category labels' size (22px uppercase).
    const cap = svgEl("text", {
      x: x + w / 2,
      y: y + 34,
      class: "fb-head-cap",
      "text-anchor": "middle",
    });
    cap.style.fill = dc;
    cap.textContent = this.style.effectLabel;
    g.appendChild(cap);

    const problem = this.model.problem || "Click to set the problem…";
    const lines = this.wrapMeasured(problem, "fb-head-text", w - 28, 3);
    const lineH = 19;
    // Vertically centre the statement between the title and the box bottom.
    const blockTop = y + 46;
    const blockH = h - 46 - 10;
    const startY = blockTop + (blockH - lines.length * lineH) / 2 + lineH - 6;
    lines.forEach((line, i) => {
      const t = svgEl("text", {
        x: x + w / 2,
        y: startY + i * lineH,
        class: this.model.problem ? "fb-head-text" : "fb-head-text fb-placeholder",
        "text-anchor": "middle",
      });
      if (this.model.problem) t.style.fill = mix(dc, 90, "black");
      t.textContent = line;
      g.appendChild(t);
    });

    if (!this.readOnly) {
      g.classList.add("fb-clickable");
      g.addEventListener("click", () => this.editProblem());
    }
    this.scene.appendChild(g);
  }

  private drawBone(bone: BoneLayout): void {
    const dc = this.style.diagramColor;
    const g = svgEl("g", { class: "fb-bone" });

    const line = svgEl("line", {
      x1: bone.ax,
      y1: bone.ay,
      x2: bone.ex,
      y2: bone.ey,
      class: "fb-bone-line",
    });
    line.style.stroke = dc;
    g.appendChild(line);

    const add = () => this.addCause(bone.category);

    // Wide invisible hit line so clicking anywhere on the bone adds a cause.
    if (!this.readOnly) {
      const hit = svgEl("line", {
        x1: bone.ax,
        y1: bone.ay,
        x2: bone.ex,
        y2: bone.ey,
        class: "fb-bone-hit fb-clickable",
      });
      const hitTitle = svgEl("title", {});
      hitTitle.textContent = `Add a root cause under "${bone.category}"`;
      hit.appendChild(hitTitle);
      hit.addEventListener("click", add);
      g.appendChild(hit);
    }

    // Causes next, so chips sit on top of the bone hit line.
    for (const cl of bone.causes) this.drawChip(cl, g);

    // Category label — large uppercase text, no box.
    const labelDy = bone.side === "top" ? -24 : 40;
    const label = svgEl("text", {
      x: bone.ex,
      y: bone.ey + labelDy,
      class: "fb-cat-label",
      "text-anchor": "middle",
    });
    label.style.fill = dc;
    label.textContent = bone.category;
    g.appendChild(label);

    // Refined add button, centred exactly on the bone tip: outlined circle
    // in the diagram colour that fills on hover (colours via CSS variables).
    const bcx = bone.ex;
    const bcy = bone.ey;
    const btn = svgEl("g", {
      class: "fb-add" + (this.readOnly ? " fb-add-hidden" : " fb-clickable"),
    });
    const circle = svgEl("circle", {
      cx: bcx,
      cy: bcy,
      r: 11,
      class: "fb-add-circle",
    });
    btn.appendChild(circle);
    const plus = svgEl("path", {
      d: `M ${bcx - 5} ${bcy} H ${bcx + 5} M ${bcx} ${bcy - 5} V ${bcy + 5}`,
      class: "fb-add-plus",
    });
    btn.appendChild(plus);
    const title = svgEl("title", {});
    title.textContent = `Add a root cause under "${bone.category}"`;
    btn.appendChild(title);
    if (!this.readOnly) {
      btn.addEventListener("click", add);
      label.classList.add("fb-clickable");
      label.addEventListener("click", add);
    }
    g.appendChild(btn);

    this.scene.appendChild(g);
  }

  private drawChip(cl: CauseLayout, parent: SVGElement): void {
    const { cause } = cl;
    const style = this.statusStyle(cause.status);

    const leader = svgEl("line", {
      x1: cl.px,
      y1: cl.py,
      x2: cl.leaderX,
      y2: cl.chipY + cl.chipH / 2,
      class: "fb-leader",
    });
    parent.appendChild(leader);

    const g = svgEl("g", {
      class: "fb-chip" + (this.readOnly ? "" : " fb-clickable"),
    });

    const rect = svgEl("rect", {
      x: cl.chipX,
      y: cl.chipY,
      width: cl.chipW,
      height: cl.chipH,
      rx: 7,
      ry: 7,
      class: "fb-chip-box",
    });
    rect.style.fill = style.bg;
    rect.style.stroke = style.border;
    g.appendChild(rect);

    const glyph = svgEl("text", {
      x: cl.chipX + 11,
      y: cl.chipY + cl.chipH / 2 + 4,
      class: "fb-status-glyph",
      "text-anchor": "middle",
    });
    glyph.style.fill = style.border;
    glyph.textContent = STATUS_GLYPH[cause.status];
    g.appendChild(glyph);

    const textX = cl.chipX + CHIP_PAD_L;
    // Lines were measured and fitted during layout — render as-is.
    cl.lines.forEach((line, i) => {
      const t = svgEl("text", {
        x: textX,
        y:
          cl.chipY +
          CHIP_PAD_Y +
          LINE_H * i +
          LINE_H - 4,
        class: "fb-chip-text",
      });
      t.style.fill = style.fg;
      if (cause.status === "Rejected") {
        t.setAttribute("text-decoration", "line-through");
      }
      t.textContent = line;
      g.appendChild(t);
    });

    if (cause.votes > 0) {
      const badge = svgEl("rect", {
        x: cl.chipX + cl.chipW - 26,
        y: cl.chipY + cl.chipH / 2 - 9,
        width: 22,
        height: 18,
        rx: 7,
        ry: 7,
        class: "fb-vote-badge",
      });
      badge.style.fill = style.border;
      g.appendChild(badge);
      const btext = svgEl("text", {
        x: cl.chipX + cl.chipW - 15,
        y: cl.chipY + cl.chipH / 2 + 4,
        class: "fb-vote-text",
        "text-anchor": "middle",
      });
      btext.textContent = String(cause.votes);
      g.appendChild(btext);
    }

    // LeanToolKit: open-action badge pinned to the chip's top-right corner
    const nAct = this.getActionBadge ? this.getActionBadge(cause.id) : 0;
    if (nAct > 0) {
      const acc = this.style.accentColor;
      const dot = svgEl("circle", {
        cx: cl.chipX + cl.chipW - 2,
        cy: cl.chipY + 1,
        r: 9,
      });
      dot.style.fill = acc;
      g.appendChild(dot);
      const dotText = svgEl("text", {
        x: cl.chipX + cl.chipW - 2,
        y: cl.chipY + 5,
        class: "fb-vote-text",
        "text-anchor": "middle",
      });
      dotText.style.fill = textOn(acc);
      dotText.textContent = String(nAct);
      g.appendChild(dotText);
    }

    const tt = svgEl("title", {});
    tt.textContent =
      `${cause.text || "(empty)"}\n` +
      `Votes: ${cause.votes} · ${cause.status}` +
      (nAct > 0 ? `\nOpen actions: ${nAct}` : "") +
      (this.readOnly ? "" : "\n(click to edit · drag to move)");
    g.appendChild(tt);

    if (!this.readOnly) {
      // click-to-edit and drag-to-move share one pointer gesture: a press
      // that barely moves is a click, otherwise it is a drag.
      g.addEventListener("pointerdown", (e) =>
        this.startDrag(e, cause.id, g as SVGGElement)
      );
    }
    parent.appendChild(g);
  }

  // ---------- drag & drop ----------

  private clientToSvg(e: PointerEvent): { x: number; y: number } {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      ctm.inverse()
    );
    return { x: pt.x, y: pt.y };
  }

  private startDrag(e: PointerEvent, id: string, g: SVGGElement): void {
    if (this.readOnly || this.drag) return;
    if (e.button !== undefined && e.button !== 0) return; // primary button only
    e.preventDefault();
    const p = this.clientToSvg(e);
    this.drag = { id, g, startX: p.x, startY: p.y, moved: false };
    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragUp);
  }

  private handleDragMove(e: PointerEvent): void {
    if (!this.drag) return;
    const p = this.clientToSvg(e);
    const dx = p.x - this.drag.startX;
    const dy = p.y - this.drag.startY;
    if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
    this.drag.moved = true;
    this.drag.g.setAttribute("transform", `translate(${dx} ${dy})`);
    this.drag.g.classList.add("fb-dragging");
    this.highlightDropTarget(this.nearestBone(p.x, p.y)?.bone ?? null);
  }

  private handleDragUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragUp);
    this.highlightDropTarget(null);
    if (!drag.moved) {
      this.editCause(drag.id);
      return;
    }
    const p = this.clientToSvg(e);
    const target = this.nearestBone(p.x, p.y);
    if (!target) {
      this.render(); // snap back
      return;
    }
    this.dropCause(drag.id, target.bone, target.t);
  }

  /** Nearest bone to a point (within a generous radius), plus the projection
   *  parameter t along it (0 = spine junction, 1 = tip). */
  private nearestBone(
    x: number,
    y: number
  ): { bone: BoneLayout; t: number } | null {
    if (!this.lastLayout) return null;
    let best: { bone: BoneLayout; t: number; d: number } | null = null;
    for (const bone of this.lastLayout.bones) {
      const vx = bone.ex - bone.ax;
      const vy = bone.ey - bone.ay;
      const len2 = vx * vx + vy * vy || 1;
      const t = clamp(
        0,
        ((x - bone.ax) * vx + (y - bone.ay) * vy) / len2,
        1
      );
      const cx = bone.ax + vx * t;
      const cy = bone.ay + vy * t;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { bone, t, d };
    }
    return best && best.d <= 220 ? { bone: best.bone, t: best.t } : null;
  }

  private highlightDropTarget(bone: BoneLayout | null): void {
    for (const line of Array.from(
      this.scene.querySelectorAll(".fb-bone-line")
    )) {
      line.classList.remove("fb-drop-target");
    }
    if (!bone) return;
    const idx = this.lastLayout?.bones.indexOf(bone) ?? -1;
    const lines = this.scene.querySelectorAll(".fb-bone-line");
    if (idx >= 0 && idx < lines.length) {
      lines[idx].classList.add("fb-drop-target");
    }
  }

  /** Move/reorder a cause: attach to `bone`'s category at position `t`
   *  (1 = bone tip, 0 = spine) relative to that bone's other causes. */
  private dropCause(id: string, bone: BoneLayout, t: number): void {
    const dragged = this.model.causes.find((c) => c.id === id);
    if (!dragged) return;

    // projection t of each existing cause anchor on the target bone
    const vx = bone.ex - bone.ax;
    const vy = bone.ey - bone.ay;
    const len2 = vx * vx + vy * vy || 1;
    const others = bone.causes.filter((cl) => cl.cause.id !== id);
    const tOf = (cl: CauseLayout): number =>
      ((cl.px - bone.ax) * vx + (cl.py - bone.ay) * vy) / len2;
    // causes are ordered tip → spine, i.e. by descending t
    const insertIdx = others.filter((cl) => tOf(cl) > t).length;

    dragged.category = bone.category;
    const remaining = this.model.causes.filter((c) => c.id !== id);
    const targetIds = remaining
      .filter((c) => c.category === bone.category)
      .map((c) => c.id);

    let globalIdx: number;
    if (targetIds.length === 0) {
      globalIdx = remaining.length;
    } else if (insertIdx >= targetIds.length) {
      globalIdx = remaining.findIndex(
        (c) => c.id === targetIds[targetIds.length - 1]
      ) + 1;
    } else {
      globalIdx = remaining.findIndex((c) => c.id === targetIds[insertIdx]);
    }
    remaining.splice(globalIdx, 0, dragged);
    this.model.causes = remaining;
    this.commit();
  }

  // ---------- PNG export ----------

  private schedulePng(): void {
    if (!this.onPngReady) return;
    if (this.pngTimer) clearTimeout(this.pngTimer);
    this.pngTimer = setTimeout(() => this.generatePng(), 400);
  }

  /** Rasterize the current SVG to a PNG data URI (2x scale, white bg). */
  private generatePng(): void {
    if (!this.onPngReady) return;
    const vb = this.svg.viewBox.baseVal;
    if (!vb || vb.width <= 0 || vb.height <= 0) return;

    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    // strip the hidden measurement node from the snapshot
    for (const t of Array.from(clone.querySelectorAll("text"))) {
      if ((t as SVGTextElement).style.visibility === "hidden") t.remove();
    }
    clone.setAttribute("width", String(vb.width));
    clone.setAttribute("height", String(vb.height));
    clone.setAttribute("xmlns", SVG_NS);
    clone.style.fontFamily = this.style.fontFamily;
    // classes need their rules inside the standalone SVG
    const styleEl = document.createElementNS(SVG_NS, "style");
    styleEl.textContent = FISHBONE_CSS;
    clone.insertBefore(styleEl, clone.firstChild);

    const xml = new XMLSerializer().serializeToString(clone);
    const src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vb.width * scale);
        canvas.height = Math.round(vb.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = this.style.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (this.onPngReady) this.onPngReady(canvas.toDataURL("image/png"));
      } catch {
        /* rasterization unavailable in this host — skip silently */
      }
    };
    img.src = src;
  }

  // ---------- model mutations ----------

  private commit(): void {
    this.onChange(this.model);
    this.render();
  }

  private addCause(category: string): void {
    this.openCauseDialog(null, category);
  }

  private editCause(id: string): void {
    const cause = this.model.causes.find((c) => c.id === id);
    if (cause) this.openCauseDialog(cause, cause.category);
  }

  private editProblem(): void {
    this.openProblemDialog();
  }

  // ---------- dialogs ----------

  private openProblemDialog(): void {
    const { overlay, card } = this.buildDialog("Problem / Effect");

    const ta = document.createElement("textarea");
    ta.className = "fb-input fb-textarea";
    ta.value = this.model.problem;
    ta.placeholder = "Describe the effect / problem being analysed…";
    card.appendChild(ta);

    const footer = document.createElement("div");
    footer.className = "fb-dialog-footer";
    const cancel = this.button("Cancel", "fb-btn", () => this.closeDialog(overlay));
    const save = this.button("Save", "fb-btn fb-btn-primary", () => {
      this.model.problem = ta.value.trim();
      this.closeDialog(overlay);
      this.commit();
    });
    footer.appendChild(cancel);
    footer.appendChild(save);
    card.appendChild(footer);

    this.showDialog(overlay);
    ta.focus();
  }

  private openCauseDialog(existing: Cause | null, category: string): void {
    const editing = existing !== null;
    const { overlay, card } = this.buildDialog(
      editing ? "Edit Root Cause" : `Add Root Cause · ${category}`
    );

    card.appendChild(this.fieldLabel("Description"));
    const ta = document.createElement("textarea");
    ta.className = "fb-input fb-textarea";
    ta.maxLength = MAX_CAUSE_CHARS;
    ta.value = (existing ? existing.text : "").slice(0, MAX_CAUSE_CHARS);
    ta.placeholder = "Root-cause description…";
    card.appendChild(ta);

    // live "x/200" character counter
    const counter = document.createElement("div");
    counter.className = "fb-char-count";
    const updateCounter = () => {
      counter.textContent = `${ta.value.length}/${MAX_CAUSE_CHARS}`;
      counter.classList.toggle(
        "fb-char-count-max",
        ta.value.length >= MAX_CAUSE_CHARS
      );
    };
    updateCounter();
    ta.addEventListener("input", updateCounter);
    card.appendChild(counter);

    card.appendChild(this.fieldLabel("Votes"));
    const voteRow = document.createElement("div");
    voteRow.className = "fb-vote-row";
    const voteInput = document.createElement("input");
    voteInput.type = "number";
    voteInput.min = "0";
    voteInput.step = "1";
    voteInput.className = "fb-input fb-vote-input";
    voteInput.value = String(existing ? existing.votes : 0);
    const dec = this.button("−", "fb-btn fb-step", () => {
      voteInput.value = String(Math.max(0, (parseInt(voteInput.value, 10) || 0) - 1));
    });
    const inc = this.button("+", "fb-btn fb-step", () => {
      voteInput.value = String(Math.max(0, (parseInt(voteInput.value, 10) || 0) + 1));
    });
    voteRow.appendChild(dec);
    voteRow.appendChild(voteInput);
    voteRow.appendChild(inc);
    card.appendChild(voteRow);

    card.appendChild(this.fieldLabel("Status"));
    const segG = document.createElement("div");
    segG.className = "fb-seg";
    let selectedStatus: CauseStatus = existing ? existing.status : "Hypothesis";
    const segButtons: Record<string, HTMLButtonElement> = {};
    for (const st of STATUSES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fb-seg-btn";
      b.textContent = `${STATUS_GLYPH[st]} ${st}`;
      b.addEventListener("click", () => {
        selectedStatus = st;
        for (const key of Object.keys(segButtons)) {
          const on = key === st;
          const btn = segButtons[key];
          btn.classList.toggle("fb-seg-on", on);
          btn.style.background = on ? mix(this.style.statusColors[key as CauseStatus], 20, "white") : "";
          btn.style.borderColor = on ? this.style.statusColors[key as CauseStatus] : "";
          btn.style.color = on ? mix(this.style.statusColors[key as CauseStatus], 72, "black") : "";
        }
      });
      segButtons[st] = b;
      segG.appendChild(b);
    }
    // activate the initial one
    segButtons[selectedStatus].click();
    card.appendChild(segG);

    // LeanToolKit: manage/raise actions on this cause (closes this dialog,
    // the wrapper opens the shared action UI)
    if (editing && existing && this.onManageActions) {
      const n = this.getActionBadge ? this.getActionBadge(existing.id) : 0;
      const act = this.button(
        n > 0 ? `Actions (${n})…` : "＋ Raise action…",
        "fb-btn",
        () => {
          this.closeDialog(overlay);
          this.onManageActions!(existing.id);
        }
      );
      act.style.marginTop = "10px";
      card.appendChild(act);
    }

    const footer = document.createElement("div");
    footer.className = "fb-dialog-footer";

    if (editing && existing) {
      const del = this.button("Delete", "fb-btn fb-btn-danger", () => {
        this.model.causes = this.model.causes.filter((c) => c.id !== existing.id);
        this.closeDialog(overlay);
        this.commit();
      });
      del.classList.add("fb-footer-left");
      footer.appendChild(del);
    }

    const cancel = this.button("Cancel", "fb-btn", () => this.closeDialog(overlay));
    const save = this.button("Save", "fb-btn fb-btn-primary", () => {
      const votes = Math.max(0, Math.round(parseInt(voteInput.value, 10) || 0));
      const text = ta.value.trim().slice(0, MAX_CAUSE_CHARS);
      if (editing && existing) {
        existing.text = text;
        existing.votes = votes;
        existing.status = selectedStatus;
        existing.category = category;
      } else {
        this.model.causes.push({
          id: newId(),
          category,
          text,
          votes,
          status: selectedStatus,
        });
      }
      this.closeDialog(overlay);
      this.commit();
    });
    footer.appendChild(cancel);
    footer.appendChild(save);
    card.appendChild(footer);

    this.showDialog(overlay);
    ta.focus();
  }

  // ---------- dialog primitives ----------

  private buildDialog(titleText: string): {
    overlay: HTMLDivElement;
    card: HTMLDivElement;
  } {
    const overlay = document.createElement("div");
    overlay.className = "fb-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeDialog(overlay);
    });

    const card = document.createElement("div");
    card.className = "fb-dialog";

    const title = document.createElement("div");
    title.className = "fb-dialog-title";
    title.textContent = titleText;
    card.appendChild(title);

    overlay.appendChild(card);
    return { overlay, card };
  }

  private showDialog(overlay: HTMLDivElement): void {
    this.root.appendChild(overlay);
  }

  private closeDialog(overlay: HTMLDivElement): void {
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  private fieldLabel(text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "fb-field-label";
    el.textContent = text;
    return el;
  }

  private button(
    text: string,
    className: string,
    onClick: () => void
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }
}

// ---------- helpers ----------

function svgEl(
  tag: string,
  attrs: Record<string, string | number>
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) {
    el.setAttribute(key, String(attrs[key]));
  }
  return el as SVGElement;
}

/**
 * `pct`% of `color`, remainder `other` — computed to a hex value via the
 * shared colour engine rather than CSS color-mix(), which older Safari
 * doesn't support (the toolkit's Safari rule: no colour-function indirection
 * on dynamically created elements).
 */
function mix(color: string, pct: number, other: string): string {
  const into = other === "white" ? "#ffffff" : "#000000";
  return mixHex(color, into, 1 - pct / 100);
}

function clamp(min: number, v: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

