// EscalationViewer stylesheet — grouped escalations with acknowledge +
// comment strips. Badge colours are set inline (Safari rule).

export const ESCALATION_CSS = `
.ltk-ev-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow-y: auto;
}

/* ---- source groups ---- */
.ltk-ev-group { display: flex; flex-direction: column; gap: 4px; }
.ltk-ev-grouphead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  background: var(--ltk-hairline);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.ltk-ev-chevron { font-size: 11px; color: var(--ltk-muted); }
.ltk-ev-grouplabel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ltk-fg);
}
.ltk-ev-groupbadge {
  margin-left: auto;
  min-width: 20px;
  text-align: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
}

/* ---- escalation items ---- */
.ltk-ev-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0 6px;
  border-bottom: 1px solid var(--ltk-hairline);
}
.ltk-ev-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 34px;
}
.ltk-ev-ack, .ltk-ev-comment {
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.ltk-ev-ack:hover, .ltk-ev-comment:hover {
  border-color: var(--ltk-accent);
  color: var(--ltk-accent);
}
.ltk-ev-ack-on {
  border-style: solid;
  border-color: #107c10;
  color: #107c10;
}
.ltk-ev-comment-count { font-size: 11px; color: var(--ltk-muted); }
.ltk-ev-lastcomment {
  padding-left: 34px;
  font-size: 11.5px;
  color: var(--ltk-muted);
  font-style: italic;
  overflow-wrap: anywhere;
}

/* ---- comment dialog history ---- */
.ltk-ev-history { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.ltk-ev-history-row { font-size: 12px; color: var(--ltk-muted); }

/* ---- footer ---- */
.ltk-ev-summary { font-size: 11px; color: var(--ltk-muted); padding-top: 2px; }
`;
