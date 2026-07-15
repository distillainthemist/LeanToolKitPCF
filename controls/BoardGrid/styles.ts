// BoardGrid stylesheet — the tile wall. Tiles are white cards on the board
// background; the stored card snapshot fills each tile (inline svg or img),
// with the slot title as a chip along the tile's bottom edge. Edit mode
// shows dashed add-tiles in the empty slots and a grab cursor on the rest.

export const BOARDGRID_CSS = `
.ltk-bg-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: auto;
}
.ltk-bg-grid {
  display: grid;
  gap: 10px;
  height: 100%;
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

/* card type — a quiet tag at the top of the tile */
.ltk-bg-typetag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 3px 10px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  background: color-mix(in srgb, var(--ltk-bg) 82%, transparent);
  border-bottom: 1px solid var(--ltk-hairline);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* title bar along the bottom: title text + the ✎ button at its right end */
.ltk-bg-chip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--ltk-bg) 88%, transparent);
  border-top: 1px solid var(--ltk-hairline);
  pointer-events: none; /* the ✎ button opts back in */
}
.ltk-bg-chip-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
