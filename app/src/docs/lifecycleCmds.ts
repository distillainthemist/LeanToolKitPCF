// Standard Documents — lifecycle command execution (Phase 5B).
//
// One dialog and one write sequence for all four commands. The sequence
// is the cookbook's, verbatim: check-out → connector term object for
// the status column → check-in carrying the command's comment (approve
// is the one MAJOR check-in — the version an auditor reads). Loaded on
// demand: commands are rare next to reads, so their bytes are in
// nobody's chunk until a stage button is pressed.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { poolPeopleSource } from "./accessGates";
import {
  LifecycleCommandDef,
  formatDateForLocale,
  spErrorText,
  validateItemErrors,
} from "./model";
import { DocRow } from "./rows";
import {
  checkInFile,
  checkOutFile,
  connectorPatchItem,
  fetchFileVersions,
  fetchRegionalSettings,
  restoreFileVersion,
  undoCheckOut,
  validateUpdateListItem,
} from "./sp";

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
  /** The actor's standing comes from an edit-access GRANT (5G3) — an
   *  Access-denied check-out then gets the propagation explanation
   *  instead of a bare refusal (Ben's first grantee run, 2026-08-06). */
  actingAsEditor?: boolean;
  /** Styled dialog host (.app-dlghost). */
  host: HTMLElement;
  /** Submit-for-review only: lets the submitter add reviewers via
   *  people search (Ben, 2026-08-04); additions are WRITTEN to the
   *  reviewers column before the status moves, so the circulation and
   *  the column always agree. */
  reviewersPicker?: {
    internal: string;
    existing: { email: string; name: string }[];
  };
  /** 5G3, the owner's Approve only: every edit-access grant on the
   *  document ends with the cycle it was granted for. The Revision
   *  editors column clears under the same check-out (before the major);
   *  after the check-in the memberships/ledger release — best effort,
   *  warned, never fatal to an approve that already landed. */
  grantRelease?: {
    internal: string;
    emails: string[];
  };
  /** Called after the command lands, so the screen can re-read the row
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
      command.staysCheckedOut === true
        ? `Checks the document out to you and sets it to “${opts.targetTerm.label}”. ` +
            "Everyone else keeps seeing the approved version until you submit; " +
            "Discard check-out abandons the revision entirely."
        : `Sets the status to “${opts.targetTerm.label}”` +
            (command.major ? " and records a MAJOR version." : ".")
    )
  );

  // additional reviewers (submit-for-review): the app's one people
  // pattern — debounced search, chips to remove. 5G1: reviewers are a
  // POOL role, so the search is the owners & approvers group's members
  // when the pool is readable, all of Entra (with a hint) otherwise.
  const added: { email: string; name: string }[] = [];
  if (opts.reviewersPicker !== undefined) {
    const source = poolPeopleSource();
    const existing = opts.reviewersPicker.existing;
    if (existing.length > 0) {
      dlg.body.appendChild(
        el("div", "app-field-hint", `Reviewers: ${existing.map((p) => p.name).join(", ")}`)
      );
    }
    const chips = el("div", "app-docs-pplchips");
    const search = el("input", "app-input") as HTMLInputElement;
    search.placeholder = "Add reviewers…";
    const hitsBox = el("div", "app-docs-pplhits");
    void source.then((s) => {
      if (s.restricted) search.placeholder = "Add reviewers from the owners & approvers group…";
      else if (s.hint !== "") dlg.body.appendChild(el("div", "app-field-hint", s.hint));
    });
    const paintChips = () => {
      clear(chips);
      for (const p of added) {
        const chip = el("span", "app-docs-pplchip");
        chip.appendChild(el("span", "", p.name));
        const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
        off.addEventListener("click", () => {
          added.splice(added.indexOf(p), 1);
          paintChips();
        });
        chip.appendChild(off);
        chips.appendChild(chip);
      }
      chips.style.display = added.length > 0 ? "" : "none";
    };
    paintChips();
    let seq = 0;
    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      const q = search.value.trim();
      if (q === "") {
        clear(hitsBox);
        return;
      }
      timer = window.setTimeout(() => {
        const mine = ++seq;
        void source.then((s) => s.search(q)).then(
          (hits) => {
            if (mine !== seq) return;
            clear(hitsBox);
            const taken = new Set(
              [...existing, ...added].map((p) => p.email.toLowerCase())
            );
            for (const h of hits.filter((x) => x.mail !== "").slice(0, 6)) {
              if (taken.has(h.mail.toLowerCase())) continue;
              const rowBtn = el("button", "app-docs-pplhit") as HTMLButtonElement;
              rowBtn.type = "button";
              rowBtn.append(
                el("span", "app-docs-pplhitname", h.displayName),
                el("span", "app-field-hint", h.mail)
              );
              rowBtn.addEventListener("click", () => {
                added.push({ email: h.mail, name: h.displayName });
                search.value = "";
                clear(hitsBox);
                paintChips();
              });
              hitsBox.appendChild(rowBtn);
            }
          },
          () => {}
        );
      }, 350);
    });
    dlg.body.append(chips, search, hitsBox);
  }

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
      // held by the acting user from earlier work is fine — the
      // sequence continues; held by someone else is a real refusal
      const already = /checked out/i.test(spErrorText(out.status));
      if (!already) {
        // a freshly granted editor hitting Access denied is almost
        // always GROUP PROPAGATION, not a broken grant — say so
        const denied = /access denied|unauthorized/i.test(spErrorText(out.status));
        const what =
          opts.actingAsEditor === true && denied
            ? "Could not check out — your editor access was granted but SharePoint may " +
              "still be propagating the group membership (try again in a few minutes; " +
              "if it persists, an admin should confirm the editors group has edit " +
              "rights on this library)"
            : "Could not check out";
        return fail(what, out.status);
      }
    }

    // additions to the reviewers column go in FIRST, under the same
    // check-out, claims-key format (the cookbook's person rule)
    const rp = opts.reviewersPicker;
    if (rp !== undefined && added.length > 0) {
      status.textContent = "Adding reviewers…";
      const everyone = [...rp.existing, ...added];
      const res = await timed(
        validateUpdateListItem(
          site,
          opts.listId,
          row.id,
          [
            {
              FieldName: rp.internal,
              FieldValue: JSON.stringify(
                everyone.map((p) => ({ Key: `i:0#.f|membership|${p.email.trim().toLowerCase()}` }))
              ),
            },
          ],
          false
        ),
        "The reviewers write"
      );
      const errs = validateItemErrors(res.data);
      if (!res.ok || errs.length > 0) {
        return fail(
          "Adding reviewers was refused (the document stays checked out)",
          errs.map((e) => `${e.field}: ${e.message}`).join("; ") || res.status
        );
      }
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

    // the grant dies with the cycle (5G3): clear the Revision editors
    // column inside the same check-out, so the approved major carries
    // no live grant. An empty claims array is the forms engine's
    // "nobody" for a person field.
    const gr = opts.grantRelease;
    const releasing =
      gr !== undefined && command.key === "approve" && command.to === "approved" && gr.emails.length > 0;
    if (releasing) {
      status.textContent = "Ending edit-access grants…";
      const cleared = await timed(
        validateUpdateListItem(
          site,
          opts.listId,
          row.id,
          [{ FieldName: gr.internal, FieldValue: "[]" }],
          false
        ),
        "The grant clear"
      );
      const errs = validateItemErrors(cleared.data);
      if (!cleared.ok || errs.length > 0) {
        return fail(
          "Ending edit access was refused (the document stays checked out)",
          errs.map((e) => `${e.field}: ${e.message}`).join("; ") || cleared.status
        );
      }
    }

    // Start revision ENDS here: the draft status and everything after
    // it live inside the check-out — nothing is published until a
    // submit checks in
    if (command.staysCheckedOut === true) {
      dlg.close();
      opts.onDone();
      return;
    }

    status.textContent = "Checking in…";
    const cin = await timed(
      checkInFile(site, row.serverUrl, comment, command.major),
      "Check-in"
    );
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Check-in was refused (the document stays checked out)", cin.status);
    }

    // the approve LANDED — membership/ledger release is cleanup, warned
    // but never fatal (the orphaned-editors health check is the net)
    if (releasing && gr !== undefined) {
      // when a warning holds the dialog open, its buttons must say so:
      // the command is DONE, so "Cancel" becomes "Close" and the
      // primary action hides (Ben, 2026-08-06)
      const warnState = () => {
        const closeBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
        if (closeBtn !== null) closeBtn.textContent = "Close";
        goBtn.style.display = "none";
        running = false;
      };
      status.textContent = "Releasing editor access…";
      try {
        const { releaseGrants } = await import("./accessRequests");
        const warn = await releaseGrants(row.uniqueId, gr.emails);
        if (warn !== "") {
          status.textContent = `Approved. ${warn}`;
          status.classList.add("app-docs-addstatus-warn");
          warnState();
          opts.onDone();
          return; // leave the dialog open so the warning is read
        }
      } catch (e) {
        status.textContent = `Approved. Editor membership was not released: ${spErrorText(
          e instanceof Error ? e.message : String(e)
        ).slice(0, 200)} — Access diagnostics will flag it.`;
        status.classList.add("app-docs-addstatus-warn");
        warnState();
        opts.onDone();
        return;
      }
    }

    dlg.close();
    opts.onDone();
  };
}

// ---- Cancel revision ---------------------------------------------------
// Abandoning a revision AFTER circulation began: minor drafts are
// checked in and cannot be un-published by a discard, so the last
// approved MAJOR (N.0) is restored instead — content and status
// together, with the abandoned drafts left in history where an audit
// can read them (Ben, 2026-08-04).

export interface CancelRevisionOpts {
  site: string;
  row: DocRow;
  host: HTMLElement;
  /** The holder's check-out (if the acting user's) is discarded first. */
  heldByMe: boolean;
  /** 5G3: grants die with the cycle they were granted for. The restore
   *  itself reverts the Revision editors column (the approved major
   *  predates the grant); memberships/ledger release afterwards. */
  grantRelease?: { emails: string[] };
  onDone: () => void;
}

