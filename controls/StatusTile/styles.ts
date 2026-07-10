// StatusTile stylesheet. The tile colour is set inline by the editor
// (Safari rule); everything else reads the --ltk-* variables.

export const STATUSTILE_CSS = `
.ltk-st-body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 12px;
}
.ltk-st-tile {
  flex: 1;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  cursor: pointer;
  text-align: center;
  transition: filter 150ms ease;
  position: relative;
}
.ltk-st-tile:hover { filter: brightness(0.97); }
.ltk-st-tile.ltk-readonly { cursor: default; }
.ltk-st-state {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.01em;
}
.ltk-st-reason {
  font-size: 14px;
  line-height: 1.35;
  max-width: 90%;
  opacity: 0.92;
}
.ltk-st-reason.ltk-st-placeholder { opacity: 0.65; }
.ltk-st-updated {
  position: absolute;
  bottom: 8px;
  right: 12px;
  font-size: 11px;
  opacity: 0.7;
}
.ltk-st-edit {
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  background: rgba(255,255,255,0.18);
  color: inherit;
  font-size: 14px;
  min-width: 32px;
  min-height: 32px;
  border-radius: 6px;
  cursor: pointer;
}
.ltk-st-edit:hover { background: rgba(255,255,255,0.32); }
.ltk-st-dots {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.ltk-st-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.35;
}
.ltk-st-dot.ltk-st-dot-on { opacity: 1; }
`;
