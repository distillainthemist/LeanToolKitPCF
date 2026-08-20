// Improvement — the escalation dialog (P6; the document-control notify
// panel's anatomy: removable recipient chips, an editable message, send
// by Teams or email with the outcome reported in place). Escalating
// FLAGS first, then notifies — a send failure must never read as the
// escalation failing.

import { el, clear } from "../../../shared/ui/dom";

export interface EscalateRecipient {
  name: string;
  email: string;
}

export interface EscalateDialogOpts {
  host: HTMLElement;
  initiativeTitle: string;
  orgLine: string;
  recipients: EscalateRecipient[];
  link: string;
  /** Applies the flag + event; runs before any send. */
  onEscalate: (note: string) => Promise<void>;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export function openEscalateDialog(o: EscalateDialogOpts): void {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal");
  overlay.appendChild(box);
  o.host.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  box.appendChild(el("div", "app-modal-title", "Escalate to sponsor"));
  box.appendChild(el("div", "app-modal-note", "This marks the initiative escalated (red) and notifies the sponsor. Say what you need."));

  let recips = [...o.recipients];
  const chips = el("div", "app-docs-pplchips");
  const paintChips = () => {
    clear(chips);
    for (const p of recips) {
      const chip = el("span", "app-docs-pplchip");
      chip.appendChild(el("span", "", p.name));
      const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
      off.type = "button";
      off.addEventListener("click", () => {
        recips = recips.filter((x) => x !== p);
        paintChips();
      });
      chip.appendChild(off);
      chips.appendChild(chip);
    }
    if (recips.length === 0) chips.appendChild(el("span", "app-field-hint", "No sponsor with an email — the flag still applies."));
  };
  paintChips();
  const fieldLabel = el("div", "app-field-label", "Notify");
  box.append(fieldLabel, chips);

  const msg = el("textarea", "app-input") as HTMLTextAreaElement;
  msg.rows = 3;
  msg.placeholder = "e.g. two fitters for one shift";
  const msgField = el("div", "app-field");
  msgField.append(el("span", "app-field-label", "What you need"), msg);
  box.appendChild(msgField);

  const outLine = el("div", "app-field-hint", "");
  box.appendChild(outLine);

  const footer = el("div", "app-modal-footer");
  const cancel = btn("Cancel", "app-link");
  cancel.addEventListener("click", close);
  const mailBtn = btn("Escalate & email");
  const teamsBtn = btn("Escalate & send Teams", "app-btn app-btn-primary");
  const run = (kind: "teams" | "email") => {
    void (async () => {
      const note = msg.value.trim();
      if (note === "") {
        outLine.textContent = "Say what you need — the sponsor sees it.";
        msg.focus();
        return;
      }
      teamsBtn.disabled = true;
      mailBtn.disabled = true;
      cancel.textContent = "Close";
      outLine.textContent = "Escalating…";
      await o.onEscalate(note);
      if (recips.length === 0) {
        outLine.textContent = "✓ Escalated. Nobody to notify.";
        return;
      }
      outLine.textContent = "✓ Escalated. Sending…";
      try {
        const { sendNotifyTeams, sendNotifyEmail } = await import("../docs/notify");
        const subject = `Escalated: ${o.initiativeTitle}`;
        const body = `${o.orgLine}: ${note}`;
        const r = kind === "teams" ? await sendNotifyTeams(recips, subject, body, o.link) : await sendNotifyEmail(recips, subject, body, o.link);
        outLine.textContent =
          r.error === ""
            ? `✓ Escalated and sent by ${r.how === "card" ? "Teams card" : r.how === "message" ? "Teams message" : "email"} to ${recips.length} ${recips.length === 1 ? "person" : "people"}.`
            : `✓ Escalated — but not sent: ${r.error.slice(0, 200)}`;
      } catch (e) {
        outLine.textContent = `✓ Escalated — but not sent: ${e instanceof Error ? e.message : String(e)}`;
      }
    })();
  };
  teamsBtn.addEventListener("click", () => run("teams"));
  mailBtn.addEventListener("click", () => run("email"));
  footer.append(cancel, mailBtn, teamsBtn);
  box.appendChild(footer);
  msg.focus();
}
