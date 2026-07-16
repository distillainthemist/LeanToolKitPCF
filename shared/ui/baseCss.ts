// Base stylesheet for the shared UI kit (dialogs, fields, title bar, kebab,
// ghost states). Written once against the --ltk-* variables that
// applyThemeVars() sets on each control's root, and bundled into the JS
// because canvas apps sometimes fail to load a separate css resource.

export const LTK_BASE_CSS = `
.ltk-root {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  font-family: var(--ltk-font);
  font-size: 14px;
  overflow: hidden;
}
.ltk-root *, .ltk-root *::before, .ltk-root *::after { box-sizing: border-box; }

/* ---- title bar + prompts ---- */
.ltk-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 6px;
  position: relative;
  flex: 0 0 auto;
  /* optional strip fill (theme.titlebar) with auto-contrast text */
  background: var(--ltk-titlebar, transparent);
  color: var(--ltk-titlebar-fg, inherit);
}
.ltk-titlebar-text { font-size: 20px; font-weight: 600; line-height: 1.2; }
.ltk-info-btn {
  border: none; background: none; color: var(--ltk-muted);
  font-size: 14px; cursor: pointer; padding: 2px 6px; border-radius: 999px;
  min-width: 28px; min-height: 28px;
}
.ltk-info-btn:hover { color: var(--ltk-accent); }
.ltk-info-pop {
  position: absolute; top: calc(100% + 4px); left: 12px; z-index: 40;
  background: var(--ltk-bg); color: var(--ltk-fg);
  border: 1px solid var(--ltk-hairline); border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  padding: 10px 12px; max-width: 340px; font-size: 12px;
}
.ltk-info-line + .ltk-info-line { margin-top: 6px; }

/* ---- ghost / empty state ---- */
.ltk-ghost {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px; flex: 1; padding: 24px;
  color: var(--ltk-muted); text-align: center; cursor: pointer;
}
.ltk-ghost-line { font-size: 16px; }
.ltk-ghost-line:first-child { font-size: 20px; font-weight: 600; }

/* ---- kebab menu ---- */
.ltk-kebab { position: absolute; top: 6px; right: 6px; z-index: 30; }
.ltk-kebab-btn {
  border: none; background: none; color: var(--ltk-muted);
  font-size: 18px; line-height: 1; cursor: pointer;
  min-width: 32px; min-height: 32px; border-radius: 6px;
}
.ltk-kebab-btn:hover { background: var(--ltk-hairline); color: var(--ltk-fg); }
.ltk-kebab-menu {
  position: absolute; right: 0; top: calc(100% + 2px);
  background: var(--ltk-bg); border: 1px solid var(--ltk-hairline);
  border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  min-width: 160px; padding: 4px; z-index: 41;
}
.ltk-kebab-item {
  display: block; width: 100%; text-align: left; border: none;
  background: none; color: var(--ltk-fg); font: inherit; font-size: 14px;
  padding: 8px 10px; border-radius: 4px; cursor: pointer;
}
.ltk-kebab-item:hover { background: var(--ltk-hairline); }

/* ---- dialog ----
   Fixed to the viewport (not the card) so dialogs never clip inside a short
   or small control; explicit sides rather than inset for older Safari. */
.ltk-dialog-overlay {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 10000;
  background: rgba(20,20,20,0.35);
  display: flex; align-items: center; justify-content: center;
}
.ltk-dialog {
  background: var(--ltk-bg); color: var(--ltk-fg);
  border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.25);
  width: min(420px, calc(100% - 32px));
  max-height: calc(100% - 32px); overflow: auto;
  display: flex; flex-direction: column;
}
.ltk-dialog-title {
  font-size: 16px; font-weight: 600; padding: 14px 16px 10px;
  border-bottom: 1px solid var(--ltk-hairline);
  text-align: left;
}
.ltk-dialog-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.ltk-dialog-footer {
  display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px 14px;
}
/* destructive actions sit apart, far left, away from Cancel/Save */
.ltk-dialog-footer .ltk-btn-danger { margin-right: auto; }

/* ---- fields ---- */
.ltk-field { display: flex; flex-direction: column; gap: 4px; }
.ltk-field-label { font-size: 12px; color: var(--ltk-muted); text-align: left; }
.ltk-dialog-body { text-align: left; }
.ltk-field-half { max-width: 200px; }
.ltk-section {
  font-size: 12px; font-weight: 600; color: var(--ltk-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
  margin-top: 2px; padding-top: 12px; border-top: 1px solid var(--ltk-hairline);
}

/* ---- checklist (assignees etc) ---- */
.ltk-checklist {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
}
.ltk-check {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--ltk-hairline); border-radius: 6px;
  padding: 8px 10px; min-height: 40px; cursor: pointer; font-size: 14px;
  transition: border-color 150ms ease, background 150ms ease;
}
.ltk-check:hover { border-color: var(--ltk-accent); }
.ltk-check input {
  accent-color: var(--ltk-accent);
  width: 16px; height: 16px; margin: 0; flex: 0 0 auto; cursor: pointer;
}
.ltk-check-on { border-color: var(--ltk-accent); background: var(--ltk-hairline); }
.ltk-input {
  font: inherit; font-size: 14px; color: var(--ltk-fg);
  background: var(--ltk-bg); border: 1px solid var(--ltk-hairline);
  border-radius: 6px; padding: 8px 10px; min-height: 36px;
}
.ltk-input:focus { outline: 2px solid var(--ltk-accent); outline-offset: -1px; }
.ltk-textarea { resize: vertical; }
.ltk-char-counter { font-size: 12px; color: var(--ltk-muted); text-align: right; }

/* ---- action rows (shared action UI; circle colours set inline) ---- */
.ltk-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 6px 8px 6px 10px;
  background: var(--ltk-bg);
}
.ltk-action-circle {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 2px solid var(--ltk-hairline);
  border-radius: 999px;
  background: none;
  color: transparent;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 150ms ease, background 150ms ease;
}
.ltk-action-circle:hover { border-color: var(--ltk-muted); }
.ltk-action-main { flex: 1; min-width: 0; cursor: pointer; text-align: left; }
.ltk-action-issue {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ltk-muted);
}
.ltk-action-desc { font-size: 13px; line-height: 1.3; overflow-wrap: break-word; }
.ltk-action-right {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  text-align: right;
}
.ltk-action-who { font-size: 13px; font-weight: 600; color: var(--ltk-fg); }
.ltk-action-due { font-size: 12px; font-weight: 600; color: var(--ltk-fg); }
.ltk-action-overdue { color: #d13438; font-weight: 600; }
.ltk-action-flag { color: var(--ltk-accent); font-weight: 600; }
.ltk-action-edit {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 14px;
  min-width: 32px;
  min-height: 32px;
  border-radius: 6px;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltk-action-edit:hover { background: var(--ltk-hairline); color: var(--ltk-fg); }

/* ---- buttons ---- */
.ltk-btn {
  font: inherit; font-size: 14px; font-weight: 600;
  border-radius: 6px; padding: 8px 14px; cursor: pointer;
  border: 1px solid transparent; min-height: 36px;
  transition: background 150ms ease, color 150ms ease;
}
.ltk-btn-primary { background: var(--ltk-accent); color: #ffffff; }
.ltk-btn-primary:hover { filter: brightness(0.92); }
.ltk-btn-secondary {
  background: none; color: var(--ltk-fg); border-color: var(--ltk-hairline);
}
.ltk-btn-secondary:hover { background: var(--ltk-hairline); }
.ltk-btn-danger { background: none; color: #d13438; border-color: #d13438; }
.ltk-btn-danger:hover { background: #d13438; color: #ffffff; }

/* ---- pan / zoom cluster (shared PanZoom controller) ---- */
.ltk-pz-zoom {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 4px;
  z-index: 5;
}
.ltk-pz-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 120ms ease;
}
.ltk-pz-btn:hover { border-color: var(--ltk-accent); }
`;
