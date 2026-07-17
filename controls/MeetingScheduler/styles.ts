// MeetingScheduler stylesheet — a selectable list of meeting instances.
// Crew badge colours are set inline (Safari rule).

export const MEETING_CSS = `
/* ---- meeting identity strip (settingsJSON.meeting) ---- */
.ltk-ms-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px 6px;
  border-bottom: 1px solid var(--ltk-hairline);
  flex: 0 0 auto;
}
.ltk-ms-meta-line {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--ltk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltk-ms-meta-toggle {
  flex: none;
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}
.ltk-ms-meta-toggle:hover { color: var(--ltk-accent); }
.ltk-ms-about {
  padding: 8px 12px;
  border-bottom: 1px solid var(--ltk-hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
}
.ltk-ms-about-purpose { font-size: 13px; line-height: 1.45; }
.ltk-ms-about-people { display: flex; flex-wrap: wrap; gap: 6px; }
.ltk-ms-person {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 2px 8px;
}
.ltk-ms-person-crew {
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  min-width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.ltk-ms-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
}
.ltk-ms-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ---- instance rows ---- */
.ltk-ms-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  transition: border-color 120ms ease, background 120ms ease;
}
.ltk-ms-row:hover { border-color: var(--ltk-accent); }
.ltk-ms-row.ltk-ms-selected {
  border-color: var(--ltk-accent);
  box-shadow: inset 0 0 0 1px var(--ltk-accent);
}
.ltk-ms-row.ltk-ms-today { background: rgba(0,0,0,0.03); }

/* identity line — the tappable selector */
.ltk-ms-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

/* ---- custom column entry cells ---- */
.ltk-ms-row-cols {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ltk-ms-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 120px;
  min-width: 0;
}
.ltk-ms-col-label {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ltk-muted);
}
.ltk-ms-col-input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
}
.ltk-ms-col-input:focus { outline: none; border-color: var(--ltk-accent); }
.ltk-ms-col-input:disabled { opacity: 0.6; cursor: default; }

.ltk-ms-row-date {
  flex: 0 0 92px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ltk-fg);
}
.ltk-ms-row-time {
  flex: 0 0 44px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ltk-fg);
  font-variant-numeric: tabular-nums;
}
.ltk-ms-row-shift { font-size: 11px; color: var(--ltk-muted); }
.ltk-ms-crew {
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 9px;
  white-space: nowrap;
}
.ltk-ms-resched { font-size: 11px; color: var(--ltk-muted); font-style: italic; }

/* status chip pinned right */
.ltk-ms-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.ltk-ms-status-existing { color: #107c10; }
.ltk-ms-status-missing { color: #b03a44; }
.ltk-ms-status-planned { color: var(--ltk-muted); }

.ltk-ms-hint { color: var(--ltk-muted); font-size: 11px; }
`;
