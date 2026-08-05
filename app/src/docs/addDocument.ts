// Standard Documents — Add a document (Phase 4C).
//
// Template copy only: six probe runs measured every byte carriage
// re-encoding in transit, so content never crosses the wire — the copy
// happens inside SharePoint, and what this dialog adds is the metadata.
// The write recipe is the probe's, verbatim: inherit the check-out the
// library hands a new file (or take one), text and choice through
// ValidateUpdateListItem with bNewDocumentUpdate=false, terms and dates
// through the connector's typed item surface, then check in as a minor
// version with a comment. Loaded on demand — its bytes are in nobody's
// chunk until someone presses Add.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { DocLibrary } from "./docsStore";
import {
  AddFieldValue,
  SiteColumn,
  fieldsFromResponse,
  newDocumentWrites,
  sanitizeFileName,
  spErrorText,
  validateItemErrors,
} from "./model";
import { DocRow, buildRenderViewXml, extOf } from "./rows";
import { renderListPage } from "./data";
import { BuiltEditor, buildFieldEditors } from "./fieldEditors";
import {
  checkInFile,
  checkOutFile,
  connectorPatchItem,
  copyFileTo,
  fetchFields,
  fetchListRoot,
  fetchRegionalSettings,
  validateUpdateListItem,
} from "./sp";

export interface AddDocumentOpts {
  site: string;
  /** Writable working/revision libraries the user may add to. */
  targets: DocLibrary[];
  /** Libraries typed template — the only source of content. */
  templates: DocLibrary[];
  /** The site dictionary by internal name (labels, term sets). */
  dictBy: Map<string, SiteColumn>;
  /** Styled dialog host (.app-dlghost). */
  host: HTMLElement;
  /** Called with the created document's row, after check-in. */
  onCreated: (row: DocRow) => void;
}

