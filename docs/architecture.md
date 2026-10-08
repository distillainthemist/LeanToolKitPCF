# LeanBoard — architecture & functionality overview

**The maintained summary.** This page is the orientation document for
the whole application: what it is, how it is structured, how it talks
to Microsoft 365, how it is developed and deployed, and how security,
authentication and data-loss prevention work. Detailed designs live in
the per-feature plans (linked throughout); when this page and a plan
disagree, fix this page — it is meant to be current, the plans are
meant to be history.

Last reviewed: 2026-08-18 (v0.46.0).

---

## 1. What the application is

LeanBoard is a **Power Apps code app** (code-first, `pac code push`,
running in the Power Apps player) with three areas sharing one shell:

- **Lean boards** — a board engine for meeting boards and
  problem-solving/project boards, built from a catalog of ~26 card
  types (agenda, actions, KPI trend, Metrics, Pareto, SQDPC, …).
- **Improvement system** — cascaded priorities (company pillars →
  priorities cascaded down the organisation), improvement initiatives
  (templated, staged, gated, with metrics and their own boards) and
  the per-site value driver tree with KPI value entry (§3.3).
- **Standard Documents** — a SharePoint-backed document management
  system (register, lifecycle, approvals, links, tags, audit) for
  controlled standards.

Plus cross-cutting features: Teams/Outlook notifications, an in-app
issue/idea reporting system with triage, and diagnostics probes.

Environments: **dev** (`pecheydistillingdev.crm6.dynamics.com`, SP site
`…/sites/Dev`) and **prod**. Code reaches dev via `pac code push`;
prod only via tagged releases (§6).

## 2. Repository structure

```
app/            the code app (vanilla TypeScript, Vite, no framework)
  src/main.ts        shell: hash router, top bar, dynamic screen imports
  src/screens/       hub, board, composer, card editor, settings, …
  src/docs/          the ENTIRE document management system
  src/priorities/    cascaded priorities (model, screen, overlay, dialogs)
  src/improvement/   initiatives, templates, metrics, boards; vdt/ = the
                     value driver tree, grid entry, KPI card links
  src/actions/       ＋ Add action (quick capture), link targets and the
                     endorsement lookup the action dialog reads
  src/issues/        report dialog + admin triage tab + the PDF export (pdf.ts writer, exportPdf.ts)
  src/saver.ts       the debounced card save every card type uses
                     (flushed when its screen is left)
  src/tileActions.ts what a board tile shows: its card's actions, or
                     the whole board's for an action surface
  src/store/         Dataverse data layer (typed helpers over services);
                     changes.ts = read cache + writing() (§3.5);
                     inflight.ts = writes a mounting screen waits for
  src/generated/     pac-generated connector/table services (do not edit)
  tools/             import-gate, native-dialog-gate, chunk-report
                     (build-time checks, all in CI)
  harness/           Vite pages that mount controls with stubbed stores
                     for screenshots: grid, kpi, vdt, wizard, pdca,
                     actiondlg, charter, walk, band, prompts, agenda,
                     embed, actionboard — served by the `pdca-harness`
                     launch config
shared/         UI kit + tokens shared with the (retired) PCF controls
controls/       retired PCF controls — kept for shared model code
data/           declarative Dataverse schema + admin scripting tools
docs/           plans (history), runbooks, this page
```

**The import gate** (`app/tools/import-gate.mjs`, runs in CI and
locally) enforces two boundaries: the board startup path (main,
cardRegistry, board, hub screens) must never statically reach
`src/docs/`, and the docs-only connectors (SharePoint, Teams, Outlook)
are only importable from `src/docs/`. Dynamic `import()` is the
sanctioned door — settings reaches the docs tab that way, cards reach
the docs card module that way. This keeps board startup lean and the
connector surface contained.

## 3. How boards and cards work

Design of record: [master-leanboard.md](master-leanboard.md) (data
model section) — the canvas/PCF sections there are historical.

- **The pattern is snapshot tiles + one editor.** A board is a grid of
  **tile snapshots** (SVG images stored with the card data); tapping a
  tile opens the full card editor for that card type. This exists
  because a grid of N live components was unbuildable and unaffordable;
  the snapshot repaints when the card saves.
- **Data model (Dataverse):** `ben_ltkboard` (board manifest JSON,
  people, occurrence settings; `ben_boardkind` meeting | project) →
  `ben_ltkboardinstance` (one per meeting occurrence; project boards
  have one living instance plus gate snapshots) → `ben_ltkcarddata`
  (per card per instance: output JSON + tile SVG). `ben_ltkcardcatalog`
  holds the card-type catalog and default tiles; `ben_ltkcardseries`
  holds every dated series (card readings, value-driver actuals and the
  per-period `spec:*` plan / forecast / limit points — §3.3);
  `ben_ltkaction` is the central actions register (§3.4);
  `ben_ltkpeoples` is the app's user record (role user / siteadmin /
  superadmin, site / department / area / crew); `ben_ltksitesettings`
  and `ben_ltkuserprefs` hold settings — the site row carries
  `ben_hubtabs` (per-site enablement of the hub's tabs;
  `shared/schema/hubTabs.ts` is the one list: My day · Cadence ·
  Priorities · Improvement · Value drivers · Actions · Documents),
  `ben_isarchived` and `ben_siteorder`; the APP_ROW carries the
  improvement settings (methods · standard roles with per-site fillers
  · standard fields · the value-driver editor role) and the priorities
  settings (period definition, RAG ratio).
  **Cascaded priorities:** `ben_ltkpillar` (with `ben_fromperiod` /
  `ben_toperiod` = the span it is in force), `ben_ltkpriority` (owned
  by its originating org by NAME; `ben_period` = START of its span,
  `ben_toperiod` stamped at close, `ben_plannedend` optional — the
  period picker is a lens over spans, nothing is copied at a year end
  (2026-10-02); `ben_primaryinitiativeid` = the ★ primary initiative
  whose charter / metrics headline it), `ben_ltkpriorityassignment`,
  `ben_ltkpriorityevent`.
  **Improvement:** `ben_ltkinitiativetemplate` (stages / gates / roles
  incl. hidden standard roles / fields / metric rule + a template
  board), `ben_ltkinitiative` (header + snapshot / roles / priority
  links / metrics / gate / stage-target JSON columns;
  `ben_alsoorgsjson` = further departments it is listed under;
  `ben_toperiod` = the period it completed in),
  `ben_ltkinitiativeevent`, `ben_ltkactionfile`.
  **Value drivers:** `ben_ltkvaluedriver` (per-site tree nodes:
  formula, cadence, aggregate, format incl. grid rows, `ben_sourceurl`,
  `ben_trackingjson` = numeric | good/bad | picklist) and
  `ben_ltkvdtscenario` (parked Simulate scenarios).
  All of these are solution-carrying (the managed LeanToolKitData
  solution); every column is declared in `data/schema.mjs`.
  Design of record: [leanboard-cascade-improvement-plan.md](leanboard-cascade-improvement-plan.md)
  (a dated ledger of every phase and decision).
- **The hub** is the landing screen: My day (today's rituals + the
  viewer's actions), Cadence (a person's or an organisation's rituals
  on a day/week grid — rituals may be listed under several
  organisations via `alsoOrgs`), Priorities, Improvement, Value
  drivers, Actions (the same Person | Organisation scope as Cadence,
  opening on the viewer each load) and Documents. App-screen tabs mount
  lazily and scroll inside the tab. **Doc cards** (Standard documents, Document
  health) render register-true rows inside boards, configured by
  pasting a register view link; they load via the dynamic-import door
  and fetch after paint with jitter so a wall of boards can't
  synchronise into a 429 storm.
