# LeanBoard backlog

The decisions of record for everything not yet built. Each item carries
its decision date and enough context to pick it up cold. The phase plans
(`leanboard-phase5-plan.md`, `leanboard-standard-documents-plan.md`)
stay the design detail; this is the queue.

## Near-term (ordered — Ben, 2026-08-07)

1. ~~**Document-control notifications.**~~ **BUILT 2026-08-08
   (v0.37.0)** — N0 probe → work link (`ltkmode=work`) → the notify
   panel on every lifecycle done-state → 5G access-request moments.
   Teams chat preferred, Outlook alternative, sent at-action by the
   actor; design of record in `leanboard-notifications-plan.md`.
   At-action only — reminder push stays a cookbook add-on.
2. ~~**Full UI design review** (Ben) + resulting tweaks.~~ **DONE
   2026-08-08 (v0.37.0)** — the D6 R1–R10 slate from
   `documents-integration-plan.md` plus field-reported fixes.
3. ~~**Document Control Health report.**~~ **BUILT 2026-08-08** —
   register kebab, gated on docAdmin (controllers + app admins).
   Checks are grounded in MAPPED ROLES, because the app can only judge
   what it has been told means something: no recognised approval
   status, no owner, review overdue, no review date, untagged (warn);
   no document type, no document ID, checked out right now (info). A
   check whose role is unmapped is REPORTED AS SKIPPED, never silently
   passed. Scans EVERY library except templates (Ben, 2026-08-08) and
   except the upload staging library (files mid-handoff are meant to be
   transient) — deliberately NOT the nav's selection, or the report
   would describe a filtered view as if it were the corpus — capped at
   2000 with the cap stated. Lifecycle checks (status, reviews) apply
   to CONTROLLED documents only: a working draft owes no approval
   status, and flagging every one would bury the real findings; the
   report states that split on screen. Findings
   collapse to counts, expand to documents, and a document click opens
   its overlay to fix it; overdue/missing reviews carry a by-owner
   tally; Export CSV for the full list. Pure `controlHealth` +
   `tallyByOwner` in model.ts, 7 tests.
4. ~~**Hub board card: documents needing review.**~~ **DECIDED +
   BUILT 2026-08-08 as a tab count**, not a card. The design review
   found two blockers for a real card: LeanHub's API has no
   "extra section" hook (only setMeetings/setActions/setBoards/
   setExtraTabs…), so a card needs a CONTROL change and a solution
   deploy, not `pac code push`; and a card that queries SharePoint on
   the landing path works against the import gate and the startup
   budget. Ben chose the tab count. Shipped: "Documents · 3" on the hub
   tab, fed by the Documents screen's OWN task selector (R7's single
   source — never a second count), remembered per viewer in
   localStorage (src/taskBadge.ts, 6 tests) so it shows on the next
   launch, and re-labelled live when the count changes (LeanHub caches
   extra-tab hosts, so re-labelling does NOT remount the register).
   Aged out after a week rather than asserting a stale number.
   **Known boundary, by design:** the badge reminds you of a backlog
   you have already seen; it cannot discover work that arrived since
   your last visit — the Teams/Outlook notifications do that, better.
   If the badge proves too quiet in practice, the next step is
   extracting the task engine out of docsScreen so the hub can sweep
   independently (~250 lines, the app's most-used panel — deferred
   until there is evidence it is needed).
5. ~~**Favourites left-nav entry.**~~ **BUILT 2026-08-08** — a
   "☆ Favourites · N" row above the Libraries card, filled accent when
   it IS the scope (rule 1: filled = location). It needed no new
   machinery: `favMode` had been waiting since the flat-2.0 pass cut
   the entry point. Signed-in only (favourites are per-person). In
   favourites mode the Folders tree HIDES rather than sitting inert —
   favourite rows carry no field values, so a folder click would look
   like a filter and do nothing — and the empty state names the ⋮ menu
   item that fills it. The libraries below are the way back out.
