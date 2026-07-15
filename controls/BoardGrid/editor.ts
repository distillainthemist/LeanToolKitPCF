// The BoardGrid view — the master-leanboard tile wall. Read mode: tap a
// tile to open its card (the app navigates). Edit mode: tap a tile (or its
// ✎ button) to configure it, tap an empty slot to add a card, drag a tile
// onto another slot to swap positions (the new layout is emitted for the
// app to persist).
//
// Snapshot rendering — the WebKit rule, learned the hard way: Safari does
// not apply the svg viewport (viewBox) scale to foreignObject content, in
// <img> AND inline. So a foreignObject snapshot is never scaled via svg:
// its HTML content is EXTRACTED and scaled with a CSS transform, which
// WebKit handles correctly. Pure-vector svgs scale fine inline, and data:
// image URIs (plain PNGs) are fine in an <img>.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar, renderGhost } from "../../shared/ui/chrome";
import { makeInteractive } from "../../shared/interact/drag";
import { BoardTile, GridShape, isImageUri, layoutSlots, sanitizeSvg } from "./types";
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
  /** Fired after a drag changes the arrangement: every filled slot's new pos. */
  onLayout: (slots: { cardId: string; pos: number }[]) => void;
}

export class BoardGridView {
  private readonly root: HTMLElement;
  private tiles: BoardTile[] = [];
  private shape: GridShape = { cols: 1, rows: 1 };
  private slots: (BoardTile | null)[] = [null];
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

  setTiles(tiles: BoardTile[], shape: GridShape): void {
    if (
      JSON.stringify(tiles) === JSON.stringify(this.tiles) &&
      shape.cols === this.shape.cols &&
      shape.rows === this.shape.rows
    ) {
      return;
    }
    this.tiles = tiles;
    this.shape = shape;
    this.slots = layoutSlots(tiles, shape);
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

    const grid = el("div", "ltk-bg-grid");
    grid.style.gridTemplateColumns = `repeat(${this.shape.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${this.shape.rows}, 1fr)`;
    body.appendChild(grid);

    this.slots.forEach((tile, idx) => {
      grid.appendChild(tile ? this.renderTile(tile, idx, grid) : this.renderEmpty(idx));
    });
    // fit once the grid has laid out (tile sizes are unknown until then).
    // A timer, NOT requestAnimationFrame — rAF starves in background /
    // throttled tabs (a wallboard on a TV must still lay out correctly).
    setTimeout(() => this.refit(), 0);
  }

  private renderEmpty(idx: number): HTMLElement {
    const slot = el("div", "ltk-bg-slot");
    slot.dataset.slotIdx = String(idx);
    const zone = el("div", "ltk-bg-empty", this.editMode && !this.readOnly ? "＋ Add card" : "");
    slot.appendChild(zone);
    if (this.editMode && !this.readOnly) {
      zone.addEventListener("click", () =>
        this.cb.onSelect({
          action: "add",
          pos: idx + 1,
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

  private renderTile(tile: BoardTile, idx: number, grid: HTMLElement): HTMLElement {
    const slot = el("div", "ltk-bg-slot");
    slot.dataset.slotIdx = String(idx);
    const card = el("div", "ltk-bg-tile");
    slot.appendChild(card);

    const snap = el("div", "ltk-bg-snap");
    this.renderSnapshot(snap, tile);
    card.appendChild(snap);

    // card type — a quiet tag at the top of the tile
    if (tile.cardType !== "") {
      card.appendChild(el("div", "ltk-bg-typetag", tile.cardType));
    }

    // title bar along the bottom: the title only, with the ✎ edit button at
    // its right end in edit mode
    const canEdit = this.editMode && !this.readOnly;
    const barText = tile.title !== "" ? tile.title : tile.cardType;
    if (barText !== "" || canEdit) {
      const chip = el("div", "ltk-bg-chip");
      chip.appendChild(el("span", "ltk-bg-chip-title", barText));
      if (canEdit) {
        const edit = el("button", "ltk-bg-editbtn") as HTMLButtonElement;
        edit.type = "button";
        edit.textContent = "✎";
        edit.title = "Configure this card";
        edit.addEventListener("click", (e) => {
          e.stopPropagation();
          this.cb.onSelect({
            action: "configure",
            pos: idx + 1,
            cardId: tile.cardId,
            cardType: tile.cardType,
            title: tile.title,
          });
        });
        chip.appendChild(edit);
      }
      card.appendChild(chip);
    }

    if (this.readOnly) return slot;

    const event = (action: SlotAction): SlotEvent => ({
      action,
      pos: idx + 1,
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

    // edit mode: tap configures; drag swaps slots
    let targetIdx: number | null = null;
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
        targetIdx = this.slotAt(grid, e.clientX, e.clientY, idx);
        for (const s of Array.from(grid.children)) {
          s.classList.toggle(
            "ltk-bg-droptarget",
            (s as HTMLElement).dataset.slotIdx === String(targetIdx)
          );
        }
      },
      onEnd: () => {
        card.style.transform = "";
        card.classList.remove("ltk-bg-dragging");
        grid.classList.remove("ltk-bg-draglive");
        if (targetIdx !== null && targetIdx !== idx) {
          [this.slots[idx], this.slots[targetIdx]] = [
            this.slots[targetIdx],
            this.slots[idx],
          ];
          this.cb.onLayout(
            this.slots.flatMap((s, i) =>
              s ? [{ cardId: s.cardId, pos: i + 1 }] : []
            )
          );
        }
        targetIdx = null;
        this.render();
      },
    });
    return slot;
  }

  /** The slot index under the pointer (excluding the dragged slot), or null. */
  private slotAt(grid: HTMLElement, x: number, y: number, dragIdx: number): number | null {
    for (const child of Array.from(grid.children)) {
      const s = child as HTMLElement;
      const idx = Number(s.dataset.slotIdx);
      if (idx === dragIdx) continue;
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return idx;
    }
    return null;
  }
}
