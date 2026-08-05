// Request edit access (5G2) — the road onto a controlled standard for
// someone who is not named on it. The REQUEST lives in an app-side
// ledger (a read-only requester can write nothing in SharePoint); the
// GRANT it leads to is the "Revision editors" column plus temporary
// editors-group membership (5G3). Label deliberately avoids "Request
// revision", which is the send-it-back-to-draft command.
//
// The ledger is one row — ben_listid "__requests__" in the doc-library
// table, NEVER the "__app__" config row, so a request write cannot
// clobber configuration (measured writable by an ordinary user, 5G0).
// It is last-write-wins, so every mutation here re-reads, merges, and
// VERIFIES its entry landed (one retry) — two simultaneous writers can
// still race, but entries are tiny, per-document-per-person, and a lost
// write is a re-request, not corruption.

import { el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { Ben_ltkdoclibrariesService } from "../generated/services/Ben_ltkdoclibrariesService";
import { eq, firstWhere, upsertWhere } from "../store/dv";
import { addMember, groupMembers, removeMember } from "../store/accessGroup";
import { REQUESTS_LIST_ID, spErrorText, validateItemErrors } from "./model";
import { DocRow } from "./rows";
import {
  addSiteGroupUser,
  checkInFile,
  checkOutFile,
  fetchFieldSchema,
  fetchSiteGroupByName,
  removeSiteGroupUser,
  validateUpdateListItem,
} from "./sp";
import { appDocsConfig } from "./docsStore";

// one source of truth with the library reads that must SKIP this row
const REQUESTS_ROW = REQUESTS_LIST_ID;

export interface AccessRequest {
  /** `${uniqueId}:${whoId}` — one live request per document per person. */
  id: string;
  listId: string;
  itemId: number;
  uniqueId: string;
  /** Document name at request time (display only). */
  name: string;
  who: { id: string; name: string; email: string };
  /** The owner column's emails at request time — routes the queue. */
  owners: string[];
  reason: string;
  /** ISO timestamp. */
  when: string;
  declined?: { by: string; reason: string; when: string };
  /** Set on approval (5G3): the entry BECOMES the live grant record —
   *  the ledger doubles as the grant registry, so a person granted on
   *  two documents keeps their editors-group seat until the LAST grant
   *  ends, and "orphaned editors" is a precise health question. */
  granted?: { by: string; when: string };
  /** The requester has SEEN the granted outcome — until then it counts
   *  on their tasks badge (news that never highlights never reaches
   *  anyone, Ben 2026-08-06). */
  seen?: boolean;
}

/** Stamp outcomes as seen — called when the panel paints them. */
export async function markSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  await mutateLedger(
    (all) => all.map((e) => (set.has(e.id) ? { ...e, seen: true } : e)),
    (all) => all.filter((e) => set.has(e.id)).every((e) => e.seen === true)
  );
}

export const requestId = (uniqueId: string, whoId: string): string =>
  `${uniqueId.trim().toLowerCase()}:${whoId}`;

// ---- ledger transport (5G0-measured) -----------------------------------

export async function readLedger(): Promise<AccessRequest[]> {
  const row = await firstWhere(
    Ben_ltkdoclibrariesService.getAll,
    eq("ben_listid", REQUESTS_ROW)
  );
  const raw = (row?.ben_configjson ?? "").trim();
  if (!raw.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter(isRequest)
      : [];
  } catch {
    return [];
  }
}

function isRequest(v: unknown): v is AccessRequest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.uniqueId === "string";
}

export async function writeLedger(entries: AccessRequest[]): Promise<void> {
  await upsertWhere(
    Ben_ltkdoclibrariesService,
    eq("ben_listid", REQUESTS_ROW),
    (row) => row.ben_ltkdoclibraryid ?? "",
    {
      ben_listid: REQUESTS_ROW,
      ben_name: "Access requests ledger",
      ben_configjson: JSON.stringify(entries),
    }
  );
}

/** Re-read → transform → write → VERIFY (one retry). The check function
 *  answers "did my change land" against a fresh read. */
