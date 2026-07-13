// EmbedCard stylesheet — a persistent iframe filling the body, a refresh
// button (in the title bar when there is one, floating over the frame when
// not), and a thin loading veil while the frame (re)loads.

export const EMBED_CSS = `
.ltk-em-body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
}
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
