# Document ingestion (proposal — critical review, 2026-10-08)

Ben's draft (2026-10-08): a dedicated ingestion library, open to every
user, hidden from the register; document controllers create named
ingestion tasks (a sub-folder, assigned users, a destination library);
assignees reach a "Document ingestion" screen through an otherwise
hidden button on the Documents tab; a task lists its files in a wide
grid with a column per metadata field and task-level defaults; an
Excel of the same grid with data validation can be downloaded, filled
and uploaded; a controller then runs the ingestion, which checks the
required metadata and moves each file into the destination as an
approved version 1.

Status: BUILT 2026-10-08 (§8), on dev, unreleased; the release will be
solution-carrying (the task table).

## 1. What the platform allows (facts the design must respect)

- **Bytes cannot cross the wire** (sharepoint-writes.md, six probe
  runs): the app can never upload a file. Users dropping files into a
  SharePoint folder themselves is therefore not a workaround — it is
  the only road, and the draft already has it right.
- **Content moves inside SharePoint.** The app's one proven content
  road is `copyto` (template copy). Moving a file between libraries is
  `SP.MoveCopyUtil.MoveFileByPath` / `CopyFileByPath` — a NEW road
  that needs a probe: what metadata and version history survive, and
  in what check-out state the file lands on a require-check-out,
  content-approval library.
- **Approved version 1** on a destination library means: the file
  checked in as a MAJOR version with a meaningful comment, the
  moderation status published, the status term set to Approved — the
  lifecycle bracket the approve command already runs. The audit view
  derives who/when/comment from version history alone, so the check-in
  comment must name the task and the ingesting controller.
- **Site columns are shared.** A library's columns are the site
  dictionary's columns (one model per site). An ingestion library
  carrying the same site columns as its destinations means: the app's
  register cells, field editors and the edit-properties dialog read
  and write it unchanged, the move can carry the values, and
  SharePoint's own grid view ("Edit in grid view") on the ingestion
  library is a bulk metadata editor with real choice, term and people
  pickers — for nothing.
- **The app has no server.** A run of 200 files × ~5 calls each
  happens in the controller's browser tab (the Replace-a-person
  command is the precedent): batches, a progress line, resumable, the
  tab stays open.
- **Library permissions are set in SharePoint by hand**, as they are
  for every library today (no check-out, no content approval, major
  versions only, Members contribute). The app flags the library's
  purpose; it does not configure SharePoint.

## 2. Findings on the draft

1. **The Excel round-trip is the expensive, fragile half.** Writing an
   .xlsx with data validation (a zip of OOXML parts, hidden list
   sheets for choice and term vocabularies) is buildable in the
   browser; READING one back is where it bites — free text in a
   validated cell, pasted values, a term renamed between download and
   upload, people typed as names, dates in locale form, a column
   deleted. Every one needs a rule and a message. SharePoint's grid
   view on the ingestion library gives the same spreadsheet experience
   with the real pickers and no round-trip, provided the library
   carries the site columns (§1). Recommendation: the app's own grid
   for review and bulk set, SharePoint's grid view for spreadsheet-
   style entry, Excel as a later phase only if the grid view fails
   users in practice.
2. **"A column for each metadata field" in the app is a wall of
   pickers.** Twenty columns × fifty rows of taxonomy, people and date
   editors is heavy to build and heavier to use. The register already
   has the grammar: a list with the dictionary's columns as CELLS
   (register cells), the row opening the edit-properties dialog, plus
   row selection and "Set for selected…" (one field, many rows). Task
   defaults become "Fill blanks from defaults", written into the
   library columns so every surface sees the same values.
3. **Assignment is visibility, not permission.** The library is open
   to every user, so assigning someone to a task cannot be what lets
   them write; it is what shows them the task and what notifies them.
   Say so, and do not build folder permissions.
4. **The entry point exists.** The Documents tab has the Document-
   tasks panel (R5 rows) and nav cards. An ingestion task is a task:
   it lists in the panel for assignees and controllers ("Ingest 12
   files into Controlled standards") and opens the ingestion screen —
   no hidden button.
5. **Validation is the dictionary's.** Required = the destination
   library type's required cells plus role completeness (owner,
   document type, organisation, status…) plus document-ID uniqueness,
   file-name sanitising, and a collision check against the
   destination. The run refuses a FILE, never the task: files that
   pass move, files that fail stay with a reason, the task stays open.
6. **Dates and people that the normal flow stamps are inputs here.**
   An ingested standard usually has its own approval history: its
   effective date (and so its next review) must be typeable per
   document, where Approve normally stamps today. Approvers are empty
   (the controller is the approver of record, in the comment).
