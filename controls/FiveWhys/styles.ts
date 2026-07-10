// FiveWhys stylesheet — control-specific classes on top of the shared base
// CSS. Everything reads the --ltk-* variables set by applyThemeVars, plus
// per-status variables set inline on each card.

export const FIVEWHYS_CSS = `
.ltk-fw-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- problem card ---- */
.ltk-fw-problem {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--ltk-accent);
  color: #ffffff;
  border-radius: 6px;
  padding: 10px 14px;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltk-fw-problem.ltk-readonly { cursor: default; }
.ltk-fw-problem-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
  flex: 0 0 auto;
}
.ltk-fw-problem-text { font-size: 16px; font-weight: 600; line-height: 1.3; }
.ltk-fw-problem-text.ltk-fw-placeholder { opacity: 0.7; font-weight: 400; }

/* ---- chains ---- */
.ltk-fw-chains { display: flex; flex-direction: column; gap: 12px; }
.ltk-fw-chain {
  position: relative; /* anchors the drag insertion marker */
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  padding-bottom: 2px;
}
.ltk-fw-step { display: flex; align-items: stretch; flex: 0 0 auto; }

/* ---- why cards ---- */
/* Status colours (top border, root tint/pill) are set inline by the editor —
   not via custom properties — for Safari compatibility. Cards are neutral by
   default; a coloured 3px top border appears only when showStatus is on. */
.ltk-fw-card {
  position: relative;
  width: 180px;
  min-height: 92px;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 8px 10px 26px;
  cursor: pointer;
  touch-action: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: box-shadow 150ms ease, transform 150ms ease;
}
.ltk-fw-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.ltk-fw-card.ltk-readonly { cursor: default; }

/* drag and drop */
.ltk-fw-ghost {
  position: fixed;
  z-index: 10001;
  opacity: 0.65;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  margin: 0;
}
.ltk-fw-dragging { opacity: 0.35; }
.ltk-fw-drop {
  outline: 2px dashed var(--ltk-accent);
  outline-offset: 3px;
  border-radius: 6px;
}
.ltk-fw-insert-marker {
  position: absolute;
  top: 4px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: var(--ltk-accent);
  pointer-events: none;
}
.ltk-fw-card-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ltk-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}
.ltk-fw-card-text {
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
.ltk-fw-card-text.ltk-fw-placeholder { color: var(--ltk-muted); }
.ltk-fw-root-pill {
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ltk-fw-card-foot {
  position: absolute;
  left: 10px;
  right: 8px;
  bottom: 5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--ltk-muted);
}
.ltk-fw-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--ltk-hairline);
  color: var(--ltk-fg);
  font-weight: 600;
}
.ltk-fw-badge.ltk-fw-badge-action { background: var(--ltk-accent); color: #ffffff; }

/* ---- connectors + add buttons ---- */
.ltk-fw-arrow {
  display: flex;
  align-items: center;
  color: var(--ltk-muted);
  padding: 0 2px;
  flex: 0 0 auto;
}
.ltk-fw-arrow svg { display: block; }
.ltk-fw-add {
  align-self: center;
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  border: 2px dashed var(--ltk-hairline);
  border-radius: 6px;
  background: none;
  color: var(--ltk-muted);
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-fw-add:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-fw-add-chain {
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
  padding: 10px 14px;
  min-height: 44px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-fw-add-chain:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- action list inside the edit dialog ----
   Complete/not-complete circle colours are set inline (Safari rule). */
.ltk-fw-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 6px 8px 6px 10px;
}
.ltk-fw-action-circle {
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
.ltk-fw-action-circle:hover { border-color: var(--ltk-muted); }
.ltk-fw-action-main { flex: 1; min-width: 0; cursor: pointer; text-align: left; }
.ltk-fw-action-desc { font-size: 13px; line-height: 1.3; overflow-wrap: break-word; }
.ltk-fw-action-who { color: var(--ltk-muted); font-size: 12px; }
.ltk-fw-action-edit {
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
.ltk-fw-action-edit:hover { background: var(--ltk-hairline); color: var(--ltk-fg); }
`;
