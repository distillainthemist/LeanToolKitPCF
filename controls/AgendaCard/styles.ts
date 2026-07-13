// AgendaCard stylesheet — three collapsible sections (pre-work, agenda,
// outputs) of list rows. Rows follow the action-row visual language: a
// complete circle for checkable items, bold titles with muted detail beneath,
// who / timing pinned right.

export const AGENDA_CSS = `
.ltk-ag-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 12px;
  overflow: auto;
}

/* ---- section header: chevron, label, summary, add ---- */
.ltk-ag-section { display: flex; flex-direction: column; }
.ltk-ag-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 4px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  color: var(--ltk-fg);
}
.ltk-ag-head:hover { background: var(--ltk-hairline); }
.ltk-ag-chevron {
  font-size: 11px;
  color: var(--ltk-muted);
  width: 14px;
  flex: none;
  transition: transform 120ms ease;
}
.ltk-ag-open .ltk-ag-chevron { transform: rotate(90deg); }
.ltk-ag-head-label {
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ltk-ag-head-summary { font-size: 12.5px; color: var(--ltk-muted); }
.ltk-ag-head-spacer { flex: 1; }
.ltk-ag-add {
  border: 1px dashed var(--ltk-muted);
  background: none;
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 12.5px;
  padding: 3px 10px;
  cursor: pointer;
  flex: none;
}
.ltk-ag-add:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }

/* ---- rows ---- */
.ltk-ag-list { display: flex; flex-direction: column; }
.ltk-ag-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 4px 8px 22px;
  border-top: 1px solid var(--ltk-hairline);
  cursor: pointer;
}
.ltk-ag-row.ltk-readonly { cursor: default; }
.ltk-ag-row.ltk-ag-drag { padding-left: 6px; }
.ltk-ag-row:hover { background: color-mix(in srgb, var(--ltk-hairline) 45%, transparent); }
.ltk-ag-empty {
  padding: 4px 4px 10px 22px;
  font-size: 13px;
  color: var(--ltk-muted);
}

/* ---- drag handle + drag state ---- */
.ltk-ag-grip {
  flex: none;
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 2px;
  color: var(--ltk-muted);
  font-size: 13px;
  line-height: 1;
  cursor: grab;
  touch-action: none; /* the grip drags; the rest of the row still scrolls */
  user-select: none;
  -webkit-user-select: none;
  opacity: 0.45;
  transition: opacity 120ms ease;
}
.ltk-ag-row:hover .ltk-ag-grip { opacity: 0.8; }
.ltk-ag-grip:hover { opacity: 1; }
.ltk-ag-dragrow {
  opacity: 0.9;
  background: color-mix(in srgb, var(--ltk-accent) 8%, var(--ltk-bg));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  border-radius: 6px;
  cursor: grabbing;
}
.ltk-ag-dragrow .ltk-ag-grip { opacity: 1; cursor: grabbing; }
/* while a drag is in progress: no text selection, no row hover highlight */
.ltk-ag-draglist, .ltk-ag-draglist * {
  user-select: none;
  -webkit-user-select: none;
}
.ltk-ag-draglist .ltk-ag-row:hover { background: none; }

/* the check circle (shared visual with the action circle; colours inline) */
.ltk-ag-circle {
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  border: 2px solid var(--ltk-muted);
  background: none;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.ltk-ag-row.ltk-readonly .ltk-ag-circle { cursor: default; }

/* agenda order number in place of a circle */
.ltk-ag-num {
  flex: none;
  width: 22px;
  margin-top: 1px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ltk-muted);
  text-align: center;
}

.ltk-ag-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ltk-ag-title { font-size: 14.5px; font-weight: 600; line-height: 1.25; overflow-wrap: break-word; }
.ltk-ag-title.ltk-ag-done { text-decoration: line-through; color: var(--ltk-muted); }
.ltk-ag-prompt { font-size: 12.5px; color: var(--ltk-muted); line-height: 1.3; }
.ltk-ag-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.ltk-ag-link {
  font-size: 12px;
  color: var(--ltk-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}

/* right column: who, minutes, action count */
.ltk-ag-right {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  max-width: 38%;
  text-align: right;
}
.ltk-ag-who { font-size: 12.5px; font-weight: 600; color: var(--ltk-fg); overflow-wrap: anywhere; }
.ltk-ag-mins {
  font-size: 12px;
  font-weight: 700;
  color: var(--ltk-muted);
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 1px 8px;
}
/* actions column: a ⚑ count chip and/or a direct ＋ action button */
.ltk-ag-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  padding-top: 1px;
}
.ltk-ag-actionchip {
  border: 1px solid var(--ltk-hairline);
  background: none;
  color: var(--ltk-accent);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  padding: 2px 9px;
  cursor: pointer;
  white-space: nowrap;
}
.ltk-ag-actionchip:hover { border-color: var(--ltk-accent); }
/* the empty "＋ 0" state is deliberately quiet — an invitation, not a button */
.ltk-ag-actionchip-empty {
  color: var(--ltk-muted);
  font-weight: 600;
  opacity: 0.7;
}
.ltk-ag-actionchip-empty:hover { color: var(--ltk-accent); opacity: 1; }
.ltk-ag-row.ltk-readonly .ltk-ag-actionchip { cursor: pointer; }

/* link rows inside the agenda-item dialog */
.ltk-ag-linkrow { display: flex; gap: 8px; align-items: center; }
.ltk-ag-linkrow .ltk-input { flex: 1; min-width: 0; }
.ltk-ag-linkrow-del {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  flex: none;
}
.ltk-ag-linkrow-del:hover { background: var(--ltk-hairline); color: var(--ltk-fg); }
`;
