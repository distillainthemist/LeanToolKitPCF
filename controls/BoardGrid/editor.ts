// The BoardGrid view — the master-leanboard tile wall. Read mode: tap a
// tile to open its card (the app navigates). Edit mode: tap a tile (or its
// ✎ button) to configure it, tap an empty cell to add a card, drag a tile
// onto another cell to move/swap, drag the ⤡ corner handle to stretch a
// tile across multiple cells (the new layout is emitted for the app to
// persist). The grid is columns-wide only — rows derive from the content,
// and edit mode keeps a spare blank row available at the bottom.
//
// Snapshot rendering — the WebKit rule, learned the hard way: Safari does
// not apply the svg viewport (viewBox) scale to foreignObject content, in
// <img> AND inline. So a foreignObject snapshot is never scaled via svg:
// its HTML content is EXTRACTED and scaled with a CSS transform, which
// WebKit handles correctly. Pure-vector svgs scale fine inline, and data:
// image URIs (plain PNGs) are fine in an <img>.

import { applyThemeVars, defaultTheme, parseColor, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar, renderGhost } from "../../shared/ui/chrome";
import { makeInteractive } from "../../shared/interact/drag";
import {
  BoardLayout,
  BoardTile,
  cellPos,
  isImageUri,
  layoutBoard,
  PlacedTile,
  sanitizeSvg,
} from "./types";
import { BOARDGRID_CSS } from "./styles";

export type SlotAction = "open" | "configure" | "add";

export interface SlotEvent {
  action: SlotAction;
  pos: number;
  cardId: string;
  cardType: string;
  title: string;
}

export interface BoardGridCallbacks {
  onSelect: (e: SlotEvent) => void;
  /**
   * Fired after a drag moves/resizes a tile, a nav order is edited, or a
   * column heading is edited: every tile's placement plus its meeting
   * navigation order, and the column headings.
   */
  onLayout: (
    slots: { cardId: string; pos: number; w: number; h: number; nav: number }[],
    columnTitles: string[]
  ) => void;
}

/** Must match the .ltk-bg-grid gap in styles.ts (cell hit-testing needs it). */
const GRID_GAP = 10;

