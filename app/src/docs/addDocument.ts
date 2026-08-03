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
  SpField,
  fieldsFromResponse,
  newDocumentWrites,
  sanitizeFileName,
  spErrorText,
  validateItemErrors,
} from "./model";
import { DocRow, buildRenderViewXml, extOf } from "./rows";
import { renderListPage } from "./data";
import { EntraHit, searchEntra } from "../store/people";
import {
  checkInFile,
  checkOutFile,
  connectorPatchItem,
  copyFileTo,
  fetchFields,
  fetchListRoot,
  fetchRegionalSettings,
  fetchTermPaths,
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

/** Columns SharePoint manages itself — fine in a VIEW, nonsense in this
 *  form ("Checked out to" rendered as an editable person picker, Ben,
 *  2026-08-04). The dictionary auto-appends new live fields as
 *  available, so availability alone cannot be the test. */
const SYSTEM_FIELDS = new Set([
  "CheckoutUser",
  "Author",
  "Editor",
  "Modified",
  "Created",
  "FileLeafRef",
  "FileSizeDisplay",
]);

/** Field types the form can edit. */
const editorKind = (f: SpField): AddFieldValue["kind"] | null => {
  if (SYSTEM_FIELDS.has(f.internal)) return null;
  if (f.isTaxonomy) return "taxonomy";
  if (f.type === "User" || f.type === "UserMulti") return "person";
  if (f.type === "DateTime") return "date";
  if (f.choices.length > 0) return "choice";
  if (f.type === "Text" || f.type === "Note") return "text";
  return null;
};

export function openAddDocument(opts: AddDocumentOpts): void {
  const { site, host } = opts;

  // Visible build marker: three "stuck" reports in a row turned out to
  // involve at least one stale player bundle, and the marker settles
  // "which code is this" from a screenshot alone. Bump per revision.
  const BUILD = "b9";

  let creating = false;
  const dlg = openDialog({
    host,
    title: `Add a document · ${BUILD}`,
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
  if (opts.targets.length > 1) body.appendChild(fieldRow("Into library", targetSel));
  body.appendChild(fieldRow("From template", tplSel));
  body.appendChild(fieldRow("Name", nameInput, nameExt));

  // ---- metadata editors, rebuilt when the target changes ---------------
  const metaBox = el("div", "app-docs-addmeta");
  body.appendChild(metaBox);
  const statusLine = el("div", "app-docs-addstatus");
  body.appendChild(statusLine);

  interface Editor {
    field: SpField;
    kind: AddFieldValue["kind"];
    /** Current value; taxonomy holds JSON {label, termId}. */
    read: () => AddFieldValue;
    isEmpty: () => boolean;
  }
  let editors: Editor[] = [];

  const currentTarget = (): DocLibrary =>
    opts.targets.find((t) => t.listId === targetSel.value) ?? opts.targets[0];

  const labelOf = (f: SpField): string => {
    const dictLabel = opts.dictBy.get(f.internal)?.label ?? "";
    return dictLabel !== "" ? dictLabel : f.title;
  };

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
    const byInternal = new Map(fields.map((f) => [f.internal, f]));
    clear(metaBox);

    // the library's own view order decides the form; availability is the
    // site's word for "a person should see this column"
    for (const c of lib.config.columns.filter((x) => x.available)) {
      const f = byInternal.get(c.internal);
      if (f === undefined) continue;
      const kind = editorKind(f);
      if (kind === null) continue; // person and exotic types: SharePoint's job for now
      const star = f.required ? " *" : "";

      if (kind === "taxonomy") {
        const setId = opts.dictBy.get(f.internal)?.termSetId || f.termSetId;
        if (setId === "") continue;
        const sel = el("select", "app-input") as HTMLSelectElement;
        placeholder(sel, "—");
        void fetchTermPaths(site, setId).then((walk) => {
          for (const n of walk.nodes) {
            const o = el(
              "option",
              "",
              `${"  ".repeat(n.labels.length - 1)}${n.labels[n.labels.length - 1]}`
            ) as HTMLOptionElement;
            o.value = JSON.stringify({ label: n.labels[n.labels.length - 1], termId: n.id });
            sel.appendChild(o);
          }
        });
        sel.addEventListener("change", sync);
        metaBox.appendChild(fieldRow(labelOf(f) + star, sel));
        editors.push({
          field: f,
          kind,
          read: () => {
            let v = { label: "", termId: "" };
            if (sel.value !== "") {
              // defensive twin of the placeholder fix — a value that is
              // not our JSON must read as "nothing picked", never throw
              try {
                v = JSON.parse(sel.value) as { label: string; termId: string };
              } catch {
                v = { label: "", termId: "" };
              }
            }
            return {
              internal: f.internal,
              kind: "taxonomy",
              label: v.label,
              termId: v.termId,
              multi: f.type === "TaxonomyFieldTypeMulti",
            };
          },
          isEmpty: () => sel.value === "",
        });
        continue;
      }

      if (kind === "person") {
        // the app's one people pattern (screens/people.ts): debounced
        // Entra search with a sequence guard, results as rows to pick
        const multi = f.type === "UserMulti";
        const picked: { email: string; name: string }[] = [];
        const box = el("div", "app-docs-ppl");
        const chips = el("div", "app-docs-pplchips");
        const search = el("input", "app-input") as HTMLInputElement;
        search.placeholder = multi ? "Search people to add…" : "Search for a person…";
        const hitsBox = el("div", "app-docs-pplhits");
        box.append(chips, search, hitsBox);

        const paintChips = () => {
          clear(chips);
          for (const p of picked) {
            const chip = el("span", "app-docs-pplchip");
            chip.appendChild(el("span", "", p.name));
            const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
            off.setAttribute("aria-label", `Remove ${p.name}`);
            off.addEventListener("click", () => {
              picked.splice(picked.indexOf(p), 1);
              paintChips();
              sync();
            });
            chip.appendChild(off);
            chips.appendChild(chip);
          }
          chips.style.display = picked.length > 0 ? "" : "none";
        };
        paintChips();

        const renderHits = (hits: EntraHit[]) => {
          clear(hitsBox);
          for (const h of hits.filter((x) => x.mail !== "").slice(0, 8)) {
            const row = el("button", "app-docs-pplhit") as HTMLButtonElement;
            row.type = "button";
            row.append(
              el("span", "app-docs-pplhitname", h.displayName),
              el("span", "app-field-hint", h.mail)
            );
            row.addEventListener("click", () => {
              if (!multi) picked.length = 0;
              if (!picked.some((p) => p.email.toLowerCase() === h.mail.toLowerCase())) {
                picked.push({ email: h.mail, name: h.displayName });
              }
              search.value = "";
              clear(hitsBox);
              paintChips();
              sync();
            });
            hitsBox.appendChild(row);
          }
        };

        let searchSeq = 0;
        let timer = 0;
        search.addEventListener("input", () => {
          window.clearTimeout(timer);
          const q = search.value.trim();
          if (q === "") {
            clear(hitsBox);
            return;
          }
          timer = window.setTimeout(() => {
            const seq = ++searchSeq;
            void searchEntra(q).then(
              (hits) => {
                if (seq === searchSeq) renderHits(hits);
              },
              () => {
                if (seq !== searchSeq) return;
                clear(hitsBox);
                hitsBox.appendChild(el("div", "app-field-hint", "People search failed."));
              }
            );
          }, 350);
        });

        metaBox.appendChild(fieldRow(labelOf(f) + star, box));
        editors.push({
          field: f,
          kind,
          read: () => ({ internal: f.internal, kind: "person", people: [...picked] }),
          isEmpty: () => picked.length === 0,
        });
        continue;
      }

      let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (kind === "choice") {
        const sel = el("select", "app-input") as HTMLSelectElement;
        // explicit empty value, or "—" itself would be WRITTEN as the
        // chosen value — same defect as the taxonomy placeholder
        placeholder(sel, "—");
        for (const choice of f.choices) {
          const o = el("option", "", choice) as HTMLOptionElement;
          o.value = choice;
          sel.appendChild(o);
        }
        control = sel;
      } else if (kind === "date") {
        const inp = el("input", "app-input") as HTMLInputElement;
        inp.type = "date";
        control = inp;
      } else if (f.type === "Note") {
        const ta = el("textarea", "app-input") as HTMLTextAreaElement;
        ta.rows = 2;
        control = ta;
      } else {
        control = el("input", "app-input") as HTMLInputElement;
      }
      control.addEventListener("input", sync);
      control.addEventListener("change", sync);
      metaBox.appendChild(fieldRow(labelOf(f) + star, control));
      editors.push({
        field: f,
        kind,
        read: () => ({ internal: f.internal, kind, text: control.value.trim() }),
        isEmpty: () => control.value.trim() === "",
      });
    }
    if (editors.length === 0) {
      metaBox.appendChild(
        el("div", "app-field-hint", "This library has no editable columns configured.")
      );
    }
    sync();
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

  /**
   * One call given the time it actually needs. File-endpoint calls on a
   * fresh copy are SLOW, not broken — an abandoned CheckOut from an
   * earlier run landed server-side a minute later (that is why run
   * two's document ended up checked out). Abandon-and-retry piles up
   * late-landing duplicates; the honest cure is one call, narrated
   * while SharePoint settles the file.
   */
  const patient = async (base: string, p: Promise<Sp>, totalMs = 120_000): Promise<Sp | null> => {
    const started = Date.now();
    let done = false;
    void p.finally(() => {
      done = true;
    });
    const tick = window.setInterval(() => {
      if (done) return;
      const s = Math.round((Date.now() - started) / 1000);
      if (s >= 10) status(`${base} — SharePoint is still settling the new file (${s}s)…`);
    }, 5_000);
    const r = await timed<Sp | null>(p, totalMs, null);
    window.clearInterval(tick);
    return r;
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

    // ONE forms-engine call — SharePoint's own path for completing a
    // just-created document (bNewDocumentUpdate: true, the document
    // information panel's write). It bypasses the require-check-out
    // rule and finishes the document, so in the good case NOTHING here
    // touches the file door that stalls on fresh copies. The copy
    // arrives checked in; this call leaves it that way.
    const writes = newDocumentWrites(editors.map((e) => e.read()), localeId);
    let taxFallback = false;
    if (writes.formValues.length > 0) {
      status("Writing properties…");
      const res = await timedRetry("Writing properties", () =>
        validateUpdateListItem(site, lib.listId, itemId, writes.formValues, true)
      );
      const errs = validateItemErrors(res.data);
      const taxErrs = errs.filter((e) => writes.taxInternals.includes(e.field));
      const otherErrs = errs.filter((e) => !writes.taxInternals.includes(e.field));
      if (otherErrs.length > 0) {
        return fail(
          "Created, but some properties were refused",
          otherErrs.map((e) => `${e.field}: ${e.message}`).join("; ")
        );
      }
      if (!res.ok || taxErrs.length > 0) {
        if (writes.taxInternals.length === 0) {
          return fail("Created, but the properties write failed", res.status);
        }
        // The whole call failing with taxonomy aboard reads as the
        // known masked check-out exception; a field-level refusal is
        // the tagging validator. Either way: re-run WITHOUT the term
        // columns (this is the proven-bare path), then send the terms
        // through the fallback below.
        taxFallback = true;
        const bare = writes.formValues.filter(
          (f) => !writes.taxInternals.includes(f.FieldName)
        );
        if (bare.length > 0) {
          const res2 = await timedRetry("Writing properties", () =>
            validateUpdateListItem(site, lib.listId, itemId, bare, true)
          );
          const errs2 = validateItemErrors(res2.data);
          if (!res2.ok || errs2.length > 0) {
            return fail(
              "Created, but some properties were refused",
              errs2.map((e) => `${e.field}: ${e.message}`).join("; ") || res2.status
            );
          }
        }
      }
    }

    // Fallback for the term columns alone, on the probe-proven route:
    // held check-out → connector term object → check-in. File-door
    // calls are SLOW on a fresh copy (five runs), so each gets one
    // patient narrated attempt, never abandon-and-retry — a duplicate
    // landing late would re-check-out the document after its check-in.
    if (taxFallback && Object.keys(writes.patch).length > 0) {
      status("Taking the check-out…");
      const out = await patient("Taking the check-out", checkOutFile(site, newUrl));
      if (out === null) {
        return fail(
          "The term columns need a check-out, and it never answered",
          "The document exists with its other properties set. Give SharePoint a minute, " +
            "then set the term columns from the register (check out, edit, check in)."
        );
      }
      // "already checked out" on a name that did not exist a minute ago
      // can only be us — a previous attempt's call landing late
      const held = out.ok || /checked out/i.test(spErrorText(out.status));
      if (!held) return fail("Created, but could not check out for the term columns", out.status);

      status("Writing the term columns…");
      const res = await timedRetry("Writing the term columns", () =>
        connectorPatchItem(site, lib.listId, itemId, writes.patch)
      );
      if (!res.ok) {
        return fail("Created, but the term columns were refused (it stays checked out to you)", res.status);
      }

      status("Checking in…");
      const cin = await patient(
        "Checking in",
        checkInFile(site, newUrl, `Created from template “${tpl.name}”`, false)
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
