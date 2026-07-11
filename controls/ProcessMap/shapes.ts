// SVG drawing for process-map symbols. Every symbol is drawn centred on (0,0)
// inside its node group; the editor translates the group to the node position.

import { NodeKind, PmNode } from "./types";

export const SVG_NS = "http://www.w3.org/2000/svg";

export interface NodeBox {
  hw: number; // half width  (centre -> left/right anchor)
  ht: number; // half height (centre -> top/bottom anchor)
  labelInside: boolean;
  labelY: number; // baseline y for the label
  labelChars: number; // wrap width in characters
}

/** Geometry per node kind. Connector anchors are (x ± hw, y) and (x, y ± ht). */
export function nodeBox(kind: NodeKind): NodeBox {
  switch (kind) {
    case "start":
    case "end":
      return { hw: 55, ht: 20, labelInside: true, labelY: 4, labelChars: 16 };
    case "process":
      return { hw: 65, ht: 27, labelInside: true, labelY: 4, labelChars: 18 };
    case "decision":
      return { hw: 62, ht: 38, labelInside: true, labelY: 4, labelChars: 14 };
    case "data":
      return { hw: 65, ht: 25, labelInside: true, labelY: 4, labelChars: 16 };
    case "document":
      return { hw: 65, ht: 30, labelInside: true, labelY: 0, labelChars: 18 };
    case "card":
      return { hw: 92, ht: 26, labelInside: true, labelY: 4, labelChars: 26 };
    case "outside":
      return { hw: 65, ht: 30, labelInside: true, labelY: 12, labelChars: 18 };
    case "vsmProcess":
      return { hw: 65, ht: 52, labelInside: true, labelY: -30, labelChars: 18 };
    case "inventory":
      return { hw: 32, ht: 26, labelInside: false, labelY: 42, labelChars: 16 };
    case "truck":
      return { hw: 55, ht: 25, labelInside: true, labelY: -4, labelChars: 12 };
    case "kaizen":
      return { hw: 62, ht: 32, labelInside: true, labelY: 4, labelChars: 12 };
  }
}

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
  return node;
}

function shape(name: string, attrs: Record<string, string | number>, color?: string): SVGElement {
  const s = el(name, attrs);
  s.classList.add("pm-shape");
  // inline style so a colour override also survives SVG/PNG export
  if (color) (s as SVGElement & { style: CSSStyleDeclaration }).style.fill = color;
  return s;
}

/** VSM data-box rows: label + which metric field feeds it. */
export const VSM_ROWS: { cap: string; key: "ct" | "co" | "uptime" | "operators" }[] = [
  { cap: "C/T", key: "ct" },
  { cap: "C/O", key: "co" },
  { cap: "Uptime", key: "uptime" },
  { cap: "Ops", key: "operators" },
];

// 12-point starburst for the kaizen symbol, precomputed once.
const KAIZEN_PATH = (() => {
  const pts: string[] = [];
  const n = 12;
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const rx = i % 2 === 0 ? 62 : 44;
    const ry = i % 2 === 0 ? 32 : 21;
    pts.push(`${Math.round(Math.cos(a) * rx * 10) / 10} ${Math.round(Math.sin(a) * ry * 10) / 10}`);
  }
  return "M " + pts.join(" L ") + " Z";
})();

/**
 * Build the symbol for a node as an SVG <g class="pm-symbol kind-xxx">.
 * `node.color` (when set) overrides the default fill of the main shape.
 */
