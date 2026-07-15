// The BoardGrid view — the master-leanboard tile wall. Read mode: tap a
// tile to open its card (the app navigates). Edit mode: tap a tile to
// configure it, tap an empty slot to add a card, drag a tile onto another
// slot to swap positions (the new layout is emitted for the app to persist).
// Snapshots render INLINE (sanitised svg markup, or an <img> for data URIs
// — plain PNG data URIs are WebKit-safe; it is only foreignObject SVG that
// must never go through an <img>).

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

  constructor(
    host: HTMLElement,
    private readonly cb: BoardGridCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-boardgrid-css", BOARDGRID_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.render();
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

  private renderTile(tile: BoardTile, idx: number, grid: HTMLElement): HTMLElement {
    const slot = el("div", "ltk-bg-slot");
    slot.dataset.slotIdx = String(idx);
    const card = el("div", "ltk-bg-tile");
    slot.appendChild(card);

    // the snapshot: inline sanitised svg, an <img> for data URIs, or a
    // typed placeholder when the card has no snapshot yet
    const snap = el("div", "ltk-bg-snap");
    const raw = tile.svg.trim();
    if (raw !== "" && isImageUri(raw)) {
      const img = el("img");
      img.src = raw;
      img.alt = tile.title || tile.cardType;
      snap.appendChild(img);
    } else if (raw !== "") {
      const svg = sanitizeSvg(raw);
      if (svg) {
        const node = document.importNode(svg, true);
        node.setAttribute("width", "100%");
        node.setAttribute("height", "100%");
        node.setAttribute("preserveAspectRatio", "xMidYMid meet");
        snap.appendChild(node);
      } else {
        snap.appendChild(el("div", "ltk-bg-nosnap", tile.cardType || "Card"));
      }
    } else {
      snap.appendChild(el("div", "ltk-bg-nosnap", tile.cardType || "Card"));
    }
    card.appendChild(snap);

    if (tile.title !== "" || tile.cardType !== "") {
      const chip = el("div", "ltk-bg-chip");
      chip.textContent = tile.title !== "" ? tile.title : tile.cardType;
      if (tile.title !== "" && tile.cardType !== "") {
        chip.appendChild(el("span", "ltk-bg-type", `  ·  ${tile.cardType}`));
      }
      card.appendChild(chip);
    }
    if (this.editMode && !this.readOnly) {
      card.appendChild(el("div", "ltk-bg-cog", "✎"));
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
