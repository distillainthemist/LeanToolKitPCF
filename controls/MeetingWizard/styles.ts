// MeetingWizard stylesheet — a stepper form. Numbered step pills across the
// top, one step's fields in the body, Back/Next (or Create) along the foot.

export const WIZARD_CSS = `
/* ---- stepper header ---- */
.ltk-mw-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--ltk-hairline);
  flex: 0 0 auto;
}
.ltk-mw-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: var(--ltk-muted);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  cursor: pointer;
}
.ltk-mw-step:disabled { cursor: default; opacity: 0.5; }
.ltk-mw-step-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid var(--ltk-hairline);
  font-size: 10.5px;
  font-weight: 700;
}
.ltk-mw-step-current { color: var(--ltk-fg); font-weight: 600; }
.ltk-mw-step-current .ltk-mw-step-n {
  background: var(--ltk-accent);
  border-color: var(--ltk-accent);
  color: #fff;
}
.ltk-mw-step-done .ltk-mw-step-n { border-color: var(--ltk-accent); color: var(--ltk-accent); }

/* ---- body + fields ---- */
.ltk-mw-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px;
}
/* one centred column keeps the form composed at any host width */
.ltk-mw-form {
  width: 100%;
  max-width: 620px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* the app-filled Meeting board step wants the full width + real height */
.ltk-mw-form:has(> .ltk-mw-boardhost) { max-width: none; }
.ltk-mw-boardhost {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: max(420px, 62vh);
  min-height: 0;
}
.ltk-mw-row { display: flex; flex-direction: column; gap: 4px; }
.ltk-mw-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
}
.ltk-mw-input {
  font: inherit;
  font-size: 13.5px;
  color: var(--ltk-fg);
  background: var(--ltk-bg);
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 8px 10px;
  width: 100%;
}
.ltk-mw-input:focus { outline: 2px solid var(--ltk-accent); outline-offset: -1px; }
.ltk-mw-textarea { min-height: 72px; resize: vertical; }
.ltk-mw-help { font-size: 12px; color: var(--ltk-muted); }

/* chips (CSV editor) */
.ltk-mw-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 6px 8px;
}
.ltk-mw-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 999px;
  padding: 2px 4px 2px 10px;
}
.ltk-mw-chip-x {
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 999px;
}
.ltk-mw-chip-x:hover { color: var(--ltk-accent); }
.ltk-mw-chip-add {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  font: inherit;
  font-size: 12.5px;
  background: transparent;
  color: var(--ltk-fg);
  padding: 4px 2px;
}

/* weekday toggles */
.ltk-mw-days { display: flex; flex-wrap: wrap; gap: 6px; }
.ltk-mw-day {
  font: inherit;
  font-size: 12.5px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-muted);
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
}
.ltk-mw-day-on {
  background: var(--ltk-accent);
  border-color: var(--ltk-accent);
  color: #fff;
}

/* participants — selected list on top, searchable roster below */
.ltk-mw-people { display: flex; flex-direction: column; gap: 4px; }
.ltk-mw-person {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--ltk-hairline);
  border-radius: 8px;
  padding: 6px 10px;
}
.ltk-mw-person-name { flex: 1; min-width: 0; font-size: 13px; }
.ltk-mw-person-crew { padding: 4px 8px; font-size: 12px; width: auto; max-width: 170px; }
.ltk-mw-person-x {
  flex: none;
  border: none;
  background: none;
  color: var(--ltk-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 999px;
}
.ltk-mw-person-x:hover { color: var(--ltk-accent); }
.ltk-mw-result {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}
.ltk-mw-result:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-mw-result-add { flex: none; font-weight: 700; color: var(--ltk-muted); }
.ltk-mw-result:hover .ltk-mw-result-add { color: var(--ltk-accent); }
.ltk-mw-result-crew { flex: none; font-size: 11.5px; color: var(--ltk-muted); }
.ltk-mw-people-count {
  font-size: 12px;
  color: var(--ltk-muted);
  padding: 2px 10px;
}

/* topic rotation rows (cadence step) */
.ltk-mw-topic-ordinal {
  flex: 0 0 84px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
}

/* review */
.ltk-mw-review {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltk-mw-review-line { display: flex; gap: 12px; font-size: 13px; }
.ltk-mw-review-k {
  flex: 0 0 130px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ltk-muted);
  padding-top: 2px;
}
.ltk-mw-review-v { flex: 1; min-width: 0; line-height: 1.45; }

/* ---- footer ---- */
.ltk-mw-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--ltk-hairline);
  flex: 0 0 auto;
}
.ltk-mw-foot-gap { flex: 1; }
.ltk-mw-btn {
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--ltk-hairline);
  background: var(--ltk-bg);
  color: var(--ltk-fg);
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
}
.ltk-mw-btn:hover { border-color: var(--ltk-accent); color: var(--ltk-accent); }
.ltk-mw-btn:disabled { opacity: 0.5; cursor: default; }
.ltk-mw-btn-primary {
  background: var(--ltk-accent);
  border-color: var(--ltk-accent);
  color: #fff;
}
.ltk-mw-btn-primary:hover { color: #fff; opacity: 0.92; }
`;