async function mutateLedger(
  transform: (entries: AccessRequest[]) => AccessRequest[],
  landed: (entries: AccessRequest[]) => boolean
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await writeLedger(transform(await readLedger()));
    if (landed(await readLedger())) return;
  }
  throw new Error("the ledger write did not land (a concurrent change kept winning) — try again");
}

export async function submitRequest(req: AccessRequest): Promise<void> {
  await mutateLedger(
    (all) => [...all.filter((e) => e.id !== req.id), req],
    (all) => all.some((e) => e.id === req.id && e.declined === undefined)
  );
}

export async function removeRequest(id: string): Promise<void> {
  await mutateLedger(
    (all) => all.filter((e) => e.id !== id),
    (all) => !all.some((e) => e.id === id)
  );
}

export async function declineRequest(
  id: string,
  by: string,
  reason: string
): Promise<void> {
  const stamp = { by, reason, when: new Date().toISOString() };
  await mutateLedger(
    (all) => all.map((e) => (e.id === id ? { ...e, declined: stamp } : e)),
    (all) => all.some((e) => e.id === id && e.declined !== undefined)
  );
}

/** This user's request for this document, if any. */
export async function myRequestFor(
  uniqueId: string,
  whoId: string
): Promise<AccessRequest | null> {
  const all = await readLedger();
  return all.find((e) => e.id === requestId(uniqueId, whoId)) ?? null;
}

// ---- the grant lifecycle (5G3) -----------------------------------------

const sameDoc = (e: AccessRequest, uniqueId: string): boolean =>
  e.uniqueId.trim().toLowerCase() === uniqueId.trim().toLowerCase();

/**
 * End the grants on one document for the given people: their ledger
 * entries go, and their editors-group seat goes UNLESS another live
 * grant elsewhere still needs it. Returns a warning ("" = clean) —
 * callers surface it but never fail the command that already landed.
 */
const claimsLogin = (email: string): string =>
  `i:0#.f|membership|${email.trim().toLowerCase()}`;

/** Resolve the SP editors site group's id (0 = not configured/found). */
async function siteEditorsGroupId(cfg: {
  siteUrl: string;
  spEditorsGroup: string;
}): Promise<number> {
  if (cfg.spEditorsGroup === "" || cfg.siteUrl === "") return 0;
  const g = await fetchSiteGroupByName(cfg.siteUrl, cfg.spEditorsGroup);
  return g.ok ? Number(((g.data ?? {}) as { Id?: unknown }).Id ?? 0) : 0;
}

export async function releaseGrants(uniqueId: string, emails: string[]): Promise<string> {
  const lower = new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e !== ""));
  if (lower.size === 0) return "";
  await mutateLedger(
    (all) => all.filter((e) => !(sameDoc(e, uniqueId) && lower.has(e.who.email.toLowerCase()))),
    (all) => !all.some((e) => sameDoc(e, uniqueId) && lower.has(e.who.email.toLowerCase()))
  );
  const cfg = await appDocsConfig();
  const stillGranted = new Set(
    (await readLedger())
      .filter((e) => e.granted !== undefined)
      .map((e) => e.who.email.toLowerCase())
  );
  const failed: string[] = [];

  // the SITE group's seat (the instant route, 5G3b) — removing a
  // non-member is SharePoint's "does not exist" refusal, a fine outcome
  const gid = await siteEditorsGroupId(cfg).catch(() => 0);
  if (gid > 0) {
    for (const email of lower) {
      if (stillGranted.has(email)) continue; // another live grant keeps the seat
      const r = await removeSiteGroupUser(cfg.siteUrl, gid, claimsLogin(email));
      if (!r.ok && !/does not exist|not found/i.test(r.status)) failed.push(email);
    }
  }

  // the Entra group's seat (the fallback route, and any legacy grants)
  if (cfg.editorsGroupId !== "") {
    try {
      const members = await groupMembers(cfg.editorsGroupId);
      for (const email of lower) {
        if (stillGranted.has(email)) continue;
        const m = members.find((x) => x.email.toLowerCase() === email);
        if (m === undefined) continue; // never held a seat (or already gone)
        try {
          await removeMember(cfg.editorsGroupId, m.id);
        } catch {
          failed.push(email);
        }
      }
    } catch {
      failed.push("(the Entra editors group could not be read)");
    }
  }
  const who = [...new Set(failed)];
  return who.length === 0
    ? ""
    : `The editors seat was not released for ${who.join(", ")} — ` +
        "remove them in SharePoint/Entra, or Access diagnostics will flag the drift.";
}

