// Stylesheet for the Fishbone control, bundled into the JS and injected at
// runtime. Canvas apps sometimes fail to load a PCF's separate CSS resource
// (it works in the harness and model-driven apps), so shipping the styles
// inside the bundle guarantees hover states, cursors and typography everywhere.

export const FISHBONE_CSS = `
.fb-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 420px;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 12px;
  color: #1b1b1b;
  background: #ffffff;
  border: 1px solid #d9d9d9;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}

/* ---------- read-only badge (floats over the stage) ---------- */
.fb-ro-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 5;
  padding: 2px 8px;
  background: #ffe6cc;
  color: #8a4b00;
  border: 1px solid #f0b070;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}

/* ---------- stage / svg ---------- */
.fb-stage {
  flex: 1 1 auto;
  overflow: hidden;
  background: #fdfdfd;
}
.fb-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ---------- spine & head ---------- */
.fb-spine {
  stroke-width: 3.5;
  stroke-linecap: round;
}
.fb-head-box {
  stroke-width: 2;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.12));
}
.fb-head-cap {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.fb-head-text {
  font-size: 14px;
  font-weight: 600;
}
.fb-placeholder {
  fill: #9aa7b3;
  font-style: italic;
  font-weight: 400;
}

/* ---------- bones ---------- */
.fb-bone-line {
  stroke-width: 2.25;
  stroke-linecap: round;
}
/* wide invisible strip along the bone — click anywhere on it to add a cause */
.fb-bone-hit {
  stroke: transparent;
  stroke-width: 18;
  stroke-linecap: round;
}
.fb-bone-hit:hover ~ .fb-add .fb-add-circle,
.fb-add.fb-clickable:hover .fb-add-circle {
  fill: var(--fb-diagram, #1b1b1b);
}
.fb-bone-hit:hover ~ .fb-add .fb-add-plus,
.fb-add.fb-clickable:hover .fb-add-plus {
  stroke: #ffffff;
}
.fb-cat-label {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.fb-cat-label.fb-clickable:hover {
  text-decoration: underline;
}

/* refined add button: outlined circle that fills on hover */
.fb-add-circle {
  fill: #ffffff;
  stroke: var(--fb-diagram, #1b1b1b);
  stroke-width: 1.75;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.15));
  transition: fill 0.12s ease;
}
.fb-add-plus {
  fill: none;
  stroke: var(--fb-diagram, #1b1b1b);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke 0.12s ease;
}
.fb-add-hidden {
  display: none;
}

/* ---------- causes / chips ---------- */
.fb-leader {
  stroke: #c9cdd1;
  stroke-width: 1.25;
}
.fb-chip-box {
  stroke-width: 1.5;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.1));
}
.fb-chip-text {
  font-size: 12px;
  font-weight: 500;
}
.fb-vote-badge {
  opacity: 0.9;
}
.fb-vote-text {
  fill: #fff;
  font-size: 10px;
  font-weight: 700;
}
.fb-status-glyph {
  font-size: 12px;
  font-weight: 800;
}
.fb-chip.fb-clickable:hover .fb-chip-box {
  stroke-width: 2.5;
}

/* ---------- drag & drop ---------- */
.fb-chip.fb-dragging {
  opacity: 0.75;
}
.fb-bone-line.fb-drop-target {
  stroke-width: 4.5;
}

/* ---------- interactivity ---------- */
.fb-clickable {
  cursor: pointer;
}
.fb-readonly .fb-clickable {
  cursor: default;
}

/* ---------- dialog ---------- */
.fb-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.fb-dialog {
  width: 320px;
  max-width: 90%;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  padding: 16px;
  box-sizing: border-box;
}
.fb-dialog-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #1b1b1b;
}
.fb-field-label {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  margin: 10px 0 4px;
}
.fb-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
}
.fb-input:focus {
  outline: none;
  border-color: #0a5ca8;
  box-shadow: 0 0 0 2px rgba(10, 92, 168, 0.15);
}
.fb-textarea {
  resize: vertical;
  min-height: 56px;
}

.fb-vote-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.fb-char-count {
  font-size: 11px;
  color: #8a8a8a;
  text-align: right;
  margin-top: 3px;
}
.fb-char-count-max {
  color: #d13438;
  font-weight: 600;
}
.fb-vote-input {
  width: 70px;
  text-align: center;
}
.fb-step {
  width: 30px;
  padding: 6px 0;
  font-weight: 700;
}

/* segmented status control (on-state colours applied inline from inputs) */
.fb-seg {
  display: flex;
  gap: 6px;
}
.fb-seg-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 4px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #f7f7f7;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: #666;
  cursor: pointer;
}
.fb-seg-btn.fb-seg-on {
  font-weight: 700;
}

.fb-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.fb-footer-left {
  margin-right: auto;
}
.fb-btn {
  padding: 6px 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.fb-btn:hover {
  background: #f0f0f0;
}
.fb-btn-primary {
  background: #0a5ca8;
  border-color: #084a86;
  color: #fff;
}
.fb-btn-primary:hover {
  background: #084a86;
}
.fb-btn-danger {
  border-color: #d13438;
  color: #d13438;
}
.fb-btn-danger:hover {
  background: #fde7e7;
}
`;
