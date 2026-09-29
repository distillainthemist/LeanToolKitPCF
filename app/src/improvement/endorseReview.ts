// The endorser's review (2026-09-30): the actions on an initiative whose
// work is done, each with Endorse and Send back. One decision at a time,
// saved as it is made; the list stays open to work through. Data in,
// callbacks out.

import { el } from "../../../shared/ui/dom";
import { LtkAction } from "../../../shared/schema/actions";
import { endorse, sendBack } from "../../../shared/schema/actionEndorsement";

export interface EndorseReviewOpts {
  host: HTMLElement;
  initiativeTitle: string;
  actions: LtkAction[];
  by: { whoId: string; who: string };
  /** Saves the action just decided. */
  onDecided: (changed: LtkAction[]) => Promise<void>;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export function openEndorseReview(o: EndorseReviewOpts): void {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal");
  overlay.appendChild(box);
  o.host.appendChild(overlay);
  box.appendChild(el("div", "app-modal-title", "Actions awaiting endorsement"));
  box.appendChild(el("div", "app-modal-note", `${o.initiativeTitle}. The work on each is done. Endorse it to close it, or send it back with what still needs doing.`));
  const list = el("div", "app-er-list");
  box.appendChild(list);
  if (o.actions.length === 0) list.appendChild(el("div", "app-cp-muted", "Nothing is waiting."));

  for (const a of o.actions) {
    const row = el("div", "app-er-row");
    row.appendChild(el("div", "app-er-title", a.issue !== "" ? a.issue : a.description));
    if (a.issue !== "" && a.description !== "") row.appendChild(el("div", "app-er-meta", a.description));
    const who = a.assignees.map((x) => x.who).filter((n) => n !== "").join(", ");
    row.appendChild(el("div", "app-er-meta", [who !== "" ? who : "Unassigned", a.due !== "" ? `due ${a.due}` : "", a.comments.length > 0 ? `💬 ${a.comments.length}` : ""].filter((s) => s !== "").join(" · ")));
    const last = a.comments[a.comments.length - 1];
    if (last) row.appendChild(el("div", "app-er-meta", `“${last.text}” — ${last.who ?? "someone"}`));
    const btns = el("div", "app-er-btns");
    const back = btn("Send back…", "app-btn app-ib-gatebtn");
    const ok = btn("Endorse", "app-btn app-btn-primary app-ib-gatebtn");
    const settle = async (label: string, colour: string, apply: () => void) => {
      back.disabled = true;
      ok.disabled = true;
      apply();
      const out = el("span", "app-er-outcome", "Saving…");
      btns.replaceChildren(out);
      try {
        await o.onDecided([a]);
        out.textContent = label;
        out.style.color = colour;
        row.classList.add("app-er-row-done");
      } catch (e) {
        out.textContent = `That could not be saved: ${e instanceof Error ? e.message : String(e)}`;
        out.style.color = "#b3261e";
      }
    };
    ok.addEventListener("click", () => void settle("✓ Endorsed", "#1f7a3f", () => endorse(a, o.by, new Date().toISOString())));
    back.addEventListener("click", () => {
      // the reason is asked for in place, under the action it is about
      const reason = el("textarea", "app-input app-er-reason") as HTMLTextAreaElement;
      reason.rows = 2;
      reason.placeholder = "What still needs doing";
      reason.setAttribute("aria-label", "Why it is being sent back");
      const err = el("span", "app-cp-err", "");
      const cancel = btn("Cancel", "app-link");
      const go = btn("Send back", "app-btn app-btn-danger app-ib-gatebtn");
      cancel.addEventListener("click", () => {
        reason.remove();
        btns.replaceChildren(back, ok);
      });
      go.addEventListener("click", () => {
        const why = reason.value.trim();
        if (why === "") {
          err.textContent = "A reason is needed.";
          reason.focus();
          return;
        }
        reason.remove();
        void settle("↩ Sent back", "#7a4d00", () => sendBack(a, o.by, new Date().toISOString(), why));
      });
      row.insertBefore(reason, btns);
      btns.replaceChildren(err, cancel, go);
      reason.focus();
    });
    btns.append(back, ok);
    row.appendChild(btns);
    list.appendChild(row);
  }

  const footer = el("div", "app-modal-footer");
  const close = btn("Close", "app-btn");
  close.addEventListener("click", () => overlay.remove());
  footer.appendChild(close);
  box.appendChild(footer);
}
