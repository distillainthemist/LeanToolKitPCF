// RiskMatrix stylesheet. Cell tints and chip colours are set inline
// (Safari rule); layout and typography live here.

export const RISKMATRIX_CSS = `
.ltk-rm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-rm-left { flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px; }
.ltk-rm-grid {
  display: grid;
  grid-auto-rows: 46px;
  gap: 3px;
  align-items: stretch;
}
.ltk-rm-cell {
  border-radius: 5px;
  position: relative;
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 2px;
  overflow: hidden;
  transition: filter 150ms ease;
}
.ltk-rm-cell:hover { filter: brightness(0.94); }
.ltk-rm-cell.ltk-readonly { cursor: default; }
.ltk-rm-classwm {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 800;
  opacity: 0.28;
  pointer-events: none;
}
.ltk-rm-axis-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--ltk-fg);
  text-align: center;
  line-height: 1.15;
}
.ltk-rm-axis-lik { justify-content: flex-end; text-align: right; padding-right: 6px; }
.ltk-rm-axis-con { align-items: flex-start; padding-top: 3px; }
.ltk-rm-axis-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  text-align: center;
  padding: 2px 0 0 92px;
}
.ltk-rm-axis-title-con { padding-left: 92px; }
.ltk-rm-chip {
  position: relative;
  min-width: 20px;
  height: 20px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  border: 2px solid transparent;
  padding: 0 3px;
}
.ltk-rm-chip.ltk-rm-pre-ghost {
  background: transparent !important;
  opacity: 0.75;
}
.ltk-rm-list {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltk-rm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}
.ltk-rm-row:hover { background: var(--ltk-hairline); }
.ltk-rm-row.ltk-readonly { cursor: default; }
.ltk-rm-row-num {
  flex: 0 0 auto;
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}
.ltk-rm-emptyhint { font-size: 13px; color: var(--ltk-muted); padding: 6px 2px; }
.ltk-rm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ltk-rm-row-risk {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltk-rm-row-controls {
  font-size: 11px;
  color: var(--ltk-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltk-rm-class {
  flex: 0 0 auto;
  border-radius: 6px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.ltk-rm-classreadout {
  font-size: 12px;
  font-weight: 600;
  min-height: 15px;
  margin-top: -4px;
}
.ltk-rm-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 600;
  background: var(--ltk-accent);
  color: #ffffff;
}
.ltk-rm-add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 2px dashed var(--ltk-hairline);
  border-radius: 6px;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 12px;
  min-height: 40px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-rm-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
