// ProcessMap stylesheet — the ported editor restyled onto the toolkit
// tokens. Structural rules + var(--ltk-*) theme colours live here; dynamic
// per-element colours (lane bands, node fills, selection accents that must
// survive SVG/PNG export) are set inline by the editor (Safari rule).

export const PROCESS_MAP_CSS = `
.pm-root {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  font-family: inherit;
  font-size: 12px;
  color: var(--ltk-fg);
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
.pm-root * { box-sizing: border-box; }

/* ---------- palette ---------- */
.pm-palette {
  flex: 0 0 112px;
  border-right: 1px solid var(--ltk-hairline);
  overflow-y: auto;
  padding: 6px;
}
.pm-pal-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  margin-bottom: 6px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  background: var(--ltk-bg);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: border-color 120ms ease;
}
.pm-pal-item:hover { border-color: var(--ltk-accent); }
.pm-pal-cap { font-size: 10px; text-align: center; color: var(--ltk-muted); }
.pm-mini { width: 88px; height: 50px; pointer-events: none; }
.pm-readonly .pm-palette { opacity: 0.45; pointer-events: none; }

/* ---------- main column ---------- */
.pm-main { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }

/* ---------- toolbar ---------- */
.pm-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--ltk-hairline);
  flex-wrap: wrap;
}
.pm-btn {
  padding: 3px 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  background: var(--ltk-bg);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  color: var(--ltk-fg);
  transition: border-color 120ms ease;
}
.pm-btn:hover { border-color: var(--ltk-accent); }
.pm-select {
  padding: 3px 4px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  background: var(--ltk-bg);
  font-size: 11px;
  font-family: inherit;
  color: var(--ltk-fg);
}
.pm-spacer { flex: 1 1 auto; }
.pm-readonly .pm-btn.pm-edit-only { opacity: 0.45; pointer-events: none; }
.pm-readonly .pm-mode { pointer-events: none; opacity: 0.7; }

/* ---------- stage / svg ---------- */
.pm-stage { flex: 1 1 auto; position: relative; overflow: hidden; }
.pm-svg { width: 100%; height: 100%; display: block; cursor: default; touch-action: none; }
.pm-hint {
  position: absolute;
  top: 46%;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--ltk-muted);
  font-size: 13px;
  pointer-events: none;
}
.pm-ro-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 5;
  padding: 2px 8px;
  background: var(--ltk-hairline);
  color: var(--ltk-muted);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}

/* ---------- nodes ---------- */
.pm-node { cursor: grab; }
.pm-readonly .pm-node { cursor: pointer; }
.pm-shape { fill: var(--ltk-bg); stroke: var(--ltk-fg); stroke-width: 1.6; }
.pm-node:hover .pm-shape { stroke-width: 2.2; }
.pm-halo { fill: none; stroke: var(--ltk-accent); stroke-width: 1.6; stroke-dasharray: 5 3; }
.pm-label { fill: var(--ltk-fg); font-size: 11px; font-family: inherit; pointer-events: none; }
.pm-detail { fill: var(--ltk-muted); font-size: 9px; font-family: inherit; pointer-events: none; }

.kind-start .pm-shape { fill: #dff6dd; stroke: #2e7d32; }
.kind-end .pm-shape { fill: #fde7e9; stroke: #b03a44; }
.kind-decision .pm-shape { fill: #fffbe6; }
.kind-card .pm-shape { fill: #f7f9fc; }
.kind-kaizen .pm-shape { fill: #fff2b8; stroke: #b8860b; }
.pm-databox { fill: var(--ltk-bg); stroke: var(--ltk-fg); stroke-width: 1.2; }
.pm-databox-line { stroke: var(--ltk-hairline); stroke-width: 1; }
.pm-metric { fill: var(--ltk-fg); font-size: 9px; font-family: inherit; pointer-events: none; }
.pm-inv-i { fill: var(--ltk-fg); font-size: 15px; font-weight: 700; font-family: inherit; pointer-events: none; }
.pm-wheel { fill: var(--ltk-bg); stroke: var(--ltk-fg); stroke-width: 1.6; }

/* action badge on kaizen bursts */
.pm-abadge-text { fill: #ffffff; font-size: 10px; font-weight: 700; font-family: inherit; text-anchor: middle; pointer-events: none; }

/* ---------- SIPOC columns + swimlane rows ---------- */
.pm-lane { fill: rgba(0,0,0,0.015); stroke: var(--ltk-hairline); stroke-width: 1; }
.pm-lane.pm-lane-alt { fill: rgba(0,0,0,0.045); }
.pm-lane-head {
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  text-anchor: middle;
  pointer-events: none;
}
.pm-swim-head { cursor: text; }
.pm-readonly .pm-swim-head { cursor: default; }

/* ---------- edges ---------- */
.pm-edge { fill: none; stroke: var(--ltk-fg); stroke-width: 1.8; pointer-events: none; }
.pm-edge.pm-kind-info { stroke-dasharray: 6 4; }
.pm-edge.pm-kind-electronic { stroke-width: 1.6; }
.pm-edge-hit { fill: none; stroke: rgba(0,0,0,0); stroke-width: 14; cursor: pointer; }
.pm-edge-selected { stroke: var(--ltk-accent); stroke-width: 2.6; }
.pm-edge-label {
  fill: var(--ltk-fg);
  font-size: 10px;
  font-family: inherit;
  text-anchor: middle;
  paint-order: stroke;
  stroke: var(--ltk-bg);
  stroke-width: 4;
  pointer-events: none;
}
.pm-temp-edge { stroke: var(--ltk-accent); stroke-width: 1.6; stroke-dasharray: 4 3; fill: none; pointer-events: none; }

/* connector handles */
.pm-handle { fill: var(--ltk-accent); stroke: #ffffff; stroke-width: 1.4; cursor: crosshair; opacity: 0; }
.pm-node:hover .pm-handle, .pm-node.pm-selected .pm-handle { opacity: 1; }

/* ---------- VSM timeline ---------- */
.pm-tl-line { fill: none; stroke: #8a6d00; stroke-width: 1.8; }
.pm-tl-text { fill: #6b5500; font-size: 10px; font-family: inherit; text-anchor: middle; pointer-events: none; }
.pm-tl-total { fill: var(--ltk-fg); font-size: 11px; font-weight: 600; font-family: inherit; pointer-events: none; }

/* ---------- ghost while dragging from the palette ---------- */
.pm-ghost {
  position: fixed;
  z-index: 10000;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0.55;
  filter: grayscale(60%);
}
.pm-ghost.pm-ghost-ok { opacity: 0.95; filter: none; }

/* ---------- inline label editor ---------- */
.pm-label-input {
  position: absolute;
  width: 150px;
  padding: 3px 6px;
  border: 1px solid var(--ltk-accent);
  border-radius: 3px;
  font-size: 11px;
  font-family: inherit;
  z-index: 20;
  text-align: center;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
}

/* ---------- properties panel ---------- */
.pm-props {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 210px;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.14);
  padding: 8px 10px 10px;
  z-index: 10;
}
.pm-props-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 6px;
}
.pm-props-kind { font-weight: 400; font-size: 10px; color: var(--ltk-muted); }
.pm-props-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.pm-props-row > label { flex: 0 0 52px; font-size: 10px; color: var(--ltk-muted); }
.pm-props-input, .pm-props-select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 3px;
  font-size: 11px;
  font-family: inherit;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
}
.pm-swatches { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.pm-swatch {
  width: 20px;
  height: 20px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--ltk-muted);
  background: var(--ltk-bg);
}
.pm-swatch:hover { border-color: var(--ltk-accent); }
.pm-swatch.pm-swatch-on { border: 2px solid var(--ltk-accent); }
.pm-props-actions {
  margin-top: 10px;
  width: 100%;
  padding: 4px 0;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.pm-props-actions:hover { border-color: var(--ltk-accent); }
.pm-props-del {
  margin-top: 8px;
  width: 100%;
  padding: 4px 0;
  border: 1px solid #d4a0a5;
  border-radius: 4px;
  background: #fff5f5;
  color: #a02832;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.pm-props-del:hover { background: #fde7e9; }
`;