export function openCancelRevision(opts: CancelRevisionOpts): void {
  const { site, row } = opts;
  let running = false;

  const dlg = openDialog({
    host: opts.host,
    title: `Cancel revision — ${row.name}`,
    buttons: [
      { label: "Keep revising", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Cancel revision", kind: "danger", onClick: () => void run() },
    ],
  });
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      "Restores the last approved version — content and status together. The abandoned " +
        "drafts stay in the version history."
    )
  );
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
  };

  const run = async () => {
    if (running) return;
    running = true;
    status.classList.remove("app-docs-addstatus-warn");

    if (opts.heldByMe) {
      status.textContent = "Discarding your check-out…";
      const undo = await timed(undoCheckOut(site, row.serverUrl), "Discard");
      if (!undo.ok && !/not checked out/i.test(spErrorText(undo.status))) {
        return fail("Could not discard the check-out", undo.status);
      }
    }

    status.textContent = "Finding the last approved version…";
    const vers = await timed(fetchFileVersions(site, row.serverUrl), "The version read");
    const rows = Array.isArray((vers.data as { value?: unknown[] })?.value)
      ? ((vers.data as { value: unknown[] }).value as Record<string, unknown>[])
      : [];
    const majors = rows
      .map((v) => String(v.VersionLabel ?? ""))
      .filter((l) => /^\d+\.0$/.test(l))
      .sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]));
    if (majors.length === 0) {
      return fail(
        "Nothing to restore",
        "This document has no approved (major) version in its history."
      );
    }

    status.textContent = `Restoring version ${majors[0]}…`;
    const restored = await timed(
      restoreFileVersion(site, row.serverUrl, majors[0]),
      "The restore"
    );
    if (!restored.ok) return fail("The restore was refused", restored.status);

    // the restore reverted the grant COLUMN (the approved major
    // predates it); memberships and ledger entries release here
    if (opts.grantRelease !== undefined && opts.grantRelease.emails.length > 0) {
      status.textContent = "Releasing editor access…";
      try {
        const { releaseGrants } = await import("./accessRequests");
        const warn = await releaseGrants(row.uniqueId, opts.grantRelease.emails);
        if (warn !== "") {
          status.textContent = `Revision cancelled. ${warn}`;
          status.classList.add("app-docs-addstatus-warn");
          // done — nothing left to cancel or keep revising
          const keepBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
          if (keepBtn !== null) keepBtn.textContent = "Close";
          const goBtn2 = dlg.root.querySelector(".ltk-btn-danger") as HTMLButtonElement | null;
          if (goBtn2 !== null) goBtn2.style.display = "none";
          running = false;
          opts.onDone();
          return;
        }
      } catch {
        /* the orphaned-editors health check is the net */
      }
    }

    dlg.close();
    opts.onDone();
  };
}

