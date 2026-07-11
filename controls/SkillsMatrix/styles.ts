// SkillsMatrix stylesheet — quadrant discs in a people × skills grid. Disc
// fills, gap rings and target glyphs are drawn inline (Safari rule).

export const SKILLS_CSS = `
.ltk-sk-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 12px 12px;
  overflow: auto;
}
.ltk-sk-grid {
  display: grid;
  gap: 2px;
  align-content: start;
  align-items: center;
}

/* ---- headers ---- */
.ltk-sk-skillhead {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  text-align: center;
  padding: 2px 2px 5px;
  border-bottom: 2px solid var(--ltk-hairline);
  border-radius: 4px 4px 0 0;
  min-height: 46px;
}
.ltk-sk-skillname {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ltk-fg);
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.ltk-sk-skillmeta { display: flex; align-items: center; gap: 5px; }
.ltk-sk-cov { font-size: 10px; font-weight: 600; color: var(--ltk-muted); }
.ltk-sk-cov-short { color: #b03a44; }
.ltk-sk-acthead {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ltk-muted);
  padding: 0 2px 5px;
  border-bottom: 2px solid var(--ltk-hairline);
}
.ltk-sk-head-edit { cursor: pointer; }
.ltk-sk-head-edit:hover { background: var(--ltk-hairline); }

/* ---- person labels ---- */
.ltk-sk-person {
  font-size: 13px;
  font-weight: 600;
  color: var(--ltk-fg);
  padding: 8px 10px 8px 4px;
  border-right: 2px solid var(--ltk-hairline);
  border-radius: 4px 0 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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

/* ---- trailing action column ---- */
.ltk-sk-actcell { display: flex; align-items: center; justify-content: center; }
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