/** A tiny timeout wrapper matching lifecycleCmds' — a grant step that
 *  hangs must become a visible failure, not a stuck dialog. */
type Sp = { ok: boolean; status: string; data: unknown };
const timedSp = async (p: Promise<Sp>, what: string): Promise<Sp> => {
  let clock = 0;
  const timeout = new Promise<Sp>((resolve) => {
    clock = window.setTimeout(
      () => resolve({ ok: false, status: `${what} did not answer within 25 seconds`, data: null }),
      25_000
    );
  });
  const r = await Promise.race([p, timeout]);
  window.clearTimeout(clock);
  return r;
};

const claimsFor = (emails: string[]): string =>
  JSON.stringify(
    emails.map((e) => ({ Key: `i:0#.f|membership|${e.trim().toLowerCase()}` }))
  );

export interface ApproveRequestOpts {
  site: string;
  request: AccessRequest;
  /** The document's LIVE row — approval needs its check-out door. */
  row: DocRow;
  /** The Revision editors column (mapped, or the caller doesn't offer
   *  approve at all). */
  revEditorsInternal: string;
  /** Current grantee emails from the column — the new grant appends. */
  existingEditors: string[];
  actorName: string;
  host: HTMLElement;
  onDone: () => void;
}

/**
 * The owner's one-step approval (5G0-proven): grant column written
 * under a check-out bracket (the authorization), editors-group seat
 * added (the physical ability), the ledger entry becomes the grant
 * record. Column first — if SharePoint refuses, nothing was granted.
 */
