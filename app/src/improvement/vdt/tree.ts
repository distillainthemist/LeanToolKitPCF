// The value driver tree — ONE component for Settings (structure), the
// hub tab (values / simulate) — drawn left → right: root at the left,
// leaves at the right, elbow connectors (spec §3.1). Connectors are an
// SVG overlay measured after layout, so the cards stay plain DOM; a
// leading node's edge is dashed.

import { el, clear } from "../../../../shared/ui/dom";
import { DriverNode, childrenOf, formatValue, isLeaf, Series } from "./model";
import { formulaInWords } from "./formula";

export type TreeMode = "structure" | "values" | "simulate";

export interface TreeOpts {
  host: HTMLElement;
  mode: TreeMode;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** values/simulate: the computed number per node for the shown series. */
  values?: Map<string, number | null>;
  /** values: the comparison series' numbers (delta chip = values − compare). */
  compare?: Map<string, number | null>;
  compareLabel?: string;
  /** simulate: nodes that moved (green border + path) and assumed ones (dashed). */
  moved?: Set<string>;
  assumed?: Set<string>;
  /** Initiative counts per node (chip). */
  initiativeCounts?: Map<string, number>;
}

export interface TreeHandle {
  update: (nodes: DriverNode[], patch?: Partial<TreeOpts>) => void;
  destroy: () => void;
}

