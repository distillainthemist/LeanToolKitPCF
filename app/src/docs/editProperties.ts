// Edit properties (5H1) — the 4C metadata form, prefilled, in two
// modes settled with Ben (2026-08-06):
//
//   - checked out to the acting user → the writes RIDE the check-out
//     and publish with their next check-in (the visibility constraint
//     keeps them private until then);
//   - not checked out (working/revision writers; standards owner or
//     controllers) → an auto bracket: check-out → writes → MINOR
//     check-in, comment REQUIRED (prefilled "Properties updated").
//
// Writes are the cookbook's, via splitAddWrites: text/choice/person
// through ValidateUpdateListItem (bNewDocumentUpdate=false), terms and
// dates through the connector's typed item surface. An empty editor
// writes nothing — v1 changes values, it does not clear them.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { DocLibrary } from "./docsStore";
import {
  SiteColumn,
  addMonthsYmd,
  fieldsFromResponse,
  prefillFromItem,
  spErrorText,
  splitAddWrites,
  validateItemErrors,
} from "./model";
import { DocRow, buildRenderViewXml } from "./rows";
import { renderListPage } from "./data";
import { BuiltEditor, EditorInitial, buildFieldEditors, editorKind } from "./fieldEditors";
import {
  checkInFile,
  checkOutFile,
  connectorPatchItem,
  fetchFields,
  fetchListItem,
  fetchListModeration,
  validateUpdateListItem,
} from "./sp";

export interface EditPropertiesOpts {
  site: string;
  row: DocRow;
  lib: DocLibrary;
  dictBy: Map<string, SiteColumn>;
  host: HTMLElement;
  /** true = ride the held check-out (no check-in); false = bracket. */
  heldByMe: boolean;
  /** The document sits in a READER-FACING stage (approved/superseded/
   *  obsolete). On a moderated library the bracket's check-in then
   *  PUBLISHES too (Ben, 2026-08-09: a property edit is not a separate
   *  approval process) — but never on a mid-circulation draft, whose
   *  moderation wall must hold. */
  readerFacingStage?: boolean;
  /** The manager's sub-headings for this library's type (Part II S2) —
   *  the form renders them as sections. */
  sections?: { heading: string; columns: string[] }[];
  /** The date model (Ben, 2026-08-10): a CHANGED importance rewrites
   *  the cadence from the mapping, and the review date follows from
   *  the stored effective date. Internals "" = unmapped, skipped. */
  dateModel?: {
    importanceInternal: string;
    effectiveInternal: string;
    reviewInternal: string;
    cadenceInternal: string;
    /** importance term id (lowercased) → months. */
    cadence: Record<string, number>;
  };
  onDone: () => void;
}

