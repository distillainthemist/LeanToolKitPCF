// ConditionsCard stylesheet — the SQDPC visual language on a rolling window.
// Cells are square (sized by the --cn-tile scale-to-fill variable); the
// conditions column carries a name plus an optional prompt.

export const CONDITIONS_CSS = `
.ltk-cn-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-cn-grid {
  display: grid;
  gap: 3px;
  justify-content: start;
  align-content: start;
  margin-left: 6px;
}

/* ---- conditions column: name up top, prompt beneath ---- */
.ltk-cn-cond {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  padding: 3px 10px 0 0;
  overflow: hidden;
}
.ltk-cn-cond-name {
  /* match the card title (.ltk-titlebar-text) so the headings sit together */
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ltk-fg);
}
.ltk-cn-cond-prompt {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.2;
  color: var(--ltk-muted);
  overflow: hidden;
}

/* ---- column headers: weekday over a slightly larger date ---- */
.ltk-cn-daylabel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 3px;
  text-align: center;
}
.ltk-cn-dl-top {
  font-size: 10px;
  font-weight: 600;
  color: var(--ltk-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ltk-cn-dl-date {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  line-height: 1.1;
}
.ltk-cn-daylabel.ltk-cn-today .ltk-cn-dl-top,
.ltk-cn-daylabel.ltk-cn-today .ltk-cn-dl-date {
  color: var(--ltk-accent);
}

/* ---- square rating cells ---- */
.ltk-cn-cell {
  width: var(--cn-tile-w, 40px);
  height: var(--cn-tile-h, 40px);
  border-radius: 5px;
  border: 1px solid var(--ltk-hairline);
  cursor: pointer;
  touch-action: none;
  transition: filter 150ms ease;
}
.ltk-cn-cell:hover { filter: brightness(0.94); }
.ltk-cn-cell.ltk-readonly { cursor: default; }
.ltk-cn-cell.ltk-cn-todaycol { box-shadow: 0 0 0 2px var(--ltk-accent); }

/* ---- legend: left-aligned, indented under the tiles, offset below ---- */
.ltk-cn-legend {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--ltk-fg);
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 6px;
  margin-left: 174px;
}
.ltk-cn-legend-item { display: inline-flex; align-items: center; }
.ltk-cn-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  margin-right: 6px;
}
.ltk-cn-hint { color: var(--ltk-muted); font-size: 11px; }
`;
