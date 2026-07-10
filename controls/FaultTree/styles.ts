// FaultTree stylesheet — an indented cause tree under a top-event card.
// Status/root colours are set inline by the editor (Safari rule).

export const FAULTTREE_CSS = `
.ltk-ft-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- top event (problem) ---- */
.ltk-ft-problem {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 6px;
  padding: 10px 14px;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltk-ft-problem.ltk-readonly { cursor: default; }
.ltk-ft-problem-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
  flex: 0 0 auto;
}
.ltk-ft-problem-text { font-size: 16px; font-weight: 600; line-height: 1.3; }
.ltk-ft-problem-text.ltk-ft-placeholder { opacity: 0.7; font-weight: 400; }

/* ---- tree ---- */
.ltk-ft-tree { display: flex; flex-direction: column; gap: 8px; }
.ltk-ft-children {
  margin-left: 24px;
  padding-left: 16px;
  border-left: 2px solid var(--ltk-hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ltk-ft-node { position: relative; }
.ltk-ft-children > .ltk-ft-node::before {
  content: "";
  position: absolute;
  left: -16px;
  top: 22px;
  width: 14px;
  height: 2px;
  background: var(--ltk-hairline);
}

/* ---- cause cards (mirrors the FiveWhys card language) ---- */
.ltk-ft-card {
  width: 260px;
  max-width: 100%;
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  touch-action: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: box-shadow 150ms ease;
}
.ltk-ft-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.ltk-ft-card.ltk-readonly { cursor: default; }
.ltk-ft-card-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ltk-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.ltk-ft-card-tag .ltk-ft-spacer { flex: 1; }
.ltk-ft-root-pill {
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ltk-ft-card-text {
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
.ltk-ft-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ltk-muted);
  min-height: 24px;
}
.ltk-ft-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--ltk-hairline);
  color: var(--ltk-fg);
  font-weight: 600;
}
.ltk-ft-badge-action { background: var(--ltk-accent); color: #ffffff; }

/* small square buttons on cards (collapse chevron, add child) */
.ltk-ft-mini {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  min-width: 26px;
  min-height: 26px;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
}
.ltk-ft-mini:hover { background: var(--ltk-hairline); color: var(--ltk-fg); }

/* ---- add top-level branch ---- */
.ltk-ft-add-branch {
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
.ltk-ft-add-branch:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- drag and drop (re-parenting) ---- */
.ltk-ft-ghost {
  position: fixed;
  z-index: 10001;
  opacity: 0.65;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  margin: 0;
}
.ltk-ft-dragging { opacity: 0.35; }
.ltk-ft-drop-target {
  outline: 2px dashed var(--ltk-accent);
  outline-offset: 3px;
}
`;