// ---- Mark reviewed (Phase 5C) ------------------------------------------
// The review-due queue's own command: a periodic review WITHOUT content
// change. Stamps the next review date (the forms engine takes dates in
// the site's regional format only — cookbook rule) and checks in with
// the comment an auditor expects to find.

export interface MarkReviewedOpts {
  site: string;
  listId: string;
  row: DocRow;
  /** The next-review-date column's internal name. */
  reviewInternal: string;
  host: HTMLElement;
  onDone: () => void;
}

export function openMarkReviewed(opts: MarkReviewedOpts): void {
  const { site, row } = opts;
  let running = false;

  const dlg = openDialog({
    host: opts.host,
    title: `Mark reviewed — ${row.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Mark reviewed", kind: "primary", onClick: () => void run() },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;

  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      "Records a periodic review with no content change: the next review date is set " +
        "and the version history gains the review comment."
    )
  );
  const dateInput = el("input", "app-input") as HTMLInputElement;
  dateInput.type = "date";
  // the default cadence: a year from today, local date parts
  const next = new Date(Date.now() + 365 * 86400000);
  dateInput.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  const note = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
  note.rows = 2;
  note.placeholder = "Comment (optional)";
  dlg.body.append(
    el("div", "app-field-label", "Next review date"),
    dateInput,
    el("div", "app-field-label", "Comment"),
    note
  );
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  const sync = () => {
    goBtn.disabled = running || dateInput.value === "";
  };
  dateInput.addEventListener("input", sync);
  sync();

  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
    sync();
  };

  const run = async () => {
    if (running || dateInput.value === "") return;
    running = true;
    sync();
    status.classList.remove("app-docs-addstatus-warn");

    status.textContent = "Reading the site's date format…";
    const regional = await timed(fetchRegionalSettings(site), "The regional settings read");
    const localeId = Number(((regional.data ?? {}) as { LocaleId?: unknown }).LocaleId ?? 0) || 1033;

    status.textContent = "Taking the check-out…";
    const out = await timed(checkOutFile(site, row.serverUrl), "Check-out");
    if (!out.ok && !/checked out/i.test(spErrorText(out.status))) {
      return fail("Could not check out", out.status);
    }

    status.textContent = "Setting the next review date…";
    const res = await timed(
      validateUpdateListItem(
        site,
        opts.listId,
        row.id,
        [{ FieldName: opts.reviewInternal, FieldValue: formatDateForLocale(dateInput.value, localeId) }],
        false
      ),
      "The date write"
    );
    const errs = validateItemErrors(res.data);
    if (!res.ok || errs.length > 0) {
      return fail(
        "The date write was refused (the document stays checked out)",
        errs.map((e) => `${e.field}: ${e.message}`).join("; ") || res.status
      );
    }

    status.textContent = "Checking in…";
    const extra = note.value.trim();
    const comment = extra !== "" ? `Periodic review — no changes — ${extra}` : "Periodic review — no changes";
    const cin = await timed(checkInFile(site, row.serverUrl, comment, false), "Check-in");
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Check-in was refused (the document stays checked out)", cin.status);
    }

    dlg.close();
    opts.onDone();
  };
}