- **The Canvas card** is the charter/plan-on-a-page: a maker lays out
  typed, titled fields (20 types — text through rich text, people,
  status/RAG on the app palette, checklists, mini capture tables,
  images) in a 1–3 column grid in the settings Layout builder; users
  fill them in on the card (inline for typing types, dialogs for
  pickers). Layout lives in config, values in the envelope keyed by
  field id — restructuring never loses content. Actions are card-level
  via the standard channel. Design of record:
  [leanboard-canvas-card-plan.md](leanboard-canvas-card-plan.md).
- **On-canvas design mode (the studio's reverse channel).** The card
  studio was one-way — settings drove the card, nothing flowed back —
  so layout editing lived in dropdowns. Cards with `CardSpec.designable`
  (Canvas today) are mounted in the studio (board mode) as THE layout
  editor: `CardMount.designLayout` + `onConfigPatch(key, value)` push
  the card's own config changes into the studio draft, which repaints
  the settings pane WITHOUT remounting the card; a selection bridge runs
  both ways (`onSelectField` / `registerSelectField` ↔
  `CardSettingsEditor.setSelection`); the studio holds a session
  undo/redo stack of config snapshots. On the canvas: a toolbar
  (columns, grid, preview), gridlines and empty cells from a pure
  `placeFields` simulation of CSS sparse auto-placement (design and run
  use the same explicit placement, so they agree by construction),
  type-true skeletons, ⋮⋮ pointer-drag to reorder, edge/corner resize
  snapping to columns/steps; the inspector becomes the selected field's
  property panel with title/id validation (duplicate titles break rollup
  matching). Design mode is studio-only — meetings never enter it. The
  pure draft model (`CanvasCard/draft.ts`) is UI-free so the mounter's
  reverse channel does not drag settings editors into the board path.
- **Title-bar contract & the universal ＋ Action.** When a card has a
  title, `renderTitleBar` gives the bar a right-hand action slot and
  `renderKebab` appends there (no longer overlaying the body); app code
  registers extras with `setTitleBarExtras(mountHost, builder)` — a
  builder, because editors rebuild their root on every render. The
  focused card editor registers **＋ Action** on every card (not action
  surfaces, not the template's live row, not when the card disables
  actions): a card-LEVEL linked action through the standard action
  manager on the card's channel, in addition to whatever a card raises
  from its own elements. Dialogs opened from app code need an
  `.app-dlghost` for the toolkit CSS variables — and inside the editor
  host it must take no space (`flex: 0; height: 0`), or it splits the
  card's height.
- **The card walk swap.** Hopping between cards in the focused view
  mounts the NEXT card before tearing the previous one down
  (hold-until-ready). Consequence: a card's teardown must release only
  ITS OWN resources — an embed card parks only its own persistent frame
  key (a global `parkAllFrames()` there hid the incoming card's frame).
- **The Embed card** (Power BI, SharePoint pages, any framing-friendly
  https page). One long-lived `<iframe>` per card lives in a
  `position:fixed` host on `<body>` (`app/src/embedFrames.ts`), OUTSIDE
  the routed DOM — re-parenting an iframe reloads it, so screens never
  take the frame, they only PARK it over a slot (scaled over a board
  tile, full-size in the card editor); the same document survives
  screen changes and Power BI's autoAuth handshake happens once. Frames
  delegate `fullscreen; storage-access; local-network-access`. Power BI
  links are normalised (`buildEmbedUrl`: pane toggles, page name);
  SharePoint doc links become `action=embedview`. Two escape hatches
  from the frame chain: the ↗ open-in-tab link, and **Present in a
  window** (`presentWindow.ts` — a card setting that holds NO frame and
  opens the page in its own top-level window, one per card, reused and
  focused; plus a ⧉ chip on every embed card to present on demand). A
  cross-origin frame cannot tell us whether its content rendered (its
  load event fires on a sign-in page too, and the Power BI secure embed
  posts nothing to its parent), so the "Not showing?" hint is a
  RISK-PROFILE hint (Windows + Chromium ≥ 142 + Power BI, focused view,
  20 s, dismissible per browser) — never a failure detector.
- **Cross-board windows:** a **LinkCard** renders another board's card
  read-only (its source's policy decides which document — live row for
  shared, newest meeting otherwise). A **Capture rollup** generalises
  this to many sources: it merges rows from Capture cards on other
  boards into one table (columns matched by NAME across sources, the
  ⚑ Flag column found by TYPE), filters to flagged items, and can
  write back — un-flag or full row edits — via a read-modify-write
  straight onto the source card's document (`store/rollup.ts`). Its
  own document is content-free with a fixed shared policy, existing so
  tiles and close-meeting archives ride the standard save road. Design
  of record: [leanboard-capture-rollup-plan.md](leanboard-capture-rollup-plan.md).
  The **Canvas rollup** is the same idea transposed for charters: one
  row per linked Canvas card (current content only), columns matched by
  field label, cells painted by the canvas display module, and full-mode
  per-cell edits through the canvas's own field dialogs writing back to
  the source document (mini-tables edit on their source card). Both
  rollups share the store road's source-resolution skeleton
  (`store/rollup.ts`).


- **Check-in times on a daily ritual** (2026-10-01, Ben: a core
  meeting in the morning and a check-in with the SAME board in the
  afternoon). `config.checkIns` ([{time, label}], daily only —
  shiftly's two sessions are its two shifts) and `config.timeLabel`
  (the day's own session's label) make `generateInstances` emit a
  further occurrence per session on each day, `session` 1.. (0 = the
  meeting), each with its `label`, all matched to the day's ONE
  record (matching is by date, as before). The calendar and My day
  name an occurrence `occurrenceTitle` = "meeting: label" (the
  meeting alone without one); the scheduler row wears the label as a
  pill, or "check-in" when it has none. The board
  opens the record the scheduler matched by its id — it used to match
  the exact date and time, which would have started a second record
  for the afternoon. Closing the meeting archives the day, so the
  wizard says to close after the last check-in.

### 3.3 Improvement, priorities, value drivers & KPIs

- **Initiatives** are created from templates (stages with gates and
  approver roles; standard roles Sponsor / Owner / Improvement lead /
  Team / Support can be HIDDEN per template, Owner never; app-level
  standard roles such as Finance lead have per-site fillers; template
  roles are free). A role's People = Several allows many holders. An
  initiative has one owning organisation plus optional further
  organisations it is listed under. Its board is seeded from the
  template's board with the template's exact cells and walk order
  (blanks stay blank; `improvement/boardLayout.ts`), and can be reset
  to the template from the board's kebab (card data is never deleted).
- **Metrics belong to the initiative.** A metric is either picked from
  the site's value driver tree (leaf or leading node; the metric IS the
  driver, its readings live on the driver's series) or
  initiative-specific (own series under the board's Metrics card; may
  later be linked or promoted into the tree). Several metrics may be
  ★ starred; each carries an objective sentence. The board's
  **Metrics card** is a chart grid (1 / 2 / 3 columns by count) of full
  KPI trends; "Update values…" in each chart's title strip opens the
  values grid — the one place values are entered.
- **Value driver tree** (`improvement/vdt/`): per-site nodes with
  formulas (+ − × ÷ ^ %, SUM/AVG/MIN/MAX/ABS/ROUND, CHILDREN), cadence
  (shiftly … annually), aggregate, format and grid rows; numeric,
  good/bad or picklist tracking (non-numeric nodes never enter a
  formula). Hub → Value drivers shows the tree with numbers; clicking a
  driver opens the grid popup. Simulate is parked (code kept).
- **Grid entry** (`vdt/grid.ts` + `gridModel.ts`, pure and tested): a
  column per cadence bucket, rows Plan / Forecast / Lower / Upper as
  configured plus Actual, unbounded paging through time with the page
  fitted to the width, Excel paste, CSV. Plan and limits are dated
  `spec:*` series that carry forward; a period's plan / forecast /
  actual is the fold of its buckets. Plan and target are one thing.
- **KPI cards on any board** may link themselves to a value driver
  (`settings.driver` on the slot); linked cards read and write the
  driver's one series and take the driver's cadence, rows and
  targets (Option C: the driver owns targets, the card's level values
  only seed an empty driver). Good/bad and picklist KPIs draw a
  category trend.
- **A priority's primary initiative** (★ on the overlay's Initiatives
  tab, or auto-claimed by the first initiative naming the priority as
  its own primary) supplies the overlay's Charter and Metrics tabs and
  the Priorities screen's Objectives row (every starred metric:
  "Name: objective" over Plan / Actual with a traffic light). The
  primary leads the overlay's Initiatives tab in its own section.
- **A Priorities view travels as a link** (2026-10-07,
  `priorities/viewLink.ts`): the kebab's "Copy link to this view"
  puts org, period, status, view mode, pillar filter / focus, rule and
  the Show toggles on the player URL as `prview=`; `links.ts` reads
  it at launch, routes to `#/priorities`, the hub fronts the tab and
  the mount reads the pending view — which lives for a 20 s GRACE
  window, because the landing-route hub can front Priorities from the
  last-tab preference and read it before the re-routed mount does
  (v0.65.1).
- **Priorities span years** (2026-10-02, `priorities/model.ts`
  "spans"). A priority runs from a START period (`period`) until it
  closes; the END (`toPeriod`) is stamped from the closing date and
  cleared on reopen, never typed; `plannedEnd` is optional. Pillars
  carry `fromPeriod` / `toPeriod`; initiatives an end stamped on
  completion or archive. The period picker is a LENS: `priorityLiveIn`
  / `pillarsLiveIn` decide what the viewed year shows, `periodsOnOffer`
  lists every period a span touches, `effectiveEnd` reads a row closed
  before ends were stamped as ending in its start (no migration).
  Custom periods compare by the ordered label list in Settings. Nothing
  is copied at a boundary — the carry-forward copy, bulk flow and close
  reason are gone; `reviewDue` flags an open priority past its planned
  end instead. **Re-parenting** (`store/priorities.ts` `relinkParent`,
  rules `canBeParent`): a junior org's own priority is linked under one
  above or beside it from the Cascade tab — parent id, an accepted
  assignment naming the child as the customised row, the old record
  removed, `linked` / `unlinked` events on both rows. Clearing a lookup
  on update sends `null` (undefined is stripped and the old reference
  stays).
- **A priority's owner** (2026-10-02): a new priority defaults to the
  org's owner from organisation settings (an area takes its
  department's; the first listed), the person adding it only when none
  is set — also on Accept & customise. The owner picker opens on the
  org's owner and its immediate children's owners, searches the roster
  behind "Search everyone", and for admins only reaches the directory:
  an Entra hit is added to the app (site and department from the org,
  role user, the Users register's `upsertPerson`) and chosen in one
  step.

- **Header fields and the charter card are one datum** (2026-09-29).
  A header field (Settings → Improvement standard fields, or a
  template's own) has a KIND from the canvas card's full set of value
  types — text, long text, rich text, whole number, decimal, percent,
  rating, date, date range, choice, multi choice, yes / no, status,
  person, people, link, checklist (`FIELD_KINDS`; headings,
  mini-tables and images stay card-only). Values are stored as
  strings in the initiative's `fieldValues` JSON;
  `improvement/fieldCodec.ts` is the ONE boundary (decode for an
  editor, encode for the row, plain words for a line of text) and
  reads values written before a field changed kind. A charter field
  bound to a target is shown and edited AS THE TARGET'S TYPE, not the
  type the layout gave it (`CanvasBinding.typeOf / value / setValue`):
  typing types edit in place — rich text included, toolbar over the
  surface, leaving saves, Escape abandons — and picking types open the
  card's own dialogs. The forms (create, edit details) enter every
  kind through `improvement/fieldInput.ts`, which reuses the canvas
  card's display and dialogs. No `promptText` popup remains on a
  typed target; roles keep their people pickers.

- **The initiative board's status band** (2026-09-29,
  `improvement/statusBand.ts`): above the cards, always in view — the
  STAGE BAR (2026-10-01: one labelled segment per stage with its
  single-quadrant PDCA glyph `pdcaQuadrant`; done full colour, current
  tinted and outlined, future grey; names ellipsise, below ~90px a
  segment keeps glyph + number, the current always named), the gate
  and its buttons on one row beneath (Request gate, Approve / Decline,
  Move to…, right-aligned) and the latest commentary. It collapses to one line, remembered per person
  (`initiativeBand` in the prefs JSON). The full stage rail and the
  whole trail stay in the details pane, which opens from a handle on
  the board's right edge. **Commentary** is one event kind
  (`comment`: High / Low / Next / Support needed) with a pure model
  (`commentaryModel.ts`), one UI (`commentary.ts`) and two writes
  (`commentaryActions.ts`) shared by the band, the pane and the
  priority popup's Commentary tab. Any member of the initiative team
  adds and edits; an edit rewrites the same event row, stamps who and
  when, and keeps the earlier wording in the row's detail (capped at
  ten). Nothing is deleted. Stale after 14 days without an update.

- **Going back a stage** (2026-09-29, `improvement/stageRevert.ts`,
  pure). A waiting gate request can be WITHDRAWN (whoever requested
  it, the owner, an admin); a declined one REQUESTED AGAIN; and an
  initiative REVERTED to any earlier stage — a completed one
  reopened into a stage — by its owner, its sponsor or an admin, with
  a required reason and no approval. A revert sets the stage, clears
  any waiting request, optionally re-dates the stage returned to, and
  writes one `stagemove` event with `revert: true`; a withdrawal
  writes a `gate` event (`what: "withdrawn"`). Card content, gate
  snapshots and history are left alone, and moving forward again
  passes each gate afresh. The approvers whose sign-off is undone
  (`undoneApproverRoles`) and the sponsor are told by the escalation
  notify road — the revert is applied first, so a send failure never
  reads as the revert failing. The band says "Reverted from …" until
  the next move forward (`standingRevert`, derived from the events).
  No schema change.

**The priorities poster** (2026-10-08). The Priorities tab's ⋮ offers
"Download PDF version": the current view as an A3 landscape PDF with
no controls (`src/priorities/pdfPoster.ts`, pure and tested, on the
issues export's writer with a size-agnostic `buildPagesPdf`).
Priorities design §18 has the page anatomy and the paging rules.

### 3.4 Actions

- One central table on the standard channel: every card raises actions
  keyed by `instanceId` = `board:card`; the hub's personal list uses
  `hub:<whoId>`; an action raised for a board as a whole (quick add, a
  relink) lives on the board's channel `<boardId>:board`
  (`boardChannelKey`), which the board's action surface lists and the
  hub labels by the board's name. `initiativeId` is stamped at the ONE
  write path for any action whose board is an initiative board and
  healed onto older rows on read (`actionBelongsTo` is the one match
  rule readers use). PDCA progression rides `ben_pdca` (Closed mirrors
  done).
- **Links are exclusive** (2026-09-29): an action is personal, or
  linked to ONE ritual, or to ONE initiative. No column holds the
  link — `shared/schema/actionLinks.ts` reads it from the instance
  key and the initiative id (`currentLink`), and `applyLink` MOVES
  the action: onto the target board's channel (the legacy
  `improvement:<id>` key for an initiative without a board) or the
  personal channel, setting or clearing the initiative id. Rows from
  v0.56.0 that carry both read as the initiative and normalise on
  their next relink. At the write, a channel key is authoritative
  for the board column (`stampedBoard`): `<board>:board` stamps that
  board, `hub…` clears it, even when a card editor passes its own
  board; a card key takes the caller's board, or keeps the stamped
  one when none is given.
- **One link provider** (`shared/ui/actionLinkProvider.ts`): the shell
  registers it at boot and every action dialog — cards, hub rows,
  quick add — reads it, so no control is handed a list. It resolves
  to `app/src/actions/linkTargets.ts`, which applies visibility ONCE:
  rituals through `canViewBoard` (and not on an archived site),
  initiatives through `canSee`, active only. Cached 60s, dropped by a
  boards / initiatives / people bump. A save that moved an existing
  action fires `ltk-action-moved`; the focused card view flushes and
  re-mounts so the list it left no longer shows it.
- **Confidential actions** (`ben_confidential` / `ben_createdby` /
  `ben_visiblejson`): seen by the creator, the assignees, each
  assignee's DIRECT manager (Office 365 Users `Manager`, session-cached)
  and super admins; the visible set is computed at save and stored;
  escalation admits the receiving board's owner. Enforced at the
  actions store's read choke point, so every surface inherits it —
  and roll-ups are therefore viewer-dependent. App-level like
  confidential initiatives and meetings: the rows stay readable
  through Dataverse itself.
- **Entry points:** every card's action dialog (Confidential check
  included), the action board's kanban / list, the hub's rows, the
  top-bar **＋ Add action** (assignee defaults to the viewer; starts
  linked to the OPEN board — ritual or initiative — else personal),
  the Actions tab's composer (assigns to the scoped person). Every
  dialog carries the "Linked to" field and a Comments section; Cancel
  action and taking an action off its card confirm inline. The focused
  card view flushes pending saves on leave and fires
  `ltk-actions-changed`; boards and the hub refresh on that signal.

