// SqdpcCard stylesheet. Rating colours are set inline (Safari rule).

export const SQDPC_CSS = `
.ltk-sq-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-sq-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ltk-sq-month { font-size: 14px; font-weight: 600; min-width: 110px; text-align: center; }
.ltk-sq-navbtn {
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  font-size: 14px;
  font-weight: 600;
  min-width: 30px;
  min-height: 30px;
  border-radius: 6px;
  cursor: pointer;
}
.ltk-sq-navbtn:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-sq-grid {
  display: grid;
  gap: 2px;
  align-items: stretch;
  min-width: max-content;
}
.ltk-sq-dim {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  padding: 0 8px;
}
.ltk-sq-daylabel {
  font-size: 10px;
  font-weight: 600;
  color: var(--ltk-muted);
  text-align: center;
  padding-bottom: 2px;
}
.ltk-sq-cell {
  min-width: 24px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid var(--ltk-hairline);
  cursor: pointer;
  touch-action: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ltk-sq-cell:hover { filter: brightness(0.94); }
.ltk-sq-cell.ltk-readonly { cursor: default; }
.ltk-sq-cell.ltk-sq-weekend { border-style: dashed; }
.ltk-sq-half { flex: 1; }
.ltk-sq-half + .ltk-sq-half { border-top: 1px solid var(--ltk-hairline); }
.ltk-sq-legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--ltk-muted);
  align-items: center;
}
.ltk-sq-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: -2px;
}
`;
