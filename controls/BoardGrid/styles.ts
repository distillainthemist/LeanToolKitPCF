// BoardGrid stylesheet — the tile wall. Tiles are white cards on the board
// background; the stored card snapshot fills each tile (inline svg or img),
// below a title bar along the tile's top edge. Edit mode shows dashed
// add-tiles in the empty cells, a grab cursor on the rest, and a ⤡ corner
// handle for stretching a tile across multiple cells.

export const BOARDGRID_CSS = `
.ltk-bg-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.ltk-bg-grid {
  display: grid;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

/* optional column headers above the grid */
.ltk-bg-colheads {
  display: grid;
  gap: 10px;
  flex: 0 0 auto;
  padding-bottom: 6px;
}
.ltk-bg-colhead {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 2px;
}
/* edit mode: the heading as a field, same visual weight as the label */
.ltk-bg-colhead-input {
  min-width: 0;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-fg);
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 3px 6px;
}
.ltk-bg-colhead-input::placeholder {
  color: var(--ltk-muted);
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}

/* ---- one slot ---- */
.ltk-bg-slot {
  position: relative;
  min-height: 90px;
  border-radius: 8px;
  overflow: hidden;
}
.ltk-bg-tile {
  position: absolute;
  inset: 0;
  background: #fff;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  touch-action: manipulation;
  display: flex;
}
.ltk-bg-edit .ltk-bg-tile { cursor: grab; touch-action: none; }
.ltk-bg-readonly .ltk-bg-tile { cursor: default; }
.ltk-bg-tile:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.10); }

/* the snapshot area: a positioning context for the scaled stage / svg / img */
.ltk-bg-snap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* with a title bar, the snapshot sits below it rather than sliding under */
.ltk-bg-haschip .ltk-bg-snap { top: 28px; }
.ltk-bg-snap img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.ltk-bg-snap .ltk-bg-nosnap {
  font-size: 12.5px;
  color: var(--ltk-muted);
  text-align: center;
  padding: 12px;
}
/* the extracted foreignObject content at natural size, fitted by transform:
   scale() — the WebKit-safe alternative to svg viewport scaling */
.ltk-bg-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  pointer-events: none; /* the copied card DOM is a picture, not a control */
  overflow: hidden;
}

/* title bar along the top: title text + the ✎ button at its right end */
.ltk-bg-chip {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--ltk-bg) 88%, transparent);
  border-bottom: 1px solid var(--ltk-hairline);
  color: var(--ltk-fg); /* barColor overrides inline with textOn(barColor) */
  pointer-events: none; /* the ✎ button opts back in */
}
.ltk-bg-chip-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: inherit; /* follows the chip's auto-contrast colour */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* meeting nav-order field (edit mode) and its read-mode tag */
.ltk-bg-nav {
  flex: none;
  pointer-events: auto;
  width: 38px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  border-radius: 6px;
  font: inherit;
  font-size: 11.5px;
  padding: 2px 4px;
  text-align: center;
}
.ltk-bg-navtag {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  border: 1px solid currentColor;
  border-radius: 999px;
  /* equal min sides = a true circle for one digit, a pill for two */
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  opacity: 0.75;
}
.ltk-bg-editbtn {
  flex: none;
  pointer-events: auto;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
  padding: 3px 8px;
  cursor: pointer;
}
.ltk-bg-editbtn:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }

/* empty slot */
.ltk-bg-empty {
  position: absolute;
  inset: 0;
  border: 2px dashed var(--ltk-hairline);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--ltk-muted);
}
.ltk-bg-edit .ltk-bg-empty { cursor: pointer; }
.ltk-bg-edit .ltk-bg-empty:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ⤡ resize handle: bottom-right corner, edit mode only */
.ltk-bg-resize {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 3;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 6px;
  cursor: nwse-resize;
}
.ltk-bg-resize:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-bg-resizing {
  z-index: 5;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  outline: 3px solid var(--ltk-accent);
  outline-offset: -3px;
}

/* ---- drag states ---- */
.ltk-bg-dragging {
  opacity: 0.92;
  z-index: 5;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  cursor: grabbing;
}
.ltk-bg-droptarget .ltk-bg-tile,
.ltk-bg-droptarget .ltk-bg-empty {
  outline: 3px solid var(--ltk-accent);
  outline-offset: -3px;
}
/* no text selection mid-drag */
.ltk-bg-grid.ltk-bg-draglive, .ltk-bg-grid.ltk-bg-draglive * {
  user-select: none;
  -webkit-user-select: none;
}
`;
