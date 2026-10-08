# Document ingestion (proposal — critical review, 2026-10-08, DRAFT)

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

Status: DRAFT — the decisions in §6 are being taken one by one.

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

(filled in as they are taken)
