// CaptureCard stylesheet — a flat table over the shared kit.

export const CAPTURE_CSS = `
.ltk-cc-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow: hidden;
}
.ltk-cc-tablewrap { flex: 1; min-height: 0; overflow: auto; }
.ltk-cc-table { border-collapse: collapse; min-width: max-content; width: 100%; height: 100%; }
.ltk-cc-table th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  text-align: left;
  padding: 4px 12px 6px 4px;
  border-bottom: 2px solid var(--ltk-hairline);
}
.ltk-cc-table td {
  font-size: 13px;
  padding: 7px 12px 7px 4px;
  border-bottom: 1px solid var(--ltk-hairline);
  vertical-align: top;
  max-width: 260px;
  overflow-wrap: break-word;
}
/* simple (no-list) cards scale their text up to fill the box */
.ltk-cc-simple td {
  font-size: var(--cc-font, 15px);
  vertical-align: middle;
  padding: 6px 16px 6px 4px;
}
.ltk-cc-simple th {
  font-size: calc(var(--cc-font, 15px) * 0.5);
}
.ltk-cc-simple .ltk-cc-rowhead { font-size: var(--cc-font, 15px); }

.ltk-cc-row { cursor: pointer; }
.ltk-cc-row:hover td { background: var(--ltk-hairline); }
.ltk-cc-row.ltk-readonly { cursor: default; }
/* Row-head labels can be full sentences (question-style cards), so they wrap
   within a generous column instead of forcing one long line — the general
   td max-width above is overridden here so the label gets the room. */
.ltk-cc-rowhead {
  font-weight: 600;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  min-width: 140px;
  width: 38%;
  max-width: 460px;
}
.ltk-cc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  margin: 1px 3px 1px 0;
  white-space: nowrap;
}
.ltk-cc-chip img { width: 14px; height: 14px; object-fit: contain; }
.ltk-cc-empty { color: var(--ltk-muted); }
.ltk-cc-add {
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
.ltk-cc-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
