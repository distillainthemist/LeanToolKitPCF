// CanvasRollup styles — the portfolio table reuses the capture-rollup's
// .ltk-cr-* classes and the canvas card's .ltk-cv-* value styling (the
// editor loads all three sheets); these are the canvas-rollup extras.

export const CANVASROLLUP_CSS = `
.ltk-vr-charter { cursor: pointer; min-width: 140px; }
.ltk-vr-charter-title { font-weight: 600; }
.ltk-vr-charter-board {
  font-size: 11px;
  color: var(--ltk-muted);
  display: block;
}
.ltk-vr-cell { max-width: 260px; }
.ltk-vr-view { display: flex; flex-direction: column; gap: 10px; }
.ltk-vr-view-heading {
  font-weight: 700;
  border-bottom: 2px solid var(--ltk-accent);
  padding-bottom: 2px;
}
.ltk-vr-view-label { font-size: 11px; color: var(--ltk-muted); }
`;
