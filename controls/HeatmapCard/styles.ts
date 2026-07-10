// HeatmapCard stylesheet. Pin colours are set inline (Safari rule).

export const HEATMAP_CSS = `
.ltk-hm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
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
  max-width: 100%;
  max-height: 100%;
}
.ltk-hm-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
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
  cursor: pointer;
  padding: 0 3px;
}
.ltk-hm-pin:hover { filter: brightness(1.1); }
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
