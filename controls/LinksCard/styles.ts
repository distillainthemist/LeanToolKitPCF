// LinksCard stylesheet: a quiet list — a glyph, the title as the link,
// the note beneath; the pinned working folder leads in its own band;
// edit rows are plain inputs with the toolkit's drag handle and ×.

export const LINKS_CSS = `
.ltk-lk-body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.ltk-lk-pinned {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  background: color-mix(in srgb, var(--ltk-accent) 8%, var(--ltk-bg)); border: 1px solid var(--ltk-hairline); border-radius: 8px;
}
.ltk-lk-pinned-glyph { font-size: 18px; line-height: 1; flex: none; }
.ltk-lk-pinned-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ltk-lk-pinned-cap { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ltk-muted); }
.ltk-lk-pinned a, .ltk-lk-title a { color: var(--ltk-fg); font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.ltk-lk-pinned a:hover, .ltk-lk-title a:hover { color: var(--ltk-accent); text-decoration: underline; }
.ltk-lk-pinned-none { color: var(--ltk-muted); font-size: 12.5px; }
.ltk-lk-set { flex: none; font: inherit; font-size: 12px; color: var(--ltk-accent); background: none; border: none; cursor: pointer; padding: 4px 6px; min-height: 32px; }
.ltk-lk-set:hover { text-decoration: underline; }
.ltk-lk-group { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ltk-muted); padding: 6px 2px 0; }
.ltk-lk-list { display: flex; flex-direction: column; gap: 4px; }
.ltk-lk-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid var(--ltk-hairline); border-radius: 8px; background: var(--ltk-bg); min-height: 36px; }
.ltk-lk-glyph { flex: none; width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; margin-top: 1px; }
.ltk-lk-glyph-sharepoint { background: #0f6cbd; }
.ltk-lk-glyph-onedrive { background: #0a64a5; }
.ltk-lk-glyph-teams { background: #5b5fc7; }
.ltk-lk-glyph-web { background: #6d675c; }
.ltk-lk-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ltk-lk-title { font-size: 13px; }
.ltk-lk-note { font-size: 12px; color: var(--ltk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ltk-lk-where { font-size: 11px; color: var(--ltk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* inline editing: ⠿ and Edit on a row; the form replaces the row */
.ltk-lk-row .ltk-lk-handle { flex: none; color: var(--ltk-muted); cursor: grab; font-size: 14px; margin-top: 3px; }
.ltk-lk-editbtn { align-self: flex-start; }
.ltk-lk-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px 8px; padding: 8px; border: 1px solid var(--ltk-accent); border-radius: 8px; background: var(--ltk-bg); }
.ltk-lk-form-wide { grid-column: 1 / -1; }
.ltk-lk-form-bar { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; padding-top: 2px; }
.ltk-lk-form-bar .ltk-lk-btn-danger { margin-left: auto; }
.ltk-lk-btn { font: inherit; font-size: 12.5px; color: var(--ltk-fg); background: var(--ltk-bg); border: 1px solid var(--ltk-hairline); border-radius: 8px; padding: 5px 12px; min-height: 32px; cursor: pointer; }
.ltk-lk-btn:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-lk-btn-primary { background: var(--ltk-accent); border-color: var(--ltk-accent); color: #fff; }
.ltk-lk-btn-primary:hover { color: #fff; filter: brightness(0.92); }
.ltk-lk-btn:disabled { opacity: 0.45; cursor: default; filter: none; }
.ltk-lk-btn-danger { color: #d13438; }
.ltk-lk-btn-danger:hover { border-color: #d13438; color: #d13438; }
.ltk-lk-in { font: inherit; font-size: 12.5px; color: var(--ltk-fg); background: var(--ltk-bg); border: 1px solid var(--ltk-hairline); border-radius: 6px; padding: 5px 8px; min-width: 0; width: 100%; box-sizing: border-box; min-height: 32px; }
.ltk-lk-in-bad { border-color: #d13438; }
.ltk-lk-add { align-self: flex-start; font: inherit; font-size: 12.5px; color: var(--ltk-fg); background: var(--ltk-bg); border: 1px dashed var(--ltk-hairline); border-radius: 8px; padding: 6px 12px; min-height: 36px; cursor: pointer; }
.ltk-lk-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-lk-toggle { align-self: flex-start; white-space: nowrap; }
.ltk-lk-hint { flex: none; color: var(--ltk-muted); cursor: help; font-size: 13px; padding: 4px; }
.ltk-lk-contents { display: flex; flex-direction: column; gap: 2px; margin: -2px 0 4px 30px; padding: 4px 0 4px 10px; border-left: 2px solid var(--ltk-hairline); }
.ltk-lk-contents-note { font-size: 12px; color: var(--ltk-muted); padding: 2px 0; }
.ltk-lk-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; min-height: 28px; }
.ltk-lk-item-glyph { flex: none; }
.ltk-lk-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ltk-fg); text-decoration: none; }
.ltk-lk-item-name:hover { color: var(--ltk-accent); text-decoration: underline; }
.ltk-lk-item-when { flex: none; font-size: 11px; color: var(--ltk-muted); font-variant-numeric: tabular-nums; }
.ltk-tile .ltk-lk-contents, .ltk-tile .ltk-lk-toggle, .ltk-tile .ltk-lk-hint { display: none; }
.ltk-lk-more { display: none; font-size: 12px; color: var(--ltk-muted); padding: 2px 8px; }
.ltk-lk-empty { color: var(--ltk-muted); font-size: 13px; padding: 10px 2px; }
/* the tile: titles only, the first six, then "+n more"; no notes */
.ltk-tile .ltk-lk-note, .ltk-tile .ltk-lk-where { display: none; }
.ltk-tile .ltk-lk-row:nth-child(n + 7) { display: none; }
.ltk-tile .ltk-lk-more { display: block; }
.ltk-tile .ltk-lk-set, .ltk-tile .ltk-lk-add, .ltk-tile .ltk-lk-handle, .ltk-tile .ltk-lk-form { display: none; }
`;
