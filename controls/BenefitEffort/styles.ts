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
/* plot: left gutter (rotated Benefit label) + canvas + bottom gutter (Effort) */
.ltk-be-plot {
  flex: 1;
  min-height: 160px;
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: 1fr 26px;
}
.ltk-be-yaxis {
  grid-column: 1;
  grid-row: 1;
  position: relative;
}
.ltk-be-yaxis > span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ltk-fg);
}
.ltk-be-xaxis {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ltk-fg);
}
.ltk-be-canvas {
  grid-column: 2;
  grid-row: 1;
  position: relative;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  overflow: hidden;
}
.ltk-be-canvas-live { cursor: crosshair; }
.ltk-be-emptyhint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: var(--ltk-muted);
  text-align: center;
  pointer-events: none;
  padding: 0 12px;
}
.ltk-be-shade {
  position: absolute;
  width: 50%;
  height: 50%;
  opacity: 0.12;
  pointer-events: none;
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
.ltk-be-chip {
  position: absolute;
  transform: translate(-50%, -50%);
  max-width: 150px;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 12px;
  line-height: 1.25;
  cursor: pointer;
  touch-action: none;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  display: flex;
  align-items: baseline;
  gap: 2px;
}
.ltk-be-chip-text {
  min-width: 0;
  overflow-wrap: break-word;
  /* allow up to two lines, then ellipsis */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.ltk-be-chip:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.16); }
.ltk-be-chip.ltk-readonly { cursor: default; }
.ltk-be-chip.ltk-be-dragging { opacity: 0.45; }
/* priority (idea to take forward): accent left border, star, bold, lifted */
.ltk-be-chip.ltk-be-priority {
  border-left-width: 3px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
.ltk-be-star { flex: 0 0 auto; font-size: 11px; }
/* open-action count taken forward against the idea */
.ltk-be-actbadge {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
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

/* dialog: capture / manage the action taken forward against an idea */
.ltk-be-dlg-actions {
  margin-top: 12px;
  width: 100%;
  padding: 8px 0;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  background: none;
  color: var(--ltk-fg);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-be-dlg-actions:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