export function openApproveRequest(opts: ApproveRequestOpts): void {
  const { site, request, row } = opts;
  let running = false;
  const dlg = openDialog({
    host: opts.host,
    title: `Approve edit access — ${request.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Approve & grant", kind: "primary", onClick: () => void go() },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  // once the grant LANDED, the secondary button is no longer a cancel —
  // there is nothing left to cancel (Ben, 2026-08-06)
  const doneState = () => {
    const closeBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
    if (closeBtn !== null) closeBtn.textContent = "Close";
    goBtn.style.display = "none";
    running = false;
  };
  dlg.body.appendChild(
    el("div", "app-field-hint", `${request.who.name} asked: ${request.reason}`)
  );
  dlg.body.appendChild(
    el(
      "div",
      "app-settings-note",
      `Grants ${request.who.name} one revision cycle on this document — they can ` +
        "start the revision, check out, edit and submit. The grant ends " +
        "automatically when the revision is approved (or cancelled/revoked)."
    )
  );
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);
  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
    goBtn.disabled = false;
  };

  const go = async () => {
    if (running) return;
    running = true;
    goBtn.disabled = true;
    status.classList.remove("app-docs-addstatus-warn");

    // preflight: the grant column must exist ON THIS LIBRARY — a role
    // mapped in the dictionary can still name a column a given list
    // never received, and that must fail HERE with the remedy, not as
    // a bare refusal mid-write (Ben's first approve run, 2026-08-06)
    status.textContent = "Checking the grant column…";
    const schema = await timedSp(
      fetchFieldSchema(site, row.listId, opts.revEditorsInternal),
      "The column check"
    );
    if (!schema.ok) {
      return fail(
        `The Revision editors column ("${opts.revEditorsInternal}") is not on this library`,
        `add the column to the standards library (and re-open Settings → Documents so the library learns it), then approve again. SharePoint said: ${schema.status}`
      );
    }

    status.textContent = "Taking the check-out…";
    const out = await timedSp(checkOutFile(site, row.serverUrl), "Check-out");
    if (!out.ok && !/checked out/i.test(spErrorText(out.status))) {
      return fail("Could not check out", out.status);
    }

    status.textContent = "Writing the grant…";
    const everyone = [
      ...opts.existingEditors.filter(
        (e) => e.trim().toLowerCase() !== request.who.email.toLowerCase()
      ),
      request.who.email,
    ];
    const wrote = await timedSp(
      validateUpdateListItem(
        site,
        row.listId,
        row.id,
        [{ FieldName: opts.revEditorsInternal, FieldValue: claimsFor(everyone) }],
        false
      ),
      "The grant write"
    );
    const errs = validateItemErrors(wrote.data);
    if (!wrote.ok || errs.length > 0) {
      return fail(
        "The grant write was refused (the document stays checked out)",
        errs.map((e) => `${e.field}: ${e.message}`).join("; ") || wrote.status
      );
    }

    status.textContent = "Checking in…";
    const cin = await timedSp(
      checkInFile(
        site,
        row.serverUrl,
        `Edit access granted to ${request.who.name} by ${opts.actorName} — ${request.reason}`,
        false
      ),
      "Check-in"
    );
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Check-in was refused (the document stays checked out)", cin.status);
    }

    // the authorization is on the record — the seat and the ledger are
    // cleanup from here, warned but never a rollback. The SITE group is
    // the seat of choice (5G3b, measured 2026-08-06: plain-JSON add,
    // effective immediately); the Entra group is the fallback route,
    // which propagates slowly.
    let warn = "";
    let instant = false;
    status.textContent = "Granting access…";
    try {
      const cfg = await appDocsConfig();
      const gid = await siteEditorsGroupId(cfg);
      if (gid > 0) {
        const added = await addSiteGroupUser(
          cfg.siteUrl,
          gid,
          claimsLogin(request.who.email)
        );
        if (added.ok) instant = true;
        else {
          warn = `The site-group add was refused (${spErrorText(added.status).slice(
            0,
            160
          )}) — add them to ${cfg.spEditorsGroup} in SharePoint. `;
        }
      } else if (cfg.spEditorsGroup !== "") {
        warn = `The site group "${cfg.spEditorsGroup}" did not resolve — add them to it in SharePoint. `;
      } else if (cfg.editorsGroupId !== "") {
        await addMember(cfg.editorsGroupId, request.who.id);
      } else {
        warn = "No editors group is configured — the grant is app-only. ";
      }
    } catch (e) {
      warn = `The editors add was refused (${spErrorText(
        e instanceof Error ? e.message : String(e)
      ).slice(0, 160)}) — add them by hand. `;
    }
    try {
      await markGranted(request.id, opts.actorName);
    } catch {
      warn += "The ledger update did not land — the request may reappear. ";
    }

    if (warn !== "") {
      status.textContent = `Granted. ${warn}`;
      status.classList.add("app-docs-addstatus-warn");
      doneState();
      opts.onDone();
      return; // leave the warning readable
    }
    status.textContent = instant
      ? `Granted — effective immediately. ${request.who.name} can Start revision now.`
      : "Granted. SharePoint can take a few minutes to honour the new group " +
        "membership — the requester's first check-out may be refused until it lands.";
    doneState();
    opts.onDone();
  };
}

async function markGranted(id: string, by: string): Promise<void> {
  const stamp = { by, when: new Date().toISOString() };
  await mutateLedger(
    (all) => all.map((e) => (e.id === id ? { ...e, declined: undefined, granted: stamp } : e)),
    (all) => all.some((e) => e.id === id && e.granted !== undefined)
  );
}

export interface RevokeAccessOpts {
  site: string;
  row: DocRow;
  revEditorsInternal: string;
  /** Current grantees (emails + names for display). */
  editors: { email: string; name: string }[];
  actorName: string;
  host: HTMLElement;
  onDone: () => void;
}

/** The owner's early exit: clear the grant column under a check-out
 *  bracket, then release seats and ledger entries. */
export function openRevokeAccess(opts: RevokeAccessOpts): void {
  const { site, row } = opts;
  let running = false;
  const dlg = openDialog({
    host: opts.host,
    title: `Revoke edit access — ${row.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Revoke access", kind: "danger", onClick: () => void go() },
    ],
  });
  dlg.body.appendChild(
    el(
      "div",
      "app-settings-note",
      `Ends edit access for ${opts.editors.map((e) => e.name || e.email).join(", ")} — ` +
        "recorded in the version history."
    )
  );
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);
  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
  };

  const go = async () => {
    if (running) return;
    running = true;
    status.classList.remove("app-docs-addstatus-warn");

    status.textContent = "Taking the check-out…";
    const out = await timedSp(checkOutFile(site, row.serverUrl), "Check-out");
    if (!out.ok && !/checked out/i.test(spErrorText(out.status))) {
      return fail("Could not check out", out.status);
    }
    status.textContent = "Clearing the grant…";
    const wrote = await timedSp(
      validateUpdateListItem(
        site,
        row.listId,
        row.id,
        [{ FieldName: opts.revEditorsInternal, FieldValue: "[]" }],
        false
      ),
      "The grant clear"
    );
    const errs = validateItemErrors(wrote.data);
    if (!wrote.ok || errs.length > 0) {
      return fail(
        "The clear was refused (the document stays checked out)",
        errs.map((e) => `${e.field}: ${e.message}`).join("; ") || wrote.status
      );
    }
    status.textContent = "Checking in…";
    const cin = await timedSp(
      checkInFile(site, row.serverUrl, `Edit access revoked by ${opts.actorName}`, false),
      "Check-in"
    );
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Check-in was refused (the document stays checked out)", cin.status);
    }
    status.textContent = "Releasing editor access…";
    const warn = await releaseGrants(
      row.uniqueId,
      opts.editors.map((e) => e.email)
    ).catch(() => "The release did not finish — Access diagnostics will flag any drift.");
    if (warn !== "") {
      status.textContent = `Revoked. ${warn}`;
      status.classList.add("app-docs-addstatus-warn");
      // the revoke LANDED — nothing left to cancel
      const closeBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
      if (closeBtn !== null) closeBtn.textContent = "Close";
      const revokeBtn = dlg.root.querySelector(".ltk-btn-danger") as HTMLButtonElement | null;
      if (revokeBtn !== null) revokeBtn.style.display = "none";
      running = false;
      opts.onDone();
      return;
    }
    dlg.close();
    opts.onDone();
  };
}

