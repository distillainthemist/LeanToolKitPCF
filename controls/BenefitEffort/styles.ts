// BenefitEffort stylesheet — a 2×2 drag canvas with quadrant labels.

export const BENEFITEFFORT_CSS = `
.ltk-be-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px 12px;
  gap: 8px;
}
.ltk-be-canvas {
  flex: 1;
  min-height: 160px;
  position: relative;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  overflow: hidden;
}
.ltk-be-mid-h, .ltk-be-mid-v {
  position: absolute;
  background: var(--ltk-hairline);
  pointer-events: none;
}
.ltk-be-mid-h { left: 0; right: 0; top: 50%; height: 2px; }
.ltk-be-mid-v { top: 0; bottom: 0; left: 50%; width: 2px; }
.ltk-be-quad {
  position: absolute;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
  pointer-events: none;
  padding: 6px 8px;
}
.ltk-be-axis {
  position: absolute;
  font-size: 10px;
  font-weight: 600;
  color: var(--ltk-muted);
  pointer-events: none;
}
.ltk-be-chip {
  position: absolute;
  transform: translate(-50%, -50%);
  max-width: 150px;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-left: 3px solid var(--ltk-accent);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 12px;
  line-height: 1.25;
  cursor: pointer;
  touch-action: none;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltk-be-chip:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.16); }
.ltk-be-chip.ltk-readonly { cursor: default; }
.ltk-be-chip.ltk-be-dragging { opacity: 0.45; }
.ltk-be-ghost {
  position: fixed;
  z-index: 10001;
  opacity: 0.7;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
.ltk-be-add {
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
.ltk-be-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