- **Comments on any action** (2026-09-30): `comments` was always in
  the model and the row (`ben_commentsjson`), with a UI only on the
  escalation viewer. The shared action dialog now lists them and adds
  to them — so every surface that opens the dialog has them. What is
  written is saved with the dialog's Save (the box's text included);
  Close asks before it is lost. The author comes from the viewer the
  shell registers (`setActionViewerProvider`). Rows wear `💬 n`.
- **On hold** is a sixth PDCA state (`hold`, a pause glyph). The
  action stays open; while held it is NOT overdue — in `isOverdue`,
  the initiative roll-up, the Gantt (its own state and legend entry)
  and My day's Late / Due buckets. Resuming is choosing another
  state; nothing remembers the state it was held from.

- **Action endorsement** (2026-09-30). An initiative with endorsement
  on (its details; never a single-action one) makes a close by anyone
  but an ENDORSER wait: status `verify`, shown as Closed with an
  "Awaiting endorsement" marker, not overdue. Endorsers are the
  initiative's owner and sponsor — assigned, or the site's fillers of
  those standard roles — and admins (`improvement/endorsers.ts`). An
  endorser endorses (closed, `verified` stamped, a `verified` history
  entry) or sends back (reopened into Do, a `reopened` entry with the
  required reason); an endorser closing an action closes it directly.
  The rule is ONE pure function (`shared/schema/actionEndorsement.ts`
  `applyEndorsementRule`) applied at every save: the dialog, the tick
  and the kanban drop apply it for an honest screen
  (`endorsementFor`, answered from a cache the shell keeps warm), and
  `upsertActions` applies it AGAIN against the status the row holds —
  the backstop, so no closing road skips it. A change made there
  fires `ltk-action-ruled` and `ltk-actions-changed`. Actions closed
  before are left alone; switching endorsement off closes what is
  waiting (`closeAwaitingEndorsement`). With endorsement off, or off
  an initiative, nothing is enforced — a board's voluntary Verify
  column works as it always did. The queue shows on the board's band
  (count, Review), in the hub's Actions tab ("Awaiting your
  endorsement") and in the board's Verify column. No schema change.
