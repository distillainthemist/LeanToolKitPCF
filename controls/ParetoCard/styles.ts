// ParetoCard stylesheet — an SVG chart in the card body.

export const PARETO_CSS = `
.ltk-pa-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px 12px;
  gap: 8px;
}
.ltk-pa-svg { flex: 1; min-height: 0; width: 100%; }
.ltk-pa-bar { cursor: pointer; }
.ltk-pa-bar:hover { opacity: 0.85; }
.ltk-pa-bar.ltk-readonly { cursor: default; }
.ltk-pa-label { font-size: 11px; fill: var(--ltk-muted); }
.ltk-pa-labelclick { cursor: pointer; }
.ltk-pa-labelclick:hover { fill: var(--ltk-fg); text-decoration: underline; }
.ltk-pa-value { font-size: 11px; font-weight: 600; fill: var(--ltk-fg); }
.ltk-pa-inc { cursor: pointer; }
.ltk-pa-inc-circle { fill: var(--ltk-bg); stroke: var(--ltk-hairline); stroke-width: 1.5; }
.ltk-pa-inc-plus { stroke: var(--ltk-muted); stroke-width: 1.5; stroke-linecap: round; }
.ltk-pa-inc-hit { fill: transparent; }
.ltk-pa-inc:hover .ltk-pa-inc-circle { stroke: var(--ltk-accent); fill: var(--ltk-hairline); }
.ltk-pa-inc:hover .ltk-pa-inc-plus { stroke: var(--ltk-accent); }
.ltk-pa-axis { stroke: var(--ltk-hairline); stroke-width: 1; }
.ltk-pa-pct { font-size: 10px; fill: var(--ltk-muted); }
.ltk-pa-add {
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
.ltk-pa-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
