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
.ltk-kt-limit { font-size: 9px; font-weight: 600; fill: var(--ltk-muted); }
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
.ltk-kt-acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ltk-kt-statechip { display: inline-block; padding: 6px 16px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 18px; background: var(--ltk-muted); }
.ltk-kt-strip { display: flex; gap: 4px; flex-wrap: wrap; margin: 8px 0; }
.ltk-kt-stripcell { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--ltk-hairline); background: none; color: #fff; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; padding: 0; }
.ltk-kt-stripcell:disabled { cursor: default; }
.ltk-kt-grid { border-style: solid; border-width: 1px; }
`;