- **Hub edits in another scope were not being saved** until
  2026-09-30: a row edited in a person's or an organisation's scope
  sent the viewer's own list to the store, never the row itself.
  `emitFor` sends the row when it is not one of the viewer's.

- **What a board tile shows** (`app/src/tileActions.ts`, pure): a card
  shows the actions that hang off it; an ACTION SURFACE (the actions
  card, the escalation viewer) shows the whole board's — or the board
  it is set to roll up — exactly as it does when opened. From the
  first live tiles (2026-07-25) until 2026-09-30 the overview gave
  every tile its own card's actions only, so the actions card's tile
  read "No actions yet" whatever the board held. An action raised ON
  the actions card now belongs to the board as a whole
  (`<board>:board`) unless the dialog says otherwise; it used to
  attach, silently, to whichever card the "Linked card" list named
  first.

- **The actions card's views** (2026-09-30). The configured view is the
  card's DEFAULT; a `List | Kanban | Gantt` switch on the card lets
  each person choose another, remembered by card for the session
  (`chosenActionView` in `cardRegistry.ts` — the tile and the opened
  card agree). **One Gantt**: in the app the card's Gantt view is
  `improvement/gantt.ts` `mountGantt`, the component the priority
  popup and the initiative's Gantt use, handed to the control through
  `setGanttRenderer` — an initiative board charts with its stage
  bands, any other board through the flat `"board"` scope. The
  control's own Gantt remains for a standalone control only. The
  kanban takes the height of its tallest column (the card's body
  scrolls, the columns never clip), and `＋` on a column raises an
  action straight into it (a status, or an issue when the board
  groups by issue; the dialog opens on the matching PDCA state).