export function openAddDocument(opts: AddDocumentOpts): void {
  const { site, host } = opts;

  // (The 4C debugging build marker is retired at Ben's ask, 2026-08-06 —
  // the dialog title is clean. If "stuck" reports return, restore a
  // visible marker FIRST: stale player bundles faked three of them.)
  let creating = false;
  const dlg = openDialog({
    host,
    title: "Add a document",
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!creating) dlg.close(); } },
      {
        label: "Create",
        kind: "primary",
        // a THROW anywhere in the flow must become a visible failure —
        // an unhandled rejection freezes the dialog on its last status
        // line forever, indistinguishable from a hung call
        onClick: () =>
          void create().catch((e: unknown) => {
            creating = false;
            status(`Unexpected failure: ${String(e).slice(0, 300)}`, true);
            sync();
          }),
      },
    ],
    onClose: () => stopHeartbeat(),
  });
  const createBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;

  const body = dlg.body;
  body.classList.add("app-docs-addbody");

  /** A placeholder option MUST carry an explicit empty value: an
   *  <option> without one returns its TEXT as its value, and the "—"
   *  placeholder fed JSON.parse("—") — the crash behind every "stuck"
   *  create (found via the b7 throw-guard, 2026-08-04). */
  const placeholder = (sel: HTMLSelectElement, label: string) => {
    const o = el("option", "", label) as HTMLOptionElement;
    o.value = "";
    sel.appendChild(o);
  };

  // the forms engine validates dates in the SITE's short format, so the
  // site's locale is read once per dialog; en-US until it answers
  let localeId = 1033;
  void fetchRegionalSettings(site).then((r) => {
    const v = Number(((r.data ?? {}) as { LocaleId?: unknown }).LocaleId ?? 0);
    if (v > 0) localeId = v;
  });

  // ---- target + template + name ----------------------------------------
  const targetSel = el("select", "app-input") as HTMLSelectElement;
  for (const t of opts.targets) {
    const o = el("option", "", t.config.title !== "" ? t.config.title : t.name) as HTMLOptionElement;
    o.value = t.listId;
    targetSel.appendChild(o);
  }

  const tplSel = el("select", "app-input") as HTMLSelectElement;
  placeholder(tplSel, "Loading templates…");
  tplSel.disabled = true;
  /** template rows by uniqueId, filled by the load below. */
  const tplRows = new Map<string, DocRow>();

  const nameInput = el("input", "app-input") as HTMLInputElement;
  nameInput.placeholder = "Document name (extension comes from the template)";
  const nameExt = el("span", "app-field-hint");

  const fieldRow = (label: string, control: HTMLElement, extra?: HTMLElement) => {
    const wrap = el("div", "app-docs-addfield");
    wrap.appendChild(el("div", "app-field-label", label));
    wrap.appendChild(control);
    if (extra) wrap.appendChild(extra);
    return wrap;
  };
  // always shown, even with one option — WHERE a document lands is
  // information the person adding it should see, not infer (Ben,
  // 2026-08-04)
  body.appendChild(fieldRow("Into library", targetSel));
  body.appendChild(fieldRow("From template", tplSel));
  body.appendChild(fieldRow("Name", nameInput, nameExt));

  // ---- metadata editors, rebuilt when the target changes ---------------
  const metaBox = el("div", "app-docs-addmeta");
  body.appendChild(metaBox);
  const statusLine = el("div", "app-docs-addstatus");
  body.appendChild(statusLine);

  let editors: BuiltEditor[] = [];

  const currentTarget = (): DocLibrary =>
    opts.targets.find((t) => t.listId === targetSel.value) ?? opts.targets[0];

  const sync = () => {
    const missing = editors.some((e) => e.field.required && e.isEmpty());
    createBtn.disabled =
      creating || tplSel.value === "" || sanitizeFileName(nameInput.value) === "" || missing;
  };
  nameInput.addEventListener("input", sync);
  tplSel.addEventListener("change", () => {
    const tpl = tplRows.get(tplSel.value);
    nameExt.textContent = tpl !== undefined ? `.${tpl.ext}` : "";
    sync();
  });

  const buildEditors = async () => {
    const lib = currentTarget();
    editors = [];
    clear(metaBox);
    metaBox.appendChild(el("div", "app-loading-line", "Reading the library's columns…"));
    const fields = fieldsFromResponse((await fetchFields(site, lib.listId)).data);
    // the SHARED editors (fieldEditors.ts, extracted for 5H1's
    // edit-properties form): dictionary order, pool-bound person
    // pickers, the placeholder/value="" lesson — one implementation,
    // verified once
    editors = buildFieldEditors({
      site,
      box: metaBox,
      fields,
      columns: lib.config.columns,
      dictBy: opts.dictBy,
      onChange: sync,
    });
  };
  targetSel.addEventListener("change", () => void buildEditors());
  void buildEditors();

  // ---- templates -------------------------------------------------------
  void (async () => {
    clear(tplSel);
    let any = false;
    for (const lib of opts.templates) {
      const page = await renderListPage(
        site,
        lib.listId,
        buildRenderViewXml({ sortName: true, asc: true, rowLimit: 100 })
      );
      const group = el("optgroup", "") as HTMLOptGroupElement;
      group.label = lib.config.title !== "" ? lib.config.title : lib.name;
      for (const row of page.rows) {
        tplRows.set(row.uniqueId, row);
        const o = el("option", "", row.name) as HTMLOptionElement;
        o.value = row.uniqueId;
        group.appendChild(o);
        any = true;
      }
      if (group.childElementCount > 0) tplSel.appendChild(group);
    }
    if (!any) {
      placeholder(tplSel, "No templates — expose a template library first");
      tplSel.value = "";
    } else {
      tplSel.disabled = false;
      // no default pick: choosing the starting document is the point
      const blank = el("option", "", "Choose a template…") as HTMLOptionElement;
      blank.value = "";
      tplSel.insertBefore(blank, tplSel.firstChild);
      tplSel.value = "";
    }
    sync();
  })();

  // ---- create ----------------------------------------------------------
  let statusBase = "";
  let statusStarted = 0;
  const status = (text: string, warn = false) => {
    statusBase = text;
    statusStarted = Date.now();
    statusLine.textContent = text;
    statusLine.classList.toggle("app-docs-addstatus-warn", warn);
  };

  // Heartbeat: while a create runs, the current step's line ticks its
  // elapsed seconds every second. A counter that stops counting is a
  // frozen runtime; a counter that climbs is a slow call — and three
  // "stuck" reports could not tell those apart (2026-08-04).
  const heartbeat = window.setInterval(() => {
    if (!creating || statusBase === "") return;
    const s = Math.round((Date.now() - statusStarted) / 1000);
    if (s >= 2 && !statusLine.classList.contains("app-docs-addstatus-warn")) {
      statusLine.textContent = `${statusBase} (${s}s)`;
    }
  }, 1_000);
  const stopHeartbeat = () => window.clearInterval(heartbeat);

  /** A step that never answers must NAME itself instead of leaving the
   *  dialog on one message forever ("Setting properties…" for a minute,
   *  Ben, 2026-08-04) — the SDK's connector calls hang rather than
   *  reject when something goes sideways, so every await races a clock. */
  const timed = async <T>(p: Promise<T>, ms: number, dead: T): Promise<T> => {
    let clock = 0;
    const timeout = new Promise<T>((resolve) => {
      clock = window.setTimeout(() => resolve(dead), ms);
    });
    const r = await Promise.race([p, timeout]);
    window.clearTimeout(clock);
    return r;
  };

  type Sp = { ok: boolean; status: string; data: unknown };

  /**
   * One call, retried once when it goes silent — run two hung on a GET
   * identical to one that had answered two steps earlier (Ben,
   * 2026-08-04), so the hangs are intermittent and a fresh attempt is
   * the cure. Only steps that repeat safely come through here; the
   * abandoned first call landing late is harmless for all of them
   * (reads, a second check-out, the same values written twice).
   */
  const timedRetry = async (what: string, make: () => Promise<Sp>): Promise<Sp> => {
    const first = await timed<Sp | null>(make(), 12_000, null);
    if (first !== null) return first;
    status(`${statusLine.textContent} (no answer — retrying)`);
    const second = await timed<Sp | null>(make(), 20_000, null);
    return (
      second ?? {
        ok: false,
        status:
          `${what} never answered (two attempts). The document may still exist in the ` +
          "library — check it there before trying again.",
        data: null,
      }
    );
  };

  const create = async () => {
    if (creating) return;
    const tpl = tplRows.get(tplSel.value);
    const lib = currentTarget();
    const clean = sanitizeFileName(nameInput.value);
    if (tpl === undefined || clean === "") return;
    creating = true;
    sync();

    const fail = (what: string, why: string) => {
      status(`${what}: ${spErrorText(why).slice(0, 300)}`, true);
      creating = false;
      sync();
    };

    status("Copying the template…");
    const rootRes = await timedRetry("Finding the library root", () =>
      fetchListRoot(site, lib.listId)
    );
    const root = String(
      ((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? ""
    );
    if (root === "") return fail("Could not find the library", rootRes.status);
    const fileName = `${clean}.${tpl.ext}`;
    const newUrl = `${root}/${fileName}`;
    // safe to retry: boverwrite=false means a landed-late first attempt
    // just makes the second one fail "already exists", which is caught
    // by reading the file back rather than trusted blindly
    const copy = await timedRetry("The copy", () => copyFileTo(site, tpl.serverUrl, newUrl));
    if (!copy.ok) return fail("Copy refused (a document with this name may already exist)", copy.status);

    // From here the document EXISTS — a failure below leaves it checked
    // out to its creator, and the message says so instead of pretending
    // nothing happened.
    // The itemId comes from the LIST door, not the file door —
    // GetFileByServerRelativePath/ListItemAllFields stalled on run four
    // exactly like every other file-endpoint call on a fresh copy. The
    // register's own read (Modified desc) puts the newest file first.
    status("Reading the new document back…");
    const idRes = await timedRetry("Reading the new document", async () => {
      const page = await renderListPage(site, lib.listId, buildRenderViewXml({ rowLimit: 25 }));
      const hit = page.rows.find((r) => r.name.toLowerCase() === fileName.toLowerCase());
      return hit !== undefined
        ? { ok: true, status: "", data: hit.id }
        : {
            ok: false,
            status:
              page.error !== ""
                ? page.error
                : "the new document has not appeared in the register yet",
            data: null,
          };
    });
    if (!idRes.ok) return fail("Created, but could not read the new document back", idRes.status);
    const itemId = Number(idRes.data);

    // Probe run six's sequence, exactly — the one path every call of
    // which is PROVEN on this tenant. The copy arrives checked in, and
    // on a require-check-out library every write against it is refused
    // ("not checked out", b9's run) — bNewDocumentUpdate does NOT
    // bypass the rule (the probe write that seemed to prove it rode an
    // addFile auto-check-out). And the check-out call itself never
    // actually hung: the five "hangs" were all the placeholder crash.
    // So: check out → forms engine for text/choice/person/dates →
    // connector term objects → check in with the comment.
    status("Taking the check-out…");
    const out = await timedRetry("Check-out", () => checkOutFile(site, newUrl));
    // "already checked out" on a minute-old name can only be us
    const held = out.ok || /checked out/i.test(spErrorText(out.status));
    if (!held) return fail("Created, but could not check out to set properties", out.status);

    const writes = newDocumentWrites(editors.map((e) => e.read()), localeId);
    const vuliValues = writes.formValues.filter(
      (f) => !writes.taxInternals.includes(f.FieldName)
    );
    if (vuliValues.length > 0) {
      status("Writing properties…");
      const res = await timedRetry("Writing properties", () =>
        validateUpdateListItem(site, lib.listId, itemId, vuliValues, false)
      );
      const errs = validateItemErrors(res.data);
      if (!res.ok || errs.length > 0) {
        return fail(
          "Created, but some properties were refused (it stays checked out to you)",
          errs.map((e) => `${e.field}: ${e.message}`).join("; ") || res.status
        );
      }
    }
    if (Object.keys(writes.patch).length > 0) {
      status("Writing the term columns…");
      const res = await timedRetry("Writing the term columns", () =>
        connectorPatchItem(site, lib.listId, itemId, writes.patch)
      );
      if (!res.ok) {
        return fail(
          "Created, but the term columns were refused (it stays checked out to you)",
          res.status
        );
      }
    }

    status("Checking in…");
    const cin = await timed<Sp | null>(
      checkInFile(site, newUrl, `Created from template “${tpl.name}”`, false),
      25_000,
      null
    );
    if (cin === null) {
      return fail(
        "Check-in never answered",
        "The document exists and the properties are set — check the library: if it " +
          "still shows checked out to you, check it in from the register."
      );
    }
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
      return fail("Created, but check-in was refused (it stays checked out to you)", cin.status);
    }

    // hand the finished row back the way the register reads rows — and
    // even if this read stalls, the document is DONE, so close anyway
    status("Opening…");
    const page = await timed(
      renderListPage(
        site,
        lib.listId,
        buildRenderViewXml({
          idIn: [itemId],
          fields: lib.config.columns.filter((c) => c.available).map((c) => c.internal),
          rowLimit: 1,
        })
      ),
      15_000,
      { rows: [] as DocRow[], next: "", error: "timed out" }
    );
    dlg.close();
    const row = page.rows[0];
    opts.onCreated(
      row ?? {
        id: itemId,
        uniqueId: "",
        name: fileName,
        ext: extOf(fileName),
        serverUrl: newUrl,
        listId: lib.listId.toLowerCase(),
        modified: "",
        values: {},
      }
    );
  };

  sync();
}
