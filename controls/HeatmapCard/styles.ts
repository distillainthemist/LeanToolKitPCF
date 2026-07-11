// HeatmapCard stylesheet. Pin colours are set inline (Safari rule).

export const HEATMAP_CSS = `
.ltk-hm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 8px 12px 12px;
}

/* ---- issues listing (right column) ---- */
.ltk-hm-list {
  flex: 0 0 190px;
  min-width: 150px;
  max-width: 40%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 2px;
}
.ltk-hm-list-empty {
  color: var(--ltk-muted);
  font-size: 12px;
  padding: 6px 4px;
}
.ltk-hm-listitem {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ltk-hm-listitem.ltk-hm-hi,
.ltk-hm-listitem:hover {
  background: var(--ltk-hairline);
  border-color: var(--ltk-accent);
}
.ltk-hm-listnum {
  flex: 0 0 auto;
  min-width: 20px;
  height: 20px;
  border-radius: 999px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}
.ltk-hm-listnote {
  font-size: 12.5px;
  line-height: 1.25;
  color: var(--ltk-fg);
  overflow-wrap: anywhere;
}

/* ---- right: image stage ---- */
.ltk-hm-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltk-hm-stage {
  flex: 1;
  min-height: 120px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.ltk-hm-imgwrap {
  position: relative;
}
.ltk-hm-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--ltk-hairline);
  cursor: crosshair;
}
.ltk-hm-img.ltk-readonly { cursor: default; }
.ltk-hm-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  cursor: grab;
  padding: 0 3px;
  transition: box-shadow 100ms ease;
}
.ltk-hm-pin:hover { filter: brightness(1.1); }
.ltk-hm-pin.ltk-hm-dragging { cursor: grabbing; }
.ltk-hm-pin.ltk-hm-hi {
  transform: translate(-50%, -50%) scale(1.4);
  box-shadow: 0 0 0 3px var(--ltk-accent), 0 1px 6px rgba(0,0,0,0.4);
  z-index: 5;
}
.ltk-hm-pin.ltk-readonly { cursor: default; }
.ltk-hm-hint {
  font-size: 11px;
  color: var(--ltk-muted);
}
.ltk-hm-noimg {
  color: var(--ltk-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
`;