- **Closing an action is one rule on every road** (2026-10-06).
  `settleFromParts` (`shared/schema/actions.ts`): every assignee's part
  done → the action is done / Closed, the endorsement rule applied as
  the list's circle applies it; a part undone → open / Do. The hub's
  "my part is done" tick applies it both ways (before, it only marked
  the part and the action stayed open everywhere else); the store's
  `upsertActions` applies the closing half as the backstop, never a
  reopen (the dialog's Do and a kanban drop are explicit acts). A
  kanban drop stores the PDCA its column implies; the dialog keeps a
  waiting (awaiting endorsement) part ticked.
- **The Gantt bar** (2026-10-05/06): List | Gantt · scope · assignee ·
  a standing "Show completed" toggle (the person's `ganttShowCompleted`
  pref, cached for the session, so it holds across the priority popup,
  the actions card and the Improvement tab) · window presets · ⋮
  export. No state filter — every bar and chip already shows its
  state.

### 3.5 Store read cache, writes in flight & change signals

- **The read cache** (`store/changes.ts` `memoRead`, 60 s, by topic:
  initiatives, boards, drivers, palettes, people roles, managers).
  Every new reader of those tables goes through the cached function.
- **Every store write goes through `writing(topic, promise)`** (never
  a bare `bumpChange` before the write): the cache is dropped as the
  write starts AND as it lands, and no read that starts while a write
  on its topic is travelling is kept (nor one a write overtook).
  Before 2026-10-01 writers bumped once, before the write, and a read
  that landed mid-write was kept stale for a minute — a charter's
  LINKED fields read the initiative through such an entry (card rows
  are never memoised), so the overview showed them one edit behind.
- **Writes in flight** (`store/inflight.ts`): writers `track` their
  promise — every card save, action save and initiative save — and a
  mounting screen `await whenSettled()` before it reads (the board
  mount, and every card and action reader in the store). A card's
  document saves through `saver.ts` on a 400 ms debounce, rescheduled
  when its snapshot lands; leaving the focused view now flushes every
  waiting save (`flushPendingSaves`) and the action flush, so the
  last edit is written at once and the next screen waits for it.
  Rule: a reader called from INSIDE a tracked write must not wait
  (it would wait for itself) — `listInitiatives` is deliberately not
  wrapped because `upsertActions` calls it.
- **Live tiles re-mount on demand** (`BoardGrid.refreshLive`): the
  grid's `setTiles` / `setLiveRenderer` are no-ops when their input is
  unchanged, so a tile mounted BEFORE something it renders from
  existed (the charter binding, which loads after the first paint;
  refreshed actions) kept its first picture. The board calls
  `refreshLive()` once the binding lands, on `ltk-actions-changed`
  and after the live-mode action refresh; a repaint through
  `renderTiles()` alone does nothing there (2026-10-01).
- **Change signals**: the Priorities screen's boot memo checks the
  topic versions; `ltk-actions-changed` is the DOM-level signal for
  action saves (boards, the hub and the initiative band refresh on
  it); `ltk-action-moved` and `ltk-action-ruled` make the focused
  card view re-mount when a save moved an action elsewhere or the
  endorsement rule changed it at the write.

### 3.6 Phone layouts (2026-10-07, v0.66.0)

The app had one phone surface before 2026-10-07 — the hub's two
columns stacked. A review of every main tab at 375px
([mobile-review-2026-10.md](mobile-review-2026-10.md)) found the frame
clipping tabs, action rows collapsing to a word a line, and three
screens (the priorities matrix, ritual boards, the initiative screen)
with no usable form at all. Five tranches followed in one day, all
CSS and layout, no model change:

- **Two width rules, deliberately.** The FRAME reads the window
  (`@media (max-width: 599px)` in `style.css`, and `isPhoneWindow()` in
  `src/phone.ts` for the few places JS must know): the top bar, the
  hub's tab strip, the board screen, the card walk, Priorities,
  Cadence and Settings are never split. A PANE that can be split reads
  its own width through a ResizeObserver: the Documents register
  (`PHONE_MAX_WIDTH`, §4), the BoardGrid (`LIST_MAX_WIDTH`) and the
  ActionBoard (`ACTIONBOARD_NARROW_MAX`, 480 — a tile is narrow on a
  desktop too). Both are 600px except the card's 480.
- **M1 — the frame.** Icon-only 44px bar buttons (the words stay in
  `title` / `aria-label`); the hub tab strip scrolls sideways with the
  open tab `scrollIntoView`'d (it used to clip Actions and Documents —
  the likely cause of pilot report 20); two-line action rows
  (`.ltk-lh-action`, and the shared `.ltk-action-row` in M4); the
  Actions head stacked; Settings says "best on a desktop" on the tabs
  that are; every harness and dev page carries the viewport meta.
- **M2 — ritual boards.** `BoardGridView` has a list mode
  (`listMode`, `measure()` on its ResizeObserver): one tile per row in
  reading order (`listOrder`, pure and tested), 4:3, the body
  scrolling, no empty cells; a live card is mounted at the slot's
  NATURAL size (the 640px stage scaled to a phone is 7px text), so
  each card's own tile layout reflows. The board screen's details &
  schedule pane becomes a fixed bottom sheet with a scrim, opened from
  a phone-only Details button (`.app-phone-only`) and closed by a pick;
  the initiative handle hides. The card walk (`cardEditor`) stacks
  PREV above and NEXT below the card, each naming its card. Four card
  tile layouts still want narrowing per card (SQDPC, RiskMatrix, RACI,
  Fishbone — backlog).
- **M3 — Priorities.** `prioritiesScreen` renders `renderPhone()`:
  native selects for organisation (`orgSelectOptions`, the tree in
  order, tested), period, status and pillar; the vision band; then the
  existing walk mounted inline (`mountWalk({ inline: true })` — no
  Exit, no Esc, no fullscreen). One objective per screen, swipe or
  rails; the matrix stays desktop. Same state as the desktop, so prefs
  and view links mean the same thing on both.
- **M4 — the initiative screen.** The board is M2's list and sheet.
  The ActionBoard renders its list under 480px of its own width, drops
  the view switch and says "Board and Gantt views open on a desktop"
  (`viewFor`, pure and tested; a tile stays silent; the person's
  chosen view is kept for the desktop); the Gantt's label column
  narrows to 150px; the Improvement tab shows tiles where List was
  picked.
- **M5 — Cadence.** The week default becomes Day under 600px until the
  person picks a view (`viewTouched`); a one-day grid drops the week's
  640px minimum.
- **Settings.** My profile was already a stacked form; Users opens
  with the add-person card, a full-width search and each person's
  controls behind an Edit toggle (admins adding someone on the fly);
  the unsaved-changes bar wraps; Rituals and the admin tabs stay
  desktop by Ben's call.

### 3.7 Settings surfaces (2026-10-07/08, v0.66.0–v0.67.0)

Settings is one row of tabs over one body per tab; the unsaved-changes
bar between them guards tab switches. What the two releases added
(the options weighed are in
[settings-nav-proposal-2026-10.md](settings-nav-proposal-2026-10.md)):

- **One section head.** `settingsSection(title, note?)`
  (`src/settingsSection.ts`) returns `.app-pr-section > h3.app-pr-h3`
  with an id and the intro note; every settings module builds its page
  sections through it, so the shell can DERIVE navigation from the
  headings. The small-caps `.app-section` divider is now only a card
  title inside a section.