7. **Not said: what happens to the folder afterwards**, what "V1"
   means if a file was edited twice in the ingestion library (version
   3.0 after a move that carries history), and where the task lives
   (a Dataverse table is a solution-carrying release; a JSON ledger
   row like the access requests is app-only).

## 3. The improved concept

- **Settings → Documents → Libraries**: a new library type
  "Ingestion" (`libType: "ingestion"`); hidden from the register, the
  phone selects, filters, views, exports and health; one per site.
- **Ingestion task**: name · destination library · assignees · task
  defaults (field → value) · status (open / running / closed) · the
  run log (file → moved / refused: reason). The sub-folder is the
  task's name, sanitised; created on save.
- **Where it shows**: the Document-tasks panel (assignees see their
  open tasks; controllers see all) and an "Ingestion" nav card for
  controllers; both open the ingestion screen for that task.
- **The ingestion screen**: the task head (destination, assignees,
  "Open folder ↗" as the primary, the instruction line), then the
  task's files as a register list with the destination's default
  columns as cells, a completeness pill per row (what is missing), row
  selection with "Set for selected…", "Fill blanks from defaults", and
  the "Edit in SharePoint grid view ↗" link for spreadsheet-style
  entry. The row opens the edit-properties dialog (no bracket on this
  library — no check-out rule).
- **Run** (controllers): a preview — n ready, m refused with reasons —
  then per file: move to the destination, bracket: check-out →
  remaining writes (effective date, status term) → MAJOR check-in
  ("Ingested — task <name>, by <controller>") → publish; results land
  in the log as they come; resumable; refused files stay.
- **Afterwards**: the task closes when its folder is empty; an empty
  folder is removed (decision §6).

## 4. Effort (rough, after the decisions)

Probe of the move road (half a day); library type + settings (half);
task store + panel rows + nav card (one); the screen with register
cells, completeness, set-for-selected, defaults (two); the run with
preview, batches, log, resume (one and a half); docs, tests, harness
(half). About six days; an Excel round-trip would add three to four.

## 5. Sequencing

1. Probe the move road and record it in sharepoint-writes.md.
2. Library type, task store, panel rows (nothing visible yet to users).
3. The screen without the run (metadata work can start).
4. The run.
5. (Later, if wanted) the Excel round-trip.

## 6. Decisions — taken one by one with Ben

1. **Metadata entry — SharePoint grid view + the app's grid; no Excel
   in phase one** (Ben, 2026-10-08). The ingestion library carries the
   site columns; "Edit in SharePoint grid view ↗" is the spreadsheet;
   the app's screen reviews, bulk-sets selected rows and fills blanks
   from the task defaults. Excel stays a later phase, only if the grid
   view fails users.
2. **Task store — a new Dataverse table** `ben_ltkingestiontask`
   (Ben, 2026-10-08): one row per task — name, site, source folder,
   destination list id, assignees JSON, defaults JSON, status, created
   by/at, the run log JSON (file → moved / refused: reason, when, by).
   Schema through `data/schema.mjs` + deploy; the release is
   solution-carrying (prod imports the managed solution first).
3. **Dates — typed per document, else stamped** (Ben, 2026-10-08).
   The effective-date column is editable on the ingestion library (an
   ingested standard has its own approval history); a blank at run
   time reads as the run day. Next review = effective + the cadence
   the Importance term maps to, as everywhere. Approvers stay empty;
   the check-in comment records the ingesting controller.
4. **Collisions — refuse the file, keep the task open** (Ben,
   2026-10-08). A name or document ID already in the destination
   leaves the file in the folder with "already exists as …"; the
   controller renames, removes or retires the existing document
   through the normal lifecycle and re-runs. An ingestion never
   overwrites or supersedes.
5. **Document IDs — optional** (Ben, 2026-10-08). A blank Document ID
   is not a refusal; the document lands without one and Document
   Control Health reports it as it does today. A typed ID that
   duplicates one in the destination is a collision (decision 4).
6. **After the run — the task closes itself, the empty folder goes**
   (Ben, 2026-10-08). A run that leaves the folder empty marks the
   task closed (its log stays in Dataverse) and recycles the empty
   sub-folder; closed tasks stay listed for controllers under a
   "Closed" filter. A folder with refused files keeps the task open.
7. **Notification — a Teams card on assignment** (Ben, 2026-10-08):
   the DMS's notification road (`docs/notify.ts`, dynamic import), a
   card from the controller naming the task, the folder link and the
   instruction; e-mail where Teams is off.

## 7. Settled by the probe, and assumptions

