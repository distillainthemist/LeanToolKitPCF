// The "Let the next step know" panel (N2/N3) — one builder for every
// done-state that offers it: lifecycle commands and the 5G access
// dialogs. Pure DOM here; the connector transport loads by dynamic
// import only when a send button is clicked, so notification bytes
// stay out of every dialog that never sends one.

import { clear, el } from "../../../shared/ui/dom";
import { spErrorText } from "./model";
import { NotifyContext, NotifyRecipient } from "./notifyModel";

/**
 * Appends the panel to `body`. Returns false (and appends nothing)
 * when nobody is left to notify — the caller then closes its dialog
 * as it always did. The caller owns its own button relabelling.
 */
export function attachNotifyPanel(opts: {
  body: HTMLElement;
  context: NotifyContext;
  /** Extra recipients the dialog itself collected (added reviewers). */
  extra?: NotifyRecipient[];
  /** The typed reason — appended to the editable message, because the
   *  dialog is the only party that has it. */
  reason?: string;
}): boolean {
  const n = opts.context;
  const seen = new Set(n.recipients.map((p) => p.email.toLowerCase()));
  let recips: NotifyRecipient[] = [
    ...n.recipients,
    ...(opts.extra ?? []).filter((p) => !seen.has(p.email.toLowerCase())),
  ];
  if (recips.length === 0) return false;

  const box = el("div", "app-docs-notifybox");
  opts.body.appendChild(box);
  box.appendChild(el("div", "app-field-label", "Let the next step know"));
  const chips = el("div", "app-docs-pplchips");
  const paintChips = () => {
    clear(chips);
    for (const p of recips) {
      const chip = el("span", "app-docs-pplchip");
      chip.appendChild(el("span", "", p.name));
      const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
      off.addEventListener("click", () => {
        recips = recips.filter((x) => x !== p);
        paintChips();
      });
      chip.appendChild(off);
      chips.appendChild(chip);
    }
    chips.style.display = recips.length > 0 ? "" : "none";
  };
  paintChips();
  const msg = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
  msg.rows = 4;
  const typed = (opts.reason ?? "").trim();
  msg.value = n.message + (typed !== "" ? `\n\nReason given: ${typed}` : "");
  const outLine = el("div", "app-field-hint");
  const teamsBtn = el(
    "button",
    "app-btn app-btn-primary",
    "Send Teams message"
  ) as HTMLButtonElement;
  const mailBtn = el("button", "app-btn", "Send email") as HTMLButtonElement;
  const btnRow = el("div", "app-docs-siterow");
  btnRow.append(teamsBtn, mailBtn);
  const send = (kind: "teams" | "email") => {
    void (async () => {
      if (recips.length === 0) {
        outLine.textContent = "Nobody left to notify.";
        return;
      }
      teamsBtn.disabled = true;
      mailBtn.disabled = true;
      outLine.textContent = "Sending…";
      try {
        const { sendNotifyEmail, sendNotifyTeams } = await import("./notify");
        const r =
          kind === "teams"
            ? await sendNotifyTeams(recips, n.subject, msg.value, n.link)
            : await sendNotifyEmail(recips, n.subject, msg.value, n.link);
        if (r.error === "") {
          const label =
            r.how === "card" ? "Teams card" : r.how === "message" ? "Teams message" : "email";
          outLine.textContent = `✓ Sent by ${label} to ${recips.length} ${
            recips.length === 1 ? "person" : "people"
          }.`;
          btnRow.remove();
          msg.disabled = true;
          return;
        }
        // the ACTION already succeeded — a send failure must never read
        // as its failure, so it reports here, in its own line
        outLine.textContent = `Not sent: ${spErrorText(r.error).slice(0, 250)} — the change itself is done.`;
      } catch (e) {
        outLine.textContent = `Not sent: ${spErrorText(
          e instanceof Error ? e.message : String(e)
        ).slice(0, 250)} — the change itself is done.`;
      }
      teamsBtn.disabled = false;
      mailBtn.disabled = false;
    })();
  };
  teamsBtn.addEventListener("click", () => send("teams"));
  mailBtn.addEventListener("click", () => send("email"));
  box.append(
    chips,
    msg,
    el("div", "app-field-hint", "Sent as you, with a link that opens the document in LeanBoard."),
    btnRow,
    outLine
  );
  return true;
}
