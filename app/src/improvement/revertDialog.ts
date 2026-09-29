// Improvement — revert to an earlier stage / reopen (2026-09-29). The
// escalation dialog's anatomy: what happens in words, the stage to return
// to, a REQUIRED reason, an optional new target date, removable recipient
// chips, send by Teams or email with the outcome in place. The revert is
// applied FIRST, then the people whose sign-off it undoes are told — a
// send failure must never read as the revert failing.

import { el, clear } from "../../../shared/ui/dom";
import { dayLabel } from "../linkTitle";
import type { EscalateRecipient } from "./escalate";
import type { RevertTarget } from "./stageRevert";

export interface RevertDialogOpts {
  host: HTMLElement;
  initiativeTitle: string;
  /** Reopening a completed initiative (wording only). */
  completed: boolean;
  /** Where it stands now ("Do", or "Complete"). */
  fromName: string;
  /** Earliest first; the last is the default (one step back). */
  targets: RevertTarget[];
  /** Preselect this stage (the rail's "Revert to this stage…"). */
  preselect?: string;
  /** stage id → its current target date (ISO). */
  targetDates: Record<string, string>;
  /** Who is told for a given stage: the approvers undone, the sponsor. */
  recipientsFor: (toStageId: string) => EscalateRecipient[];
  /** The message's opening line for a given stage. */
  lineFor: (toName: string) => string;
  link: string;
  /** Applies the move + the log entry; runs before any send. */
  onRevert: (toStageId: string, reason: string, newTarget: string) => Promise<void>;
  /** The send road (the docs notify module by default; a harness stubs it). */
  send?: (kind: "teams" | "email", to: EscalateRecipient[], subject: string, body: string, link: string) => Promise<{ error: string; how: string }>;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export function openRevertDialog(o: RevertDialogOpts): void {
  if (o.targets.length === 0) return;
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal");
  overlay.appendChild(box);
  o.host.appendChild(overlay);
  const close = () => overlay.remove();
  const verb = o.completed ? "Reopen" : "Revert";
  const done = o.completed ? "Reopened" : "Reverted";

  box.appendChild(el("div", "app-modal-title", o.completed ? "Reopen this initiative" : "Revert to an earlier stage"));
  box.appendChild(
    el(
      "div",
      "app-modal-note",
      `${o.completed ? "It returns to the stage you choose." : `It moves back from ${o.fromName}.`} Card content, gate snapshots and history are kept. Moving forward again passes each gate afresh.`
    )
  );

  // the stage to return to
  const stageSel = el("select", "app-input") as HTMLSelectElement;
  for (const t of o.targets) {
    const opt = el("option", undefined, `${t.index + 1}. ${t.name}`) as HTMLOptionElement;
    opt.value = t.id;
    stageSel.appendChild(opt);
  }
  stageSel.value = o.preselect && o.targets.some((t) => t.id === o.preselect) ? o.preselect : o.targets[o.targets.length - 1].id;
  const stageField = el("div", "app-field");
  stageField.append(el("span", "app-field-label", "Return to"), stageSel);
  box.appendChild(stageField);

  const reason = el("textarea", "app-input") as HTMLTextAreaElement;
  reason.rows = 3;
  reason.placeholder = "e.g. the trial data covered one shift only";
  const reasonField = el("div", "app-field");
  reasonField.append(el("span", "app-field-label", "Why"), reason);
  box.appendChild(reasonField);

  const date = el("input", "app-input") as HTMLInputElement;
  date.type = "date";
  const dateLabelEl = el("span", "app-field-label", "");
  const dateHint = el("span", "app-field-hint", "");
  const dateField = el("div", "app-field");
  dateField.append(dateLabelEl, date, dateHint);
  box.appendChild(dateField);

  let recips: EscalateRecipient[] = [];
  const chips = el("div", "app-docs-pplchips");
  const paintChips = () => {
    clear(chips);
    for (const p of recips) {
      const chip = el("span", "app-docs-pplchip");
      chip.appendChild(el("span", "", p.name));
      const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
      off.type = "button";
      off.setAttribute("aria-label", `Do not notify ${p.name}`);
      off.addEventListener("click", () => {
        recips = recips.filter((x) => x !== p);
        paintChips();
      });
      chip.appendChild(off);
      chips.appendChild(chip);
    }
    if (recips.length === 0) chips.appendChild(el("span", "app-field-hint", "Nobody to notify — the revert still applies."));
  };
  box.append(el("div", "app-field-label", "Notify"), chips);

  const stageName = () => o.targets.find((t) => t.id === stageSel.value)?.name ?? "";
  const syncStage = () => {
    const cur = o.targetDates[stageSel.value] ?? "";
    dateLabelEl.textContent = `New target date for ${stageName()} (optional)`;
    dateHint.textContent = cur !== "" ? `Currently ${dayLabel(cur)}. Leave blank to keep it.` : "None set. Leave blank to keep it that way.";
    recips = o.recipientsFor(stageSel.value);
    paintChips();
  };
  stageSel.addEventListener("change", syncStage);
  syncStage();

  const outLine = el("div", "app-field-hint", "");
  box.appendChild(outLine);

  const footer = el("div", "app-modal-footer");
  const cancel = btn("Cancel", "app-link");
  cancel.addEventListener("click", close);
  const mailBtn = btn(`${verb} & email`);
  const teamsBtn = btn(`${verb} & send Teams`, "app-btn app-btn-primary");
  const run = (kind: "teams" | "email") => {
    void (async () => {
      const why = reason.value.trim();
      if (why === "") {
        outLine.textContent = "Say why — it goes on the record and to the people notified.";
        reason.focus();
        return;
      }
      const toId = stageSel.value;
      const toName = stageName();
      teamsBtn.disabled = true;
      mailBtn.disabled = true;
      stageSel.disabled = true;
      reason.disabled = true;
      date.disabled = true;
      cancel.textContent = "Close";
      outLine.textContent = o.completed ? "Reopening…" : "Reverting…";
      try {
        await o.onRevert(toId, why, date.value);
      } catch (e) {
        outLine.textContent = `That could not be saved: ${e instanceof Error ? e.message : String(e)}`;
        teamsBtn.disabled = false;
        mailBtn.disabled = false;
        stageSel.disabled = false;
        reason.disabled = false;
        date.disabled = false;
        cancel.textContent = "Cancel";
        return;
      }
      if (recips.length === 0) {
        outLine.textContent = `✓ ${done} to ${toName}. Nobody to notify.`;
        return;
      }
      outLine.textContent = `✓ ${done} to ${toName}. Sending…`;
      try {
        const send =
          o.send ??
          (async (k, to, subject, body, link) => {
            const { sendNotifyTeams, sendNotifyEmail } = await import("../docs/notify");
            return k === "teams" ? sendNotifyTeams(to, subject, body, link) : sendNotifyEmail(to, subject, body, link);
          });
        const r = await send(kind, recips, `${done} to ${toName}: ${o.initiativeTitle}`, `${o.lineFor(toName)}: ${why}`, o.link);
        outLine.textContent =
          r.error === ""
            ? `✓ ${done} to ${toName} and sent by ${r.how === "card" ? "Teams card" : r.how === "message" ? "Teams message" : "email"} to ${recips.length} ${recips.length === 1 ? "person" : "people"}.`
            : `✓ ${done} to ${toName} — but not sent: ${r.error.slice(0, 200)}`;
      } catch (e) {
        outLine.textContent = `✓ ${done} to ${toName} — but not sent: ${e instanceof Error ? e.message : String(e)}`;
      }
    })();
  };
  teamsBtn.addEventListener("click", () => run("teams"));
  mailBtn.addEventListener("click", () => run("email"));
  footer.append(cancel, mailBtn, teamsBtn);
  box.appendChild(footer);
  reason.focus();
}