6. ~~**Phase 6 deployment cookbook** + stale-docs cleanup.~~ **DONE
   2026-08-08** — `deployment-cookbook.md`: the contract (columns only,
   five rules — never write status, never hold a check-out, never touch
   staging, honest identity, notify-don't-duplicate) plus four recipes:
   review-due reminder push (with the work-link shape and retention/
   escalation variants), content-approval hardening (Approve Items cost
   stated; unmeasured against the write bracket — trial on a test
   library), stored watermarked renditions (into the per-library
   rendition folder — the app's read path stays the live PDF), and the
   native-upload relay (declined for Pechey, documented as the road).
   Linked from `deploy-to-new-org.md`. Stale docs swept:
   `master-leanboard.md`'s phase table closed (3–5 shipped as the code
   app), the standard-documents plan's Phase 6 section closed, and this
   queue's items 1–2 struck.

7. **Doc cards refresh (NEXT).** The Standard documents card renders
   register-true rows (extracted cells: status chip, owner avatar,
   file-type chip, checkout lock); Document health renders R5 task
   rows; both configured by PASTING a filtered view's Copy link from
   the register (`docsView` — the encoded DocView, rename-proof term
   ids, one source of filter truth), legacy text configs honoured when
   blank. DocsCard also moves off the pre-C3b search feed onto the
   register's RLDAS road, approved-only by default. Plan of record:
   `leanboard-doc-cards-plan.md` parts A/B (Ben, 2026-08-08).
8. **Native upload relay.** U0 **GREEN (Ben's hosted run,
   2026-08-08)**: bytes cross the SDK's file door intact — 64KB up in
   1.1s, 4MB up in 10.4s / down in 0.9s, byte-identical both sizes
   (≈0.4 MB/s up: a size cap and a visible progress state are U2
   requirements, not niceties). The SDK door is `uploadFileToRecord`
   on the DataClient (1.2.7); `ben_ltkupload` deployed to DEV via
   `data/deploy-schema.mjs`, which now grants role privileges
   declaratively (`role: {delete}` — the 2026-08-05 stale-role trap
   closed at the tool). The probe stays as "Test Dataverse upload" in
   Test write access. **U1/U2 PARKED (Ben, 2026-08-08)** — the shipped
   staging handoff stays the upload road; the relay is measured OPEN
   and fully specified (cookbook recipe 2 + plan part C, including the
   alternatives analysis), so picking it up later is authoring one
   flow and building the dialog UI (`u-<stamp>-<name>` staging watch,
   size cap, progress — required at the measured ~0.4 MB/s). The
   table, probe and schema stay: NEXT RELEASE IS STILL
   SCHEMA-CARRYING (prod needs the managed solution re-imported, not
   just an app push).
9. ~~**Content-approval trial — CA0.**~~ **DONE + ADOPTED
   2026-08-08/09.** The bracket held, drafts were walled; the one gap
   (owner's Approve left the item PENDING) became CA1: lifecycle
   commands now publish (`_ModerationStatus = 0`) on every
   reader-facing transition, warned-not-fatal when refused. Ben
   granted Owners & Approvers the Approve Items permission — one-step
   approval confirmed working. Verdict + requirements recorded in
   cookbook recipe 1 and the deploy runbook's permission table. The
   quick-edit niggle CLOSED same day (Ben's call): a property edit on
   a READER-FACING document publishes as part of the save — a
   mid-circulation draft's edit still pends, its moderation wall
   holds, and the plain Check in… deliberately stays unpublished
   (content changes belong to the revision workflow). Same session:
   draft-with-no-reviewers now offers BOTH submits in the decision
   card, "Submit for owner approval" when that is where it lands
   (Ben's flow finding).

Removed by decision (Ben, 2026-08-08): the cookbook's reminder-push
recipe (reviews run on rituals & reporting — no inbox push) and the
stored-watermarked-renditions recipe (a field in the document template,
bound to the status column beside the template's own "uncontrolled if
printed" wording, does the watermark's job — no flow, no stored
artefact).

10. ~~**Settings consolidation Part II.**~~ **BUILT 2026-08-10**
    (S0–S3, unreleased): the one Document Columns manager — drag rows
    across sub-heading groups, —/✓/★ per-type cells — with Libraries
    first; every surface (register, docs card, chooser, filters, add
    form, edit properties, properties pane) answers from the cells;
    dialogs sectioned by the groups; C5 templates + per-library grid
    retired from the UI (data dormant, mirror keeps flags true);
    Health names type-relevance drift. Saved views untouched. Ben's
    hosted checks pending; design of record in
    `leanboard-docs-settings-consolidation-plan.md` Part II.

## Future (formally logged, no date)

- **SOP review & sign-off card (was 5E).** Redesigned 2026-08-07: not a
  DMS command but a **LeanBoard card** where crews review and sign off
  SOP updates as part of their board ritual. Would still need the
  acknowledgement schema (`ben_ltkdocack` — the first schema release
  since v0.25.0) but the surface is the board, not the register.
  Replaces the parked "5E acknowledgement ledger" design.
- **Chatbot link-out.** Parked until Pechey chooses a chatbot — build
  the button when there is something real to link to. (Original Phase 6
  deferral, re-affirmed 2026-08-07.)
- **Native file upload.** STANDING RULE (Ben, 2026-08-07): any commit
  that bumps @microsoft/power-apps re-runs the write-access probe's
  byte carriages as part of that change. If bytes ever cross the
  connector wire, native upload replaces the staging handoff. The
  Dataverse-file+relay-flow road stays the documented alternative
  (declined 2026-08-06).
- **Live-tiles cost bounding.** Watch item (re-affirmed 2026-08-07) —
  act only if refresh cost shows up in practice.

## BBA requirements backlog (Ben's disposition, 2026-08-13)

From `bba-dms-gap-analysis.md` — the items dispositioned to backlog
(the NEXT tranche — governed hashtags, generic document linking +
management-system filters, audit trail — is tracked in its own plan
when written):

- **Document numbering (FR-LC-002 MUST, FR-LC-006 SHOULD).** Auto-
  generated persistent document numbers with a short prefix; rename/
  renumber with visible history. Approach to be worked out before
  build.
- **Workflow depth (FR-WF-003/007/009/011 MUST; WF-004/008/010,
  TM-002/003).** Regulator-approved gate, approval timeframes,
  delegation, formal on-behalf records, simple content revisions,
  change requests, DocuSign, template self-lifecycle, co-authoring.
- **Acknowledgement (FR-DI-001/002, RP ack KPIs).** The 5E sign-off
  card design stands; needs the ben_ltkdocack schema (road proven).
- **Retention & disposal (FR-VR-004/005/011).** retainUntil stays
  inert until this is picked up; Purview labels + owner disposal
  review.
- **Reporting completeness (FR-RP-001/002/008 tails).** % on-time
  review compliance KPI, acknowledgement KPIs (after 5E), PDF register
  export.

**Decisions of record from the same disposition:**
- PDF/reader layer (FR-DI-005/006/007, LC-003): handled IN the
  documents — a status stamp field bound to the status column; no
  app-side rendering. Too difficult to implement reliably.
- Push notifications (FR-NT-002/003/004): DECIDED AGAINST — rituals
  and pull surfaces are the mechanism; at-action notify panel only.
- Per-document confidentiality (FR-AC-005): REJECTED as too risky —
  library-level confidentiality controls only.
- Guest/auditor access (FR-AC-007): parked indefinitely.
- Bulk curated ingestion (FR-IM-002/006): met by the existing
  spreadsheet process outside the app.
- AI assistant (FR-AI-*): a future project iteration.

## Done / no longer tracked

- Folder counts REMOVED (Ben, 2026-08-08, UI design review): they cost
  one id-and-org query per library after every register reload, and
  same-named departments merged their numbers. The tree is pure
  navigation; the walk now also serves from a localStorage cache
  (screen trees only — drift/sync always walk live). This DISSOLVED the
  "duplicate-label term counts" investigation.

- Table display-name renames ("LTK …" → "LeanBoard …") — done by hand
  in the portal (Ben, 2026-08-07).
- "Effective Dae" column label, marketing@'s leftover Entra ownership,
  Dev-role check (`ben_ltkdoclibrary` + Delete privilege) — all fixed
  by Ben in the portals (2026-08-07).
