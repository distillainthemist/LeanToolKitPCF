// CanvasCard styles. The grid is the card: repeat(cols, 1fr) columns and
// fixed-step auto rows; fields span w columns × h steps. Chips reuse the
// capture card's classes (the editor loads CAPTURE_CSS too) so shared
// vocabulary stays visually identical.

export const CANVAS_STEP = 44;

export const CANVAS_CSS = `
.ltk-cv-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 10px 10px;
}
.ltk-cv-banner {
  font-size: 12px;
  color: var(--ltk-muted);
  padding: 0 2px 6px;
}
.ltk-cv-banner b { color: var(--ltk-accent); }
.ltk-cv-grid {
  display: grid;
  gap: 8px;
  grid-auto-rows: ${CANVAS_STEP}px;
  grid-auto-flow: row;
}
.ltk-cv-narrow .ltk-cv-grid { grid-template-columns: 1fr !important; }
.ltk-cv-narrow .ltk-cv-field {
  grid-column: auto / span 1 !important;
  grid-row: auto / span var(--h, 1) !important;
}
.ltk-cv-narrow .ltk-cv-emptycell { display: none; }

.ltk-cv-field {
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 5px 8px 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.ltk-cv-field-heading {
  border: none;
  padding: 6px 2px 0;
  justify-content: flex-end;
  overflow: visible;
}
.ltk-cv-heading-text {
  font-weight: 700;
  font-size: 16px;
  border-bottom: 2px solid var(--ltk-accent);
  padding-bottom: 3px;
}

.ltk-cv-label {
  font-size: 11px;
  color: var(--ltk-muted);
  display: flex;
  gap: 6px;
  align-items: baseline;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 0 auto;
}
.ltk-cv-needed { color: var(--ltk-accent); font-style: italic; }

.ltk-cv-value {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 14px;
  line-height: 1.35;
}
.ltk-cv-editable { cursor: pointer; }
.ltk-cv-empty { color: var(--ltk-muted); }
.ltk-cv-pre { white-space: pre-wrap; overflow-wrap: break-word; }

.ltk-cv-rich p { margin: 0 0 6px; }
.ltk-cv-rich ul, .ltk-cv-rich ol { margin: 0 0 6px; padding-left: 20px; }
.ltk-cv-rich a { color: var(--ltk-accent); }

.ltk-cv-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ltk-cv-bar-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--ltk-hairline);
  overflow: hidden;
}
.ltk-cv-bar-fill { height: 100%; background: var(--ltk-accent); }

.ltk-cv-stars { font-size: 19px; letter-spacing: 3px; user-select: none; }
.ltk-cv-star { color: var(--ltk-muted); cursor: pointer; }
.ltk-cv-star-on { color: var(--ltk-accent); }
.ltk-readonly .ltk-cv-star { cursor: default; }

.ltk-cv-status {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
}

.ltk-cv-person {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 1px 8px 1px 2px;
  font-size: 12px;
  margin: 1px 3px 1px 0;
  white-space: nowrap;
}
.ltk-cv-person-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ltk-accent);
  color: var(--ltk-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
}

.ltk-cv-check { display: flex; flex-direction: column; gap: 3px; }
.ltk-cv-check-item {
  display: flex;
  gap: 7px;
  align-items: baseline;
  cursor: pointer;
}
.ltk-readonly .ltk-cv-check-item { cursor: default; }
.ltk-cv-check-box { color: var(--ltk-muted); }
.ltk-cv-check-done .ltk-cv-check-box { color: var(--ltk-accent); }
.ltk-cv-check-done .ltk-cv-check-text {
  text-decoration: line-through;
  color: var(--ltk-muted);
}

.ltk-cv-url { display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.ltk-cv-url a {
  color: var(--ltk-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ltk-cv-img { width: 100%; height: 100%; object-fit: contain; display: block; }

.ltk-cv-mini { font-size: 12px; }
.ltk-cv-mini .ltk-cc-table th { font-size: 11px; }

.ltk-cv-yes { font-weight: 600; }

/* ---- required marker (both modes) ---- */
.ltk-cv-req { color: #b42318; font-weight: 700; }

/* ---- design mode (studio only, canvas plan D0+) ---- */
.ltk-cv-designable { cursor: pointer; }
.ltk-cv-selected {
  outline: 2px solid var(--ltk-accent);
  outline-offset: 1px;
  position: relative;
}
.ltk-cv-readout {
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ltk-accent);
  background: var(--ltk-bg);
  padding: 0 4px;
  border-radius: 4px;
}
.ltk-cv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--ltk-hairline);
  margin-bottom: 8px;
  font-size: 12px;
}
.ltk-cv-toolbar-label { color: var(--ltk-muted); }
.ltk-cv-seg { display: inline-flex; border: 1px solid var(--ltk-hairline); border-radius: 6px; overflow: hidden; }
.ltk-cv-seg-btn {
  border: none;
  background: none;
  color: var(--ltk-fg);
  padding: 3px 9px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ltk-cv-seg-btn + .ltk-cv-seg-btn { border-left: 1px solid var(--ltk-hairline); }
.ltk-cv-seg-btn.ltk-cv-seg-on { background: var(--ltk-fg); color: var(--ltk-bg); }
.ltk-cv-toolbtn {
  border: 1px solid var(--ltk-hairline);
  background: none;
  color: var(--ltk-fg);
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ltk-cv-toolbtn.ltk-cv-toolbtn-on { background: var(--ltk-fg); color: var(--ltk-bg); }
.ltk-cv-toolbar-spacer { flex: 1; }
.ltk-cv-glyph { color: var(--ltk-muted); margin-right: 2px; }
.ltk-cv-emptycell {
  border: 1px dashed var(--ltk-hairline);
  border-radius: 8px;
  opacity: 0.7;
}
.ltk-cv-gridon .ltk-cv-field { border-style: dashed; }
.ltk-cv-skel {
  border: 1px dashed var(--ltk-hairline);
  border-radius: 6px;
  color: var(--ltk-muted);
  font-size: 12px;
  padding: 4px 8px;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  overflow: hidden;
}
.ltk-cv-skel-line { align-items: center; }
.ltk-cv-skel .ltk-cc-chip { opacity: 0.7; }
.ltk-cv-dropzone {
  grid-column: 1 / -1;
  border: 1px dashed var(--ltk-accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ltk-accent) 6%, transparent);
  color: var(--ltk-accent);
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.ltk-cv-dropzone-add {
  border: none;
  background: none;
  color: var(--ltk-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

/* ---- picker dialogs (C3) ---- */
.ltk-cv-statuspick { display: flex; flex-wrap: wrap; gap: 8px; }
.ltk-cv-statusopt { border: 2px solid transparent; cursor: pointer; font: inherit; }
.ltk-cv-statusopt-on { border-color: var(--ltk-fg); }

.ltk-cv-peoplepick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.ltk-cv-personopt { background: none; cursor: pointer; font: inherit; }
.ltk-cv-personopt-on {
  border-color: var(--ltk-accent);
  box-shadow: 0 0 0 1px var(--ltk-accent);
}

.ltk-cv-richbar {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.ltk-cv-richbtn {
  border: 1px solid var(--ltk-hairline);
  background: none;
  color: var(--ltk-fg);
  border-radius: 6px;
  cursor: pointer;
  padding: 3px 9px;
  font-size: 13px;
}
.ltk-cv-richbtn:first-child { font-weight: 700; }
.ltk-cv-richlink { flex: 1 1 140px; min-width: 0; }
.ltk-cv-richedit {
  min-height: 140px;
  max-height: 45vh;
  overflow: auto;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
}
.ltk-cv-richedit:focus { border-color: var(--ltk-accent); }

.ltk-cv-checkedit { display: flex; flex-direction: column; gap: 6px; }
.ltk-cv-checkedit-row { display: flex; gap: 6px; align-items: center; }
.ltk-cv-checkedit-row input { flex: 1; min-width: 0; }

.ltk-cv-addbtn {
  align-self: flex-start;
  border: 1px dashed var(--ltk-hairline);
  background: none;
  color: var(--ltk-fg);
  border-radius: 6px;
  cursor: pointer;
  padding: 5px 10px;
  font: inherit;
}

.ltk-cv-pastezone {
  border: 1px dashed var(--ltk-hairline);
  border-radius: 8px;
  padding: 18px 12px;
  text-align: center;
  color: var(--ltk-muted);
  margin-top: 8px;
  outline: none;
}
.ltk-cv-pastezone:focus { border-color: var(--ltk-accent); }

.ltk-cv-value input,
.ltk-cv-value textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: inherit;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-accent);
  border-radius: 6px;
  padding: 3px 6px;
}
.ltk-cv-value textarea { height: 100%; resize: none; }
.ltk-cv-rangeedit { display: flex; gap: 6px; }
.ltk-cv-rangeedit input { flex: 1; min-width: 0; }
`;