export class BoardGridView {
  private readonly root: HTMLElement;
  private tiles: BoardTile[] = [];
  private cols = 1;
  private colTitles: string[] = [];
  private layout: BoardLayout | null = null;
  private editMode = false;
  private readOnly = false;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  /** Per-tile rescale callbacks (CSS-transform fitting), rebuilt each render. */
  private fitters: (() => void)[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: BoardGridCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-boardgrid-css", BOARDGRID_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    // refit every scaled snapshot whenever the grid resizes
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.refit());
      this.resizeObserver.observe(this.root);
    }
    this.render();
  }

  private refit(): void {
    for (const fit of this.fitters) fit();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setTiles(tiles: BoardTile[], cols: number): void {
    if (
      JSON.stringify(tiles) === JSON.stringify(this.tiles) &&
      cols === this.cols
    ) {
      return;
    }
    this.tiles = tiles;
    this.cols = cols;
    this.render();
  }

  setColumnTitles(titles: string[]): void {
    if (JSON.stringify(titles) === JSON.stringify(this.colTitles)) return;
    this.colTitles = titles;
    this.render();
  }

  setEditMode(on: boolean): void {
    if (this.editMode !== on) {
      this.editMode = on;
      this.render();
    }
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  destroy(): void {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.root.remove();
  }

  // ---- rendering ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (this.editMode && !this.readOnly) this.root.classList.add("ltk-bg-edit");
    else this.root.classList.remove("ltk-bg-edit");
    if (this.readOnly) this.root.classList.add("ltk-bg-readonly");
    else this.root.classList.remove("ltk-bg-readonly");

    const body = el("div", "ltk-bg-body");
    this.root.appendChild(body);
    this.fitters = [];

    // read mode with nothing configured: an instructive ghost, not a grid
    if (this.tiles.length === 0 && (!this.editMode || this.readOnly)) {
      renderGhost(
        body,
        this.prompts.general.length > 0
          ? this.prompts.general
          : ["No cards on this board yet", "Open board setup to add cards"]
      );
      return;
    }

    // rows derive from content; the spare add-row exists only in edit mode
    const lay = layoutBoard(this.tiles, this.cols, this.editMode && !this.readOnly);
    this.layout = lay;

    // optional column headers above the grid (same column template) —
    // read mode shows them only when set; edit mode always offers the
    // fields so headings can be added to an unheaded board
    const canEdit = this.editMode && !this.readOnly;
    if (canEdit || this.colTitles.some((t) => t !== "")) {
      const heads = el("div", "ltk-bg-colheads");
      heads.style.gridTemplateColumns = `repeat(${lay.cols}, 1fr)`;
      for (let c = 0; c < lay.cols; c++) {
        if (canEdit) {
          const field = el("input", "ltk-bg-colhead-input") as HTMLInputElement;
          field.type = "text";
          field.placeholder = "Column title";
          field.title = "Column heading (empty = none)";
          field.value = this.colTitles[c] ?? "";
          field.addEventListener("change", () => {
            const next = this.colTitles.slice(0, lay.cols);
            while (next.length < lay.cols) next.push("");
            next[c] = field.value.trim();
            this.colTitles = next;
            this.emitLayout();
          });
          heads.appendChild(field);
        } else {
          heads.appendChild(el("div", "ltk-bg-colhead", this.colTitles[c] ?? ""));
        }
      }
      body.appendChild(heads);
    }

    const grid = el("div", "ltk-bg-grid");
    grid.style.gridTemplateColumns = `repeat(${lay.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${lay.rows}, 1fr)`;
    body.appendChild(grid);

    for (const placed of lay.placed) grid.appendChild(this.renderTile(placed, grid));
    for (const cell of lay.free) grid.appendChild(this.renderEmpty(cell));
    // fit once the grid has laid out (tile sizes are unknown until then).
    // A timer, NOT requestAnimationFrame — rAF starves in background /
    // throttled tabs (a wallboard on a TV must still lay out correctly).
    setTimeout(() => this.refit(), 0);
  }

  /** Grid-place a slot element at a 0-based cell with a span. */
  private placeSlot(
    slot: HTMLElement,
    col: number,
    row: number,
    w: number,
    h: number
  ): void {
    slot.style.gridColumn = `${col + 1} / span ${w}`;
    slot.style.gridRow = `${row + 1} / span ${h}`;
    slot.dataset.col = String(col);
    slot.dataset.row = String(row);
    slot.dataset.w = String(w);
    slot.dataset.h = String(h);
  }

  private renderEmpty(cell: { col: number; row: number }): HTMLElement {
    const slot = el("div", "ltk-bg-slot");
    this.placeSlot(slot, cell.col, cell.row, 1, 1);
    const zone = el("div", "ltk-bg-empty", this.editMode && !this.readOnly ? "＋ Add card" : "");
    slot.appendChild(zone);
    if (this.editMode && !this.readOnly) {
      zone.addEventListener("click", () =>
        this.cb.onSelect({
          action: "add",
          pos: cellPos(this.cols, cell.col, cell.row),
          cardId: "",
          cardType: "",
          title: "",
        })
      );
    }
    return slot;
  }

  /**
   * Render a snapshot into `snap`. foreignObject svgs get their HTML content
   * extracted and fitted with a CSS transform (WebKit does not apply svg
   * viewport scaling to foreignObject content — <img> AND inline). Pure svgs
   * scale inline; data: URIs go through an <img>.
   */
  private renderSnapshot(snap: HTMLElement, tile: BoardTile): void {
    const raw = tile.svg.trim();
    if (raw === "") {
      snap.appendChild(el("div", "ltk-bg-nosnap", tile.cardType || "Card"));
      return;
    }
    if (isImageUri(raw)) {
      const img = el("img");
      img.src = raw;
      img.alt = tile.title || tile.cardType;
      snap.appendChild(img);
      return;
    }
    const svg = sanitizeSvg(raw);
    if (!svg) {
      snap.appendChild(el("div", "ltk-bg-nosnap", tile.cardType || "Card"));
      return;
    }

    // intrinsic size: viewBox first, then width/height attributes
    const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const width = vb.length === 4 && vb[2] > 0 ? vb[2] : Number(svg.getAttribute("width")) || 640;
    const height = vb.length === 4 && vb[3] > 0 ? vb[3] : Number(svg.getAttribute("height")) || 400;

    const fo = svg.getElementsByTagName("foreignObject")[0];
    if (!fo) {
      // pure vector — svg viewport scaling of real svg content is fine
      const node = document.importNode(svg, true);
      node.setAttribute("width", "100%");
      node.setAttribute("height", "100%");
      node.setAttribute("preserveAspectRatio", "xMidYMid meet");
      node.style.pointerEvents = "none";
      snap.appendChild(node);
      return;
    }

    // HTML snapshot: stage the foreignObject's content at its natural size
    // and fit it with transform: scale() — the WebKit-safe path
    const stage = el("div", "ltk-bg-stage");
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    // the export's background rect → the stage background
    const rect = svg.getElementsByTagName("rect")[0];
    const fill = rect?.getAttribute("fill");
    if (fill) stage.style.background = fill;
    // carry the export's inlined css, then the serialized card DOM (XHTML
    // namespace === the HTML namespace, so these import as live elements)
    for (const styleEl of Array.from(svg.getElementsByTagName("style"))) {
      stage.appendChild(document.importNode(styleEl, true));
    }
    for (const child of Array.from(fo.children)) {
      stage.appendChild(document.importNode(child, true));
    }
    snap.appendChild(stage);

    const fit = () => {
      const w = snap.clientWidth;
      const h = snap.clientHeight;
      if (w <= 0 || h <= 0) return;
      const k = Math.min(w / width, h / height);
      stage.style.transform = `scale(${k})`;
      stage.style.left = `${Math.max(0, (w - width * k) / 2)}px`;
      stage.style.top = `${Math.max(0, (h - height * k) / 2)}px`;
    };
    this.fitters.push(fit);
    fit();
  }

  private renderTile(placed: PlacedTile, grid: HTMLElement): HTMLElement {
    const tile = placed.tile;
    const slot = el("div", "ltk-bg-slot");
    this.placeSlot(slot, placed.col, placed.row, placed.w, placed.h);
    const anchorPos = cellPos(this.cols, placed.col, placed.row);
    const card = el("div", "ltk-bg-tile");
    slot.appendChild(card);

    const snap = el("div", "ltk-bg-snap");
    this.renderSnapshot(snap, tile);
    card.appendChild(snap);

    // title bar along the top: the title only (card type as fallback), with
    // the nav-order field and ✎ edit button at its right end in edit mode
    const canEdit = this.editMode && !this.readOnly;
    const barText = tile.title !== "" ? tile.title : tile.cardType;
    if (barText !== "" || canEdit) {
      const chip = el("div", "ltk-bg-chip");
      // per-tile strip colour (association between related cards)
      if (tile.barColor !== "" && parseColor(tile.barColor) !== null) {
        chip.style.background = tile.barColor;
        chip.style.color = textOn(tile.barColor);
      }
      chip.appendChild(el("span", "ltk-bg-chip-title", barText));
      if (canEdit) {
        // meeting navigation order — distinct from the layout pos
        const nav = el("input", "ltk-bg-nav") as HTMLInputElement;
        nav.type = "number";
        nav.min = "1";
        nav.max = "99";
        nav.placeholder = "–";
        nav.title = "Navigation order when running the meeting (empty = not in the flow)";
        nav.value = tile.nav > 0 ? String(tile.nav) : "";
        nav.addEventListener("change", () => {
          const n = Math.round(Number(nav.value));
          tile.nav = Number.isFinite(n) && n >= 1 ? Math.min(99, n) : 0;
          this.emitLayout();
        });
        chip.appendChild(nav);
      } else if (tile.nav > 0) {
        // read mode: show the flow position quietly
        chip.appendChild(el("span", "ltk-bg-navtag", String(tile.nav)));
      }
      if (canEdit) {
        const edit = el("button", "ltk-bg-editbtn") as HTMLButtonElement;
        edit.type = "button";
        edit.textContent = "✎";
        edit.title = "Configure this card";
        edit.addEventListener("click", (e) => {
          e.stopPropagation();
          this.cb.onSelect({
            action: "configure",
            pos: anchorPos,
            cardId: tile.cardId,
            cardType: tile.cardType,
            title: tile.title,
          });
        });
        chip.appendChild(edit);
      }
      card.appendChild(chip);
      card.classList.add("ltk-bg-haschip"); // snap insets below the bar
    }

    if (this.readOnly) return slot;

    const event = (action: SlotAction): SlotEvent => ({
      action,
      pos: anchorPos,
      cardId: tile.cardId,
      cardType: tile.cardType,
      title: tile.title,
    });

    if (!this.editMode) {
      makeInteractive(card, {
        onTap: () => this.cb.onSelect(event("open")),
      });
      return slot;
    }

    // edit mode: tap configures; drag moves the tile to the cell under the
    // pointer (swapping with the tile already there, if any)
    let target: { col: number; row: number } | null = null;
    makeInteractive(card, {
      onTap: () => this.cb.onSelect(event("configure")),
      onStart: () => {
        card.classList.add("ltk-bg-dragging");
        grid.classList.add("ltk-bg-draglive");
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      },
      onMove: (e, dx, dy) => {
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        const cell = this.cellAt(grid, e.clientX, e.clientY);
        target =
          cell && !this.inArea(cell, placed) ? cell : null;
        for (const child of Array.from(grid.children)) {
          const s = child as HTMLElement;
          s.classList.toggle(
            "ltk-bg-droptarget",
            target !== null && this.slotCovers(s, target)
          );
        }
      },
      onEnd: () => {
        card.style.transform = "";
        card.classList.remove("ltk-bg-dragging");
        grid.classList.remove("ltk-bg-draglive");
        if (target !== null) {
          const victim = this.layout?.placed.find(
            (p) => p.tile !== tile && this.inArea(target as { col: number; row: number }, p)
          );
          if (victim) {
            // land on an occupied area: trade anchors with that tile
            tile.pos = cellPos(this.cols, victim.col, victim.row);
            victim.tile.pos = anchorPos;
          } else {
            tile.pos = cellPos(this.cols, target.col, target.row);
          }
          this.emitLayout();
        }
        target = null;
        this.render();
      },
    });

    // ⤡ resize: drag the corner handle to the cell the tile should stretch to
    const handle = el("button", "ltk-bg-resize") as HTMLButtonElement;
    handle.type = "button";
    handle.textContent = "⤡";
    handle.title = "Drag to resize";
    card.appendChild(handle);
    let live: { w: number; h: number } | null = null;
    makeInteractive(handle, {
      onStart: () => {
        card.classList.add("ltk-bg-resizing");
        grid.classList.add("ltk-bg-draglive");
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      },
      onMove: (e) => {
        const cell = this.cellAt(grid, e.clientX, e.clientY);
        if (!cell) return;
        live = {
          w: Math.min(Math.max(1, cell.col - placed.col + 1), this.cols - placed.col),
          h: Math.max(1, cell.row - placed.row + 1),
        };
        // preview the stretch live; the snapshot rescales with it. dataset
        // follows so cellAt keeps subdividing this slot correctly
        slot.style.gridColumn = `${placed.col + 1} / span ${live.w}`;
        slot.style.gridRow = `${placed.row + 1} / span ${live.h}`;
        slot.dataset.w = String(live.w);
        slot.dataset.h = String(live.h);
        this.refit();
      },
      onEnd: () => {
        card.classList.remove("ltk-bg-resizing");
        grid.classList.remove("ltk-bg-draglive");
        if (live && (live.w !== placed.w || live.h !== placed.h)) {
          tile.w = live.w;
          tile.h = live.h;
          tile.pos = anchorPos; // keep the anchor while the span changes
          this.emitLayout();
        }
        live = null;
        this.render();
      },
    });
    return slot;
  }

  /** Re-place everything and hand the app each tile's resolved pos + span. */
  private emitLayout(): void {
    const lay = layoutBoard(this.tiles, this.cols, false);
    this.cb.onLayout(
      lay.placed.map((p) => ({
        cardId: p.tile.cardId,
        pos: cellPos(this.cols, p.col, p.row),
        w: p.w,
        h: p.h,
        nav: p.tile.nav,
      })),
      this.colTitles.slice(0, this.cols)
    );
  }

  /**
   * The 0-based grid cell under the pointer, or null when outside the grid.
   * Hit-tests the slot elements (together they tile the whole grid) rather
   * than dividing the grid rect — the rect lies about track sizes once the
   * min-height tracks overflow the container. A spanned slot is subdivided
   * into its w×h cells.
   */
  private cellAt(
    grid: HTMLElement,
    x: number,
    y: number
  ): { col: number; row: number } | null {
    for (const child of Array.from(grid.children)) {
      const s = child as HTMLElement;
      const r = s.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const w = Number(s.dataset.w) || 1;
      const h = Number(s.dataset.h) || 1;
      const cw = (r.width - GRID_GAP * (w - 1)) / w;
      const ch = (r.height - GRID_GAP * (h - 1)) / h;
      return {
        col:
          Number(s.dataset.col) +
          Math.max(0, Math.min(w - 1, Math.floor((x - r.left) / (cw + GRID_GAP)))),
        row:
          Number(s.dataset.row) +
          Math.max(0, Math.min(h - 1, Math.floor((y - r.top) / (ch + GRID_GAP)))),
      };
    }
    return null;
  }

  private inArea(
    cell: { col: number; row: number },
    area: { col: number; row: number; w: number; h: number }
  ): boolean {
    return (
      cell.col >= area.col &&
      cell.col < area.col + area.w &&
      cell.row >= area.row &&
      cell.row < area.row + area.h
    );
  }

  /** Does this slot element's placed area cover the cell? */
  private slotCovers(slot: HTMLElement, cell: { col: number; row: number }): boolean {
    return this.inArea(cell, {
      col: Number(slot.dataset.col),
      row: Number(slot.dataset.row),
      w: Number(slot.dataset.w) || 1,
      h: Number(slot.dataset.h) || 1,
    });
  }
}