// ---- dialogs -----------------------------------------------------------

export interface RequestAccessOpts {
  /** The document (a standard, approved) the requester wants to edit. */
  doc: { listId: string; itemId: number; uniqueId: string; name: string };
  owners: string[];
  viewer: { id: string; name: string; email: string };
  host: HTMLElement;
  /** An existing request by this user (pending or declined) — the
   *  dialog shows its state instead of a fresh form. */
  existing: AccessRequest | null;
  onChanged: () => void;
}

export function openRequestAccess(opts: RequestAccessOpts): void {
  const { existing } = opts;
  let running = false;

  // granted: the good news — the entry is the LIVE grant record, so
  // there is nothing to dismiss; it clears when the revision cycle ends
  if (existing !== null && existing.granted !== undefined) {
    const dlg = openDialog({
      host: opts.host,
      title: `Edit access granted — ${opts.doc.name}`,
      buttons: [{ label: "Close", kind: "primary", onClick: () => dlg.close() }],
    });
    dlg.body.appendChild(
      el(
        "div",
        "app-settings-note",
        `${existing.granted.by} granted you one revision cycle — Start revision is ` +
          "available on the document."
      )
    );
    return;
  }

  // declined: show the outcome, offer request-again (which replaces the
  // entry) or dismiss (which removes it)
  if (existing !== null && existing.declined !== undefined) {
    const d = existing.declined;
    const dlg = openDialog({
      host: opts.host,
      title: `Edit access declined — ${opts.doc.name}`,
      buttons: [
        { label: "Close", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Dismiss",
          kind: "secondary",
          onClick: () =>
            void removeRequest(existing.id).then(() => {
              dlg.close();
              opts.onChanged();
            }),
        },
        {
          label: "Request again…",
          kind: "primary",
          onClick: () => {
            dlg.close();
            openRequestAccess({ ...opts, existing: null });
          },
        },
      ],
    });
    dlg.body.appendChild(
      el("div", "app-settings-note", `${d.by} declined this request: ${d.reason}`)
    );
    return;
  }

  // pending: state + withdraw
  if (existing !== null) {
    const dlg = openDialog({
      host: opts.host,
      title: `Edit access requested — ${opts.doc.name}`,
      buttons: [
        { label: "Close", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Withdraw request",
          kind: "danger",
          onClick: () =>
            void removeRequest(existing.id).then(() => {
              dlg.close();
              opts.onChanged();
            }),
        },
      ],
    });
    dlg.body.appendChild(
      el(
        "div",
        "app-settings-note",
        `Waiting on the document owner${existing.owners.length === 1 ? "" : "s"} — requested ${existing.when.slice(0, 10)}: ${existing.reason}`
      )
    );
    return;
  }

  // fresh request: reason required — an owner deciding on access needs
  // to know WHY, same rule as Request revision
  const dlg = openDialog({
    host: opts.host,
    title: `Request edit access — ${opts.doc.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Send request", kind: "primary", onClick: () => void send() },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      "The document owner decides; approval checks the document out to you for " +
        "one revision cycle. The request lands in their tasks in this app."
    )
  );
  const reason = el("textarea", "app-input app-docs-reason") as HTMLTextAreaElement;
  reason.placeholder = "Why you need to edit this document (required)";
  reason.rows = 3;
  dlg.body.appendChild(reason);
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);
  const sync = () => {
    goBtn.disabled = running || reason.value.trim() === "";
  };
  reason.addEventListener("input", sync);
  sync();

  const send = async () => {
    if (running || reason.value.trim() === "") return;
    running = true;
    sync();
    status.textContent = "Sending…";
    try {
      await submitRequest({
        id: requestId(opts.doc.uniqueId, opts.viewer.id),
        listId: opts.doc.listId,
        itemId: opts.doc.itemId,
        uniqueId: opts.doc.uniqueId,
        name: opts.doc.name,
        who: opts.viewer,
        owners: opts.owners,
        reason: reason.value.trim(),
        when: new Date().toISOString(),
      });
      dlg.close();
      opts.onChanged();
    } catch (e) {
      running = false;
      sync();
      status.textContent = `Could not send: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}

/** The owner's decline — reason required, recorded on the entry so the
 *  requester learns the outcome next time they open the document. */
export function openDeclineRequest(opts: {
  request: AccessRequest;
  actorName: string;
  host: HTMLElement;
  onDone: () => void;
}): void {
  let running = false;
  const dlg = openDialog({
    host: opts.host,
    title: `Decline edit access — ${opts.request.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Decline request", kind: "danger", onClick: () => void go() },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-danger") as HTMLButtonElement | null;
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      `${opts.request.who.name} asked: ${opts.request.reason}`
    )
  );
  const reason = el("textarea", "app-input app-docs-reason") as HTMLTextAreaElement;
  reason.placeholder = "Why not (required — shown to the requester)";
  reason.rows = 3;
  dlg.body.appendChild(reason);
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);
  const sync = () => {
    if (goBtn) goBtn.disabled = running || reason.value.trim() === "";
  };
  reason.addEventListener("input", sync);
  sync();
  const go = async () => {
    if (running || reason.value.trim() === "") return;
    running = true;
    sync();
    status.textContent = "Recording…";
    try {
      await declineRequest(opts.request.id, opts.actorName, reason.value.trim());
      dlg.close();
      opts.onDone();
    } catch (e) {
      running = false;
      sync();
      status.textContent = `Could not decline: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}
