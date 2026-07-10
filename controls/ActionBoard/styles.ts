// ActionBoard stylesheet — list and kanban layouts on top of the shared base
// CSS. Status/done colours are set inline by the editor (Safari rule).

export const ACTIONBOARD_CSS = `
.ltk-ab-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---- list view ---- */
.ltk-ab-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---- kanban view ---- */
.ltk-ab-kanban {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 12px;
  overflow-x: auto;
  min-height: 0;
}
.ltk-ab-col {
  flex: 1 0 200px;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--ltk-hairline);
  border-radius: 6px;
  padding: 10px;
  min-height: 120px;
}
.ltk-ab-col-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ltk-ab-col-count {
  border-radius: 999px;
  background: var(--ltk-bg);
  padding: 1px 8px;
  font-weight: 600;
}
.ltk-ab-col.ltk-ab-col-drop {
  outline: 2px dashed var(--ltk-accent);
  outline-offset: 2px;
}
.ltk-ab-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

/* ---- kanban card ---- */
.ltk-ab-card {
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-left: 3px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  touch-action: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: box-shadow 150ms ease;
}
.ltk-ab-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.ltk-ab-card.ltk-readonly { cursor: default; }
.ltk-ab-card-issue {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
}
.ltk-ab-card-desc { font-size: 13px; line-height: 1.35; overflow-wrap: break-word; }
.ltk-ab-card-desc.ltk-ab-done { text-decoration: line-through; }
.ltk-ab-card-meta {
  font-size: 12px;
  font-weight: 600;
  color: var(--ltk-fg);
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

/* drag ghost + source dim (shared pattern) */
.ltk-ab-ghost {
  position: fixed;
  z-index: 10001;
  opacity: 0.65;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  margin: 0;
}
.ltk-ab-dragging { opacity: 0.35; }

/* ---- gantt view ---- */
.ltk-ab-gantt {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.ltk-ab-g-scroll { overflow: auto; flex: 0 1 auto; }
.ltk-ab-g-inner { position: relative; }
.ltk-ab-g-header {
  display: flex;
  height: 28px;
  border-bottom: 1px solid var(--ltk-hairline);
}
.ltk-ab-g-corner { flex: 0 0 210px; }
.ltk-ab-g-scale { position: relative; flex: 0 0 auto; }
.ltk-ab-g-tick {
  position: absolute;
  top: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ltk-muted);
  white-space: nowrap;
  border-left: 1px solid var(--ltk-hairline);
  padding-left: 4px;
  height: 20px;
}
.ltk-ab-g-rows { display: flex; flex-direction: column; }
.ltk-ab-g-row {
  display: flex;
  align-items: center;
  height: 40px;
  border-bottom: 1px solid var(--ltk-hairline);
  cursor: pointer;
}
.ltk-ab-g-row:hover { background: var(--ltk-hairline); }
.ltk-ab-g-label {
  flex: 0 0 210px;
  min-width: 0;
  padding: 3px 10px 3px 2px;
  overflow: hidden;
}
.ltk-ab-g-desc {
  font-size: 12px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltk-ab-g-plot { position: relative; height: 100%; flex: 0 0 auto; }
.ltk-ab-g-bar {
  position: absolute;
  top: 9px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  overflow: hidden;
}
.ltk-ab-g-bar-who {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
}
.ltk-ab-g-today {
  position: absolute;
  top: 0;
  width: 0;
  border-left: 2px dashed var(--ltk-accent);
  pointer-events: none;
  opacity: 0.6;
}
.ltk-ab-g-empty { color: var(--ltk-muted); font-size: 13px; padding: 12px 2px; }
.ltk-ab-g-undated-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  margin-top: 4px;
}

/* ---- add button ---- */
.ltk-ab-add {
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
  padding: 10px 14px;
  min-height: 44px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-ab-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
