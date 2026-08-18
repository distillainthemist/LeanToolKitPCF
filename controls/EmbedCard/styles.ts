// EmbedCard stylesheet — a persistent iframe filling the body, a refresh
// button (in the title bar when there is one, floating over the frame when
// not), and a thin loading veil while the frame (re)loads.

export const EMBED_CSS = `
.ltk-em-main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.ltk-em-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
}

/* ---- commentary pane (configured headings -> notes + actions) ---- */
.ltk-em-aside {
  flex: 0 0 300px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--ltk-hairline);
  overflow-y: auto;
  padding: 10px 12px 12px;
  gap: 4px;
}
.ltk-em-fmtbar { display: flex; gap: 4px; padding-bottom: 4px; }
.ltk-em-fmt {
  font: inherit; font-size: 12.5px; width: 26px; height: 24px; line-height: 1;
  border: 1px solid var(--ltk-hairline); border-radius: 6px;
  background: var(--ltk-bg); color: var(--ltk-muted); cursor: pointer;
}
.ltk-em-fmt:nth-child(1) { font-weight: 700; }
.ltk-em-fmt:nth-child(2) { font-style: italic; }
.ltk-em-fmt:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-em-notes { display: flex; flex-direction: column; gap: 4px; }
.ltk-em-h {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--ltk-muted); margin-top: 8px;
}
.ltk-em-note {
  min-height: 44px; font-size: 13px; line-height: 1.45;
  border: 1px solid var(--ltk-hairline); border-radius: 6px;
  padding: 6px 8px; background: var(--ltk-bg); color: var(--ltk-fg);
  outline: none; overflow-wrap: break-word;
}
.ltk-em-note:focus { border-color: var(--ltk-accent); }
.ltk-em-note[contenteditable="false"] { background: color-mix(in srgb, var(--ltk-fg) 3%, transparent); }
.ltk-em-note ul, .ltk-em-note ol { margin: 4px 0; padding-left: 18px; }
.ltk-em-acts { display: flex; flex-direction: column; gap: 6px; margin-top: auto; padding-top: 10px; }
.ltk-em-addact { align-self: flex-start; }

/* tile mode (shared .ltk-tile contract): the commentary pane is readable on
   a tile, but its authoring chrome is not — formatting toolbar, add-action
   and the frame refresh are all authoring, not content */
.ltk-tile .ltk-em-fmtbar,
.ltk-tile .ltk-em-addact,
.ltk-tile .ltk-em-refresh { display: none !important; }
.ltk-em-noacts { font-size: 12.5px; color: var(--ltk-muted); }

/* actions chip (no-pane mode): sits left of the open/refresh chips */
.ltk-em-actchip {
  position: absolute;
  top: 8px;
  right: 108px;
  z-index: 3;
  font: inherit;
  font-size: 12.5px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
}
.ltk-em-actchip:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-em-notitle .ltk-em-actchip { right: 82px; opacity: 0.85; }
.ltk-em-frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--ltk-bg);
}

/* refresh: pinned top-right; translucent chip when floating over the frame */
.ltk-em-refresh {
  position: absolute;
  top: 8px;
  right: 34px; /* clear of the kebab slot */
  z-index: 3;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 15px;
  line-height: 1;
  padding: 5px 9px;
  cursor: pointer;
}
.ltk-em-refresh:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-em-notitle .ltk-em-refresh { right: 8px; opacity: 0.85; }
.ltk-em-refresh:disabled { opacity: 0.4; cursor: default; }

/* open-in-new-tab: sits just left of refresh, same chip styling */
.ltk-em-open {
  position: absolute;
  top: 8px;
  right: 68px; /* left of the refresh chip */
  z-index: 3;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 15px;
  line-height: 1;
  padding: 5px 9px;
  cursor: pointer;
  text-decoration: none;
}
.ltk-em-open:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-em-notitle .ltk-em-open { right: 42px; opacity: 0.85; }

/* present-in-window chip: left of open-in-tab, same chip styling */
.ltk-em-pop {
  position: absolute;
  top: 8px;
  right: 102px; /* left of the open chip */
  z-index: 3;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 6px;
  font-size: 15px;
  line-height: 1;
  padding: 5px 9px;
  cursor: pointer;
}
.ltk-em-pop:hover { color: var(--ltk-accent); border-color: var(--ltk-accent); }
.ltk-em-notitle .ltk-em-pop { right: 76px; opacity: 0.85; }
.ltk-tile .ltk-em-pop { display: none !important; }

/* present mode: the body is a launch panel, never a frame */
.ltk-em-present {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
  background: var(--ltk-bg);
  z-index: 2;
}
.ltk-em-present-title { font-size: 16px; font-weight: 700; }
.ltk-em-present-text { font-size: 13px; color: var(--ltk-muted); max-width: 420px; }
.ltk-em-present-row { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
.ltk-em-present-btn {
  border: none;
  background: var(--ltk-accent);
  color: #fff;
  border-radius: 8px;
  padding: 10px 18px;
  font: inherit;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  min-height: 44px;
}
.ltk-em-present-sec {
  border: 1px solid var(--ltk-hairline);
  background: none;
  color: var(--ltk-fg);
  border-radius: 8px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
  min-height: 44px;
}
.ltk-tile .ltk-em-present-row { display: none; }

.ltk-em-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* the "not showing?" hint: a slim bar BELOW the frame area (a sibling, so
   the host's fixed persistent frame cannot cover it) */
.ltk-em-hint {
  flex: 0 0 auto;
  margin: 6px 8px 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  background: var(--ltk-bg);
  box-shadow: 0 2px 10px rgba(0,0,0,0.12);
  font-size: 12.5px;
}
.ltk-em-hint-text { flex: 1 1 260px; color: var(--ltk-fg); }
.ltk-em-hint-btn {
  border: none; background: var(--ltk-accent); color: #fff;
  border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer;
}
.ltk-em-hint-link {
  border: none; background: none; color: var(--ltk-accent);
  font: inherit; text-decoration: underline; cursor: pointer; padding: 4px;
}
.ltk-em-hint-x {
  border: none; background: none; color: var(--ltk-muted);
  font: inherit; font-size: 14px; cursor: pointer; padding: 4px 6px;
}
.ltk-em-hint-detail {
  flex: 1 1 100%;
  color: var(--ltk-muted);
  display: flex; flex-direction: column; gap: 4px;
  padding-top: 4px; border-top: 1px dashed var(--ltk-hairline);
}
.ltk-tile .ltk-em-hint { display: none !important; }

/* loading veil: covers the frame while a (re)load is in flight */
.ltk-em-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--ltk-muted);
  background: color-mix(in srgb, var(--ltk-bg) 72%, transparent);
  pointer-events: none;
  opacity: 0;
  transition: opacity 150ms ease;
}
.ltk-em-loading.ltk-em-on { opacity: 1; }
`;
