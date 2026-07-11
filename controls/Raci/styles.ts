// RaciCard stylesheet — a responsibility matrix. Cell colours are set inline
// from the (theme-overridable) RACI palette (Safari rule).

export const RACI_CSS = `
.ltk-ra-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-ra-grid {
  display: grid;
  gap: 4px;
  align-content: start;
}

/* ---- headers ---- */
.ltk-ra-corner { }
.ltk-ra-rolehead {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  text-align: center;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  padding: 0 2px 4px;
  line-height: 1.15;
  border-bottom: 2px solid var(--ltk-hairline);
  overflow-wrap: anywhere;
}

/* ---- deliverable (row) labels ---- */
.ltk-ra-task {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 10px 6px 4px;
  border-right: 2px solid var(--ltk-hairline);
  cursor: pointer;
  overflow: hidden;
}
.ltk-ra-task.ltk-ra-warn { background: rgba(242, 200, 17, 0.14); }
.ltk-ra-taskname {
  font-size: 13px;
  font-weight: 600;
  color: var(--ltk-fg);
  line-height: 1.2;
}
.ltk-ra-taskmeta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ltk-ra-warnflag {
  font-size: 10px;
  font-weight: 600;
  color: #9a6a00;
  background: rgba(242, 200, 17, 0.28);
  border-radius: 8px;
  padding: 0 6px;
}
.ltk-ra-abadge { font-size: 10px; font-weight: 600; color: var(--ltk-accent); }

/* ---- cells ---- */
.ltk-ra-cell {
  min-height: 38px;
  border-radius: 5px;
  border: 1px solid var(--ltk-hairline);
  cursor: pointer;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  transition: filter 150ms ease;
}
.ltk-ra-cell:hover { filter: brightness(0.94); }
.ltk-ra-cell.ltk-readonly { cursor: default; }

/* ---- add button ---- */
.ltk-ra-add {
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
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-ra-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- legend ---- */
.ltk-ra-legend {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--ltk-fg);
  align-items: center;
  flex-wrap: wrap;
}
.ltk-ra-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.ltk-ra-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.ltk-ra-hint { color: var(--ltk-muted); font-size: 11px; margin-left: auto; }
`;