**The probe is built (2026-10-08, on dev):** Settings → Documents →
"Move road (ingestion)" — pick a source and a destination library
(working / revision only), "Test move road". `docs/moveProbe.ts`
creates a text file with a Title and two major versions in the source,
`SP.MoveCopyUtil.MoveFileByPath` moves it, the probe reads back the
check-out state, Title (carried / lost), version label, moderation
status and prior versions, runs the approve bracket (check-out → major
check-in → publish where moderated), repeats with `CopyFileByPath`,
tries a second copy onto the same name (must refuse), and recycles
every file. Findings go into sharepoint-writes.md once Ben has run it.

- **"Version 1" — SETTLED by the probe (Ben ran it 2026-10-08,
  working → controlled standards):** a MOVE carries the whole version
  history AND the moderation state — the file landed checked in and
  approved (reader-visible at once) as 3.0. A COPY carries the Title
  (so the shared columns), starts a fresh history, and lands as 0.1
  draft, invisible under content approval until published; the bracket
  takes it to 1.0 approved. **The run copies, brackets, then recycles
  the source.** `overwrite=false` refuses a name collision in
  SharePoint's own words. Recorded in sharepoint-writes.md.
- **Destinations**: any exposed library of type standard, record or
  working; never template, revision or ingestion.
- **Who runs**: document controllers only; assignees prepare metadata.
- **Required metadata**: the destination library type's required
  cells in the site dictionary plus role completeness (owner,
  document type, organisation; status is set by the run) — the
  Health scan's rules, applied before the move rather than after.
- **Phone**: not a phone task; the ingestion screen is desktop-only
  (the Document-tasks panel is already hidden on the phone register).

## 8. Status — BUILT 2026-10-08 (dev, unreleased)

- **Schema**: `ben_ltkingestiontask` deployed to dev (Ben's device-code
  sign-in); service generated; the next release is solution-carrying.
- **Library type** "Ingestion" (`model.ts` LIBRARY_TYPES,
  `isRegisterLibrary`): filtered out at the register's one choke point
  (`docsScreen` L209) and the cards' scope, the tag scan and the move
  probe's targets; ranked last in display order.
- **Pure parts** `docs/ingestionModel.ts` (row mapping, `taskFolderName`,
  `canSeeTask` / `tasksForPanel`, `missingFor`, `blanksToFill`,
  `logSummary`, `latestByFile`, `ingestComment`) — tested.
