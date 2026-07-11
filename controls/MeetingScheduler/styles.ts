// MeetingScheduler stylesheet — cadence editor (left) + rolling occurrence
// preview (right). Crew badge colours are set inline (Safari rule).

export const MEETING_CSS = `
.ltk-ms-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 14px;
  padding: 8px 12px 12px;
}

/* ---- left: cadence editor ---- */
.ltk-ms-editor {
  flex: 0 0 240px;
  min-width: 200px;
  max-width: 45%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.ltk-ms-seclabel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  margin-top: 6px;
}
.ltk-ms-seclabel:first-child { margin-top: 0; }
.ltk-ms-meeting, .ltk-ms-roster {
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ltk-ms-edit { cursor: pointer; transition: border-color 120ms ease; }
.ltk-ms-edit:hover { border-color: var(--ltk-accent); }
.ltk-ms-meeting-name, .ltk-ms-roster-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ltk-fg);
}
.ltk-ms-meeting-detail, .ltk-ms-roster-detail {
  font-size: 11.5px;
  color: var(--ltk-muted);
  line-height: 1.3;
}
.ltk-ms-add {
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
.ltk-ms-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- right: occurrence preview ---- */
.ltk-ms-preview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 1px solid var(--ltk-hairline);
  padding-left: 14px;
}
.ltk-ms-empty { color: var(--ltk-muted); font-size: 13px; padding: 12px 0; }
.ltk-ms-day { display: flex; flex-direction: column; gap: 2px; }
.ltk-ms-dayhead {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  padding: 4px 0 2px;
  border-bottom: 1px solid var(--ltk-hairline);
}
.ltk-ms-dayhead.ltk-ms-today { color: var(--ltk-accent); border-bottom-color: var(--ltk-accent); }
.ltk-ms-occ {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
}
.ltk-ms-occ-time {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  font-variant-numeric: tabular-nums;
  flex: 0 0 44px;
}
.ltk-ms-occ-name { font-size: 12.5px; color: var(--ltk-fg); }
.ltk-ms-crew {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}

/* ---- day chips inside the meeting dialog ---- */
.ltk-ms-daychips { display: flex; flex-wrap: wrap; gap: 6px; }
`;
