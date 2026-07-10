// KpiTrendCard stylesheet.

export const KPITREND_CSS = `
.ltk-kt-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px 12px;
  gap: 8px;
}
.ltk-kt-readout {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.ltk-kt-current {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
}
.ltk-kt-target {
  font-size: 12px;
  font-weight: 600;
  color: var(--ltk-muted);
}
.ltk-kt-svg { flex: 1; min-height: 0; width: 100%; }
.ltk-kt-axis { stroke: var(--ltk-hairline); stroke-width: 1; }
.ltk-kt-tick { font-size: 10px; fill: var(--ltk-muted); }
.ltk-kt-dot { cursor: pointer; }
.ltk-kt-dot:hover { opacity: 0.8; }
.ltk-kt-dot.ltk-readonly { cursor: default; }
.ltk-kt-add {
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
.ltk-kt-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
`;