export function renderTree(nodes0: DriverNode[], opts0: TreeOpts): TreeHandle {
  let nodes = nodes0;
  let opts = opts0;
  const collapsed = new Set<string>();
  const wrap = el("div", "app-vd-tree");
  opts.host.appendChild(wrap);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("app-vd-links");
  const canvas = el("div", "app-vd-canvas");
  wrap.append(svg, canvas);
  const cardEls = new Map<string, HTMLElement>();
  let ro: ResizeObserver | null = null;

  const card = (n: DriverNode): HTMLElement => {
    const kids = childrenOf(nodes, n.id);
    const leaf = isLeaf(nodes, n);
    const root = n.parentId === "";
    const c = el("div", "app-vd-card" + (root ? " app-vd-root" : "") + (n.kind === "leading" ? " app-vd-leading" : "") + (!root && !leaf ? " app-vd-computed" : ""));
    if (opts.selectedId === n.id) c.classList.add("app-vd-sel");
    if (opts.moved?.has(n.id)) c.classList.add("app-vd-moved");
    if (opts.assumed?.has(n.id)) c.classList.add("app-vd-assumed");
    const head = el("div", "app-vd-head");
    if (!root && !leaf) head.appendChild(el("span", "app-vd-fn", "⨍"));
    head.appendChild(el("span", "app-vd-name", n.name || "(unnamed)"));
    if (n.kind === "leading") head.appendChild(el("span", "app-vd-tag", "leading"));
    c.appendChild(head);
    // the value line (values / simulate) or the structure line (settings)
    if (opts.mode !== "structure" && opts.values) {
      const v = opts.values.get(n.id) ?? null;
      const line = el("div", "app-vd-value", formatValue(v, n.unit, n.format));
      c.appendChild(line);
      if (opts.compare) {
        const cv = opts.compare.get(n.id) ?? null;
        if (v !== null && cv !== null && Math.abs(v - cv) > 1e-9) {
          const d = v - cv;
          const chip = el("span", "app-vd-delta" + (d > 0 ? " app-vd-delta-up" : " app-vd-delta-down"), `${d > 0 ? "+" : "−"}${formatValue(Math.abs(d), n.unit, n.format)}${opts.compareLabel ? " vs " + opts.compareLabel : ""}`);
          c.appendChild(chip);
        }
      }
    } else {
      const bits = [n.unit || "no unit", n.cadence].filter((x) => x !== "");
      c.appendChild(el("div", "app-vd-meta", bits.join(" · ")));
    }
    if (!root && !leaf && n.formula.trim() !== "") c.appendChild(el("div", "app-vd-formula", formulaInWords(n.formula, nodes)));
    if (n.source !== "" || n.sourceUrl !== "") {
      if (n.sourceUrl !== "") {
        const a = el("a", "app-vd-source app-vd-sourcelink", n.source || "source ↗") as HTMLAnchorElement;
        a.href = n.sourceUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = n.sourceUrl;
        a.addEventListener("click", (e) => e.stopPropagation());
        c.appendChild(a);
      } else c.appendChild(el("div", "app-vd-source", n.source));
    }
    const count = opts.initiativeCounts?.get(n.id) ?? 0;
    if (count > 0) c.appendChild(el("span", "app-vd-count", `${count} initiative${count === 1 ? "" : "s"}`));
    if (kids.length > 0) {
      const caret = el("button", "app-vd-caret", collapsed.has(n.id) ? "▸" : "▾") as HTMLButtonElement;
      caret.type = "button";
      caret.title = collapsed.has(n.id) ? "Expand" : "Collapse";
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsed.has(n.id)) collapsed.delete(n.id);
        else collapsed.add(n.id);
        paint();
      });
      c.appendChild(caret);
    }
    if (opts.onSelect) {
      c.classList.add("app-vd-clickable");
      c.addEventListener("click", () => opts.onSelect?.(n.id));
    }
    cardEls.set(n.id, c);
    return c;
  };

  /** A node and, to its right, the stack of its children. */
  const branch = (n: DriverNode): HTMLElement => {
    const b = el("div", "app-vd-branch");
    b.appendChild(card(n));
    const kids = childrenOf(nodes, n.id);
    if (kids.length > 0 && !collapsed.has(n.id)) {
      const stack = el("div", "app-vd-stack");
      for (const k of kids) stack.appendChild(branch(k));
      b.appendChild(stack);
    } else if (kids.length > 0) {
      const pill = el("div", "app-vd-collapsed", `${kids.length} driver${kids.length === 1 ? "" : "s"}`);
      pill.addEventListener("click", () => {
        collapsed.delete(n.id);
        paint();
      });
      b.appendChild(pill);
    }
    return b;
  };

  const drawLinks = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const base = canvas.getBoundingClientRect();
    svg.setAttribute("width", String(canvas.scrollWidth));
    svg.setAttribute("height", String(canvas.scrollHeight));
    const moved = opts.moved ?? new Set<string>();
    for (const n of nodes) {
      if (n.parentId === "" || collapsed.has(n.parentId)) continue;
      const p = cardEls.get(n.parentId);
      const c = cardEls.get(n.id);
      if (!p || !c) continue;
      const pr = p.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const x1 = pr.right - base.left + canvas.scrollLeft;
      const y1 = pr.top + pr.height / 2 - base.top + canvas.scrollTop;
      const x2 = cr.left - base.left + canvas.scrollLeft;
      const y2 = cr.top + cr.height / 2 - base.top + canvas.scrollTop;
      const mx = x1 + (x2 - x1) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`);
      path.classList.add("app-vd-link");
      if (n.kind === "leading" || opts.assumed?.has(n.id)) path.classList.add("app-vd-link-dashed");
      if (moved.has(n.id) && moved.has(n.parentId)) path.classList.add("app-vd-link-moved");
      svg.appendChild(path);
    }
  };

  const paint = () => {
    clear(canvas);
    cardEls.clear();
    const roots = nodes.filter((n) => n.parentId === "");
    if (roots.length === 0) {
      canvas.appendChild(el("div", "app-vd-empty", "No value drivers for this site yet. Start with the measure the site is judged on, then add what drives it."));
      drawLinks();
      return;
    }
    for (const r of roots) canvas.appendChild(branch(r));
    requestAnimationFrame(drawLinks);
  };

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => drawLinks());
    ro.observe(canvas);
  }
  paint();

  return {
    update: (next, patch) => {
      nodes = next;
      if (patch) opts = { ...opts, ...patch };
      paint();
    },
    destroy: () => {
      ro?.disconnect();
      wrap.remove();
    },
  };
}

/** The series label for value headers. */
export const SERIES_LABELS: Record<Series, string> = {
  baseline: "Baseline",
  plan: "Plan",
  forecast: "Forecast",
  actual: "Actual",
};
