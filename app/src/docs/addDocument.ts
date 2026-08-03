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
  sanitizeFileName,
  spErrorText,
  splitAddWrites,
  validateItemErrors,
} from "./model";
import { DocRow, buildRenderViewXml, extOf } from "./rows";
import { renderListPage } from "./data";
import { EntraHit, searchEntra } from "../store/people";
import {
  checkOutFile,
  checkInFile,
  connectorPatchItem,
  copyFileTo,
  fetchFields,
  fetchFileInfo,
  fetchFileItemId,
  fetchListRoot,
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

/** Field types the form can edit. */
const editorKind = (f: SpField): AddFieldValue["kind"] | null => {
  if (f.isTaxonomy) return "taxonomy";
  if (f.type === "User" || f.type === "UserMulti") return "person";
  if (f.type === "DateTime") return "date";
  if (f.choices.length > 0) return "choice";
  if (f.type === "Text" || f.type === "Note") return "text";
  return null;
};

export function openAddDocument(opts: AddDocumentOpts): void {
  const { site, host } = opts;

  let creating = false;
  const dlg = openDialog({
    host,
    title: "Add a document",
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!creating) dlg.close(); } },
      { label: "Create", kind: "primary", onClick: () => void create() },
    ],
  });
  const createBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;

  const body = dlg.body;
  body.classList.add("app-docs-addbody");

  // ---- target + template + name ----------------------------------------
  const targetSel = el("select", "app-input") as HTMLSelectElement;
  for (const t of opts.targets) {
    const o = el("option", "", t.config.title !== "" ? t.config.title : t.name) as HTMLOptionElement;
    o.value = t.listId;
    targetSel.appendChild(o);
  }

  const tplSel = el("select", "app-input") as HTMLSelectElement;
  tplSel.appendChild(el("option", "", "Loading templates…"));
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
        sel.appendChild(el("option", "", "—"));
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
            const v = sel.value === "" ? { label: "", termId: "" } : (JSON.parse(sel.value) as { label: string; termId: string });
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
        sel.appendChild(el("option", "", "—"));
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
      tplSel.appendChild(el("option", "", "No templates — expose a template library first"));
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
  const status = (text: string, warn = false) => {
    statusLine.textContent = text;
    statusLine.classList.toggle("app-docs-addstatus-warn", warn);
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
    const rootRes = await fetchListRoot(site, lib.listId);
    const root = String(
      ((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? ""
    );
    if (root === "") return fail("Could not find the library", rootRes.status);
    const fileName = `${clean}.${tpl.ext}`;
    const newUrl = `${root}/${fileName}`;
    const copy = await copyFileTo(site, tpl.serverUrl, newUrl);
    if (!copy.ok) return fail("Copy refused (a document with this name may already exist)", copy.status);

    // From here the document EXISTS — a failure below leaves it checked
    // out to its creator, and the message says so instead of pretending
    // nothing happened.
    status("Setting properties…");
    const idRes = await fetchFileItemId(site, newUrl);
    const itemId = Number(((idRes.data ?? {}) as { Id?: unknown }).Id ?? 0);
    if (itemId <= 0) {
      return fail("Created, but could not read the new document back", idRes.status);
    }

    // a require-check-out library hands the copy back already checked
    // out to us; otherwise take the check-out explicitly (probe rule)
    const info = await fetchFileInfo(site, newUrl);
    const held =
      info.ok && Number(((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType ?? 2) !== 2;
    if (!held) {
      const out = await checkOutFile(site, newUrl);
      if (!out.ok) return fail("Created, but could not check out to set properties", out.status);
    }

    const { formValues, patch } = splitAddWrites(editors.map((e) => e.read()));
    if (formValues.length > 0) {
      const res = await validateUpdateListItem(site, lib.listId, itemId, formValues, false);
      const errs = validateItemErrors(res.data);
      if (!res.ok || errs.length > 0) {
        return fail(
          "Created, but some properties were refused (it stays checked out to you)",
          errs.map((e) => `${e.field}: ${e.message}`).join("; ") || res.status
        );
      }
    }
    if (Object.keys(patch).length > 0) {
      const res = await connectorPatchItem(site, lib.listId, itemId, patch);
      if (!res.ok) {
        return fail("Created, but the term columns were refused (it stays checked out to you)", res.status);
      }
    }

    status("Checking in…");
    const cin = await checkInFile(site, newUrl, `Created from template “${tpl.name}”`, false);
    if (!cin.ok) {
      // classic cause: a required column the form could not edit —
      // SharePoint's own sentence names it
      return fail("Created, but check-in was refused (it stays checked out to you)", cin.status);
    }

    // hand the finished row back the way the register reads rows
    const page = await renderListPage(
      site,
      lib.listId,
      buildRenderViewXml({
        idIn: [itemId],
        fields: lib.config.columns.filter((c) => c.available).map((c) => c.internal),
        rowLimit: 1,
      })
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
