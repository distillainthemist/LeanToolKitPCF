// PNG + SVG snapshot machinery. SVG controls rasterise directly (the proven
// Fishbone path); HTML controls are wrapped in an SVG <foreignObject>, which
// modern Chromium/WebKit hosts rasterise fine — when a host refuses, the
// export is skipped silently and pngExport simply stays empty.
//
// Both snapshot paths hand their intermediate SVG markup to the callback as
// a second argument — that string is the svgExport output (vector, small,
// crisp at any size). Caveat: foreignObject SVGs render in documents but
// Safari can refuse them inside <img>; boards should verify before relying
// on them for image tiles (the PNG stays available as the fallback).

import { SVG_NS } from "../ui/dom";

function rasterize(
  svgMarkup: string,
  width: number,
  height: number,
  background: string,
  scale: number,
  onReady: (dataUri: string) => void
): void {
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onReady(canvas.toDataURL("image/png"));
    } catch {
      /* rasterisation unavailable in this host — skip silently */
    }
  };
  img.src = src;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Snapshot an SVG element (2× scale). `css` is inlined so classes survive.
 * The callback also receives the standalone SVG markup (the svgExport).
 */
export function svgToPng(
  svg: SVGSVGElement,
  css: string,
  background: string,
  onReady: (dataUri: string, svgMarkup: string) => void
): void {
  const vb = svg.viewBox.baseVal;
  const width = vb && vb.width > 0 ? vb.width : svg.clientWidth;
  const height = vb && vb.height > 0 ? vb.height : svg.clientHeight;
  if (width <= 0 || height <= 0) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", SVG_NS);
  const styleEl = document.createElementNS(SVG_NS, "style");
  styleEl.textContent = css;
  clone.insertBefore(styleEl, clone.firstChild);
  const bgRect = document.createElementNS(SVG_NS, "rect");
  bgRect.setAttribute("width", "100%");
  bgRect.setAttribute("height", "100%");
  bgRect.setAttribute("fill", background);
  clone.insertBefore(bgRect, styleEl.nextSibling);
  const markup = new XMLSerializer().serializeToString(clone);
  rasterize(markup, width, height, background, 2, (uri) => onReady(uri, markup));
}

/**
 * Snapshot an HTML element via <foreignObject> (2× scale). The callback also
 * receives the standalone SVG markup (the svgExport).
 */
export function htmlToPng(
  root: HTMLElement,
  css: string,
  background: string,
  onReady: (dataUri: string, svgMarkup: string) => void
): void {
  const width = root.clientWidth;
  const height = root.clientHeight;
  if (width <= 0 || height <= 0) return;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const markup =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${css}</style>` +
    `<rect width="100%" height="100%" fill="${escapeAttr(background)}"/>` +
    `<foreignObject width="100%" height="100%">` +
    new XMLSerializer().serializeToString(clone) +
    `</foreignObject></svg>`;
  rasterize(markup, width, height, background, 2, (uri) => onReady(uri, markup));
}

/** Debounced snapshot scheduling (the Fishbone 400 ms pattern). */
export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly generate: () => void,
    private readonly delayMs = 400
  ) {}
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.generate(), this.delayMs);
  }
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
