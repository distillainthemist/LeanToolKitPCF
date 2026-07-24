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
