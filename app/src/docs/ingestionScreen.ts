// Document ingestion — the task screen and the task editor
// (document-ingestion-proposal-2026-10.md, built 2026-10-08).
//
// A task is a sub-folder of the site's ingestion library plus a
// destination library. Assignees drop files into the folder (SharePoint
// itself — bytes never cross the connector) and set each file's details
// here (the edit-properties dialog, "Set for selected…", "Fill blanks
// from defaults") or in SharePoint's grid view. A document controller
// then RUNS the task: per file, the probe's road — copy into the
// destination (a fresh history, lands as a draft nobody sees), the
// approve bracket (check-out → status term + the date model → MAJOR
// check-in naming the task → publish), then recycle the source. A file
// that fails stays, with its reason in the log; the task closes itself
// when its folder is empty.
//
// Loaded on demand from the register (Document-tasks panel, the
// Ingestion nav card); in the docs chunk, like everything SharePoint.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { markDialog, trapFocus } from "../../../shared/ui/focusTrap";
import { statusChip } from "../../../shared/ui/format";
import { paletteMap } from "../../../shared/palette";
import { appPalettes } from "../store/config";
import { currentViewer } from "../runtime";
import { searchEntra } from "../store/people";
import { appLinkUrl } from "../links";
import { DocLibrary, docsConfig } from "./docsStore";
import { DocRow, buildRenderViewXml, formatWhen } from "./rows";
import { renderListPage } from "./data";
import { mountDocList } from "./listView";
import { RegisterCellCtx, buildRegisterColumns, makeNameCell } from "./registerCells";
import {
  AddFieldValue,
  DEFAULT_CADENCE_MONTHS,
  SpField,
  addMonthsYmd,
  cadenceForImportance,
  columnsForTypes,
  defaultColumnsFor,
  deriveTypeStates,
  dialogSections,
  emptySiteDictionary,
  fieldsFromResponse,
  formatDateForLocale,
  siteKey,
  spErrorText,
  splitAddWrites,
  termForStage,
  todayYmd,
  validateItemErrors,
} from "./model";
import {
  cachedTermPaths,
  checkInFile,
  checkOutFile,
  connectorPatchItem,
  copyFileByPath,
  createFolder,
  fetchFields,
  fetchFileItemId,
  fetchFolderCounts,
  fetchListModeration,
  fetchListRoot,
  fetchRegionalSettings,
  fetchTermsInSet,
  recycleFile,
  recycleFolder,
  validateUpdateListItem,
} from "./sp";
import { buildFieldEditors } from "./fieldEditors";
import { IngestionAssignee, IngestionTask, RunLogEntry, blanksToFill, ingestComment, latestByFile, logSummary, missingFor, taskFolderName } from "./ingestionModel";
import { saveIngestionTask, deleteIngestionTask } from "./ingestionStore";
import { promptConfirm } from "../prompts";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};
const linkBtn = (label: string, href: string, cls = "app-btn"): HTMLAnchorElement => {
  const a = el("a", cls, label) as HTMLAnchorElement;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
};
const libName = (l: DocLibrary | undefined) => (l ? l.config.title || l.name : "(library not exposed)");

// ---- the site context a task needs -----------------------------------------

interface SiteCtx {
  site: string;
  origin: string;
  libraries: DocLibrary[];
  ingestionLib: DocLibrary | null;
  cellCtx: RegisterCellCtx;
  dictBy: Map<string, import("./model").SiteColumn>;
  internalForRole: (role: string) => string;
}

async function loadSiteCtx(): Promise<SiteCtx> {
  const [{ app, libraries }, palettes] = await Promise.all([docsConfig(), appPalettes().catch(() => ({ states: [], titles: [] }))]);
  const siteDict = deriveTypeStates(app.sites[siteKey(app.siteUrl)] ?? emptySiteDictionary(), libraries);
  const dictBy = new Map(siteDict.columns.map((c) => [c.internal, c]));
  const internalForRole = (role: string) => siteDict.columns.find((c) => c.role === role)?.internal ?? "";
  const statusInternal = internalForRole("status");
  const statusCol = statusInternal !== "" ? (dictBy.get(statusInternal) ?? null) : null;
  const myEmail = (currentViewer()?.email ?? "").toLowerCase();
  return {
    site: app.siteUrl,
    origin: app.siteUrl === "" ? "" : new URL(app.siteUrl).origin,
    libraries,
    ingestionLib: libraries.find((l) => l.libType === "ingestion") ?? null,
    cellCtx: { dict: siteDict, states: paletteMap(palettes.states), labelToId: new Map(), statusCol, myEmail },
    dictBy,
    internalForRole,
  };
}

/** The status vocabulary: label → id for the chips, and the list the
 *  stage lookup reads. */
async function readStatusTerms(ctx: SiteCtx): Promise<{ id: string; label: string }[]> {
  const col = ctx.cellCtx.statusCol;
  if (col === null || col.termSetId === "") return [];
  const r = await fetchTermsInSet(ctx.site, col.termSetId);
  const rows = Array.isArray((r.data as { value?: unknown[] })?.value) ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[]) : [];
  const out: { id: string; label: string }[] = [];
  for (const t of rows) {
    const names = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
    const def = Array.isArray(names) ? (names.find((l) => l.isDefault) ?? names[0]) : undefined;
    const name = (def?.name ?? "").trim();
    if (name === "" || typeof t.id !== "string") continue;
    ctx.cellCtx.labelToId.set(name.toLowerCase(), t.id);
    out.push({ id: t.id, label: name });
  }
  return out;
}

