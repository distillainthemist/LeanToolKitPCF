// CardSettings stylesheet — a settings composer form. Two states: the card
// type picker (searchable grid), then the sectioned settings form.

export const CARDSETTINGS_CSS = `
.ltk-cs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- card type picker ---- */
.ltk-cs-search {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
}
.ltk-cs-search:focus { outline: none; border-color: var(--ltk-accent); }
.ltk-cs-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px;
}
.ltk-cs-group {
  grid-column: 1 / -1;
  font-size: 12px;
  font-weight: 600;
  color: var(--ltk-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--ltk-hairline);
}
.ltk-cs-group:first-child { margin-top: 0; padding-top: 0; border-top: none; }
.ltk-cs-cardopt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  background: var(--ltk-bg);
  padding: 10px 12px;
  font: inherit;
  color: var(--ltk-fg);
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.ltk-cs-cardopt:hover {
  border-color: var(--ltk-accent);
  box-shadow: 0 1px 6px rgba(0,0,0,0.08);
}
.ltk-cs-cardopt-label { font-size: 13px; font-weight: 700; }
.ltk-cs-cardopt-desc { font-size: 11.5px; line-height: 1.3; color: var(--ltk-muted); }
.ltk-cs-empty { color: var(--ltk-muted); font-size: 12px; padding: 4px 2px; }

/* ---- chosen card header ---- */
.ltk-cs-chosen {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.ltk-cs-chosen-label { font-size: 15px; font-weight: 700; }
.ltk-cs-chosen-desc { font-size: 12px; color: var(--ltk-muted); }
.ltk-cs-change {
  margin-left: auto;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.ltk-cs-change:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- sections ---- */
.ltk-cs-note { font-size: 12px; color: var(--ltk-muted); line-height: 1.4; }
.ltk-cs-appbound { font-size: 11px; color: var(--ltk-muted); font-style: italic; }

/* ---- field grid ---- */
.ltk-cs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px 18px;
  align-items: start;
}
.ltk-cs-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ltk-cs-field-wide { grid-column: 1 / -1; }
.ltk-cs-field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ltk-muted);
  min-height: 13px;
}
.ltk-cs-help { font-size: 11px; color: var(--ltk-muted); line-height: 1.35; }

/* ---- chips (string lists) ---- */
.ltk-cs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 6px;
  background: var(--ltk-bg);
}
.ltk-cs-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
}
.ltk-cs-chip-x {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.ltk-cs-chip-x:hover { color: #a02832; }
.ltk-cs-chipinput {
  flex: 1 1 90px;
  min-width: 80px;
  border: none;
  outline: none;
  font: inherit;
  font-size: 12px;
  background: transparent;
  color: var(--ltk-fg);
  padding: 2px;
}

/* ---- colours ---- */
.ltk-cs-colorwrap { display: inline-flex; align-items: center; gap: 6px; }
.ltk-cs-color {
  width: 30px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--ltk-hairline);
  border-radius: 4px;
  background: var(--ltk-bg);
  cursor: pointer;
}
.ltk-cs-color-unset { opacity: 0.35; }
.ltk-cs-colorhex {
  font-size: 11px;
  color: var(--ltk-muted);
  font-variant-numeric: tabular-nums;
  min-width: 52px;
}
.ltk-cs-colorclear {
  border: none;
  background: none;
  color: var(--ltk-muted);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  padding: 0 2px;
}
.ltk-cs-colorclear:hover { color: #a02832; }
.ltk-cs-colorslot { display: inline-flex; align-items: center; gap: 2px; }

/* ---- small tables (objectList / kvList) ---- */
.ltk-cs-table { display: flex; flex-direction: column; gap: 4px; }
.ltk-cs-tr { display: flex; gap: 6px; align-items: center; }
.ltk-cs-th .ltk-cs-td {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ltk-muted);
}
.ltk-cs-td { flex: 1 1 0; min-width: 0; }
.ltk-cs-td-x { flex: 0 0 20px; text-align: center; }
.ltk-cs-td-key { flex: 0 0 32%; }
.ltk-cs-cell { width: 100%; box-sizing: border-box; font-size: 12px; padding: 4px 6px; }
.ltk-cs-add {
  align-self: flex-start;
  border: 1px dashed var(--ltk-hairline);
  border-radius: 6px;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.ltk-cs-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- capture columns builder ---- */
.ltk-cs-cols { display: flex; flex-direction: column; gap: 8px; }
.ltk-cs-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 8px;
  background: var(--ltk-bg);
}
.ltk-cs-col-head { display: flex; gap: 6px; align-items: center; }
.ltk-cs-col-label { flex: 1 1 auto; min-width: 0; }
/* Safari: fixed flex items need an explicit width, not shrink-to-fit */
.ltk-cs-col-key {
  flex: 0 0 110px;
  width: 110px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--ltk-muted);
}
.ltk-cs-col-type { flex: 0 0 118px; width: 118px; font-size: 12px; padding: 4px 6px; }
.ltk-cs-td-icon { flex: 0 0 30%; }
.ltk-cs-td-prev, .ltk-cs-iconprev {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  overflow: hidden;
}
.ltk-cs-iconprev img { max-width: 22px; max-height: 22px; }
.ltk-cs-col-foot {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}
.ltk-cs-col-dep {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ltk-muted);
}
.ltk-cs-col-dep select { font-size: 12px; padding: 4px 6px; }

/* ---- raw JSON fallback ---- */
.ltk-cs-json {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.ltk-cs-json-bad { border-color: #a02832 !important; }
.ltk-cs-jsonerr { font-size: 11px; color: #a02832; }
`;