- **Store** `docs/ingestionStore.ts` (list / save / delete).
- **Screen** `docs/ingestionScreen.ts`: the task sheet (the viewer's
  overlay idiom) — head (destination, assignees, creator, status chip),
  "Open folder ↗" primary (the grid-view link was cut the next day: it
  landed on the same page), "Set for selected…"
  (one column, the field editor, a bracket per file), "Fill blanks from
  defaults", the folder's files as a compact register list
  (destination default columns + required, a Ready pill naming what is
  missing, the last refusal beneath), a row opening the edit-properties
  dialog with the system dates editable (`ingestion: true`), and for
  controllers "Edit task…" (with "Cancel task…": the folder goes to the
  recycle bin with its files, then the row — Ben 2026-10-09) and "Run ingestion…",
  greyed until EVERY file has its required details (Ben, 2026-10-09;
  the per-file refusal still covers collisions) (confirm → per file:
  document-ID collision check → `CopyFileByPath` → check-out → Approved
  term + effective/review/cadence → MAJOR check-in naming the task →
  publish → recycle the source; refusals logged with the reason; the
  task closes and its folder goes when the folder is empty). The editor
  dialog: name (the folder), destination, assignees (directory search,
  chips), task defaults (the destination's columns as editors); a new
  assignee gets a Teams card.
- **Register**: an "Ingestion tasks · n" button of its own beside
  Document tasks, shown only while the viewer has active tasks
  (assignees and the creator theirs, controllers all — Ben,
  2026-10-09: not folded into Document tasks); its panel's rows open
  the task sheet; controllers with "＋ New task…" where the site
  exposes an ingestion library.
- **Feed**: `renderListPage(…, folder)` lists one folder
  (`FolderServerRelativeUrl`); `RenderQueryOpts.textEquals` for the
  document-ID check; `createFolder` / `recycleFolder` /
  `fetchFolderCounts` / `moveFileByPath` / `copyFileByPath` in `sp.ts`.

### Setting up (Ben, on dev)

1. In SharePoint, create the bulk-drop library on the DMS site: no
   check-out required, no content approval, major versions only,
   Members may contribute; add the same site columns the controlled
   libraries carry (the site content type).
2. Settings → Documents → Libraries: expose it with the type
   "Ingestion (bulk drop, hidden from the register)".
3. Documents tab → ⋮ → "New ingestion task…": name,
   destination, assignees, defaults. Open the task from Document tasks.

## 9. The editable grid (Ben, 2026-10-09 — critical review)

Ben: "show every column that needs to be set for the document, in the
same order as defined in settings, with the ability to directly enter /
change; a horizontally scrollable grid is fine as long as the Document
column on the left is a frozen pane."

### What this changes

The task sheet's list becomes a GRID: one row per file, one column per
field the destination type offers (the site dictionary's order — the
same set and order the Edit-properties form shows), each cell editable
in place; the Document column (select box, type chip, name) frozen at
the left while the rest scrolls sideways; the Ready pill frozen at the
right or first after the name. The Edit-properties dialog on the row
becomes redundant for this screen.

### What the platform gives, and what it costs

- **Editors exist per kind** (`fieldEditors.ts`): text, note, number,
  choice, yes/no, date, taxonomy single / multi (term pickers over
  `cachedTermPaths`), person (pool or directory search), url. They are
  FORM editors — stacked, labelled, 100% wide. A cell needs the same
  value logic in a cell-sized skin: a select or input in the cell for
  choice / yes-no / date / text / number; a popover anchored to the
  cell for taxonomy (search when the set is large, indented select
  when small), people, note and url.
- **Every write is a bracket** (check-out → forms-engine / typed write
  → major check-in): ~4 round trips, 2–3 s. A cell-at-a-time save is
  what SharePoint's grid does, but 10 cells × 50 files is 500 brackets.
  A DRAFT model — cells change locally, one "Save changes" writes each
  touched file ONCE with all its changed cells — is cheaper by an order
  of magnitude and gives an honest unsaved state (row dot, a guard on
  close). It is also what the register's lifecycle commands do: one
  bracket per act.
- **Prefill is display-only.** The feed (RLDAS) gives display strings;
  taxonomy loses its term ids, people keep an `#email` twin, dates an
  ISO twin. Showing a cell needs nothing more; EDITING a taxonomy cell
  resolves the current label through the set's walk (label → id) so a
  single-pick select can show the current term selected.
- **Frozen column**: CSS alone — the row stays a grid, the scroller
  scrolls on x, the first cell is `position: sticky; left: 0` with its
  own background; the header row the same. No library.
- **Keyboard**: Tab / Shift+Tab between cells, Enter commits and moves
  down, Esc reverts a cell — the values grid's grammar (vdt grid).
- **The date model**: effective date editable (decision 3); next
  review and cadence derived at run time — shown read-only, greyed.
- **Required**: marked ✱ in the header; the Ready pill reads the DRAFT
  (what it would be after save), the run button the SAVED state.

### Options

A. **Autosave per cell** (SharePoint's grid): one bracket per commit;
   simplest mental model; slow at volume, and a half-typed row can
   never be abandoned. B. **Draft + Save changes**: local edits, row
   dot, one bracket per touched file; a guard on close; Refresh asks
   before discarding drafts. Recommended. C. **Both**: autosave with a
   debounce per row — the worst of each (surprise writes, still slow).

Columns: **(i)** every column the type offers (the form's set), or
**(ii)** only the type's default-view and required columns, with the
rest behind "More columns ▾". (i) is what was asked; (ii) keeps a
narrow task narrow. Recommended (i), with the required ones first after
the name? No — settings order, as asked; required marked.

Effort: about two days — `docs/ingestionGrid.ts` (pure draft model,
tested: dirty tracking, writes per file, Ready from draft; the cell
renderers and popover editors by kind; sticky CSS; keyboard), the
sheet rewired (Save changes, the guard, Refresh with a drafts check),
Set for selected and Fill blanks writing into the DRAFT rather than
SharePoint, the dialog on the row removed.

### Decisions — taken with Ben (2026-10-09)

1. **Draft + Save changes** (B): cells change locally; a row dot and a
   tinted cell mark unsaved; "Save changes (n files)" writes each
   touched file once; Discard; closing or refreshing with drafts asks.
2. **Every column the type offers** (i): the site dictionary's order,
   required ones ✱ in the header, minus the status (the run sets it)
   and the two derived dates (next review, cadence).

### Status — BUILT 2026-10-09 (dev)

`docs/ingestionDraft.ts` (pure, tested: `setCell` drops blanks and
no-op values, `effectiveValues`, `applyToRows` for Set-for-selected
and Fill-blanks, `writesFor`). The sheet's list is now the grid: the
Document cell (select box, dirty dot, type chip, name) frozen left,
Ready frozen right, the header frozen top, the rest scrolling on x;
choice / date / single-line text edit in the cell (Tab across, Enter
down, Esc reverts); taxonomy, people and notes open a popover carrying
the form editor for that one field, with the current value resolved
(term labels → ids through the set's walk, people from the feed's
email twin). Set for selected and Fill blanks land in the draft. The
Ready pill reads the draft; Run ingestion needs a clean, saved, fully
ready grid. The Edit-properties dialog is no longer opened from the
sheet.
