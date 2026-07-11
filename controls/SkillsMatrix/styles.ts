// SkillsMatrix stylesheet — skills (rows, grouped by category) × people
// (columns). Disc fills, gap rings and target glyphs are drawn inline (Safari
// rule); layout + theme colours live here.

export const SKILLS_CSS = `
.ltk-sk-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 12px 12px;
  overflow: auto;
  position: relative;
}
.ltk-sk-grid {
  display: grid;
  gap: 2px;
  align-content: start;
  align-items: center;
}

/* ---- headers ---- */
.ltk-sk-corner { }
.ltk-sk-personhead {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  text-align: center;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  padding: 2px 2px 6px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

/* continuous full-width horizontal rule (spans all columns) */
.ltk-sk-rule {
  grid-column: 1 / -1;
  height: 2px;
  background: var(--ltk-hairline);
  margin: 1px 0 3px;
}

/* ---- category band ---- */
.ltk-sk-cathead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  margin-top: 4px;
  border-radius: 5px;
  background: var(--ltk-hairline);
}
.ltk-sk-catname {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ltk-fg);
}
.ltk-sk-cathead.ltk-sk-drag::before {
  content: "⠿";
  color: var(--ltk-muted);
  font-size: 13px;
  line-height: 1;
}

/* ---- skill labels ---- */
.ltk-sk-skilllabel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 8px 6px 16px;
  overflow: hidden;
}
.ltk-sk-skillname {
  font-size: 13px;
  font-weight: 600;
  color: var(--ltk-fg);
  line-height: 1.2;
}
.ltk-sk-skillmeta { display: flex; align-items: center; gap: 5px; }
.ltk-sk-cov { font-size: 10px; font-weight: 600; color: var(--ltk-muted); }
.ltk-sk-cov-short { color: #b03a44; }
.ltk-sk-drag { cursor: pointer; touch-action: none; }
.ltk-sk-drag:hover { background: var(--ltk-hairline); }

/* ---- cells ---- */
.ltk-sk-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  cursor: pointer;
  border-radius: 5px;
  transition: background 120ms ease;
}
.ltk-sk-cell:hover { background: var(--ltk-hairline); }
.ltk-sk-cell.ltk-readonly { cursor: default; }
.ltk-sk-disc { display: block; }

/* ---- final Actions row ---- */
.ltk-sk-actlabel {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  padding: 4px 8px 4px 16px;
}
.ltk-sk-actcell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 2px;
}
.ltk-sk-actbtn {
  min-width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1.5px dashed var(--ltk-hairline);
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 8px;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-sk-actbtn:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-sk-actbtn-on {
  border-style: solid;
  border-color: var(--ltk-accent);
  color: var(--ltk-accent);
}

/* ---- drag ghost + insertion line ---- */
.ltk-sk-ghost {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-accent);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ltk-fg);
  box-shadow: 0 3px 10px rgba(0,0,0,0.2);
  opacity: 0.95;
}
.ltk-sk-insert {
  position: absolute;
  left: 8px;
  right: 12px;
  height: 2px;
  background: var(--ltk-accent);
  border-radius: 2px;
  pointer-events: none;
  z-index: 5;
}

/* ---- footer: add buttons (left) + level legend (right, in line) ---- */
.ltk-sk-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ltk-sk-addrow { display: flex; gap: 8px; flex-wrap: wrap; }
.ltk-sk-add {
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
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-sk-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-sk-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--ltk-fg);
  align-items: center;
  flex-wrap: wrap;
  margin-left: auto;
}
.ltk-sk-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.ltk-sk-hint { color: var(--ltk-muted); font-size: 11px; }
`;
