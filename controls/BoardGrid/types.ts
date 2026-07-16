// BoardGrid — the master-leanboard tile grid. Renders each card's stored
// svgExport INLINE in the DOM (never inside an <img>), which sidesteps the
// WebKit bug where foreignObject SVGs render unscaled in image contexts
// (the Phase 0 spike's zoomed-to-a-corner tiles), and keeps tile storage at
// SVG size (~15KB) instead of PNG (~50-250KB).
//
// This control has no document: the tiles are pure input, taps and drags
// are pure output. No envelope, no actions channel, no snapshots.

export interface BoardTile {
  pos: number; // 1-based anchor cell, row-major; 0 = take the next free spot
  cardId: string;
  cardType: string;
  title: string;
  /** Raw svg markup (rendered inline) or a data: image URI (rendered <img>). */
  svg: string;
  /** Column span (stretched cards). Clamped to the grid width at layout. */
  w: number;
  /** Row span. */
  h: number;
  /** Title-strip fill for the tile chip ("" = board default). */
  barColor: string;
  /** Meeting navigation order (distinct from layout pos); 0 = unset. */
  nav: number;
}

/** One tile resolved onto the grid: 0-based anchor cell + effective span. */
export interface PlacedTile {
  tile: BoardTile;
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface BoardLayout {
  cols: number;
  rows: number;
  placed: PlacedTile[];
  /** 0-based cells covered by no tile — each is an add / drop target. */
  free: { col: number; row: number }[];
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asSpan(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(6, Math.round(n)) : 1;
}

function asNav(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(99, Math.round(n)) : 0;
}

/**
 * Parse the columnTitles input: JSON array preferred, CSV accepted (the
 * parseLegend contract). Never throws; empty/invalid = no header row.
 */
export function parseColumnTitles(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) return arr.map((v) => String(v ?? "").trim());
    } catch {
      /* fall through to CSV */
    }
  }
  return t.split(",").map((v) => v.trim());
}

/**
 * Parse tilesJSON: [{pos, cardId, cardType, title, svg, w, h, barColor,
 * nav}]. Tiles without a cardId are dropped; a missing/invalid pos gets the
 * next free spot when the grid is laid out; w/h default to a single cell.
 * Defensive; never throws.
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
        w: asSpan(o.w),
        h: asSpan(o.h),
        barColor: asStr(o.barColor).trim(),
        nav: asNav(o.nav),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Column count from the gridSize input: a bare number 1..6. Rows are never
 * specified — they derive from the content. Legacy "CxR" values still parse
 * (the column count is kept, the row count ignored). Empty/invalid = auto:
 * a near-square column count for the tiles' total cell area.
 */
export function parseColumns(
  raw: string | null | undefined,
  tiles: BoardTile[]
): number {
  const t = (raw ?? "").trim().toLowerCase();
  const m = /^(\d{1,2})\s*[x×]\s*\d{1,2}$/.exec(t);
  if (m) return Math.max(1, Math.min(6, Number(m[1])));
  const n = Number(t);
  if (t !== "" && Number.isInteger(n) && n >= 1 && n <= 6) return n;
  const area = Math.max(
    1,
    tiles.reduce((sum, tile) => sum + tile.w * tile.h, 0)
  );
  return Math.max(1, Math.min(6, Math.ceil(Math.sqrt(area))));
}

/** Layout can never run away past this many rows, whatever the input says. */
const MAX_ROWS = 24;

/** 1-based row-major pos of a 0-based cell. */
export function cellPos(cols: number, col: number, row: number): number {
  return row * cols + col + 1;
}

/**
 * Place every tile on a cols-wide grid. A tile anchors at its pos and covers
 * w×h cells; when its area collides with an earlier (lower-pos) tile, or its
 * span no longer fits its column, it scans forward to the first area that
 * fits. Rows are exactly what the content needs; `spareRow` (edit mode)
 * appends a blank row when the final row has no free cell, so there is
 * always somewhere to add or drop a card — the row disappears outside edit
 * mode because rows are derived, never stored.
 */
export function layoutBoard(
  tiles: BoardTile[],
  cols: number,
  spareRow: boolean
): BoardLayout {
  const occ: boolean[][] = [];
  const rowAt = (r: number): boolean[] => {
    while (occ.length <= r) occ.push(new Array<boolean>(cols).fill(false));
    return occ[r];
  };
  const fits = (col: number, row: number, w: number, h: number): boolean => {
    if (row + h > MAX_ROWS) return false;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (rowAt(r)[c]) return false;
      }
    }
    return true;
  };

  // anchor in pos order so the lower pos wins a contested area
  const ordered = tiles
    .map((tile, i) => ({ tile, i }))
    .sort(
      (a, b) =>
        (a.tile.pos || Number.MAX_SAFE_INTEGER) -
          (b.tile.pos || Number.MAX_SAFE_INTEGER) || a.i - b.i
    );

  const placed: PlacedTile[] = [];
  for (const { tile } of ordered) {
    const w = Math.max(1, Math.min(tile.w, cols));
    const h = Math.max(1, Math.min(tile.h, MAX_ROWS));
    const start = tile.pos >= 1 ? tile.pos - 1 : 0;
    for (let idx = start; idx < cols * MAX_ROWS; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      if (col + w > cols) continue;
      if (!fits(col, row, w, h)) continue;
      for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) rowAt(r)[c] = true;
      }
      placed.push({ tile, col, row, w, h });
      break;
    }
  }

  let rows = Math.max(1, ...placed.map((p) => p.row + p.h));
  const lastRowFull =
    placed.length > 0 && rowAt(rows - 1).every((cell) => cell);
  if (spareRow && lastRowFull && rows < MAX_ROWS) rows++;

  const free: { col: number; row: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!rowAt(r)[c]) free.push({ col: c, row: r });
    }
  }
  return { cols, rows, placed, free };
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