export function buildSymbol(node: Pick<PmNode, "kind" | "color" | "metrics">): SVGGElement {
  const g = el("g", { class: `pm-symbol kind-${node.kind}` }) as SVGGElement;
  const color = node.color;

  switch (node.kind) {
    case "start":
    case "end":
      g.appendChild(shape("rect", { x: -55, y: -20, width: 110, height: 40, rx: 20, ry: 20 }, color));
      break;
    case "process":
      g.appendChild(shape("rect", { x: -65, y: -27, width: 130, height: 54, rx: 4, ry: 4 }, color));
      break;
    case "decision":
      g.appendChild(shape("path", { d: "M 0 -38 L 62 0 L 0 38 L -62 0 Z" }, color));
      break;
    case "data":
      g.appendChild(shape("path", { d: "M -50 -25 L 65 -25 L 50 25 L -65 25 Z" }, color));
      break;
    case "document":
      g.appendChild(
        shape(
          "path",
          { d: "M -65 -30 L 65 -30 L 65 22 Q 33 34 0 24 Q -33 14 -65 24 Z" },
          color
        )
      );
      break;
    case "card":
      g.appendChild(shape("rect", { x: -92, y: -26, width: 184, height: 52, rx: 8, ry: 8 }, color));
      break;
    case "outside":
      // factory / outside source: sawtooth roof
      g.appendChild(
        shape(
          "path",
          {
            d:
              "M -65 30 L -65 -6 L -39 -30 L -39 -6 L -13 -30 L -13 -6 " +
              "L 13 -30 L 13 -6 L 39 -30 L 39 -6 L 65 -6 L 65 30 Z",
          },
          color
        )
      );
      break;
    case "vsmProcess": {
      g.appendChild(shape("rect", { x: -65, y: -52, width: 130, height: 40, rx: 3, ry: 3 }, color));
      const dataBox = el("rect", { x: -65, y: -12, width: 130, height: 64, class: "pm-databox" });
      g.appendChild(dataBox);
      VSM_ROWS.forEach((row, i) => {
        const y = -12 + i * 16;
        if (i > 0) {
          g.appendChild(el("line", { x1: -65, y1: y, x2: 65, y2: y, class: "pm-databox-line" }));
        }
        const t = el("text", { x: -60, y: y + 12, class: "pm-metric" });
        const v = node.metrics ? node.metrics[row.key] : undefined;
        t.textContent = `${row.cap}: ${v ?? ""}`;
        g.appendChild(t);
      });
      break;
    }
    case "inventory": {
      g.appendChild(shape("path", { d: "M 0 -26 L 32 26 L -32 26 Z" }, color));
      const i = el("text", { x: 0, y: 20, "text-anchor": "middle", class: "pm-inv-i" });
      i.textContent = "I";
      g.appendChild(i);
      break;
    }
    case "truck": {
      g.appendChild(shape("rect", { x: -55, y: -25, width: 80, height: 34, rx: 2, ry: 2 }, color));
      g.appendChild(shape("path", { d: "M 25 -13 L 45 -13 L 55 -1 L 55 9 L 25 9 Z" }, color));
      g.appendChild(el("circle", { cx: -32, cy: 15, r: 7, class: "pm-wheel" }));
      g.appendChild(el("circle", { cx: 38, cy: 15, r: 7, class: "pm-wheel" }));
      break;
    }
    case "kaizen":
      g.appendChild(shape("path", { d: KAIZEN_PATH }, color));
      break;
  }
  return g;
}

/** Build a wrapped text label centred on x=0 at the given baseline. */
export function buildLabel(
  text: string,
  y: number,
  maxChars: number,
  cls = "pm-label"
): SVGTextElement {
  const t = el("text", { class: cls, x: 0, y, "text-anchor": "middle" }) as SVGTextElement;
  const lines = wrap(text, maxChars, 3);
  if (lines.length === 1) {
    t.textContent = lines[0];
  } else {
    const lineHeight = 13;
    const startDy = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((ln, i) => {
      const ts = el("tspan", { x: 0, dy: i === 0 ? startDy : lineHeight }) as SVGTSpanElement;
      ts.textContent = ln;
      t.appendChild(ts);
    });
  }
  return t;
}

/** Greedy word wrap into at most `maxLines` lines of ~`maxChars` chars. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) {
        // last line: dump the rest, truncate if needed
        const rest = [cur, ...words.slice(words.indexOf(w) + 1)].join(" ");
        lines.push(rest.length > maxChars ? rest.slice(0, maxChars - 1) + "…" : rest);
        return lines;
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
