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

/* ---- sections (populated by the field editors) ---- */
.ltk-cs-note { font-size: 12px; color: var(--ltk-muted); line-height: 1.4; }
.ltk-cs-appbound { font-size: 11px; color: var(--ltk-muted); font-style: italic; }
`;
