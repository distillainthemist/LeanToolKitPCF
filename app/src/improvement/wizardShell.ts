// The meeting wizard's shell, reusable (design review 11a: "admins learn
// one flow, not two"): accent title bar · numbered step strip with ✓ on
// done steps · a 620px centred column with a step title and one-line
// purpose · footer ‹ Back · Step n of N · Next: <label> › (or the final
// primary). Same CSS classes as the MeetingWizard control, so it reads
// identically; the steps' bodies are the caller's.

import { el, clear, ensureStylesheet } from "../../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../../shared/ui/baseCss";
import { WIZARD_CSS } from "../../../controls/MeetingWizard/styles";
import { applyThemeVars, Theme } from "../../../shared/tokens";
import { parsePrompts, renderTitleBar } from "../../../shared/ui/chrome";

export interface WizardStepDef {
  key: string;
  label: string;
  description: string;
  render: (form: HTMLElement) => void;
  /** Forward navigation blocked while this returns a message. */
  blocker?: () => string | null;
}

export interface WizardShellOpts {
  host: HTMLElement;
  title: string;
  theme: Theme;
  steps: WizardStepDef[];
  finalLabel: string;
  onFinal: () => void;
  startKey?: string;
}

export interface WizardShell {
  /** Re-render the current step (after model edits that change the UI). */
  refresh: () => void;
  goTo: (key: string) => void;
  current: () => string;
  destroy: () => void;
}

export function createWizardShell(o: WizardShellOpts): WizardShell {
  ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
  ensureStylesheet("ltk-meetingwizard-css", WIZARD_CSS);
  const root = el("div", "ltk-root");
  o.host.appendChild(root);
  let stepKey = o.startKey ?? o.steps[0]?.key ?? "";

  const render = () => {
    clear(root);
    applyThemeVars(root, o.theme);
    renderTitleBar(root, o.title, parsePrompts(""));
    let idx = o.steps.findIndex((s) => s.key === stepKey);
    if (idx === -1) idx = 0;
    const step = o.steps[idx];
    const head = el("div", "ltk-mw-steps");
    o.steps.forEach((s, i) => {
      const dot = el("button", "ltk-mw-step") as HTMLButtonElement;
      dot.type = "button";
      dot.append(el("span", "ltk-mw-step-n", i < idx ? "✓" : String(i + 1)), el("span", "ltk-mw-step-label", s.label));
      if (i === idx) {
        dot.classList.add("ltk-mw-step-current");
        dot.setAttribute("aria-current", "step");
      }
      if (i < idx) dot.classList.add("ltk-mw-step-done");
      dot.addEventListener("click", () => {
        if (i > idx) {
          const why = blockerUpTo(i);
          if (why) {
            flash(why);
            return;
          }
        }
        stepKey = s.key;
        render();
      });
      head.appendChild(dot);
    });
    root.appendChild(head);
    const body = el("div", "ltk-mw-body");
    root.appendChild(body);
    const form = el("div", "ltk-mw-form");
    body.appendChild(form);
    form.appendChild(el("div", "ltk-mw-stephead", step.label));
    form.appendChild(el("div", "ltk-mw-stepdesc", step.description));
    step.render(form);
    const foot = el("div", "ltk-mw-foot");
    if (idx > 0) {
      const back = el("button", "ltk-mw-btn", "‹ Back") as HTMLButtonElement;
      back.type = "button";
      back.addEventListener("click", () => {
        stepKey = o.steps[idx - 1].key;
        render();
      });
      foot.appendChild(back);
    }
    foot.appendChild(el("span", "ltk-mw-foot-gap"));
    foot.appendChild(el("span", "ltk-mw-stepcount", `Step ${idx + 1} of ${o.steps.length}`));
    foot.appendChild(el("span", "ltk-mw-foot-gap"));
    const note = el("span", "ltk-mw-help app-tw-flash", "");
    if (idx < o.steps.length - 1) {
      const next = el("button", "ltk-mw-btn ltk-mw-btn-primary", `Next: ${o.steps[idx + 1].label} ›`) as HTMLButtonElement;
      next.type = "button";
      next.addEventListener("click", () => {
        const why = step.blocker?.() ?? null;
        if (why) {
          flash(why);
          return;
        }
        stepKey = o.steps[idx + 1].key;
        render();
      });
      foot.append(note, next);
    } else {
      const fin = el("button", "ltk-mw-btn ltk-mw-btn-primary", o.finalLabel) as HTMLButtonElement;
      fin.type = "button";
      fin.addEventListener("click", () => {
        const why = blockerUpTo(o.steps.length);
        if (why) {
          flash(why);
          return;
        }
        o.onFinal();
      });
      foot.append(note, fin);
    }
    root.appendChild(foot);
    function flash(msg: string) {
      note.textContent = msg;
      note.classList.add("app-tw-flash-on");
      setTimeout(() => note.classList.remove("app-tw-flash-on"), 2500);
    }
  };
  const blockerUpTo = (untilIdx: number): string | null => {
    for (let i = 0; i < untilIdx && i < o.steps.length; i++) {
      const why = o.steps[i].blocker?.() ?? null;
      if (why) return `${o.steps[i].label}: ${why}`;
    }
    return null;
  };

  render();
  return {
    refresh: render,
    goTo: (key) => {
      stepKey = key;
      render();
    },
    current: () => stepKey,
    destroy: () => root.remove(),
  };
}