- **The section strip** (`src/settingsStrip.ts`): after each tab
  render, and on repaints through a MutationObserver, the shell reads
  the body's heads and shows one pill per section — from two sections
  — sticky at the top of the window scroll (the settings card is
  `overflow: clip`; `hidden` would make it the scroll container),
  scroll-spy by `currentSectionIndex`, a click scrolling by the strip's
  live height, the hash never written. A tab may mark a control row
  `.app-settings-striptool` and the strip lifts it into its right end
  (Site cadence's site picker). Lifted rows are dropped only on
  `reset()`, which the shell calls before clearing the body on a tab
  switch — never on a heading change, because a tab's rows can land
  before its headings do.
- **Section cards.** The same pass (`groupSections`) folds each head
  and the siblings that follow it into `.app-settings-sectioncard` on
  the body's tinted ground, with a leading card for content before the
  first head. It is idempotent: a container that holds its own heads
  (or, once grouped, its own cards) is grouped INSIDE and left on the
  ground; a leading card that turns out to hold sections is taken
  apart and re-grouped; a repeat pass makes zero DOM mutations (a
  non-idempotent pass once moved the DOM under every focused field).
  A card that lived inside a section (`.app-access-card`, a
  `.app-dept-card`) takes a divider or the tinted-row look, never a
  second box.
- **Users** has one search box: the roster filters as you type;
  "Search directory & add" sends the same text to the directory
  (`directoryAddCard`), a hit's "＋ Add…" opens an inline placement row
  (site · department · area · crew · role) and "Add to roster" writes
  the person once, placed. An empty roster result offers the directory
  search.
- **Moves.** Ritual categories under Branding (colours are brand);
  Cascade customisation on each site's Organisation card beside its
  hub tabs, saved on change; the Vision statements section removed
  from Priorities settings (the band's ⋮ on the Priorities tab is the
  one road), leaving that tab super-admin only; Initiative templates
  first on Improvement; Rituals' head one row with a primary New
  ritual; Request admin lists the super admins with mail links.

## 4. The document management system

The DMS treats **SharePoint as the source of truth** — documents,
metadata, versions, permissions all live in SP document libraries; the
app is a register and workflow surface over them. Dataverse holds only
configuration (`ben_ltkdoclibraries`: the library list + one JSON
config blob per library + one app-level blob carrying the site
dictionary, lifecycle mapping, cadence and default filters).

Key concepts (details: [leanboard-standard-documents-plan.md](leanboard-standard-documents-plan.md),
[leanboard-phase5-plan.md](leanboard-phase5-plan.md)):

- **Library types**: standard (controlled), record, working, revision,
  template. Templates are visible to document controllers only.
- **The site dictionary**: one column model per site — internal name,
  label, group, per-library-type cells (hidden/available/default), and
  **roles** (status, owner, approvers, reviewers, documentId, docType,
  organisation, importance, effectiveDate, nextReviewDate,
  reviewCadence, linkedDocuments, tags, regulatorApproved,
  ackRequired…). Every behaviour keys off roles, never hardcoded
  column names.
- **Lifecycle**: draft → in review → in approval → in owner approval →
  approved → superseded/obsolete, driven by a status **term set**
  mapped to stages. Review is mandatory only when reviewers are named;
  a two-step approval only when approvers outside the owner exist.
  Commands run a strict write bracket (§5) and write recognisable
  check-in comments — the **audit view** derives who/step/comment from
  version history alone (no separate event store).
- **The date model**: effective date stamps itself at Approve and Mark
  reviewed; cadence follows the Importance term (a mapping); review
  date is always effective + cadence. None are typed by hand.
- **Content approval (moderation)**: libraries run SharePoint content
  approval; readers see only published versions. Every reader-facing
  act (approve, retire, quick property edit, mark reviewed) publishes
  as part of the act; mid-circulation drafts stay walled.
- **Links**: JSON in the document's own `DMSLinkedDocuments` column,
  uid-anchored, rels parent/peer/child/regulatorCopy. Declaring writes
  only the declaring document; "what links here" is derived (session
  index under 2,000 docs, per-document search above). The regulator
  gate is evidence-based: a flagged document warns at Approve until
  its stamped copy is linked.
- **Tags**: a closed term set; anyone proposes (guarded against
  phone-hostile characters, §7), controllers mint or decline
  (`ben_ltktagproposal` ledger). Since feedback round 1 (2026-10-06):
  Settings → Documents → Tags lists the tags in use with rename in
  place and ＋ Add tag; a controller's tag editor on a document mints
  on the spot (`mintTag`, the one road approval rides too); the editor
  is a MULTI-value one — chips plus an adder, every term written
  (`PrefillValue.terms` / `AddFieldValue.terms`, `taxonomyTermsOf`);
  the single select it had replaced every tag and prefilled only the
  first, which read as "couldn't add a tag".
- **Access model** (5G): four groups — document controllers (Entra),
  owners & approvers pool (Entra), a SharePoint **site group** for
  temporary edit grants (instant; the Entra editors group is retired),
  wall-TV/kiosk accounts. Requests → grant → revision-end release.
  In-app gates hide affordances; SharePoint stays the hard gate.
  Reviewers may be anyone (C2, 2026-10-06: `reviewerPeopleSource`,
  the pool first, the directory behind); owners and approvers stay
  pool-bound. Readers need **View Versions** in their permission level
  for the version history pane, which otherwise says so in one line.
- **Health**: Document Control Health scans the corpus (capped,
  stated) for control gaps — unmapped roles are reported as skipped,
  never silently passed. Roles are resolved per LIBRARY (a review
  column under another internal name is found). Since 2026-10-06 the
  scan keeps each document's named people (names + the `#email`
  twins), and two directory-backed findings are APPENDED after the
  pure report paints — a named owner / approver outside the owners &
  approvers group, and a named person the directory no longer has —
  with "Not checked" lines when a lookup fails. Document controllers
  get **Replace a person…** (`docs/roleReassign.ts`): one person out,
  one in from the pool, roles ticked, a preview count, then per
  document check-out → claims write → minor check-in, published on a
  moderated library when the document is approved; refusals listed.
- **Issues**: the ⚐ Report button files bugs/ideas with pasted
  screenshots (Dataverse file columns); superadmins triage, merge,
  and message reporters via Teams ([leanboard-issues-plan.md](leanboard-issues-plan.md)).
  Tick reports → **Export to PDF**: one document, a section per issue
  (`issues/pdf.ts` writer, `issues/exportPdf.ts`). Round 1 of the
  pilot's feedback (50 reports, 2026-10-05) was triaged from that
  export: [user-feedback-plan-2026-10.md](user-feedback-plan-2026-10.md)
  (the plan and status per item) and
  [user-feedback-test-script-2026-10.md](user-feedback-test-script-2026-10.md)
  (the walkthrough and its outcome table).
- **The register after feedback round 1** (v0.65.0, 2026-10-07). It
  OPENS with a visible "Approval status: Approved" filter
  (`seedApprovedFilter` after the status vocabulary is read; a view's
  `nonCurrent` now means "no status filter"; the kebab's hidden "Show
  only Approved" is gone). Filters take several terms per column,
  OR'd (`filterFromPicks` / `toggleFilter`; views carry every pick);
  tags and any set past 14 terms are SEARCHED in the popover; People
  filters are a directory search (the pool first) answered by CAML
  `Contains` on the person column; "Has" filters (linked documents,
  tags) by `IsNotNull`; the CSV export follows every filter (it never
  had). Every column header sorts — name and Modified on the server,
  the rest within the loaded rows with a status note. A saved view's
  name is the register TITLE (scope in the crumb; Update and Close in
  the Views menu); the chooser's dragged column order is honoured
  (`keepOrder` — the dictionary orders only the defaults). "Match
  contents & every field" is a toggle beside the search box and the
  scope dropdown is gone (the left pane picks libraries); the panel
  hides to a rail (`navHidden` pref); ☆ on every row; scroll restored
  after the preview closes; the preview's ⋯ downloads the PDF under
  the document's name; "Details ›" in the viewer head; type and
  status read inside their pane sections; a date-only column prefills
  as the SITE's day, not the UTC day. Default filters pick the site
  from the organisation's defined sites.
- **The phone register** (Tranche D, 2026-10-07; reports 43 and 20).
  Not a second screen: the same `mountDocs` with a `phone` flag that
  `relayout` sets from the register's OWN width (under
  `PHONE_MAX_WIDTH` = 600px of the wrap — the hub can split the
  screen, so the window is the wrong measure) and that CSS on
  `.app-docs-phone` turns into the limited layout. The folders pane,
  Document tasks, Add, Filters, tiles, the kebab and the row actions
  hide; four native selects (`paintPhoneFilters`): Library first —
  "All libraries" or one of them through the Libraries card's own
  `switchTo` (a remount), the desktop's ticked subset named until a
  pick replaces it (`phoneLibraryState`); then organisation, document
  type, status — from `filterColumns()`, the ONE list the Filters
  popover also reads — one pick per column through the same
  `applyFilter`, so chips, the query, exports and saved views
  read a phone pick exactly as a desktop one; the list is the `phone`
  width bucket of `buildRegisterColumns` — one stacked cell
  (`makePhoneCell`: Document cell, then status chip · library · date).
  The pure rules (`phoneOptions` indents a walk by depth, parents
  first; `phoneSelectState` names several picks or a deeper pick as a
  synthetic option rather than claiming "Any") live in
  `src/docs/phoneRegister.ts`. One ResizeObserver watches BOTH the
  wrap and the list pane: hiding the folders pane changes the pane's
  width, and a pane already hidden by the B5 pref would never re-fire
  on its own. `app/docs-phone.html` renders the real cells at 375px.

