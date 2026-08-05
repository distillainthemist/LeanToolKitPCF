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

const REQUESTS_ROW = "__requests__";

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