// ---- one write bracket on a file in the ingestion library -------------------

/** check-out (tolerated if not needed) → the forms-engine and typed
 *  writes → a MAJOR check-in. Returns "" or the refusal. */
async function writeValues(site: string, listId: string, row: DocRow, values: AddFieldValue[], comment: string): Promise<string> {
  const { formValues, patch } = splitAddWrites(values);
  if (formValues.length === 0 && Object.keys(patch).length === 0) return "";
  const out = await checkOutFile(site, row.serverUrl);
  if (!out.ok && !/already checked out|checked out to you/i.test(spErrorText(out.status))) return `check-out refused: ${spErrorText(out.status)}`;
  if (formValues.length > 0) {
    const r = await validateUpdateListItem(site, listId, row.id, formValues, false);
    const errs = validateItemErrors(r.data);
    if (!r.ok || errs.length > 0) return errs.map((x) => `${x.field}: ${x.message}`).join("; ") || spErrorText(r.status);
  }
  if (Object.keys(patch).length > 0) {
    const r = await connectorPatchItem(site, listId, row.id, patch);
    if (!r.ok) return spErrorText(r.status);
  }
  const ci = await checkInFile(site, row.serverUrl, comment, true);
  if (!ci.ok && !/not checked out/i.test(spErrorText(ci.status))) return `check-in refused: ${spErrorText(ci.status)}`;
  return "";
}

// ---- the task screen -----------------------------------------------------------

export interface IngestionScreenOpts {
  task: IngestionTask;
  isController: boolean;
  /** The register repaints its panel and badge. */
  onChanged: () => void;
}

