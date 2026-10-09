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
import { RegisterCellCtx, makeNameCell } from "./registerCells";
import { Draft, applyToRows, dirtyRows, effectiveValues, savedDisplay, setCell, writesFor } from "./ingestionDraft";
import {
  AddFieldValue,
  DEFAULT_CADENCE_MONTHS,
  SpField,
  addMonthsYmd,
  cadenceForImportance,
  columnsForTypes,
  deriveTypeStates,
  dialogSections,
  emptySiteDictionary,
  fieldsFromResponse,
  formatDateForLocale,
  sanitizeFileName,
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
  fetchListRules,
  fetchRegionalSettings,
  fetchTermsInSet,
  moveFileByPath,
  recycleFile,
  recycleFolder,
  validateUpdateListItem,
} from "./sp";
import { buildFieldEditors, editorKind } from "./fieldEditors";
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

/** The app's own tooltip (a title shows as a bare ? cursor in the
 *  player, Ben 2026-10-09): on hover or focus, a small panel beside the
 *  element; gone on leave, blur or Esc. */
function attachTip(target: HTMLElement, text: string): void {
  let tip: HTMLElement | null = null;
  const hide = () => {
    tip?.remove();
    tip = null;
  };
  const show = () => {
    hide();
    tip = el("div", "app-ing-tip");
    for (const line of text.split("\n")) tip.appendChild(el("div", undefined, line));
    document.body.appendChild(tip);
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.top = `${r.bottom + 6}px`;
    tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
  };
  target.tabIndex = 0;
  target.addEventListener("mouseenter", show);
  target.addEventListener("focus", show);
  target.addEventListener("mouseleave", hide);
  target.addEventListener("blur", hide);
  target.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tip) hide();
    else show();
  });
}

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
async function writeValues(site: string, listId: string, row: DocRow, values: AddFieldValue[], comment: string, bracket = true): Promise<string> {
  const { formValues, patch } = splitAddWrites(values);
  if (formValues.length === 0 && Object.keys(patch).length === 0) return "";
  // the ingestion library has no check-out rule, so the writes go
  // straight in (two round trips, not four — Ben, 2026-10-09: "speed
  // these up"); a "not checked out" refusal falls back to the bracket
  if (!bracket) {
    const direct = await writeDirect(site, listId, row, formValues, patch);
    if (direct === "" || !/checked out/i.test(direct)) return direct;
  }
  const out = await checkOutFile(site, row.serverUrl);
  if (!out.ok && !/already checked out|checked out to you/i.test(spErrorText(out.status))) return `check-out refused: ${spErrorText(out.status)}`;
  const err = await writeDirect(site, listId, row, formValues, patch);
  if (err !== "") return err;
  const ci = await checkInFile(site, row.serverUrl, comment, true);
  if (!ci.ok && !/not checked out/i.test(spErrorText(ci.status))) return `check-in refused: ${spErrorText(ci.status)}`;
  return "";
}

async function writeDirect(site: string, listId: string, row: DocRow, formValues: { FieldName: string; FieldValue: string }[], patch: Record<string, unknown>): Promise<string> {
  if (formValues.length > 0) {
    const r = await validateUpdateListItem(site, listId, row.id, formValues, false);
    const errs = validateItemErrors(r.data);
    if (!r.ok || errs.length > 0) return errs.map((x) => `${x.field}: ${x.message}`).join("; ") || spErrorText(r.status);
  }
  if (Object.keys(patch).length > 0) {
    const r = await connectorPatchItem(site, listId, row.id, patch);
    if (!r.ok) return spErrorText(r.status);
  }
  return "";
}

/** Run `work` over `items`, at most `limit` at a time — brackets on
 *  different files are independent, and four in flight is well inside
 *  what SharePoint throttles. Order of completion is not the order of
 *  items. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** A progress bar with a time-remaining estimate from the files done so far. */
