// ConditionsCard stylesheet — the SQDPC visual language on a rolling week.

export const CONDITIONS_CSS = `
.ltk-cn-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-cn-grid {
  display: grid;
  gap: 3px;
  align-items: stretch;
}
.ltk-cn-cond {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  padding-right: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltk-cn-daylabel {
  font-size: 10px;
  font-weight: 600;
  color: var(--ltk-muted);
  text-align: center;
  padding-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ltk-cn-daylabel.ltk-cn-next { color: var(--ltk-accent); }
.ltk-cn-cell {
  min-height: 30px;
  border-radius: 4px;
  border: 1px solid var(--ltk-hairline);
  cursor: pointer;
  touch-action: none;
  transition: filter 150ms ease;
}
.ltk-cn-cell:hover { filter: brightness(0.94); }
.ltk-cn-cell.ltk-readonly { cursor: default; }
.ltk-cn-cell.ltk-cn-forecast { border: 2px solid var(--ltk-accent); }
.ltk-cn-legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--ltk-muted);
  align-items: center;
}
.ltk-cn-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: -2px;
}
`;