export function openIngestionTask(o: IngestionScreenOpts): () => void {
  const scrim = el("div", "app-docs-scrim app-docs-scrim-right");
  const sheet = el("div", "app-docs-dialog app-docs-viewer app-ing-sheet");
  markDialog(sheet, `Ingestion task ${o.task.name}`);
  scrim.appendChild(sheet);
  document.body.appendChild(scrim);
  const untrap = trapFocus(sheet);
  let dead = false;
  let running = false;
  const close = () => {
    if (running) return; // a run in flight is never abandoned by a stray Esc
    dead = true;
    untrap();
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  const task = o.task;
  const head = el("div", "app-docs-viewhead");
  const titleBlock = el("div", "app-docs-viewtitle");
  const titleRow = el("div", "app-ing-titlerow");
  titleRow.appendChild(el("div", "app-docs-viewdocname", task.name));
  titleBlock.append(titleRow, el("div", "app-ing-meta", "Loading…"));
  head.appendChild(titleBlock);
  const closeBtn = btn("✕", "app-btn app-docs-viewclose");
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", close);
  head.appendChild(closeBtn);
  sheet.appendChild(head);
  const body = el("div", "app-ing-body");
  sheet.appendChild(body);

  void (async () => {
    const ctx = await loadSiteCtx();
    if (dead) return;
    const src = ctx.ingestionLib;
    const dest = ctx.libraries.find((l) => l.listId.toLowerCase() === task.destListId) ?? null;
    const statusTerms = await readStatusTerms(ctx);
    if (dead) return;
    const meta = titleBlock.querySelector(".app-ing-meta")!;
    meta.textContent = `→ ${libName(dest ?? undefined)} · ${task.assignees.length} assignee${task.assignees.length === 1 ? "" : "s"} · created by ${task.createdByName || task.createdByEmail} ${task.createdAt !== "" ? formatWhen(task.createdAt) : ""}`;
    // a small chip beside the name, never a stretched band (Ben, 2026-10-09)
    titleRow.appendChild(statusChip(task.status === "closed" ? "✓ Closed" : task.status === "running" ? "◐ Running" : "● Open", task.status === "closed" ? "green" : "amber"));
    clear(body);
    if (src === null || dest === null || ctx.site === "") {
      body.appendChild(el("div", "app-cp-err", src === null ? "No ingestion library is exposed for this site (Settings → Documents → Libraries)." : "This task's destination library is no longer exposed."));
      return;
    }

    // the columns a file needs: the destination's required fields (live)
    // and the roles the register leans on, by label
    const fieldsRes = await fetchFields(ctx.site, dest.listId);
    const destFields: SpField[] = fieldsRes.ok ? fieldsFromResponse(fieldsRes.data) : [];
    const carried = new Set(dest.config.columns.filter((c) => c.available).map((c) => c.internal));
    const roleInternals = ["owner", "docType", "organisation"].map((r) => ctx.internalForRole(r)).filter((i) => i !== "" && carried.has(i));
    const required = destFields
      .filter((f) => (f.required || roleInternals.includes(f.internal)) && carried.has(f.internal) && f.internal !== ctx.internalForRole("status"))
      .map((f) => ({ internal: f.internal, label: ctx.dictBy.get(f.internal)?.label || f.title }));
    const statusInternal = ctx.internalForRole("status");
    const docIdInternal = ctx.internalForRole("documentId");
    const effInternal = ctx.internalForRole("effectiveDate");
    const importanceInternal = ctx.internalForRole("importance");
    // the source library's columns are the destination's (site columns);
    // the edit form reads the destination's configuration
    const formLib: DocLibrary = { ...src, config: dest.config };
    // the columns the REGISTER shows for the destination's type (the site
    // dictionary's default cells, in its order), plus the required ones
    const wanted = Array.from(new Set([...defaultColumnsFor(ctx.cellCtx.dict, [dest.libType]), ...required.map((r) => r.internal)])).filter((c) => carried.has(c));
    const feedFields = Array.from(new Set([...wanted, docIdInternal, effInternal, importanceInternal, statusInternal].filter((f) => f !== "")));

    // ---- actions row ---------------------------------------------------------
    const actions = el("div", "app-ing-actions");
    // greyed until EVERY file has its required details (Ben, 2026-10-09)
    let runBtn: HTMLButtonElement | null = null;
    const openFolder = linkBtn("Open folder ↗", `${ctx.origin}${task.folder}`, "app-btn app-btn-primary");
    openFolder.title = "The task's folder in SharePoint — add files there";
    actions.appendChild(openFolder);
    // (an "Edit in grid view" link landed on the same folder page as
    // Open folder — removed, Ben 2026-10-09; the note names the grid view)
    const selectedCount = el("span", "app-cp-muted app-ing-selcount", "");
    const setSel = btn("Set for selected…");
    setSel.disabled = true;
    const fillBtn = btn("Fill blanks from defaults");
    fillBtn.disabled = task.defaults.length === 0;
    fillBtn.title = task.defaults.length === 0 ? "No task defaults set (Edit task…)" : "Write each default into the files that lack it";
    // the folder is edited in SharePoint: a refresh re-reads it (Ben, 2026-10-09)
    const refresh = btn("↻ Refresh");
    refresh.title = "Re-read the folder's files and details";
    refresh.addEventListener("click", () => void reload());
    actions.append(setSel, fillBtn, refresh, selectedCount);
    const right = el("span", "app-ing-actions-right");
    if (o.isController && task.status !== "closed") {
      const edit = btn("Edit task…");
      edit.addEventListener("click", () => {
        let cancelled = false;
        openIngestionTaskEditor({
          task,
          onCancelled: () => {
            cancelled = true;
          },
          onSaved: () => {
            o.onChanged();
            close();
            if (!cancelled) openIngestionTask(o);
          },
        });
      });
      runBtn = btn("Run ingestion…", "app-btn app-btn-primary");
      runBtn.disabled = true;
      right.append(edit, runBtn);
      runBtn.addEventListener("click", () => void startRun());
    }
    actions.appendChild(right);
    body.appendChild(actions);
    body.appendChild(
      el("div", "app-field-hint", task.status === "closed" ? "This task is closed — its log is below." : "Add files to the folder, then set each file's details — open a row here, select rows and set one column for all, or use \"Edit in grid view\" in the folder itself. A document controller then runs the ingestion. A file moves only when every required detail is set; files that are refused stay here with the reason.")
    );

    // ---- the files ---------------------------------------------------------
    const listHost = el("div", "app-ing-list");
    body.appendChild(listHost);
    const status = el("div", "app-ing-status");
    body.appendChild(status);
    const selected = new Set<string>();
    let rows: DocRow[] = [];
    let lastLog = latestByFile(task.log);
    const paintSel = () => {
      selectedCount.textContent = selected.size > 0 ? `${selected.size} selected` : "";
      setSel.disabled = selected.size === 0;
    };
    const nameCell = makeNameCell(ctx.cellCtx);
    const selectCol = {
      key: "__sel",
      label: "",
      width: "28px",
      render: (row: DocRow) => {
        const box = el("input", "app-docs-libcheck") as HTMLInputElement;
        box.type = "checkbox";
        box.checked = selected.has(row.uniqueId);
        box.title = "Select";
        box.addEventListener("click", (e) => e.stopPropagation());
        box.addEventListener("change", () => {
          if (box.checked) selected.add(row.uniqueId);
          else selected.delete(row.uniqueId);
          paintSel();
        });
        return box;
      },
    };
    const readyCol = {
      key: "__ready",
      label: "Ready",
      width: "170px",
      render: (row: DocRow) => {
        const missing = missingFor(row.values, required);
        const last = lastLog.get(row.name);
        const cell = el("span", "app-ing-readycell");
        if (missing.length === 0) cell.appendChild(statusChip("✓ Ready", "green"));
        else {
          const pill = statusChip(`⚠ ${missing.length} missing`, "amber");
          pill.title = `Missing: ${missing.join(", ")}`;
          cell.appendChild(pill);
        }
        if (last && last.outcome === "refused") {
          const why = el("span", "app-field-hint app-ing-why", last.detail);
          why.title = last.detail;
          cell.appendChild(why);
        }
        return cell;
      },
    };
    const columns = [
      selectCol,
      { key: "name", label: "File", width: "minmax(180px, 1.4fr)", render: nameCell },
      ...buildRegisterColumns(ctx.cellCtx, { wanted, bucket: "full" }).filter((c) => c.key !== "name" && c.key !== "Modified"),
      readyCol,
    ];
    const list = mountDocList<DocRow>(listHost, {
      columns,
      onRow: (row) => {
        void import("./editProperties").then(({ openEditProperties }) =>
          openEditProperties({
            site: ctx.site,
            row,
            lib: formLib,
            dictBy: ctx.dictBy,
            host: sheet,
            heldByMe: false,
            sections: dialogSections(ctx.cellCtx.dict, dest.libType),
            ingestion: true,
            onDone: () => void reload(),
          })
        );
      },
      onNearEnd: () => undefined,
      emptyText: task.status === "closed" ? "Every file has moved." : "No files yet — open the folder and add them.",
      density: "compact",
    });
    const reload = async (): Promise<void> => {
      list.setLoading(true);
      const page = await renderListPage(ctx.site, src.listId, buildRenderViewXml({ fields: feedFields, rowLimit: 500, sortName: true, asc: true }), "", task.folder);
      if (dead) return;
      list.setLoading(false);
      if (page.error !== "") {
        status.textContent = `Could not read the folder: ${page.error}`;
        return;
      }
      rows = page.rows;
      for (const id of [...selected]) if (!rows.some((r) => r.uniqueId === id)) selected.delete(id);
      list.setRows(rows);
      paintSel();
      const ready = rows.filter((r) => missingFor(r.values, required).length === 0).length;
      status.textContent = rows.length === 0 ? "" : `${rows.length} file${rows.length === 1 ? "" : "s"} · ${ready} ready${task.log.length > 0 ? ` · log: ${logSummary(task.log)}` : ""}`;
      if (runBtn) {
        const allReady = rows.length > 0 && ready === rows.length;
        runBtn.disabled = !allReady || running;
        runBtn.title = rows.length === 0 ? "No files in the folder yet" : allReady ? "Copy every file into the destination as approved version 1" : `${rows.length - ready} file${rows.length - ready === 1 ? " is" : "s are"} missing required details — set them first`;
      }
    };
    await reload();

    // ---- bulk set --------------------------------------------------------------
    setSel.addEventListener("click", () => {
      const targets = rows.filter((r) => selected.has(r.uniqueId));
      if (targets.length === 0) return;
      const dlg = openDialog({
        host: sheet,
        title: `Set one detail for ${targets.length} file${targets.length === 1 ? "" : "s"}`,
        maxWidth: 520,
        buttons: [
          { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
          { label: "Set for selected", kind: "primary", onClick: () => void apply() },
        ],
      });
      const pick = el("select", "app-input") as HTMLSelectElement;
      // the destination type's offered columns, in the dictionary's order
      const offered = columnsForTypes(ctx.cellCtx.dict, [dest.libType]);
      const settable = offered.map((i) => destFields.find((f) => f.internal === i)).filter((f): f is SpField => f !== undefined && carried.has(f.internal) && f.internal !== statusInternal);
      for (const f of settable) {
        const opt = el("option", "", ctx.dictBy.get(f.internal)?.label || f.title) as HTMLOptionElement;
        opt.value = f.internal;
        pick.appendChild(opt);
      }
      const box = el("div", "app-ing-onefield");
      const note = el("div", "app-field-hint", "");
      dlg.body.append(el("div", "app-field-label", "Column"), pick, box, note);
      let editors: ReturnType<typeof buildFieldEditors> = [];
      const paint = () => {
        editors = buildFieldEditors({
          site: ctx.site,
          box,
          fields: destFields.filter((f) => f.internal === pick.value),
          columns: [{ internal: pick.value, available: true }],
          dictBy: ctx.dictBy,
          onChange: () => undefined,
          includeSystemDates: true,
        });
      };
      pick.addEventListener("change", paint);
      paint();
      const apply = async () => {
        const values = editors.filter((e) => !e.isEmpty()).map((e) => e.read());
        if (values.length === 0) {
          note.textContent = "Pick a value first.";
          return;
        }
        let done = 0;
        const refused: string[] = [];
        for (const row of targets) {
          note.textContent = `Writing ${done + 1} of ${targets.length}…`;
          const err = await writeValues(ctx.site, src.listId, row, values, `Set ${ctx.dictBy.get(pick.value)?.label ?? pick.value}`);
          if (err === "") done++;
          else refused.push(`${row.name}: ${err}`);
        }
        dlg.close();
        selected.clear();
        await reload();
        if (refused.length > 0) status.textContent = `${done} written; refused — ${refused.join("; ")}`.slice(0, 600);
      };
    });

    // ---- fill blanks from defaults ------------------------------------------
    fillBtn.addEventListener("click", () => {
      void (async () => {
        fillBtn.disabled = true;
        let written = 0;
        const refused: string[] = [];
        for (const row of rows) {
          const values = blanksToFill(row.values, task.defaults);
          if (values.length === 0) continue;
          status.textContent = `Filling ${row.name}…`;
          const err = await writeValues(ctx.site, src.listId, row, values, "Task defaults applied");
          if (err === "") written++;
          else refused.push(`${row.name}: ${err}`);
        }
        fillBtn.disabled = false;
        await reload();
        if (refused.length > 0) status.textContent = `${written} file${written === 1 ? "" : "s"} filled; refused — ${refused.join("; ")}`.slice(0, 600);
        else if (written === 0) status.textContent = "Nothing to fill — no file lacks a default's column.";
      })();
    });

    // ---- the run ----------------------------------------------------------------
    const startRun = async (): Promise<void> => {
      if (running) return;
      const approved = statusInternal !== "" ? termForStage(ctx.cellCtx.dict, "approved", statusTerms) : null;
      if (statusInternal !== "" && approved === null) {
        status.textContent = "No status term is mapped to the Approved stage (Settings → Documents → Lifecycle) — the run cannot publish.";
        return;
      }
      await reload();
      const ready = rows.filter((r) => missingFor(r.values, required).length === 0);
      const notReady = rows.length - ready.length;
      const ok = await promptConfirm({
        title: "Run the ingestion?",
        note: `${ready.length} file${ready.length === 1 ? "" : "s"} will be copied into ${libName(dest)}, published as an approved version 1 and removed from the folder.${notReady > 0 ? ` ${notReady} with missing details stay${notReady === 1 ? "s" : ""} here.` : ""} Keep this window open until it finishes.`,
        confirmLabel: "Run",
      });
      if (!ok || dead) return;
      running = true;
      closeBtn.disabled = true;
      task.status = "running";
      await saveIngestionTask(task).catch(() => undefined);
      const by = currentViewer()?.name ?? "";
      const [moderation, regional, destRootRes] = await Promise.all([fetchListModeration(ctx.site, dest.listId), fetchRegionalSettings(ctx.site), fetchListRoot(ctx.site, dest.listId)]);
      const moderated = ((moderation.data ?? {}) as { EnableModeration?: unknown }).EnableModeration === true;
      const localeId = Number(((regional.data ?? {}) as { LocaleId?: unknown }).LocaleId ?? 0) || 1033;
      const destRoot = String(((destRootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? "");
      const reviewInternal = ctx.internalForRole("nextReviewDate");
      const cadenceInternal = ctx.internalForRole("reviewCadence");
      const impSet = importanceInternal !== "" ? (ctx.dictBy.get(importanceInternal)?.termSetId ?? "") : "";
      const log = (file: string, outcome: RunLogEntry["outcome"], detail: string) => {
        task.log.push({ file, outcome, detail, at: new Date().toISOString(), by });
      };
      let n = 0;
      for (const row of ready) {
        if (dead) break;
        n++;
        status.textContent = `Ingesting ${n} of ${ready.length}: ${row.name}…`;
        const refuse = (why: string) => log(row.name, "refused", why);
        // document-ID collision: the app's own check (decision 4)
        const docId = docIdInternal !== "" ? (row.values[docIdInternal] ?? "").trim() : "";
        if (docId !== "" && carried.has(docIdInternal)) {
          const dup = await renderListPage(ctx.site, dest.listId, buildRenderViewXml({ textEquals: [{ col: docIdInternal, value: docId }], fields: [docIdInternal], rowLimit: 2 }));
          if (dup.rows.length > 0) {
            refuse(`Document ID "${docId}" is already used by "${dup.rows[0].name}"`);
            continue;
          }
        }
        if (destRoot === "") {
          refuse("The destination library's folder could not be read");
          continue;
        }
        const destUrl = `${destRoot}/${row.name}`;
        const copied = await copyFileByPath(ctx.site, `${ctx.origin}${row.serverUrl}`, `${ctx.origin}${destUrl}`);
        if (!copied.ok) {
          const text = spErrorText(copied.status);
          refuse(/already exists/i.test(text) ? `A file named "${row.name}" already exists in ${libName(dest)}` : `Copy refused: ${text}`);
          continue;
        }
        // the bracket on the copy: check-out → status + dates → major → publish
        const idRes = await fetchFileItemId(ctx.site, destUrl);
        const itemId = Number(((idRes.data ?? {}) as { Id?: unknown }).Id ?? 0);
        if (itemId === 0) {
          refuse("Copied, but the copy's item could not be read — check the destination by hand");
          continue;
        }
        const out = await checkOutFile(ctx.site, destUrl);
        if (!out.ok && !/already checked out/i.test(spErrorText(out.status))) {
          refuse(`Copied, but check-out was refused: ${spErrorText(out.status)}`);
          continue;
        }
        let bracketErr = "";
        if (approved !== null) {
          const r = await connectorPatchItem(ctx.site, dest.listId, itemId, { [statusInternal]: { Value: approved.label, TermGuid: approved.id, WssId: -1 } });
          if (!r.ok) bracketErr = `status: ${spErrorText(r.status)}`;
        }
        if (bracketErr === "" && (effInternal !== "" || reviewInternal !== "")) {
          // effective = the typed date, else today; review = effective + cadence
          const typed = (row.values[`${effInternal}.`] ?? row.values[effInternal] ?? "").slice(0, 10);
          const effYmd = /^\d{4}-\d{2}-\d{2}$/.test(typed) ? typed : todayYmd();
          let months: number | null = null;
          const impLabel = (row.values[importanceInternal] ?? "").split(";")[0].trim();
          if (impLabel !== "" && impSet !== "") {
            try {
              const walk = await cachedTermPaths(ctx.site, impSet);
              const node = walk.nodes.find((x) => x.labels[x.labels.length - 1].toLowerCase() === impLabel.toLowerCase());
              if (node !== undefined) months = cadenceForImportance(ctx.cellCtx.dict, node.id);
            } catch {
              /* unmapped = default */
            }
          }
          const m = months ?? DEFAULT_CADENCE_MONTHS;
          const stamps: { FieldName: string; FieldValue: string }[] = [];
          if (effInternal !== "" && carried.has(effInternal)) stamps.push({ FieldName: effInternal, FieldValue: formatDateForLocale(effYmd, localeId) });
          if (reviewInternal !== "" && carried.has(reviewInternal)) stamps.push({ FieldName: reviewInternal, FieldValue: formatDateForLocale(addMonthsYmd(effYmd, m), localeId) });
          if (cadenceInternal !== "" && carried.has(cadenceInternal)) stamps.push({ FieldName: cadenceInternal, FieldValue: String(m) });
          if (stamps.length > 0) {
            const r = await validateUpdateListItem(ctx.site, dest.listId, itemId, stamps, false);
            const errs = validateItemErrors(r.data);
            if (!r.ok || errs.length > 0) bracketErr = `dates: ${errs.map((x) => `${x.field}: ${x.message}`).join("; ") || spErrorText(r.status)}`;
          }
        }
        if (bracketErr !== "") {
          // the copy stays checked out as a draft in the destination; say so
          refuse(`Copied, but ${bracketErr} — the draft is checked out in ${libName(dest)}; finish or discard it there`);
          continue;
        }
        const ci = await checkInFile(ctx.site, destUrl, ingestComment(task.name, by), true);
        if (!ci.ok) {
          refuse(`Copied, but the major check-in was refused: ${spErrorText(ci.status)}`);
          continue;
        }
        if (moderated) {
          const pub = await validateUpdateListItem(ctx.site, dest.listId, itemId, [{ FieldName: "_ModerationStatus", FieldValue: "0" }], false);
          if (!pub.ok || validateItemErrors(pub.data).length > 0) {
            refuse(`Moved, but the publish was refused — it is PENDING in ${libName(dest)}: approve it in SharePoint`);
            await recycleFile(ctx.site, row.serverUrl);
            continue;
          }
        }
        const gone = await recycleFile(ctx.site, row.serverUrl);
        log(row.name, "moved", gone.ok ? destUrl : `${destUrl} (the source copy could not be recycled: ${spErrorText(gone.status)})`);
        await saveIngestionTask(task).catch(() => undefined);
      }
      // closes itself when the folder is empty (decision 6)
      const counts = await fetchFolderCounts(ctx.site, task.folder);
      const left = Number(((counts.data ?? {}) as { ItemCount?: unknown }).ItemCount ?? NaN);
      if (counts.ok && left === 0) {
        task.status = "closed";
        task.closedAt = new Date().toISOString();
        await recycleFolder(ctx.site, task.folder);
      } else task.status = "open";
      await saveIngestionTask(task).catch(() => undefined);
      running = false;
      closeBtn.disabled = false;
      lastLog = latestByFile(task.log);
      o.onChanged();
      if (task.status === "closed") {
        close();
        openIngestionTask(o);
        return;
      }
      await reload();
      const thisRun = task.log.slice(-ready.length);
      status.textContent = `Run finished — ${logSummary(thisRun)}. Refused files stay here with the reason in the Ready column.`;
    };

    // ---- the log, on a closed task ---------------------------------------
    if (task.status === "closed" && task.log.length > 0) {
      const logBox = el("div", "app-ing-log");
      logBox.appendChild(el("div", "app-field-label", `Run log · ${logSummary(task.log)}`));
      for (const e of task.log) {
        logBox.appendChild(el("div", "app-ing-logrow", `${e.outcome === "moved" ? "✓" : "⚠"} ${e.file} — ${e.detail} (${e.by}, ${formatWhen(e.at)})`));
      }
      body.appendChild(logBox);
    }
  })().catch((e) => {
    clear(body);
    body.appendChild(el("div", "app-cp-err", `Could not open the task: ${e instanceof Error ? e.message : String(e)}`));
  });
  return close;
}

// ---- the task editor (create / edit) -----------------------------------------

export interface IngestionEditorOpts {
  /** Absent = a new task. */
  task?: IngestionTask;
  onSaved: (task: IngestionTask) => void;
  /** The task was cancelled (removed) — the sheet behind closes. */
  onCancelled?: () => void;
}

export function openIngestionTaskEditor(o: IngestionEditorOpts): void {
  const isNew = o.task === undefined;
  const viewer = currentViewer();
  const t: IngestionTask = o.task
    ? { ...o.task, assignees: o.task.assignees.map((a) => ({ ...a })), defaults: o.task.defaults.map((d) => ({ ...d })), log: [...o.task.log] }
    : {
        rowId: "",
        name: "",
        siteUrl: "",
        sourceListId: "",
        folder: "",
        destListId: "",
        status: "open",
        assignees: [],
        defaults: [],
        log: [],
        createdByEmail: (viewer?.email ?? "").toLowerCase(),
        createdByName: viewer?.name ?? "",
        createdAt: new Date().toISOString(),
        closedAt: "",
      };
  const before = new Set(t.assignees.map((a) => a.email));
  const dlg = openDialog({
    host: document.body,
    title: isNew ? "New ingestion task" : "Edit ingestion task",
    maxWidth: 640,
    buttons: [
      // a controller may cancel a task (Ben, 2026-10-09): the row goes;
      // files already in the folder stay in the ingestion library
      ...(isNew ? [] : [{ label: "Cancel task…", kind: "danger" as const, onClick: () => void cancelTask() }]),
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      { label: isNew ? "Create task" : "Save task", kind: "primary" as const, onClick: () => void save() },
    ],
  });
  const cancelTask = async () => {
    const left = await folderItemCount(t);
    const ok = await promptConfirm({
      title: `Cancel the task "${t.name}"?`,
      note:
        left > 0
          ? `The task and its folder are removed, with the ${left} file${left === 1 ? "" : "s"} in it — they go to the site's recycle bin, where a document controller can restore them. Nothing is ingested.`
          : "The task and its empty folder are removed. Nothing is ingested.",
      confirmLabel: "Cancel task",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeIngestionTask(t, left);
      dlg.close();
      // cancelled BEFORE saved: the sheet behind closes and must not
      // reopen a task that no longer exists
      o.onCancelled?.();
      o.onSaved(t);
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const body = dlg.body;
  body.classList.add("app-ing-editor"); // fields take the dialog's width
  body.appendChild(el("div", "app-settings-note", "Loading…"));
  const err = el("div", "app-cp-err", "");
  let editors: ReturnType<typeof buildFieldEditors> = [];
  let ctx: SiteCtx | null = null;
  let destSel: HTMLSelectElement | null = null;
  let nameIn: HTMLInputElement | null = null;

  void (async () => {
    ctx = await loadSiteCtx();
    clear(body);
    if (ctx.ingestionLib === null) {
      body.appendChild(el("div", "app-cp-err", "No ingestion library is exposed for this site. Settings → Documents → Libraries: expose the bulk-drop library with the type \"Ingestion\"."));
      return;
    }
    const field = (label: string, control: HTMLElement, hint?: string) => {
      const f = el("div", "app-field");
      f.append(el("span", "app-field-label", label), control);
      if (hint) f.appendChild(el("span", "app-field-hint", hint));
      body.appendChild(f);
    };
    nameIn = el("input", "app-input") as HTMLInputElement;
    nameIn.value = t.name;
    nameIn.placeholder = "e.g. Legacy SOPs — Packaging";
    nameIn.disabled = !isNew; // the folder carries the name
    field("Task name", nameIn, isNew ? "Becomes the folder's name in the ingestion library." : "The folder carries the name; it cannot change.");
    destSel = el("select", "app-input") as HTMLSelectElement;
    for (const l of ctx.libraries.filter((l) => l.libType === "standard" || l.libType === "record" || l.libType === "working")) {
      const opt = el("option", "", `${libName(l)} (${l.libType})`) as HTMLOptionElement;
      opt.value = l.listId;
      if (l.listId.toLowerCase() === t.destListId) opt.selected = true;
      destSel.appendChild(opt);
    }
    destSel.disabled = !isNew;
    field("Destination library", destSel, isNew ? "Where the files land as approved version 1." : undefined);

    // assignees: chips + a directory search
    const peopleBox = el("div", "app-im-links");
    const paintPeople = () => {
      clear(peopleBox);
      for (const a of t.assignees) {
        const chip = el("span", "app-im-link");
        chip.appendChild(el("span", undefined, a.name || a.email));
        const x = btn("×", "app-im-link-x");
        x.title = "Remove";
        x.addEventListener("click", () => {
          t.assignees = t.assignees.filter((p) => p.email !== a.email);
          paintPeople();
        });
        chip.appendChild(x);
        peopleBox.appendChild(chip);
      }
    };
    paintPeople();
    const search = el("input", "app-input") as HTMLInputElement;
    search.placeholder = "Search the directory to add a person…";
    const hits = el("div", "app-ing-hits");
    let timer: ReturnType<typeof setTimeout> | null = null;
    search.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void searchEntra(search.value).then((found) => {
          clear(hits);
          for (const h of found.slice(0, 8)) {
            const mail = (h.mail ?? "").toLowerCase();
            if (mail === "" || t.assignees.some((a) => a.email === mail)) continue;
            const b = btn(`＋ ${h.displayName}`, "app-link");
            b.addEventListener("click", () => {
              t.assignees.push({ email: mail, name: h.displayName });
              paintPeople();
              clear(hits);
              search.value = "";
            });
            hits.appendChild(b);
          }
        });
      }, 250);
    });
    const assigneesWrap = el("div", "app-ing-people");
    assigneesWrap.append(peopleBox, search, hits);
    field("Assignees", assigneesWrap, "They see the task in Document tasks and get a Teams message. The folder is open to everyone; assignment is who is asked.");

    // task defaults: the destination's columns as editors
    const defaultsBox = el("div", "app-ing-defaults");
    const paintDefaults = async () => {
      const destId = destSel?.value ?? "";
      const dest = ctx!.libraries.find((l) => l.listId === destId);
      clear(defaultsBox);
      if (!dest) return;
      const fr = await fetchFields(ctx!.site, ctx!.ingestionLib!.listId);
      const fields = fr.ok ? fieldsFromResponse(fr.data) : [];
      const initial = new Map<string, { text?: string; people?: { email: string; name: string }[]; term?: { label: string; termId: string }; terms?: { label: string; termId: string }[] }>();
      for (const d of t.defaults) {
        if (d.kind === "taxonomy") initial.set(d.internal, d.multi === true && d.terms ? { terms: d.terms } : d.label && d.termId ? { term: { label: d.label, termId: d.termId } } : {});
        else if (d.kind === "person") initial.set(d.internal, { people: d.people ?? [] });
        else initial.set(d.internal, { text: d.text ?? "" });
      }
      const statusInternal = ctx!.internalForRole("status");
      editors = buildFieldEditors({
        site: ctx!.site,
        box: defaultsBox,
        fields: fields.filter((f) => f.internal !== statusInternal),
        columns: dest.config.columns,
        dictBy: ctx!.dictBy,
        onChange: () => undefined,
        initial,
        // the destination type's sections and order — the same form the
        // edit-properties dialog shows for that library
        sections: dialogSections(ctx!.cellCtx.dict, dest.libType),
        includeSystemDates: true,
      });
    };
    destSel.addEventListener("change", () => void paintDefaults());
    await paintDefaults();
    field("Task defaults", defaultsBox, "Values every file in this task shares — \"Fill blanks from defaults\" writes them into the files that lack them. Leave a column empty to set it per file.");
    body.appendChild(err);
  })().catch((e) => {
    clear(body);
    body.appendChild(el("div", "app-cp-err", e instanceof Error ? e.message : String(e)));
  });

  const save = async () => {
    if (ctx === null || ctx.ingestionLib === null || destSel === null || nameIn === null) return;
    const name = nameIn.value.trim();
    if (name === "") {
      err.textContent = "A task name is needed.";
      return;
    }
    if (destSel.value === "") {
      err.textContent = "Pick a destination library.";
      return;
    }
    err.textContent = "";
    try {
      t.defaults = editors.filter((e) => !e.isEmpty()).map((e) => e.read());
      if (isNew) {
        const rootRes = await fetchListRoot(ctx.site, ctx.ingestionLib.listId);
        const root = String(((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? "");
        if (root === "") throw new Error(`The ingestion library's folder could not be read: ${spErrorText(rootRes.status)}`);
        const folderName = taskFolderName(name);
        if (folderName === "") throw new Error("The task name leaves nothing usable as a folder name.");
        const made = await createFolder(ctx.site, `${root}/${folderName}`);
        if (!made.ok) throw new Error(`The folder could not be created: ${spErrorText(made.status)}`);
        t.name = name;
        t.siteUrl = ctx.site;
        t.sourceListId = ctx.ingestionLib.listId.toLowerCase();
        t.folder = `${root}/${folderName}`;
        t.destListId = destSel.value.toLowerCase();
      }
      await saveIngestionTask(t);
      // a Teams message to each NEW assignee (decision 7), best effort
      const fresh = t.assignees.filter((a) => !before.has(a.email) && a.email !== (currentViewer()?.email ?? "").toLowerCase());
      if (fresh.length > 0) {
        try {
          const { sendNotifyTeams } = await import("./notify");
          const dest = ctx.libraries.find((l) => l.listId.toLowerCase() === t.destListId);
          await sendNotifyTeams(
            fresh.map((a) => ({ name: a.name, email: a.email })),
            `Document ingestion: ${t.name}`,
            `You have been asked to help ingest documents into ${libName(dest)}. Add the files to the task's folder, set each file's details, and a document controller will run the ingestion. Open LeanBoard → Documents → Document tasks.`,
            appLinkUrl()
          );
        } catch {
          /* the task is saved; the message is a courtesy */
        }
      }
      dlg.close();
      o.onSaved(t);
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : String(e);
    }
  };
}

/** How many items the task's folder holds (0 when unreadable). */
async function folderItemCount(task: IngestionTask): Promise<number> {
  if (task.folder === "") return 0;
  const ctx = await loadSiteCtx();
  const counts = await fetchFolderCounts(ctx.site, task.folder);
  const left = Number(((counts.data ?? {}) as { ItemCount?: unknown }).ItemCount ?? NaN);
  return counts.ok && Number.isFinite(left) ? left : 0;
}

/** Cancel a task (controllers): the folder goes to the recycle bin WITH
 *  whatever it holds (Ben, 2026-10-09 — restorable there), then the row. */
export async function removeIngestionTask(task: IngestionTask, itemsLeft: number): Promise<void> {
  if (task.folder !== "") {
    const ctx = await loadSiteCtx();
    const r = await recycleFolder(ctx.site, task.folder);
    if (!r.ok && !/not exist|not found|404/i.test(r.status)) throw new Error(`The folder (${itemsLeft} item${itemsLeft === 1 ? "" : "s"}) could not be recycled: ${spErrorText(r.status)}`);
  }
  if (task.rowId !== "") await deleteIngestionTask(task.rowId);
}

export type { IngestionAssignee };
