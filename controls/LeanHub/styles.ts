// LeanHub stylesheet — tab shell, the day/week calendar grid with
// protected-time bands and meeting chips, the personal actions list, and
// the settings forms.

export const LEANHUB_CSS = `
.ltk-lh-boards { display: flex; flex-direction: column; gap: 8px; padding: 12px; max-width: 860px; }
.ltk-lh-boardrow { display: flex; align-items: center; gap: 12px; font: inherit; text-align: left;
  background: var(--ltk-bg); border: 1px solid color-mix(in srgb, var(--ltk-fg) 14%, transparent);
  border-radius: 8px; padding: 12px 14px; cursor: pointer; }
.ltk-lh-boardrow:hover { border-color: var(--ltk-accent); }
.ltk-lh-boardname { font-weight: 700; }
.ltk-lh-boarddot { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; }
.ltk-lh-boardmeta { font-size: 12.5px; opacity: 0.7; }

/* ---- tabs ---- */
.ltk-lh-tabs {
  display: flex;
  gap: 2px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ltk-hairline);
  flex: 0 0 auto;
}
.ltk-lh-tab {
  font: inherit;
  font-size: 15.5px;
  font-weight: 600;
  border: none;
  background: none;
  color: var(--ltk-muted);
  padding: 12px 16px 10px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.ltk-lh-tab-on { color: var(--ltk-fg); border-bottom-color: var(--ltk-accent); }
.ltk-lh-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ---- calendar toolbar ---- */
.ltk-lh-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  flex: 0 0 auto;
  flex-wrap: wrap;
}
.ltk-lh-bar-gap { flex: 1; }
.ltk-lh-input {
  font: inherit;
  font-size: 12.5px;
  color: var(--ltk-fg);
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 6px 8px;
}
/* toolbar/form selects size to content, not the row */
.ltk-lh-bar select.ltk-lh-input { width: auto; max-width: 230px; }
.ltk-lh-person-pick { display: inline-flex; align-items: center; gap: 6px; }
.ltk-lh-person-input { width: 210px; }
.ltk-lh-field select.ltk-lh-input { width: auto; max-width: 260px; }
.ltk-lh-btn {
  font: inherit;
  font-size: 12.5px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}
.ltk-lh-btn:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-lh-range { font-size: 12.5px; font-weight: 600; color: var(--ltk-muted); }

/* ---- calendar grid ---- */
.ltk-lh-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 12px; }
.ltk-lh-grid {
  display: grid;
  grid-auto-rows: min-content;
  min-width: 640px;
}
.ltk-lh-corner { position: sticky; top: 0; z-index: 3; background: var(--ltk-bg); }
.ltk-lh-dayhead {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--ltk-bg);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 6px;
  border-bottom: 1px solid var(--ltk-hairline);
}
.ltk-lh-dayhead.ltk-lh-today { color: var(--ltk-accent); }
.ltk-lh-axis { position: relative; }
.ltk-lh-hour {
  position: absolute;
  right: 8px;
  transform: translateY(-6px);
  font-size: 10.5px;
  color: var(--ltk-muted);
}
.ltk-lh-daycol {
  position: relative;
  border-left: 1px solid var(--ltk-hairline);
  overflow: hidden;
}
.ltk-lh-daycol.ltk-lh-today { background: color-mix(in srgb, var(--ltk-accent) 4%, transparent); }
.ltk-lh-gridline {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid color-mix(in srgb, var(--ltk-hairline) 55%, transparent);
  pointer-events: none;
}
.ltk-lh-band {
  position: absolute;
  left: 0;
  right: 0;
  opacity: 0.18;
  pointer-events: none;
}
.ltk-lh-band-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-fg);
  opacity: 0.9;
  white-space: nowrap;
}
.ltk-lh-chip {
  position: absolute;
  z-index: 2;
  margin: 0 2px;
  text-align: left;
  font: inherit;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-left: 3px solid var(--ltk-accent);
  border-radius: 6px;
  padding: 2px 6px;
  overflow: hidden;
  cursor: pointer;
}
.ltk-lh-chip:hover { border-color: var(--ltk-accent); box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.ltk-lh-chip-title {
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltk-lh-chip-meta {
  font-size: 10px;
  color: var(--ltk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- actions tab ---- */
.ltk-lh-actions {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 760px;
}
.ltk-lh-compose {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
}
.ltk-lh-compose-issue { flex: 1; min-width: 0; }
.ltk-lh-compose-due { width: 140px; }
.ltk-lh-group {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  padding: 10px 2px 2px;
}
.ltk-lh-action {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 8px 10px;
}
.ltk-lh-tick {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin: 0;
  accent-color: var(--ltk-accent);
  cursor: pointer;
}
.ltk-lh-action-main { flex: 1; min-width: 0; }
.ltk-lh-action-issue { font-size: 13px; font-weight: 600; }
.ltk-lh-action-issue.ltk-lh-done { text-decoration: line-through; color: var(--ltk-muted); }
.ltk-lh-action-desc {
  font-size: 12px;
  color: var(--ltk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltk-lh-action-with { flex: none; font-size: 11.5px; color: var(--ltk-muted); font-style: italic; }
.ltk-lh-action-due {
  flex: none;
  font-size: 11.5px;
  font-weight: 700;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 2px 8px;
}
.ltk-lh-overdue { color: #d13438; border-color: #d13438; }
.ltk-lh-esc { flex: none; color: #d13438; }

/* ---- settings tab ---- */
.ltk-lh-form {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 680px;
}
.ltk-lh-section {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  padding-top: 8px;
}
.ltk-lh-help { font-size: 12px; color: var(--ltk-muted); }
.ltk-lh-field { display: flex; align-items: center; gap: 10px; }
.ltk-lh-label { flex: 0 0 130px; font-size: 12.5px; font-weight: 600; }
.ltk-lh-cascade { display: flex; gap: 8px; flex-wrap: wrap; }
.ltk-lh-cascade select.ltk-lh-input { width: auto; max-width: 200px; }

/* protected time editor */
.ltk-lh-zone {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 6px 8px;
  flex-wrap: wrap;
}
.ltk-lh-zone-color input { width: 28px; height: 24px; border: none; background: none; padding: 0; cursor: pointer; }
.ltk-lh-zone-label { flex: 1; min-width: 140px; }
.ltk-lh-zone-days { display: flex; gap: 2px; }
.ltk-lh-zoneday {
  font: inherit;
  font-size: 10.5px;
  font-weight: 700;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  cursor: pointer;
  padding: 0;
}
.ltk-lh-zoneday-on { background: var(--ltk-accent); border-color: var(--ltk-accent); color: #fff; }
.ltk-lh-zone-time { width: 92px; }
.ltk-lh-zone-dash { color: var(--ltk-muted); }
.ltk-lh-zone-x {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 15px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 999px;
}
.ltk-lh-zone-x:hover { color: var(--ltk-accent); }
`;
