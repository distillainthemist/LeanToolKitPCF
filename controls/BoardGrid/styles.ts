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

/* the snapshot: inline svg or an <img>, letterboxed to fit */
.ltk-bg-snap { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ltk-bg-snap svg { width: 100%; height: 100%; }
.ltk-bg-snap img { width: 100%; height: 100%; object-fit: contain; }
.ltk-bg-snap .ltk-bg-nosnap {
  font-size: 12.5px;
  color: var(--ltk-muted);
  text-align: center;
  padding: 12px;
}

/* title chip along the bottom edge */
.ltk-bg-chip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  background: color-mix(in srgb, var(--ltk-bg) 88%, transparent);
  border-top: 1px solid var(--ltk-hairline);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.ltk-bg-chip .ltk-bg-type { font-weight: 400; color: var(--ltk-muted); }

/* edit-mode configure hint, top-right of a filled tile */
.ltk-bg-cog {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 13px;
  color: var(--ltk-muted);
  background: color-mix(in srgb, var(--ltk-bg) 85%, transparent);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 2px 7px;
  pointer-events: none;
}

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
