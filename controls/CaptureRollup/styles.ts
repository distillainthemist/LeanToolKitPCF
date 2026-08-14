// CaptureRollup styles — the table itself reuses the capture card's
// .ltk-cc-* classes (the editor loads CAPTURE_CSS too), so cells render
// identically to their source cards; these are the rollup-only extras.

export const ROLLUP_CSS = `
.ltk-cr-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 10px 10px;
}
.ltk-cr-tablewrap { overflow: auto; flex: 1; min-height: 0; }
.ltk-cr-source {
  color: var(--ltk-muted);
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltk-cr-source .ltk-cr-when { font-size: 11px; display: block; }
.ltk-cr-flagcell { width: 24px; text-align: center; }
.ltk-cr-errors { padding: 6px 2px 0; }
.ltk-cr-error { color: var(--ltk-muted); font-size: 12px; }
.ltk-cr-note { color: var(--ltk-muted); font-size: 12px; padding: 4px 2px 0; }
.ltk-cr-view { display: flex; flex-direction: column; gap: 8px; }
.ltk-cr-view-row { display: flex; gap: 10px; align-items: baseline; }
.ltk-cr-view-label {
  color: var(--ltk-muted);
  font-size: 12px;
  min-width: 130px;
  flex: 0 0 130px;
}
.ltk-cr-view-value { flex: 1; }
`;