type Sp = { ok: boolean; status: string; data: unknown };
const timed = async (p: Promise<Sp>, what: string): Promise<Sp> => {
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

export function openEditProperties(opts: EditPropertiesOpts): void {
  const { site, row, heldByMe } = opts;
  let running = false;

  const dlg = openDialog({
    host: opts.host,
    title: `Edit properties — ${row.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Save properties", kind: "primary", onClick: () => void save() },
    ],
  });
  const saveBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  dlg.body.classList.add("app-docs-addbody");
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      heldByMe
        ? "Changes ride your check-out — they publish with your next check-in. Empty fields are left unchanged."
        : "Saves as a minor version (check-out → properties → check-in). Empty fields are left unchanged."
    )
  );

  const metaBox = el("div", "app-docs-addmeta");
  dlg.body.appendChild(metaBox);
  metaBox.appendChild(el("div", "app-loading-line", "Reading the document's properties…"));

  // the bracket's check-in demands its comment — the auditor rule
  let comment: HTMLTextAreaElement | null = null;
  if (!heldByMe) {
    comment = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
    comment.rows = 2;
    comment.value = "Properties updated";
    dlg.body.append(el("div", "app-field-label", "Check-in comment"), comment);
    comment.addEventListener("input", () => sync());
  }
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  let editors: BuiltEditor[] = [];
  /** The prefill, kept for save(): the date model reads the STORED
   *  effective date and the ORIGINAL importance from here. */
  let initialMap: Map<string, EditorInitial> = new Map();
  const sync = () => {
    const missing = editors.some((e) => e.field.required && e.isEmpty());
    saveBtn.disabled =
      running || editors.length === 0 || missing || (comment !== null && comment.value.trim() === "");
  };
  sync();

  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
    sync();
  };

  // ---- load + prefill ---------------------------------------------------
  void (async () => {
    const [fieldsRes, itemRes] = await Promise.all([
      fetchFields(site, row.listId),
      fetchListItem(site, row.listId, row.id),
    ]);
    if (!fieldsRes.ok) return fail("Could not read the library's columns", fieldsRes.status);
    const fields = fieldsFromResponse(fieldsRes.data);
    const initial = new Map<string, EditorInitial>();
    if (itemRes.ok) {
      for (const [k, v] of prefillFromItem(
        (itemRes.data ?? {}) as Record<string, unknown>,
        fields
      )) {
        initial.set(k, v);
      }
    }
    // person emails ride an RLDAS row — the item read carries ids only
    const carried = new Set(opts.lib.config.columns.map((c) => c.internal));
    const personCols = fields
      .filter((f) => editorKind(f) === "person" && carried.has(f.internal))
      .map((f) => f.internal);
    if (personCols.length > 0) {
      try {
        const page = await renderListPage(
          site,
          row.listId,
          buildRenderViewXml({ idIn: [row.id], fields: personCols, rowLimit: 1 })
        );
        const fresh = page.rows[0];
        if (fresh !== undefined) {
          for (const internal of personCols) {
            const names = (fresh.values[internal] ?? "")
              .split(";")
              .map((s) => s.trim())
              .filter((s) => s !== "");
            const mails = (fresh.values[`${internal}#email`] ?? "")
              .split(";")
              .filter((s) => s !== "");
            if (mails.length > 0) {
              initial.set(internal, {
                people: mails.map((email, i) => ({ email, name: names[i] ?? email })),
              });
            }
          }
        }
      } catch {
        /* person prefill missing = empty pickers; the writes still work */
      }
    }
    if (!dlg.root.isConnected) return;
    initialMap = initial;
    editors = buildFieldEditors({
      site,
      box: metaBox,
      fields,
      columns: opts.lib.config.columns,
      dictBy: opts.dictBy,
      onChange: sync,
      initial,
      sections: opts.sections,
    });
  })().catch((e: unknown) => fail("Could not load the form", String(e)));

  // ---- save -------------------------------------------------------------
  const save = async () => {
    if (running || saveBtn.disabled) return;
    running = true;
    sync();
    status.classList.remove("app-docs-addstatus-warn");

    if (!heldByMe) {
      status.textContent = "Taking the check-out…";
      const out = await timed(checkOutFile(site, row.serverUrl), "Check-out");
      if (!out.ok && !/checked out/i.test(spErrorText(out.status))) {
        return fail("Could not check out", out.status);
      }
    }

    const { formValues, patch } = splitAddWrites(editors.map((e) => e.read()));
    // the date model (Ben, 2026-08-10): importance CHANGED → cadence
    // rewritten from the mapping, review date recomputed from the
    // stored effective date. Unchanged importance writes nothing.
    const dm = opts.dateModel;
    if (dm !== undefined && dm.importanceInternal !== "") {
      const imp = editors.find((e) => e.field.internal === dm.importanceInternal);
      const picked = imp?.read();
      const termId = (picked?.termId ?? "").toLowerCase();
      const wasId = (initialMap.get(dm.importanceInternal)?.term?.termId ?? "").toLowerCase();
      if (termId !== "" && termId !== wasId) {
        const months = dm.cadence[termId];
        if (months !== undefined && months > 0) {
          if (dm.cadenceInternal !== "") {
            formValues.push({ FieldName: dm.cadenceInternal, FieldValue: String(months) });
          }
          const effYmd = (initialMap.get(dm.effectiveInternal)?.text ?? "").trim();
          if (dm.reviewInternal !== "" && /^\d{4}-\d{2}-\d{2}$/.test(effYmd)) {
            patch[dm.reviewInternal] = addMonthsYmd(effYmd, months);
          }
        }
      }
    }
    if (formValues.length > 0) {
      status.textContent = "Writing properties…";
      const res = await timed(
        validateUpdateListItem(site, row.listId, row.id, formValues, false),
        "The property write"
      );
      const errs = validateItemErrors(res.data);
      if (!res.ok || errs.length > 0) {
        return fail(
          heldByMe
            ? "Some properties were refused"
            : "Some properties were refused (the document stays checked out)",
          errs.map((x) => `${x.field}: ${x.message}`).join("; ") || res.status
        );
      }
    }
    if (Object.keys(patch).length > 0) {
      status.textContent = "Writing terms and dates…";
      const res = await timed(
        connectorPatchItem(site, row.listId, row.id, patch),
        "The term write"
      );
      if (!res.ok) {
        return fail(
          heldByMe
            ? "The term write was refused"
            : "The term write was refused (the document stays checked out)",
          res.status
        );
      }
    }

    if (!heldByMe && comment !== null) {
      status.textContent = "Checking in…";
      const cin = await timed(
        checkInFile(site, row.serverUrl, comment.value.trim(), false),
        "Check-in"
      );
      if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
        return fail("Check-in was refused (the document stays checked out)", cin.status);
      }
      // CA1 (Ben, 2026-08-09): on a moderated library the bracket's
      // minor check-in lands PENDING, hiding the metadata fix from
      // readers behind an approval process nobody meant to start. A
      // quick edit on a READER-FACING document publishes as part of
      // the save — the same road the lifecycle commands ride. Never on
      // a mid-circulation draft: its moderation wall must hold.
      if (opts.readerFacingStage === true) {
        const mod = await timed(fetchListModeration(site, row.listId), "The moderation read");
        const moderated =
          mod.ok &&
          ((mod.data ?? {}) as { EnableModeration?: unknown }).EnableModeration === true;
        if (moderated) {
          status.textContent = "Publishing (content approval)…";
          const pub = await timed(
            validateUpdateListItem(
              site,
              row.listId,
              row.id,
              [{ FieldName: "_ModerationStatus", FieldValue: "0" }],
              false
            ),
            "The publish"
          );
          const errs = validateItemErrors(pub.data);
          if (!pub.ok || errs.length > 0) {
            // the edit LANDED — the pending state is a warning, and the
            // dialog stays open so it is read
            status.textContent =
              "Saved — but SharePoint content approval is still PENDING: readers see the " +
              "previous properties until a document controller approves it in SharePoint.";
            status.classList.add("app-docs-addstatus-warn");
            const closeBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
            if (closeBtn !== null) closeBtn.textContent = "Close";
            saveBtn.style.display = "none";
            running = false;
            opts.onDone();
            return;
          }
        }
      }
    }
    dlg.close();
    opts.onDone();
  };
}