## 5. SharePoint interfacing (the connector roads)

Cookbook of record: [sharepoint-writes.md](sharepoint-writes.md).

Everything SharePoint rides the **SharePoint connector's `HttpRequest`
passthrough** (`src/docs/sp.ts → spRequest`) — REST calls executed as
the signed-in user through the connector, so consent, DLP and
conditional access all apply. The important roads:

- **Reads**: `RenderListDataAsStream` (RLDAS) is the register's feed —
  display-ready values, server-side CAML for search/filters/sort,
  cursor paging. REST item reads (`fetchListItem`) give full field
  values (RLDAS clips multiline columns — never mutate from a feed
  value). SharePoint **search** (`postquery`) covers
  inside-the-document matching and the over-cap links road. Term
  store v2.1 endpoints walk/create/rename terms (walks are
  localStorage-cached for screens; syncs always walk live).
- **Writes**: `ValidateUpdateListItem` (VULI) for text/choice/person
  (claims)/moderation/dates-in-site-locale; the connector's typed item
  PATCH for taxonomy and ISO dates; file operations (add, check-out,
  check-in, recycle) via REST. Every lifecycle write runs the
  **bracket**: check-out → writes → check-in (with a meaningful
  comment) → moderation publish when reader-facing → grant release.
  A refused step aborts before the check-in; nothing half-lands.
- **Previews**: presigned, cookie-free drive URLs (an iframe to SP is
  a third-party-cookie context that renders a blocked sign-in frame).
- **Measured platform limits** the code respects: ≤12 lookup-type
  columns per query (throttle), Note columns not CAML-filterable and
  clipped in feeds, RLDAS responses shrink-retried on mobile (§7),
  taxonomy labels store `&` as U+FF06 (§7).

### The five connectors

| Connector | Service | Used for |
|---|---|---|
| SharePoint (`shared_sharepointonline`) | `DocumentsService` + `spRequest` passthrough | everything in §5 |
| Microsoft Teams (`shared_teams`) | `MicrosoftTeamsService` | notifications: CreateChat + adaptive card (plain-message fallback); sender = the acting user (self-chats refused by the connector) |
| Office 365 Outlook (`shared_office365`) | `Office365OutlookService` | e-mail alternative for notifications (SendEmailV2) |
| Office 365 Groups (`shared_office365groups`) | `Office365GroupsService` | Graph passthrough (`HttpRequestV2`) for Entra group membership: pool checks, controller checks, member/owner add/remove |
| Office 365 Users (`shared_office365users`) | `Office365UsersService` | people search for pickers, profiles, and the direct-manager lookup behind confidential actions (app-wide, not docs-only) |

Teams/Outlook are **docs-only by the import gate** and load by dynamic
import at the moment of sending — the board bundle never carries them.
Group-membership gates **fail closed for elevation** (an unreadable
group never makes someone a controller) and **fail open for
convenience affordances** (a Graph hiccup must not hide the Add button
from a legitimate author — SharePoint still refuses unauthorised
writes).

## 6. Development & deployment

Operating instructions of record: [../CLAUDE.md](../CLAUDE.md) (agent),
[deploy-to-new-org.md](deploy-to-new-org.md) (new-environment runbook),
[deployment-cookbook.md](deployment-cookbook.md) (operational recipes).

