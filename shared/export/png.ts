// Snapshot machinery. An HTML card is wrapped in an SVG <foreignObject>,
// giving vector markup that is small, crisp at any size, and what the board
// stores as a card's tile.
//
// Two entry points, deliberately separate:
//   htmlToSvg — markup only. This is the hot path: every debounced card edit
//               takes a snapshot, and the board only ever keeps the markup.
//   htmlToPng — markup PLUS a rasterised 2× PNG data URI, for the kebab's
//               "Download PNG" alone. Rasterising costs an Image decode and
//               a canvas draw, so nothing on the edit path should call it.
//               When a host refuses to rasterise, the export is skipped
//               silently.
//
// Caveat: foreignObject SVGs render in documents but Safari can refuse them
// inside <img>; BoardGrid therefore renders tiles inline rather than as
// image sources.

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

/** Serialise an HTML element into standalone SVG markup via <foreignObject>. */
function snapshot(
  root: HTMLElement,
  css: string,
  background: string
): { markup: string; width: number; height: number } | null {
  const width = root.clientWidth;
  const height = root.clientHeight;
  if (width <= 0 || height <= 0) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const markup =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${css}</style>` +
    `<rect width="100%" height="100%" fill="${escapeAttr(background)}"/>` +
    `<foreignObject width="100%" height="100%">` +
    new XMLSerializer().serializeToString(clone) +
    `</foreignObject></svg>`;
  return { markup, width, height };
}

/**
 * Snapshot an HTML element to SVG markup — the tile the board stores.
 * Synchronous work only: no Image decode, no canvas. Use this on the edit
 * path; `htmlToPng` is for explicit downloads.
 */
export function htmlToSvg(
  root: HTMLElement,
  css: string,
  background: string,
  onReady: (svgMarkup: string) => void
): void {
  const shot = snapshot(root, css, background);
  if (shot) onReady(shot.markup);
}

/**
 * Snapshot an HTML element and rasterise it to a 2× PNG data URI. Only the
 * kebab's "Download PNG" needs this — see the note at the top of the file.
 */
export function htmlToPng(
  root: HTMLElement,
  css: string,
  background: string,
  onReady: (dataUri: string, svgMarkup: string) => void
): void {
  const shot = snapshot(root, css, background);
  if (!shot) return;
  rasterize(shot.markup, shot.width, shot.height, background, 2, (uri) =>
    onReady(uri, shot.markup)
  );
}

/** Save SVG markup to a downloaded .svg file. */
export function saveSvg(svg: string, filename: string): void {
  if (!svg) return;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
