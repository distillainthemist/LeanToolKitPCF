// SqdpcCard stylesheet — letter-shaped month calendars. Tile colours (and
// the diagonal shift gradient) are set inline (Safari rule).

export const SQDPC_CSS = `
.ltk-sq-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 10px;
  overflow: auto;
}

/* ---- letter panels: fill the height; subtitle band on top, element centred ---- */
.ltk-sq-panels {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex-wrap: wrap;
}
.ltk-sq-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ltk-sq-caption {
  flex: 0 0 auto;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ltk-fg);
  text-align: center;
  min-height: 22px;
  line-height: 22px;
  margin-bottom: 4px;
}
.ltk-sq-gridwrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ltk-sq-letter {
  display: grid;
  grid-auto-rows: var(--sq-tile, 30px);
  gap: 3px;
}

/* ---- tiles (sized by the --sq-tile scale-to-fill variable) ---- */
.ltk-sq-tile {
  width: var(--sq-tile, 30px);
  height: var(--sq-tile, 30px);
  border-radius: 5px;
  border: 1px solid var(--ltk-hairline);
  cursor: pointer;
  touch-action: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  line-height: 1;
  overflow: hidden;
  transition: filter 150ms ease;
}
.ltk-sq-tile:hover { filter: brightness(0.93); }
.ltk-sq-tile.ltk-readonly { cursor: default; }
.ltk-sq-tile.ltk-sq-filler {
  background: var(--ltk-hairline);
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}
.ltk-sq-num { font-size: calc(var(--sq-tile, 30px) * 0.34); font-weight: 700; }
.ltk-sq-sub { font-size: calc(var(--sq-tile, 30px) * 0.26); font-weight: 600; margin-top: 1px; opacity: 0.9; }
.ltk-sq-halo { text-shadow: 0 1px 2px rgba(0,0,0,0.55); }

/* ---- legend ---- */
.ltk-sq-legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--ltk-muted);
  align-items: center;
  flex-wrap: wrap;
}
.ltk-sq-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.ltk-sq-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.ltk-sq-legend-hint { margin-left: auto; }
`;