- **Gates before any push**: `tsc --noEmit`, the import gate, the
  native-dialog gate, vitest (~730 tests), `npm run build`, chunk
  report — plus repo-root
  typecheck when `shared/`/`controls/` change. Check the test COUNT
  line, not just exit codes, when chaining, and `set -o pipefail`
  (`tsc | tail` reports tail's exit). The chunk report's ceiling on
  `cardRegistry` is a LEAK detector: a mounter that needs a pure helper
  from a settings module must import a UI-free module (the
  `CanvasCard/draft.ts` precedent), never the settings editors. Read
  the report's `index` line too: `main.ts` must import nothing heavy
  statically (`./runtime` carries the host SDK behind a dynamic
  import).
- **Dev deploys**: `pac code push` from `app/` (authenticated as the
  maker; the player caches bundles — close/reopen after every push).
  `pac code add-data-source -a dataverse -t <logical name>` wires new
  tables and regenerates services (use logical names, not entity-set
  names).
- **Schema**: declarative in `data/schema.mjs`, applied by
  `data/deploy-schema.mjs` (idempotent Dataverse Web API; creates
  tables/columns/relationships inside the **LeanToolKitData** solution
  and grants LeanBoard User role privileges in the same run). A schema
  change makes the next release **schema-carrying**: prod needs the
  managed solution imported before the app package.
- **Admin auth (device codes)**: `data/get-token.mjs` runs a
  device-code sign-in against any resource URL using the first-party
  Azure CLI public client; `data/exchange-token.mjs` re-scopes the
  refresh token to a sibling resource (e.g. Graph) without a second
  sign-in. The human performs every sign-in; tokens are written 0600
  to a temp directory outside the repo, never printed, and deleted
  after use. Direct SPO REST rejects this client in this tenant —
  Graph is the admin-scripting road.
- **Harness pages** (`app/harness/*.html`, `pdca-harness` in
  `.claude/launch.json`): mount a control or a screen fragment with an
  in-memory series stub (a Vite alias in `harness/vite.config.ts`) for
  screenshots and layout checks without Dataverse. Anything that reads
  live tables (the popup, the register, the overlay) stays a hosted
  check.
- **Releases**: `./release.sh <x.y.z>` + `git push origin main --tags`.
  The tag triggers GitHub Actions: build the app package, export the
  managed LeanToolKitData solution from dev, attach both to a GitHub
  Release. Version lives in the tag alone; the build stamps
  `__APP_VERSION__` from `git describe` (issue reports carry it).
- **Issues → one PDF** (2026-10-06): the triage desk ticks reports and
  exports a single PDF, a section per issue (id, kind, area, status,
  reporter, times, merges, following, description, captured context,
  resolution, thread with audience, attachments as images).
  `issues/pdf.ts` is a dependency-free writer (Helvetica / Courier in
  WinAnsi, JPEG XObjects, A4 flowed from blocks, text written as text
  so it extracts); `issues/exportPdf.ts` reads the four tables and
  re-encodes attachments as JPEG through a canvas. The hand-off for
  bugs found in a deployment the fixer cannot open.
- **Settings → Organisation** (2026-10-02): a site admin sees only
  their site; a superadmin's sites open collapsed to their heads, a
  site admin's departments likewise, with a chevron per row.

## 7. Security, authentication & data-loss prevention

**Authentication.** Users sign into Power Apps with their **Entra ID**
account — MFA and conditional access policies apply exactly as for any
M365 app. The code app runs inside the Power Apps player; the Power
Apps SDK **brokers an access token per data source** at call time. The
application code never sees, stores, or handles credentials or tokens:
there are no client secrets, no app registrations of our own, no
custom auth. Kiosk/wall-TV surfaces use ordinary (least-privileged)
signed-in accounts.

**Execution identity.** Every connector call — SharePoint reads and
writes, Teams messages, Graph group operations — executes **as the
signed-in user** through their own per-user connector connections
(consented on first run). There is no service account and no
elevation: a Teams notification is sent by the person who clicked
send; an approval is written by the approver. This is a deliberate
design principle ("honest provenance") and also the security model —
the app can never do what its user cannot.

**Authorization is layered, SharePoint last and decisive:**
1. SharePoint permissions (site groups, library permissions, content
   approval) — the hard gate; the app cannot grant anything SP denies.
2. Dataverse security roles — the **LeanBoard User** role carries
   explicit per-table privileges (granted declaratively at schema
   deploy). Issue/proposal tables are org-readable by decision
   (internal transparency powers dedupe and known-issues culture).
3. In-app gates (superadmin/siteadmin roles in `ben_ltkpeoples`,
   controller/pool Entra groups) — these only *hide affordances* and
   route workflows; they are UX, not security. **Confidentiality of
   initiatives, meetings and actions is of this kind**: hidden in every
   screen, readable through Dataverse by anyone with the app role. A
   hardened design (a separately secured table with per-record sharing)
   is logged in the backlog, not built. Elevation checks fail
   closed; convenience checks fail open (documented per gate).
   **Documents domain (2026-08-28):** admin standing there is the
   Document Controllers group ALONE — app site/super admins are not in
   the documents circle. The circle for a standard is: named owners /
   approvers, a Document Controllers member, or a granted revision
   editor.

**Data-loss prevention.** The app uses **five standard Microsoft
connectors only** (SharePoint, Teams, Outlook, O365 Groups, O365
Users) plus Dataverse — no custom connectors, no third-party
endpoints, no direct `fetch` to anything outside the connector
surface. Environment **DLP policies** therefore govern it completely:
all five connectors must sit in the same (business) group in the
environment's policy, and any DLP change that splits them breaks the
app loudly rather than leaking quietly. All data at rest stays in the
tenant: documents in SharePoint, configuration/issues in Dataverse.
Screenshots pasted into issue reports are stored in Dataverse file
columns (tenant-bound), never in SharePoint libraries where DMS
readers might browse them.

**Client-side state.** localStorage on the user's own profile holds
only UX state: term-set walks, UI preferences (collapse state, view
selections), a task-badge count, and the register's cached first page
(document names/metadata for instant paint — same data the user just
saw; cleared by cache-key mismatch). No tokens, credentials, or
document content are ever cached.

**Frames & popups**: the only iframes the app creates are the Embed
card's (user-configured https URLs, `safeEmbedUrl`-validated, no
`javascript:`/`data:`), delegated `fullscreen; storage-access;
local-network-access` and nothing more; the only popups are user-gesture
"Present in window" / open-in-tab of that same URL. Rich text (canvas
fields, embed commentary) is sanitised by allowlist REBUILDERS on write
and render — stored HTML is never trusted.

**Admin scripting hygiene** (§6): human-performed device-code
sign-ins, short-lived tokens in 0600 temp files outside the repo,
deleted after use; the deploy tooling is committed and reviewable —
no ad-hoc credential handling.

**Known platform boundaries** (documented, monitored):
- The Power Apps *mobile* player truncates connector responses
  containing U+FF06 (fullwidth ampersand — what the term store turns
  `&` into). Mitigations: the org-sync warns on `&` in unit names, the
  tag guard blocks it in proposals, feeds shrink-retry, and in-app
  probes (Test document feed / character classes) diagnose on-device.
  Reported to Microsoft.
- The mobile player's CSP blocks `blob:` images — screenshots render
  as `data:` URLs.
- Entra group membership propagates slowly to SP tokens — which is why
  temporary edit grants seat a SharePoint **site group** (instant)
  instead.
- **Chromium Local Network Access × Windows work-account SSO** (Edge/
  Chrome ≥ 142): the browser hands the Power BI frame's Entra token POST
  to the Windows account broker, Chromium gates that as a local-network
  request, and a NESTED cross-origin frame only holds the permission if
  every parent delegates it — the Power Apps player's frame does not
  (Microsoft's; Teams has the same open issue). Result: the embedded
  Power BI sign-in loops on Windows. Not DNS/VPN/proxy. Levers are
  outside the app (device-group SSO policies, the LNA off-switch
  policy, a Microsoft fix) plus the in-app Present-in-window mode and
  hint. Full diagnosis + policy names:
  [deployment-cookbook.md](deployment-cookbook.md) → Power BI embed
  prerequisites. The embed-token relay road (Custom API + service
  principal, needs Power BI capacity) is specified there and ON HOLD.

## 8. Living documents map

| Question | Document |
|---|---|
| Data model & board engine | [master-leanboard.md](master-leanboard.md) |
| DMS design (register, vault UI) | [leanboard-standard-documents-plan.md](leanboard-standard-documents-plan.md), [leanboard-vault-design-plan.md](leanboard-vault-design-plan.md) |
| Lifecycle, access model, dates | [leanboard-phase5-plan.md](leanboard-phase5-plan.md), [leanboard-access-group-plan.md](leanboard-access-group-plan.md) |
| SharePoint write mechanics | [sharepoint-writes.md](sharepoint-writes.md) |
| Links, audit view, tags | [leanboard-relationships-plan.md](leanboard-relationships-plan.md) |
| Issues/reporting | [leanboard-issues-plan.md](leanboard-issues-plan.md) |
| Pilot feedback round 1 — plan, status, test script | [user-feedback-plan-2026-10.md](user-feedback-plan-2026-10.md), [user-feedback-test-script-2026-10.md](user-feedback-test-script-2026-10.md) |
| Phone layouts — the review, tranches M1–M5, card follow-ups | [mobile-review-2026-10.md](mobile-review-2026-10.md) |
| Settings in-page navigation — options and the built strip | [settings-nav-proposal-2026-10.md](settings-nav-proposal-2026-10.md) |
| Capture rollup (Flag column, cross-board capture rows) | [leanboard-capture-rollup-plan.md](leanboard-capture-rollup-plan.md) |
| Canvas card, design mode, Canvas rollup | [leanboard-canvas-card-plan.md](leanboard-canvas-card-plan.md) |
| Power BI embed prerequisites (browser policy) | [deployment-cookbook.md](deployment-cookbook.md) |
| Backlog & decisions of record | [backlog.md](backlog.md) |
| Notifications | [leanboard-notifications-plan.md](leanboard-notifications-plan.md) |
| New environment setup | [deploy-to-new-org.md](deploy-to-new-org.md) |
| Operational recipes (flows etc.) | [deployment-cookbook.md](deployment-cookbook.md) |
| Requirements disposition | [bba-dms-gap-analysis.md](bba-dms-gap-analysis.md) |
| Decisions & queue | [backlog.md](backlog.md) |
| Dev-environment operating rules | [../CLAUDE.md](../CLAUDE.md) |
