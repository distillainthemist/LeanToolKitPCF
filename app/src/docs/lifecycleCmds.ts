// Standard Documents — lifecycle command execution (Phase 5B).
//
// One dialog and one write sequence for all four commands. The sequence
// is the cookbook's, verbatim: check-out → connector term object for
// the status column → check-in carrying the command's comment (approve
// is the one MAJOR check-in — the version an auditor reads). Loaded on
// demand: commands are rare next to reads, so their bytes are in
// nobody's chunk until a stage button is pressed.

import { el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { LifecycleCommandDef, spErrorText } from "./model";
import { DocRow } from "./rows";
import { checkInFile, checkOutFile, connectorPatchItem } from "./sp";

export interface LifecycleRunOpts {
  site: string;
  listId: string;
  row: DocRow;
  command: LifecycleCommandDef;
  /** The term the command writes — resolved by the SCREEN from the
   *  lifecycle mapping, so this module never guesses. */
  targetTerm: { id: string; label: string };
  /** The status column's internal name. */
  statusInternal: string;
  /** Who is acting — approve's comment names them. */
  actorName: string;
  /** Styled dialog host (.app-dlghost). */
  host: HTMLElement;
  /** Called after the check-in lands, so the screen can re-read the row
   *  and the tasks badge. */
  onDone: () => void;
}

type Sp = { ok: boolean; status: string; data: unknown };

const timed = async (p: Promise<Sp>, what: string): Promise<Sp> => {
  let clock = 0;
  const timeout = new Promise<Sp>((resolve) => {
    clock = window.setTimeout(
      () =>
        resolve({ ok: false, status: `${what} did not answer within 25 seconds`, data: null }),
      25_000
    );
  });
  const r = await Promise.race([p, timeout]);
  window.clearTimeout(clock);
  return r;
};

export function openLifecycleCommand(opts: LifecycleRunOpts): void {
  const { site, row, command } = opts;
  let running = false;

  const dlg = openDialog({
    host: opts.host,
    title: `${command.label} — ${row.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      {
        label: command.label,
        kind: "primary",
        onClick: () => void run(),
      },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;

  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      `Sets the status to “${opts.targetTerm.label}”` +
        (command.major ? " and records a MAJOR version." : ".")
    )
  );
  const reason = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
  reason.rows = 2;
  reason.placeholder = command.needsReason
    ? "Why is revision needed? (required)"
    : "Comment (optional)";
  dlg.body.append(el("div", "app-field-label", "Comment"), reason);
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  const sync = () => {
    goBtn.disabled = running || (command.needsReason && reason.value.trim() === "");
  };
  reason.addEventListener("input", sync);
  sync();
  reason.focus();

  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
    sync();
  };

  const run = async () => {
    if (running || (command.needsReason && reason.value.trim() === "")) return;
    running = true;
    sync();
    status.classList.remove("app-docs-addstatus-warn");

    // approve's comment names the approver — the version history is the
    // audit trail, and "Approved" without a who explains nothing
    const base =
      command.key === "approve" && opts.actorName !== ""
        ? `${command.comment} by ${opts.actorName}`
        : command.comment;
    const note = reason.value.trim();
    const comment = note !== "" ? `${base} — ${note}` : base;

    status.textContent = "Taking the check-out…";
    const out = await timed(checkOutFile(site, row.serverUrl), "Check-out");
    if (!out.ok) {
      // held by the acting user from earlier work is fine; held by
      // ANYONE on a minute-old… no — this is an existing document, so
      // someone else's check-out is a real refusal, reported as such
      const already = /checked out/i.test(spErrorText(out.status));
      if (!already) return fail("Could not check out", out.status);
    }

    status.textContent = "Writing the status…";
    const patch = await timed(
      connectorPatchItem(site, opts.listId, row.id, {
        [opts.statusInternal]: {
          Value: opts.targetTerm.label,
          TermGuid: opts.targetTerm.id,
          WssId: -1,
        },
      }),
      "The status write"
    );
    if (!patch.ok) {
      return fail("The status write was refused (the document stays checked out)", patch.status);
    }

    status.textContent = "Checking in…";
    const cin = await timed(
      checkInFile(site, row.serverUrl, comment, command.major),
      "Check-in"
    );
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Check-in was refused (the document stays checked out)", cin.status);
    }

    dlg.close();
    opts.onDone();
  };
}