function progressBar(host: HTMLElement) {
  const wrap = el("div", "app-ing-progress");
  const bar = el("div", "app-ing-progressbar");
  const fill = el("div", "app-ing-progressfill");
  bar.appendChild(fill);
  const text = el("div", "app-ing-progresstext", "");
  wrap.append(bar, text);
  wrap.style.display = "none";
  host.appendChild(wrap);
  let total = 0;
  let done = 0;
  let started = 0;
  let verb = "";
  const paint = (current = "") => {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    fill.style.width = `${pct}%`;
    let eta = "";
    if (done >= 2 && done < total) {
      const per = (performance.now() - started) / done;
      const left = Math.round((per * (total - done)) / 1000);
      eta = left < 60 ? ` · about ${Math.max(left, 1)} s left` : ` · about ${Math.round(left / 60)} min left`;
    }
    text.textContent = `${verb} ${done} of ${total}${eta}${current !== "" ? ` — ${current}` : ""}`;
  };
  return {
    start: (n: number, what: string) => {
      total = n;
      done = 0;
      verb = what;
      started = performance.now();
      wrap.style.display = "";
      paint();
    },
    working: (current: string) => paint(current),
    tick: () => {
      done++;
      paint();
    },
    finish: () => {
      wrap.style.display = "none";
    },
  };
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
  /** Unsaved cells: the close asks before dropping them. */
  let unsavedCount = (): number => 0;
  const closeNow = () => {
    dead = true;
    untrap();
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const close = () => {
    if (running) return; // a run in flight is never abandoned by a stray Esc
    const n = unsavedCount();
    if (n === 0) {
      closeNow();
      return;
    }
    void promptConfirm({ title: "Discard unsaved changes?", note: `${n} file${n === 1 ? " has" : "s have"} details you have not saved.`, confirmLabel: "Discard", danger: true }).then((ok) => {
      if (ok) closeNow();
    });
  };
  const onKey = (e: KeyboardEvent) => {
    // a popover editor or a dialog on the sheet takes Esc for itself
    if (e.key === "Escape" && !sheet.querySelector(".ltk-dialog-overlay, .app-ing-pop")) close();
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
    const reviewInternal = ctx.internalForRole("nextReviewDate");
    const cadenceInternal = ctx.internalForRole("reviewCadence");
    // the grid's columns (proposal §9): EVERY column the destination type
    // offers, in the site dictionary's order — the Edit-properties form's
    // set — minus the status (the run sets it) and the two derived dates
    const derived = new Set([statusInternal, reviewInternal, cadenceInternal].filter((x) => x !== ""));
    const gridFields = columnsForTypes(ctx.cellCtx.dict, [dest.libType])
      .map((i) => destFields.find((f) => f.internal === i))
      .filter((f): f is SpField => f !== undefined && carried.has(f.internal) && !derived.has(f.internal) && editorKind(f) !== null);
    const requiredSet = new Set(required.map((r) => r.internal));
    // "Name on ingestion" (Ben, 2026-10-09): a synthetic first column — the
    // file's stem; a change RENAMES the file in the folder on Save, so
    // the copy carries the new name and the grid view shows it too
    const NAME: SpField = { internal: "__name", title: "Name on ingestion", type: "Text", choices: [], isTaxonomy: false, termSetId: "", required: false };
    const stemOf = (name: string) => {
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(0, dot) : name;
    };
    const extPart = (name: string) => {
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(dot) : "";
    };
    const gridCols: SpField[] = [NAME, ...gridFields];
    const feedFields = Array.from(new Set([...gridFields.map((f) => f.internal), ...required.map((r) => r.internal), docIdInternal, effInternal, importanceInternal, statusInternal].filter((f) => f !== "")));

    // ---- actions row ---------------------------------------------------------
    const actions = el("div", "app-ing-actions");
    // greyed until EVERY file has its required details (Ben, 2026-10-09)
    let runBtn: HTMLButtonElement | null = null;
    const openFolder = linkBtn("Open folder ↗", `${ctx.origin}${task.folder}`, "app-btn");
    openFolder.title = "The task's folder in SharePoint — add files there";
    // (an "Edit in grid view" link landed on the same folder page as
    // Open folder — removed, Ben 2026-10-09; the note names the grid view)
    const selectedCount = el("span", "app-cp-muted app-ing-selcount", "");
    const setSel = btn("Set for selected…");
    setSel.disabled = true;
    const fillBtn = btn("Fill blanks from defaults");
    fillBtn.disabled = task.defaults.length === 0;
    fillBtn.title = task.defaults.length === 0 ? "No task defaults set (Edit task…)" : "Put each default into the files that lack it (saved with Save changes)";
    // the folder is edited in SharePoint: a refresh re-reads it (Ben, 2026-10-09)
    const refresh = btn("↻ Refresh");
    refresh.title = "Re-read the folder's files and details";
    refresh.addEventListener("click", () => void reloadGuarded());
    // a quick filter over every cell, and a fit-to-width toggle (Ben, 2026-10-09)
    const search = el("input", "app-input app-ing-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = "Filter files…";
    search.title = "Show the files whose name or any detail contains this";
    const fitBtn = btn("Fit to width");
    fitBtn.title = "Shrink every column so the whole grid fits without sideways scrolling";
    // the draft model (proposal §9): cells change here; Save writes each
    // touched file once
    const saveBtn = btn("Save changes", "app-btn app-btn-primary app-ing-save");
    saveBtn.disabled = true;
    const discardBtn = btn("Discard", "app-link");
    discardBtn.style.display = "none";
    // Refresh, Save and Discard at the far right (Ben, 2026-10-09)
    const farRight = el("span", "app-ing-actions-right");
    farRight.append(discardBtn, refresh, saveBtn);
    actions.append(setSel, fillBtn, search, fitBtn, selectedCount, farRight);
    // the task-level buttons live in the title row, before ✕ (Ben, 2026-10-09)
    const right = el("span", "app-ing-headactions");
    right.appendChild(openFolder); // (Ben, 2026-10-09: with the task buttons)
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
            closeNow();
            if (!cancelled) openIngestionTask(o);
          },
        });
      });
      runBtn = btn("Run ingestion…", "app-btn app-btn-primary");
      runBtn.disabled = true;
      const closeTask = btn("Close task…");
      closeTask.title = "The batch is complete: the folder goes, the task keeps its log";
      closeTask.addEventListener("click", () => void closeOut());
      right.append(edit, closeTask, runBtn);
      runBtn.addEventListener("click", () => void startRun());
    }
    head.insertBefore(right, closeBtn);
    body.appendChild(actions);
    body.appendChild(
      el("div", "app-field-hint", task.status === "closed" ? "This task is closed — its log is below." : "Add files to the folder, then set each file's details in the grid (✱ = required; Tab moves across, Enter down) — or select rows and set one column for all. Save changes writes them. A document controller then runs the ingestion; files that are refused stay here with the reason.")
    );

    // ---- the files: the editable grid (proposal §9) ------------------------
    const gridHost = el("div", "app-ing-grid");
    body.appendChild(gridHost);
    const status = el("div", "app-ing-status");
    body.appendChild(status);
    const progress = progressBar(body);
    // writes on the ingestion library skip the bracket unless it asks
    const srcRules = await fetchListRules(ctx.site, src.listId);
    const srcForcesCheckout = ((srcRules.data ?? {}) as { ForceCheckout?: unknown }).ForceCheckout === true;
    const selected = new Set<string>();
    let rows: DocRow[] = [];
    let lastLog = latestByFile(task.log);
    const draft: Draft = new Map();
    unsavedCount = () => dirtyRows(draft).length;
    const nameCell = makeNameCell(ctx.cellCtx);
    const labelOf = (f: SpField) => ctx.dictBy.get(f.internal)?.label || f.title;
    // term label → id per set, resolved lazily so a taxonomy cell can open
    // with its current term selected (the feed gives labels only)
    const termIds = new Map<string, Promise<Map<string, string>>>();
    const termIdsFor = (setId: string): Promise<Map<string, string>> => {
      let p = termIds.get(setId);
      if (!p) {
        p = cachedTermPaths(ctx.site, setId)
          .then((w) => new Map(w.nodes.map((n) => [n.labels[n.labels.length - 1].toLowerCase(), n.id])))
          .catch(() => new Map<string, string>());
        termIds.set(setId, p);
      }
      return p;
    };
    const paintSel = () => {
      selectedCount.textContent = selected.size > 0 ? `${selected.size} selected` : "";
      setSel.disabled = selected.size === 0;
    };
    const paintDirty = () => {
      const n = dirtyRows(draft).length;
      saveBtn.disabled = n === 0;
      saveBtn.textContent = n > 0 ? `Save changes (${n} file${n === 1 ? "" : "s"})` : "Save changes";
      discardBtn.style.display = n > 0 ? "" : "none";
      for (const r of rows) {
        const rowEl = gridHost.querySelector<HTMLElement>(`[data-row="${r.uniqueId}"]`);
        if (rowEl) rowEl.classList.toggle("app-ing-row-dirty", draft.has(r.uniqueId));
      }
      if (runBtn) {
        runBtn.disabled = n > 0 || !allReadySaved() || running;
        if (n > 0) runBtn.title = "Save changes first";
      }
    };
    const allReadySaved = () => rows.length > 0 && rows.every((r) => missingFor(r.values, required).length === 0);
    /** A glyph at the end of the frozen Document cell (Ben, 2026-10-09:
     *  a right-frozen column was clunky): ✓ ready, ⚠ with what is missing
     *  and the last refusal in the tooltip. */
    const readyMark = (row: DocRow): HTMLElement => {
      const missing = missingFor(effectiveValues(row.values, draft.get(row.uniqueId)), required);
      const last = lastLog.get(row.name);
      const refused = last && last.outcome === "refused" ? `\nLast run: ${last.detail}` : "";
      const mark = el("span", "app-ing-readymark " + (missing.length === 0 ? "app-ing-readymark-ok" : "app-ing-readymark-warn"), missing.length === 0 ? "✓" : "⚠");
      const text = (missing.length === 0 ? "Ready to ingest" : `Missing: ${missing.join(", ")}`) + refused;
      mark.setAttribute("aria-label", text);
      attachTip(mark, text);
      return mark;
    };
    const repaintReady = (row: DocRow) => {
      const old = gridHost.querySelector<HTMLElement>(`[data-row="${row.uniqueId}"] .app-ing-readymark`);
      if (old) old.replaceWith(readyMark(row));
    };
    const commit = (row: DocRow, v: AddFieldValue) => {
      setCell(draft, row.uniqueId, row.values, v);
      const cellEl = gridHost.querySelector<HTMLElement>(`[data-row="${row.uniqueId}"] [data-col="${v.internal}"]`);
      if (cellEl) cellEl.classList.toggle("app-ing-cell-dirty", draft.get(row.uniqueId)?.has(v.internal) === true);
      repaintReady(row);
      paintDirty();
    };
    /** Enter moves to the same column one row down (the values grid's
     *  grammar); Esc puts the cell back as it reads now. */
    const keyNav = (ctl: HTMLElement, row: DocRow, f: SpField, revert: () => void) => {
      ctl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !(ctl instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          (ctl as HTMLInputElement).blur();
          const i = shown.findIndex((r) => r.uniqueId === row.uniqueId);
          const next = shown[i + 1];
          if (next) gridHost.querySelector<HTMLElement>(`[data-row="${next.uniqueId}"] [data-col="${f.internal}"] input, [data-row="${next.uniqueId}"] [data-col="${f.internal}"] select, [data-row="${next.uniqueId}"] [data-col="${f.internal}"] button`)?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          revert();
          (ctl as HTMLInputElement).blur();
        }
      });
    };
    /** The cell's value as something the forms could WRITE: the draft's,
     *  else the saved value lifted — terms through the set's walk, people
     *  from the feed's email twin. Null when it reads blank. */
    const valueOf = async (row: DocRow, f: SpField): Promise<AddFieldValue | null> => {
      const d = draft.get(row.uniqueId)?.get(f.internal);
      if (d) return d;
      const kind = editorKind(f) ?? "text";
      if (kind === "taxonomy") {
        if (f.termSetId === "") return null;
        const ids = await termIdsFor(f.termSetId);
        const terms = (row.values[f.internal] ?? "").split(";").map((x) => x.trim()).filter((x) => x !== "").map((l) => ({ label: l, termId: ids.get(l.toLowerCase()) ?? "" })).filter((t) => t.termId !== "");
        if (terms.length === 0) return null;
        return f.type === "TaxonomyFieldTypeMulti" ? { internal: f.internal, kind, multi: true, terms, label: terms[0].label, termId: terms[0].termId } : { internal: f.internal, kind, label: terms[0].label, termId: terms[0].termId };
      }
      if (kind === "person") {
        const names = (row.values[f.internal] ?? "").split(";").map((x) => x.trim());
        const emails = (row.values[`${f.internal}#email`] ?? "").split(";").map((x) => x.trim().toLowerCase());
        const people = emails.map((email, i) => ({ email, name: names[i] ?? email })).filter((p) => p.email !== "");
        return people.length === 0 ? null : { internal: f.internal, kind, people };
      }
      const text = savedDisplay(row.values, f.internal, kind);
      return text === "" ? null : { internal: f.internal, kind, text };
    };
    /** Excel's fill handle (Ben, 2026-10-09): drag the corner of a cell
     *  down and the rows passed over take its value, in the draft. */
    const startFill = (e: PointerEvent, row: DocRow, f: SpField) => {
      e.preventDefault();
      e.stopPropagation();
      const from = shown.findIndex((r) => r.uniqueId === row.uniqueId);
      let to = from;
      const mark = () => {
        gridHost.querySelectorAll<HTMLElement>(".app-ing-fillmark").forEach((c) => c.classList.remove("app-ing-fillmark"));
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
          gridHost.querySelector<HTMLElement>(`[data-row="${shown[i].uniqueId}"] [data-col="${f.internal}"]`)?.classList.add("app-ing-fillmark");
        }
      };
      const move = (ev: PointerEvent) => {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-row]");
        if (!hit) return;
        const i = shown.findIndex((r) => r.uniqueId === hit.dataset.row);
        if (i >= 0 && i !== to) {
          to = i;
          mark();
        }
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        gridHost.querySelectorAll<HTMLElement>(".app-ing-fillmark").forEach((c) => c.classList.remove("app-ing-fillmark"));
        if (to === from) return;
        void valueOf(row, f).then((v) => {
          if (!v) return;
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
            const target = shown[i];
            if (target.uniqueId === row.uniqueId) continue;
            commit(target, { ...v, internal: f.internal });
            const cellEl = gridHost.querySelector<HTMLElement>(`[data-row="${target.uniqueId}"] [data-col="${f.internal}"]`);
            if (cellEl) paintCell(cellEl, target, f);
          }
        });
      };
      mark();
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    };
    /** The cell's current reading: the draft's, else the saved value. */
    const current = (row: DocRow, f: SpField): string => {
      const d = draft.get(row.uniqueId)?.get(f.internal);
      const kind = editorKind(f) ?? "text";
      return d ? (kind === "date" ? (d.text ?? "") : effectiveValues(row.values, draft.get(row.uniqueId))[f.internal] ?? "") : savedDisplay(row.values, f.internal, kind);
    };
    /** A popover with the FORM editor for one field, anchored to the cell —
     *  taxonomy, people, notes: the pickers already know these kinds. */
    const openCellPopover = async (anchor: HTMLElement, row: DocRow, f: SpField) => {
      document.querySelectorAll(".app-ing-pop").forEach((p) => p.remove());
      const pop = el("div", "app-cp-menu app-ing-pop");
      const box = el("div", "app-ing-popbody");
      const bar = el("div", "app-ing-popbar");
      const set = btn("Set", "app-btn app-btn-primary");
      const cancel = btn("Cancel", "app-link");
      bar.append(cancel, set);
      pop.append(box, bar);
      // the current value as the editor's starting point
      const initial = new Map<string, { text?: string; people?: { email: string; name: string }[]; term?: { label: string; termId: string }; terms?: { label: string; termId: string }[] }>();
      const v = await valueOf(row, f);
      if (v) {
        if (v.kind === "taxonomy") initial.set(f.internal, v.multi === true && v.terms ? { terms: v.terms } : v.label && v.termId ? { term: { label: v.label, termId: v.termId } } : {});
        else if (v.kind === "person") initial.set(f.internal, { people: v.people ?? [] });
        else initial.set(f.internal, { text: v.text ?? "" });
      }
      const editors = buildFieldEditors({ site: ctx.site, box, fields: [f], columns: [{ internal: f.internal, available: true }], dictBy: ctx.dictBy, onChange: () => undefined, initial, includeSystemDates: true });
      const closePop = () => {
        pop.remove();
        document.removeEventListener("pointerdown", off, true);
        document.removeEventListener("keydown", onPopKey, true);
      };
      const off = (e: PointerEvent) => {
        if (!pop.contains(e.target as Node)) closePop();
      };
      const onPopKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePop();
        }
      };
      cancel.addEventListener("click", closePop);
      set.addEventListener("click", () => {
        const v = editors[0]?.read();
        closePop();
        if (v) {
          commit(row, v);
          const cellEl = gridHost.querySelector<HTMLElement>(`[data-row="${row.uniqueId}"] [data-col="${f.internal}"]`);
          if (cellEl) paintCell(cellEl, row, f);
        }
      });
      const r = anchor.getBoundingClientRect();
      pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 380)}px`;
      pop.style.left = `${Math.min(r.left, window.innerWidth - 400)}px`;
      document.body.appendChild(pop);
      setTimeout(() => {
        document.addEventListener("pointerdown", off, true);
        document.addEventListener("keydown", onPopKey, true);
        box.querySelector<HTMLElement>("input, select, textarea")?.focus();
      }, 0);
    };
    /** One cell: a control in place for the simple kinds, a button
     *  opening the popover for the rest. */
    const paintCell = (cellEl: HTMLElement, row: DocRow, f: SpField) => {
      clear(cellEl);
      const kind = editorKind(f) ?? "text";
      const value = current(row, f);
      if (kind === "choice") {
        const sel = el("select", "app-input app-ing-ctl") as HTMLSelectElement;
        const ph = el("option", "", "—") as HTMLOptionElement;
        ph.value = "";
        sel.appendChild(ph);
        for (const c of f.choices) {
          const o = el("option", "", c) as HTMLOptionElement;
          o.value = c;
          sel.appendChild(o);
        }
        if (f.choices.includes(value)) sel.value = value;
        sel.addEventListener("change", () => commit(row, { internal: f.internal, kind: "choice", text: sel.value }));
        keyNav(sel, row, f, () => (sel.value = current(row, f)));
        cellEl.appendChild(sel);
      } else if (kind === "date") {
        const inp = el("input", "app-input app-ing-ctl") as HTMLInputElement;
        inp.type = "date";
        inp.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
        inp.addEventListener("change", () => commit(row, { internal: f.internal, kind: "date", text: inp.value }));
        keyNav(inp, row, f, () => (inp.value = current(row, f)));
        cellEl.appendChild(inp);
      } else if (kind === "text" && f.type !== "Note") {
        const inp = el("input", "app-input app-ing-ctl") as HTMLInputElement;
        inp.value = value;
        inp.addEventListener("change", () => commit(row, { internal: f.internal, kind: "text", text: inp.value }));
        keyNav(inp, row, f, () => (inp.value = current(row, f)));
        cellEl.appendChild(inp);
      } else {
        const b = btn(value !== "" ? value : "—", "app-ing-cellbtn" + (value === "" ? " app-ing-cellbtn-empty" : ""));
        b.title = value !== "" ? `${value} — click to change` : `Set ${labelOf(f)}`;
        b.addEventListener("click", () => void openCellPopover(b, row, f));
        cellEl.appendChild(b);
      }
      if (f !== NAME) {
        const handle = el("span", "app-ing-fillhandle");
        handle.title = "Drag down to fill";
        handle.addEventListener("pointerdown", (e) => startFill(e, row, f));
        cellEl.appendChild(handle);
      }
    };
    // the VIEW: the rows after the filter and the sort — what the grid
    // paints and what Enter-down and the fill handle walk
    let filterText = "";
    let sortKey = "__name";
    let sortAsc = true;
    let fit = false;
    let shown: DocRow[] = [];
    const cellText = (row: DocRow, internal: string): string => effectiveValues(row.values, draft.get(row.uniqueId))[internal] ?? "";
    const computeView = () => {
      const q = filterText.trim().toLowerCase();
      const keys = gridCols.map((f) => f.internal);
      let v = q === "" ? [...rows] : rows.filter((r) => r.name.toLowerCase().includes(q) || keys.some((k) => cellText(r, k).toLowerCase().includes(q)));
      const col = gridCols.find((f) => f.internal === sortKey);
      const isDate = col ? editorKind(col) === "date" : false;
      const num = (s: string) => (s !== "" && !Number.isNaN(Number(s)) ? Number(s) : null);
      v = v.sort((a, b) => {
        const x = sortKey === "__name" ? a.name : isDate ? savedDisplay(effectiveValues(a.values, draft.get(a.uniqueId)), sortKey, "date") : cellText(a, sortKey);
        const y = sortKey === "__name" ? b.name : isDate ? savedDisplay(effectiveValues(b.values, draft.get(b.uniqueId)), sortKey, "date") : cellText(b, sortKey);
        // blanks last either way; numbers as numbers; otherwise natural text
        if (x === "" && y !== "") return 1;
        if (y === "" && x !== "") return -1;
        const nx = num(x);
        const ny = num(y);
        const c = nx !== null && ny !== null ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
        return sortAsc ? c : -c;
      });
      shown = v;
    };
    search.addEventListener("input", () => {
      filterText = search.value;
      paintGrid();
    });
    fitBtn.addEventListener("click", () => {
      fit = !fit;
      fitBtn.textContent = fit ? "Normal width" : "Fit to width";
      fitBtn.title = fit ? "Back to full-width columns with sideways scrolling" : "Shrink every column so the whole grid fits without sideways scrolling";
      gridHost.classList.toggle("app-ing-grid-fit", fit);
      paintGrid();
    });
    const template = () => (fit ? `minmax(200px, 1.6fr) minmax(0, 1.2fr) ${gridFields.map(() => "minmax(0, 1fr)").join(" ")}` : `320px minmax(220px, 1.3fr) ${gridFields.map(() => "minmax(170px, 1fr)").join(" ")}`);
    const paintGrid = () => {
      computeView();
      clear(gridHost);
      const head = el("div", "app-ing-gridrow app-ing-gridhead");
      head.style.gridTemplateColumns = template();
      const docHead = el("div", "app-ing-cell app-ing-cell-doc", "");
      const all = el("input", "app-docs-libcheck") as HTMLInputElement;
      all.type = "checkbox";
      all.title = "Select all";
      all.checked = shown.length > 0 && shown.every((r) => selected.has(r.uniqueId));
      all.title = filterText.trim() !== "" ? "Select the files shown" : "Select all";
      all.addEventListener("change", () => {
        for (const r of shown) {
          if (all.checked) selected.add(r.uniqueId);
          else selected.delete(r.uniqueId);
        }
        paintSel();
        paintGrid();
      });
      docHead.append(all, el("span", undefined, "Document"));
      head.appendChild(docHead);
      for (const f of gridCols) {
        const h = el("div", "app-ing-cell app-ing-sorthead");
        const b = btn(labelOf(f) + (requiredSet.has(f.internal) ? " ✱" : "") + (sortKey === f.internal ? (sortAsc ? " ▲" : " ▼") : ""), "app-link app-ing-sortbtn");
        b.title = (f === NAME ? "The document's name once ingested — change it here; the extension stays. " : requiredSet.has(f.internal) ? "Required before the file can move. " : "") + "Click to sort";
        b.addEventListener("click", () => {
          if (sortKey === f.internal) sortAsc = !sortAsc;
          else {
            sortKey = f.internal;
            sortAsc = true;
          }
          paintGrid();
        });
        h.appendChild(b);
        head.appendChild(h);
      }
      gridHost.appendChild(head);
      if (rows.length === 0) {
        gridHost.appendChild(el("div", "app-ing-empty", task.status === "closed" ? "Every file has moved." : "No files yet — open the folder and add them, then Refresh."));
        return;
      }
      if (shown.length === 0) {
        gridHost.appendChild(el("div", "app-ing-empty", `No file matches "${filterText.trim()}".`));
        return;
      }
      for (const row of shown) {
        const rowEl = el("div", "app-ing-gridrow" + (draft.has(row.uniqueId) ? " app-ing-row-dirty" : ""));
        rowEl.dataset.row = row.uniqueId;
        rowEl.style.gridTemplateColumns = template();
        const doc = el("div", "app-ing-cell app-ing-cell-doc");
        const box = el("input", "app-docs-libcheck") as HTMLInputElement;
        box.type = "checkbox";
        box.checked = selected.has(row.uniqueId);
        box.addEventListener("change", () => {
          if (box.checked) selected.add(row.uniqueId);
          else selected.delete(row.uniqueId);
          paintSel();
        });
        doc.append(box, el("span", "app-ing-dirtydot", "●"), nameCell(row), readyMark(row));
        rowEl.appendChild(doc);
        for (const f of gridCols) {
          const c = el("div", "app-ing-cell app-ing-cell-edit" + (draft.get(row.uniqueId)?.has(f.internal) ? " app-ing-cell-dirty" : ""));
          c.dataset.col = f.internal;
          paintCell(c, row, f);
          rowEl.appendChild(c);
        }
        gridHost.appendChild(rowEl);
      }
    };
    const reload = async (): Promise<void> => {
      status.textContent = "Reading the folder…";
      const page = await renderListPage(ctx.site, src.listId, buildRenderViewXml({ fields: feedFields, rowLimit: 500, sortName: true, asc: true }), "", task.folder);
      if (dead) return;
      if (page.error !== "") {
        status.textContent = `Could not read the folder: ${page.error}`;
        return;
      }
      rows = page.rows;
      for (const r of rows) r.values.__name = stemOf(r.name);
      for (const id of [...selected]) if (!rows.some((r) => r.uniqueId === id)) selected.delete(id);
      for (const id of [...draft.keys()]) if (!rows.some((r) => r.uniqueId === id)) draft.delete(id);
      paintGrid();
      paintSel();
      const ready = rows.filter((r) => missingFor(r.values, required).length === 0).length;
      status.textContent = rows.length === 0 ? "" : `${rows.length} file${rows.length === 1 ? "" : "s"} · ${ready} ready${task.log.length > 0 ? ` · log: ${logSummary(task.log)}` : ""}`;
      if (runBtn) {
        const allReady = rows.length > 0 && ready === rows.length;
        runBtn.disabled = !allReady || running || dirtyRows(draft).length > 0;
        runBtn.title = rows.length === 0 ? "No files in the folder yet" : allReady ? "Copy every file into the destination as approved version 1" : `${rows.length - ready} file${rows.length - ready === 1 ? " is" : "s are"} missing required details — set them first`;
      }
      paintDirty();
    };
    /** A refresh with drafts asks first — SharePoint's reading would
     *  replace what is typed here. */
    const reloadGuarded = async (): Promise<void> => {
      const n = dirtyRows(draft).length;
      if (n > 0) {
        const ok = await promptConfirm({ title: "Discard unsaved changes?", note: `Refreshing re-reads the folder; ${n} file${n === 1 ? " has" : "s have"} details you have not saved.`, confirmLabel: "Discard and refresh", danger: true });
        if (!ok) return;
        draft.clear();
      }
      await reload();
    };
    await reload();

    // ---- save / discard ------------------------------------------------------
    saveBtn.addEventListener("click", () => {
      void (async () => {
        const ids = dirtyRows(draft);
        if (ids.length === 0) return;
        saveBtn.disabled = true;
        const refused: string[] = [];
        progress.start(ids.length, "Saving");
        status.textContent = "";
        const saveOne = async (id: string): Promise<void> => {
          const row = rows.find((r) => r.uniqueId === id);
          if (!row) return;
          progress.working(row.name);
          const all = writesFor(draft, id);
          const nameV = all.find((v) => v.internal === NAME.internal);
          let target = row;
          if (nameV) {
            const stem = sanitizeFileName(nameV.text ?? "");
            if (stem === "") {
              refused.push(`${row.name}: the new name leaves nothing usable`);
              return;
            }
            const newName = `${stem}${extPart(row.name)}`;
            const newUrl = `${task.folder}/${newName}`;
            const mv = await moveFileByPath(ctx.site, `${ctx.origin}${row.serverUrl}`, `${ctx.origin}${newUrl}`);
            if (!mv.ok) {
              const text = spErrorText(mv.status);
              refused.push(`${row.name}: rename refused — ${/already exists/i.test(text) ? `"${newName}" is already in the folder` : text}`);
              return;
            }
            target = { ...row, name: newName, serverUrl: newUrl };
            draft.get(id)?.delete(NAME.internal);
          }
          const err = await writeValues(ctx.site, src.listId, target, all.filter((v) => v.internal !== NAME.internal), "Details set", srcForcesCheckout);
          if (err === "") draft.delete(id);
          else refused.push(`${target.name}: ${err}`);
        };
        await pool(ids, 4, async (id) => {
          await saveOne(id);
          progress.tick();
        });
        progress.finish();
        await reload();
        if (refused.length > 0) status.textContent = `${ids.length - refused.length} saved; refused — ${refused.join("; ")}`.slice(0, 600);
      })();
    });
    discardBtn.addEventListener("click", () => {
      void promptConfirm({ title: "Discard unsaved changes?", note: `${dirtyRows(draft).length} file${dirtyRows(draft).length === 1 ? " has" : "s have"} details you have not saved.`, confirmLabel: "Discard", danger: true }).then((ok) => {
        if (!ok) return;
        draft.clear();
        paintGrid();
        paintDirty();
      });
    });

    // ---- bulk set (into the draft) ------------------------------------------
    setSel.addEventListener("click", () => {
      const targets = rows.filter((r) => selected.has(r.uniqueId));
      if (targets.length === 0) return;
      const dlg = openDialog({
        host: sheet,
        title: `Set one detail for ${targets.length} file${targets.length === 1 ? "" : "s"}`,
        maxWidth: 520,
        buttons: [
          { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
          { label: "Set for selected", kind: "primary", onClick: () => apply() },
        ],
      });
      const pick = el("select", "app-input") as HTMLSelectElement;
      for (const f of gridFields) {
        const opt = el("option", "", labelOf(f)) as HTMLOptionElement;
        opt.value = f.internal;
        pick.appendChild(opt);
      }
      const box = el("div", "app-ing-onefield");
      const note = el("div", "app-field-hint", "The value lands in the grid; Save changes writes it.");
      dlg.body.append(el("div", "app-field-label", "Column"), pick, box, note);
      let editors: ReturnType<typeof buildFieldEditors> = [];
      const paint = () => {
        editors = buildFieldEditors({ site: ctx.site, box, fields: gridFields.filter((f) => f.internal === pick.value), columns: [{ internal: pick.value, available: true }], dictBy: ctx.dictBy, onChange: () => undefined, includeSystemDates: true });
      };
      pick.addEventListener("change", paint);
      paint();
      const apply = () => {
        const values = editors.filter((e) => !e.isEmpty()).map((e) => e.read());
        if (values.length === 0) {
          note.textContent = "Pick a value first.";
          return;
        }
        const touched = applyToRows(draft, targets, values, false);
        dlg.close();
        selected.clear();
        paintGrid();
        paintSel();
        paintDirty();
        status.textContent = `${touched} file${touched === 1 ? "" : "s"} changed in the grid — Save changes writes them.`;
      };
    });

    // ---- fill blanks from defaults (into the draft) ---------------------------
    fillBtn.addEventListener("click", () => {
      const touched = applyToRows(draft, rows, task.defaults, true);
      paintGrid();
      paintDirty();
      status.textContent = touched === 0 ? "Nothing to fill — no file lacks a default's column." : `${touched} file${touched === 1 ? "" : "s"} filled in the grid — Save changes writes them.`;
    });

    // ---- the run ----------------------------------------------------------------
    const startRun = async (): Promise<void> => {
      if (running || dirtyRows(draft).length > 0) return;
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
      // files in flight four at a time (Ben, 2026-10-09: speed); the
      // task row is saved through one chain so the writes never race
      let saveChain: Promise<unknown> = Promise.resolve();
      progress.start(ready.length, "Ingesting");
      status.textContent = "";
      const ingestOne = async (row: DocRow): Promise<void> => {
        if (dead) return;
        progress.working(row.name);
        const refuse = (why: string) => log(row.name, "refused", why);
        // document-ID collision: the app's own check (decision 4)
        const docId = docIdInternal !== "" ? (row.values[docIdInternal] ?? "").trim() : "";
        if (docId !== "" && carried.has(docIdInternal)) {
          const dup = await renderListPage(ctx.site, dest.listId, buildRenderViewXml({ textEquals: [{ col: docIdInternal, value: docId }], fields: [docIdInternal], rowLimit: 2 }));
          if (dup.rows.length > 0) {
            refuse(`Document ID "${docId}" is already used by "${dup.rows[0].name}"`);
            return;
          }
        }
        if (destRoot === "") {
          refuse("The destination library's folder could not be read");
          return;
        }
        const destUrl = `${destRoot}/${row.name}`;
        const copied = await copyFileByPath(ctx.site, `${ctx.origin}${row.serverUrl}`, `${ctx.origin}${destUrl}`);
        if (!copied.ok) {
          const text = spErrorText(copied.status);
          refuse(/already exists/i.test(text) ? `A file named "${row.name}" already exists in ${libName(dest)}` : `Copy refused: ${text}`);
          return;
        }
        // the bracket on the copy: check-out → status + dates → major → publish
        const idRes = await fetchFileItemId(ctx.site, destUrl);
        const itemId = Number(((idRes.data ?? {}) as { Id?: unknown }).Id ?? 0);
        if (itemId === 0) {
          refuse("Copied, but the copy's item could not be read — check the destination by hand");
          return;
        }
        const out = await checkOutFile(ctx.site, destUrl);
        if (!out.ok && !/already checked out/i.test(spErrorText(out.status))) {
          refuse(`Copied, but check-out was refused: ${spErrorText(out.status)}`);
          return;
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
          return;
        }
        const ci = await checkInFile(ctx.site, destUrl, ingestComment(task.name, by), true);
        if (!ci.ok) {
          refuse(`Copied, but the major check-in was refused: ${spErrorText(ci.status)}`);
          return;
        }
        if (moderated) {
          const pub = await validateUpdateListItem(ctx.site, dest.listId, itemId, [{ FieldName: "_ModerationStatus", FieldValue: "0" }], false);
          if (!pub.ok || validateItemErrors(pub.data).length > 0) {
            refuse(`Moved, but the publish was refused — it is PENDING in ${libName(dest)}: approve it in SharePoint`);
            await recycleFile(ctx.site, row.serverUrl);
            return;
          }
        }
        const gone = await recycleFile(ctx.site, row.serverUrl);
        log(row.name, "moved", gone.ok ? destUrl : `${destUrl} (the source copy could not be recycled: ${spErrorText(gone.status)})`);
        saveChain = saveChain.then(() => saveIngestionTask(task)).catch(() => undefined);
      };
      await pool(ready, 4, async (row) => {
        await ingestOne(row);
        progress.tick();
      });
      await saveChain;
      progress.finish();
      // the task stays open: a batch may follow (Ben, 2026-10-09 — an
      // explicit close-out replaces decision 6's self-close)
      task.status = "open";
      await saveIngestionTask(task).catch(() => undefined);
      running = false;
      closeBtn.disabled = false;
      lastLog = latestByFile(task.log);
      o.onChanged();
      await reload();
      const thisRun = task.log.slice(-ready.length);
      status.textContent = `Run finished — ${logSummary(thisRun)}.${rows.length === 0 ? " Every file has moved — Close task when the batch is complete." : " Refused files stay here with the reason on the glyph."}`;
    };
    /** The explicit close-out: the folder (with anything left in it) goes
     *  to the recycle bin, the task reads closed and keeps its log. */
    const closeOut = async (): Promise<void> => {
      if (running || dirtyRows(draft).length > 0) return;
      const counts = await fetchFolderCounts(ctx.site, task.folder);
      const left = Number(((counts.data ?? {}) as { ItemCount?: unknown }).ItemCount ?? NaN);
      const n = counts.ok && Number.isFinite(left) ? left : rows.length;
      const ok = await promptConfirm({
        title: `Close the task "${task.name}"?`,
        note: n > 0 ? `${n} file${n === 1 ? " has" : "s have"} NOT been ingested; the folder and those files go to the site's recycle bin. The task keeps its log and leaves Ingestion tasks.` : "The empty folder is removed; the task keeps its log and leaves Ingestion tasks.",
        confirmLabel: "Close task",
        danger: n > 0,
      });
      if (!ok || dead) return;
      const r = await recycleFolder(ctx.site, task.folder);
      if (!r.ok && !/not exist|not found|404/i.test(r.status)) {
        status.textContent = `The folder could not be recycled: ${spErrorText(r.status)}`;
        return;
      }
      task.status = "closed";
      task.closedAt = new Date().toISOString();
      await saveIngestionTask(task);
      o.onChanged();
      closeNow();
      openIngestionTask(o);
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
