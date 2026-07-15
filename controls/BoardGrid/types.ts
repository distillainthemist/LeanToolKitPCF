// BoardGrid — the master-leanboard tile grid. Renders each card's stored
// svgExport INLINE in the DOM (never inside an <img>), which sidesteps the
// WebKit bug where foreignObject SVGs render unscaled in image contexts
// (the Phase 0 spike's zoomed-to-a-corner tiles), and keeps tile storage at
// SVG size (~15KB) instead of PNG (~50-250KB).
//
// This control has no document: the tiles are pure input, taps and drags
// are pure output. No envelope, no actions channel, no snapshots.

export interface BoardTile {
  pos: number; // 1-based grid position
  cardId: string;
  cardType: string;
  title: string;
  /** Raw svg markup (rendered inline) or a data: image URI (rendered <img>). */
  svg: string;
}

export interface GridShape {
  cols: number;
  rows: number;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse tilesJSON: [{pos, cardId, cardType, title, svg}]. Tiles without a
 * cardId are dropped; a missing/invalid pos gets the next free slot when
 * the grid is laid out. Defensive; never throws.
 */
export function parseTiles(raw: string | null | undefined): BoardTile[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: BoardTile[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const cardId = asStr(o.cardId).trim();
      if (cardId === "") continue;
      const pos = Number(o.pos);
      out.push({
        pos: Number.isFinite(pos) && pos >= 1 ? Math.round(pos) : 0,
        cardId,
        cardType: asStr(o.cardType).trim(),
        title: asStr(o.title).trim(),
        svg: asStr(o.svg),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Grid shape from the gridSize input: "3x3" (columns x rows), a bare number
 * of columns ("4"), or empty for auto — a near-square grid sized to fit
 * every tile (and every tile's declared position).
 */
export function parseGridSize(
  raw: string | null | undefined,
  tiles: BoardTile[]
): GridShape {
  const need = Math.max(
    1,
    tiles.length,
    ...tiles.map((t) => t.pos)
  );
  const t = (raw ?? "").trim().toLowerCase();
  const m = /^(\d{1,2})\s*[x×]\s*(\d{1,2})$/.exec(t);
  if (m) {
    const cols = Math.max(1, Math.min(6, Number(m[1])));
    let rows = Math.max(1, Math.min(6, Number(m[2])));
    while (cols * rows < need && rows < 12) rows++;
    return { cols, rows };
  }
  const n = Number(t);
  if (t !== "" && Number.isInteger(n) && n >= 1 && n <= 6) {
    return { cols: n, rows: Math.max(1, Math.ceil(need / n)) };
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(need)));
  return { cols, rows: Math.max(1, Math.ceil(need / cols)) };
}

/**
 * Lay tiles into slots 1..capacity. A tile with a valid free position keeps
 * it; collisions and unplaced tiles take the next free slot; overflow tiles
 * beyond capacity are dropped (the shape from parseGridSize always fits).
 */
export function layoutSlots(
  tiles: BoardTile[],
  shape: GridShape
): (BoardTile | null)[] {
  const capacity = shape.cols * shape.rows;
  const slots: (BoardTile | null)[] = new Array(capacity).fill(null);
  const spill: BoardTile[] = [];
  for (const tile of tiles) {
    const idx = tile.pos - 1;
    if (idx >= 0 && idx < capacity && slots[idx] === null) slots[idx] = tile;
    else spill.push(tile);
  }
  for (const tile of spill) {
    const free = slots.indexOf(null);
    if (free === -1) break;
    slots[free] = tile;
  }
  return slots;
}

const URI_PREFIX = /^data:image\//i;

/** True when the tile's `svg` value is a data: image URI, not raw markup. */
export function isImageUri(svg: string): boolean {
  return URI_PREFIX.test(svg.trim());
}

/**
 * Parse + sanitise raw svg markup for inline rendering: drops script and
 * animation-timing elements, event-handler attributes and javascript: hrefs.
 * The markup comes from our own controls' exports, but the grid renders
 * whatever the table holds — so it cleans regardless. Returns null when the
 * markup does not parse as SVG.
 */
export function sanitizeSvg(markup: string): SVGSVGElement | null {
  const t = markup.trim();
  if (!t.startsWith("<svg")) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(t, "image/svg+xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return null;

  const banned = ["script", "animate", "set", "iframe", "embed", "object"];
  for (const tag of banned) {
    for (const node of Array.from(doc.getElementsByTagName(tag))) {
      node.parentNode?.removeChild(node);
    }
  }
  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name === "xlink:href" || name === "src") &&
          value.startsWith("javascript:"))
      ) {
        el.removeAttribute(attr.name);
      }
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return root as unknown as SVGSVGElement;
}
