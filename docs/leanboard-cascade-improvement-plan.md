# Cascaded Priorities, Improvement & Problem Solving — plan of record

(2026-08-19. Source: "Cascaded Priorities, Improvement & Problem Solving
Brief.docx"; decisions Ben's, same date. **STATUS: decisions taken;
design pass for §4.1–4.3 signed off and folded in (see "Design pass —
outcome"); phasing revised to the build order; P0 next on Ben's go.**)

Two new pillars of the app: **cascaded priorities** (what we want to
achieve, at every org level, cascading down and across) and
**improvement / problem-solving initiatives** (how we deliver them),
tied together by a single-page priorities view, a value driver tree,
and reporting.

## What already exists and is reused (the shape of the build)

| Brief concept | LeanBoard today |
|---|---|
| Org hierarchy (company → site → department → team) | the DMS org dictionary (term-store synced; on people + boards). "Team" = area. |
| Initiative "leanboard format", templates | project boards (one living instance) + board templates, composer, card studio |
| Plan on a page / charter | the Canvas card (v0.45) — gains **bound fields** |
| Summary of underlying initiatives | Canvas rollup |
| Metrics tracking | KPI-trend renderer + `ben_ltkcardseries` |
| Flag / escalate | the actions escalation channel + EscalationViewer |
| Evidence files | the Dataverse file road (`uploadFileToRecord`) |
| Notify team (Teams/Outlook) | the notify road (docs-only today — opens to boards; DLP story updated) |
| Confidential initiatives | boards' `canViewBoard` / confidentiality settings |
| Roles/admins | ben_ltkpeoples role + site/department |

Genuinely new engines: **the priority cascade** (records, lineage,
per-org acceptance), the **value driver tree** with formulas and
simulation, a **Gantt** over actions, **stage/PDCA gates** on boards.

## Decisions of record (Ben, 2026-08-19)

1. **Org model = the org dictionary**, company root → site → department
   → area ("team"). Site is the minimum level for priorities.
   Individual objectives are OUT of v1.
2. **Cascade model = assignments + child priorities.** A priority is one
   record owned by its originating org. Cascading creates per-org
   ASSIGNMENTS (priority × org: proposed → accepted / rejected / on hold
   / completed, with reason). Customising creates a CHILD priority
   (own record, parent link). Lineage is preserved either way; the
   originator sees every assignment's status; peers cascade the same
   way.
3. **Initiative = header record + project board.** Header (title,
   linked priorities, method/template, roles, metrics, stage,
   confidentiality, flag, period) + a project board from the initiative
   template. Charter = a Canvas card **with bound fields** that display
   and edit header data live (title, roles, priorities, metrics…) — the
   charter is never a copy. Actions = the existing Actions card.
   "Single action" initiative = header + actions, no board.
4. **Metrics full + VDT with free-form formulas + simulation, this
   phase.** Initiative metrics: interval, definition, source link,
   units, tracking method (good/bad · value vs target/limits ·
   picklist), baseline; VDT metrics add plan/forecast/actual. VDT per
   site: nodes with a **formula per node** over children (a small pure,
   tested expression evaluator — no `eval`), roll-up on read, and
   simulation = apply initiative forecasts at leaves, recompute.
5. **Stages**: template-defined ordered stages, each mapped to Plan / Do /
   Check / Act (fixed four, app-wide colours); a stage gate can require
   approval by **one or more roles** (e.g. sponsor + improvement lead
   at completion; finance for valuation) — roles are template-
   extensible beyond sponsor/owner/lead/team/support. Template cards
   are tagged with a stage; the title bar shows the stage chip. Stage
   changes are logged (who/when/comment) = the initiative's audit trail.
6. **Actions**: start date + Gantt (default 4-week window);
   reschedule/cancel reasons + history; evidence files + owner
   endorsement of completions (initiative switch) + recently completed;
   bulk reassign + open-actions digest to team via Teams/Outlook.
7. **Permissions**: org OWNERS named per node — at **site and
   department** only (areas are managed by their department's owners)
   — create/edit their org's priorities, accept/reject/hold cascades,
   set the vision, and see confidential initiatives in their org;
   siteadmins across their site; superadmins everything; **pillars
   superadmin-only**. Everyone reads (except confidential).
8. **Embedded card + week**: live data; the meeting's week sets the
   time window of metric points, Gantt/due-soon and "what changed". No
   record snapshots; the tile image archives on close as always.
9. **Priority status**: derived, shown as **counts of red / amber /
   green initiatives**; roll-up rule is a VIEW toggle — **strict** (any
   red → red) or **ratio** (red > X% → red, X an admin setting). No
   manual override. Primary-initiative metrics headline the priority.
10. **Period**: every priority carries a period (FY / calendar / custom
    label per company); views default to the current period; year-end
    review per priority: carry forward (same record, lineage intact) /
    complete-archive with reason / retire.
11. **Confidential** initiatives: visible to role-holders + org owners +
    admins only; hidden elsewhere and counted as "n confidential" where
    a total would otherwise lie.
12. **Health checks**: periodic evaluations against a **company-level
    question set** (admin-defined), captured at any point from the
    initiative board; per-initiative trend/history; org-level trend
    across initiatives in reporting.
13. **Sequencing: cascade first, then initiatives, then VDT/reporting**
    (statuses read "No data" until initiatives exist — accepted).

## Data model (provisional — solution-carrying; all `ben_ltk*`)

- `pillar` (company-level; two levels via parent; label, colour, active,
  order) — superadmin.
- `orgowner` (org term id ↔ person; site/department only) + `orgvision`
  (org term id → vision text) — or both on one `orgprofile` row.
- `priority` (statement, pillar, originating org, owner person, period,
  status: active / completed / archived / retired + reason, parent
  priority, primary initiative, order, created/updated).
- `priorityassignment` (priority × org, status proposed / accepted /
  rejected / on hold / completed, reason, decided by/when).
- `initiative` (title, template, org, stage, status, confidential,
  flag level none/flag/escalated + note, endorsement switch, period,
  board id nullable, created/updated) + `initiativepriority` (junction,
  primary flag) + `initiativerole` (initiative × person × role key ×
  optional time commitment) + `initiativemetric` (per-metric definition
  or VDT node link; series in `ben_ltkcardseries` keyed by metric id) +
  `initiativestagelog` + `initiativehealth` (dated evaluation, answers
  JSON, score) + `initiativecomment` (dated highs/lows/next steps).
- `initiativetemplate` (name, method, stages JSON incl. PDCA map +
  approver roles, roles JSON, custom fields JSON, board template ref,
  mandatory/optional card map) — superadmin.
- `vdtnode` (site, parent, name, definition, source link, units,
  tracking, formula, is leaf) + `vdtvalue` (node × period: baseline /
  plan / forecast / actual).
- `healthquestion` (company-level checklist) — superadmin.
- Actions table extensions: start date, evidence files, verification
  state, reschedule/cancel history (child rows or JSON), initiative
  link.
- Admin settings: RAG ratio threshold X; period definition.

## Design pass — outcome (2026-08-19)

The design pass is signed off. Its outputs live beside this plan:
`leanboard-cascade-build-brief.md` (the hand-off + build order),
`leanboard-cascade-priorities-design.md` (§4.1 spec),
`leanboard-cascade-initiative-board-design.md` (§4.2–4.3 spec),
`leanboard-design-review.dc.html` (visual reference — sections 9a, 10a).
**Presentation: the specs win. Model: this plan wins; conflicts were
asked, not assumed** (three below).

Presentation decisions taken by the review, adopted here: the wall
template is the Simple view (vision band → L1 pillar chips ("medium-term
strategy") → L2 pillars as matrix columns → **Priorities** row →
**Objectives** row = the primary initiative's headline metric); status
tallies are **symbols + total** (`✓ n ! n ✕ n · n initiatives`), never
letters or colour alone; no owner chip on matrix cards; no per-column
add cells (toolbar `＋ Priority`); ONE cascade surface (toolbar
`⇩ n cascades to accept` chip → review list; a final walk-mode step);
priority detail = the Documents overlay + rail; density rule for 5–6
columns with the pillar filter as the primary width answer; TV is
displayed (matrix) AND walked (one objective per step); Improvement tab
= one table, three groups (Mine → Owned by my team with scope select →
All I can see); initiative board = two-tier header (tier 2 collapsible,
persisted), chevron stage stepper doubling as the gate control, gate
line with `Request gate` / `Approve` / `Decline`, flag/escalate as header
chips, board grid with stage-tagged cards + Current/All stages filter,
bound Canvas fields as sunken dashed tiles with ⛓, kanban gains a
**Verify** column; PDCA colours are fixed app tokens (Plan amber, Do
blue, Check green, Act purple).

### Model points raised by the specs — answered (Ben, 2026-08-19)

- **Accept keeps decision 2**: accepting a cascade AS-IS records the
  assignment only and the receiving org's matrix renders the parent's
  record in its column tagged "adopted"; a CHILD row exists only when
  customised. Presentation consequence: the review list offers
  **Accept** (adopt) and **Accept & customise** (child) — the one
  adjustment to the spec's "accept creates the child".
- **Initiative R/A/G = worst of metric AND actions**: red if the primary
  metric is red OR the initiative is escalated; amber if the metric is
  amber OR any action is overdue OR it needs support; green otherwise;
  no metric and no actions → grey (excluded from tallies, counted in the
  total). One pure, tested function feeds the row edge, the priority
  tallies (strict / ratio) and reporting.
- **Templates builder is designed before the initiative board is
  built**: no seed-JSON interim; build items 5–6 wait for the next
  design pass (templates builder + Gantt + VDT + reporting). Items 1–4
  (priorities) do not depend on initiatives and proceed.

### Model additions from the specs (adopted)

pillar `level` (1/2) + colour + order; priority `order`; per-user prefs
(view mode per org, tier-2 collapsed, TV mode, last pillar filter);
`initiativegate` (initiative × stage transition × approver role ×
person × decision × comment × when) instead of folding approvals into
the stage log; **stage target dates** on the initiative (the "Next
gate — Do → Check, 28 Aug" column); template `mandatoryMetrics` (target
+ good direction) and per-slot `stage` + `mandatory` flags in the board
template manifest; commentary rows carry High / Low / Next; the single-
action initiative writes one action linked to the header; actions gain
status `verify` (awaiting verification), start date, evidence files,
reschedule/cancel history with a reason picklist.

## Phasing (revised to the build order — 2026-08-19)

- **P0 Foundations — BUILT 2026-08-19 (dev; next release SOLUTION-CARRYING)** — schema (priorities side + actions + settings columns; INITIATIVE tables deferred to P5 so their shape follows the templates-builder design; the notify road stays docs-only until P6 first uses it);
  pillars L1/L2 + period/RAG + VISIONS in a NEW Settings → Priorities
  tab; OWNERS are the org editor's owners (Organisation tab) and nowhere
  else — Ben, 2026-08-19: no separate owner lists under priorities; the
  permission map reads them (company/site/department; areas fall to
  their department); user prefs (P3, when the view mode exists); action model
  changes (`verify` tolerated by the kanban in Done with a marker,
  excluded from overdue; history + verification + initiative id mapped;
  `ben_start` already existed) — UI in P6. Pure model
  `app/src/priorities/model.ts` (org refs, pillars, matrix membership
  own+adopted, lineage, tallies/roll-up, initiative RAG, periods,
  permissions — 13 tests); store `store/priorities.ts` (GUID↔id bridge,
  `loadCascade` in one call).
- **P1 Priorities — Simple view spine — BUILT 2026-08-19 (dev, app-only)** —
  `app/src/priorities/prioritiesScreen.ts` + `dialogs.ts`, riding the hub as
  an extra tab "Priorities" beside Documents (dynamic import; `#/priorities`
  fronts it). Built as designed, with these P1 stand-ins: statuses come
  from a stub resolver (every card grey, "· 0 initiatives"; Objectives
  cells read "No metric set") until initiatives land in P5; the Dynamic
  toggle is shown disabled (P3); the cascade chip shows the count only
  (review list is P2); TV mode is absent from ⋮ (P4); the card kebab
  offers Edit / Move up / Move down with Cascade to… and Complete greyed
  (P2). PULLED FORWARD from P2: the add/edit priority dialog (§9 —
  statement, sub-pillar grouped under pillars, owner picker from the
  roster, period, primary initiative placeholder, cascade-to child+peer
  orgs with owner names → proposed assignments + `cascaded` event, confirm
  line, notes) and reorder — so the matrix can be filled and checked in
  the player. ORG NAV streamlined after Ben's review (2026-08-19): plain
  crumbs (click an ancestor to go up) + ONE ▾ popover on the current node
  — Switch (siblings, ✓ current) · Descend (children) · Browse all… (tree
  picker) — each row carrying its ⇩ pending-cascade count; the Descend
  chip row and the standalone Org-picker button are gone. Row labels are
  plain small-caps in the 126px gutter (Vision · Strategic pillars ·
  Priorities · Objectives), pillars/sub-pillars fill with their set
  colour, the vision band is dark on the matrix grid. Org tree = site-settings rows (`{department, areas}`) under
  the site→company map; default org = viewer's site; view prefs (org,
  pillar filter, rule, Other, group-by) in localStorage. Design as
  specified — org bar (breadcrumb dropdowns
  + Descend chips + Org-picker dialog on the DMS tree), vision band,
  toolbar (pillar two-level filter, period, status, Simple/Dynamic
  toggle, cascade chip, ＋ Priority, ⋮ view options incl. strict/ratio,
  Other, completed, TV mode), the matrix (`126px repeat(n,1fr)`), the
  priority card (status edge, statement, tallies + total, lineage
  glyph line, worded flags), Objectives row (metric line + sparkline),
  Other strip, density rule (≤4 / 5–6 compact + collapsed Objectives
  strip / 7+ scroll + group-by-strategy), phone stacking, empty/vision
  copy. Statuses read from a stub resolver until initiatives exist.
- **P2 Detail overlay + rail + cascade lifecycle — BUILT 2026-08-19 (dev,
  app-only)** — `app/src/priorities/lifecycle.ts`: detail overlay (any
  viewer; header pillar chip · statement · org · period · owner · ✕;
  tabs Initiatives / Charter / Actions state their P5 dependency plainly,
  History is live from ben_ltkpriorityevent + notes; rail Status (tallies
  + rule words) · Lineage (↑ parent link; children ✓/⏳/⏸/✕ with reasons
  and customised wording, links) · Actions stub · foot `Add initiative`
  (disabled until P5, the one solid primary) · `Cascade to…` · `⋮ More`
  Edit / Complete… / Archive…; scroll preserved across repaints; parent-
  completed prompt with Complete… / Keep-with-note); the cascade review
  list behind the ⇩ chip (Awaiting / Parked sections; Accept = adopt
  as-is, Accept & customise = child priority via the dialog with own
  cascade-on, Hold / Reject with reason dialogs; a quiet ⏸ chip when only
  parked items remain); close dialog "Why is this closing?" with the four
  reasons — Carried to next period creates the copy (`carryForwardCopy`,
  no lineage, events on both); bulk carry-forward from ⋮ view options;
  sender's-view flags on the card (✕ declined / ⏸ parked with reason,
  ▲ Parent completed). Objectives row now shows at every density (Ben).
  Design as specified — overlay
  (Initiatives / Charter / Actions / History tabs; Status / Lineage /
  Actions rail; one solid primary; restore org+filters+scroll on
  close); the cascade review list (Accept / Accept & customise / Hold /
  Reject with reasons; sender's-view flags for declined/parked); add /
  edit priority dialog (statement, pillar, owner, period, primary
  initiative, cascade-to with confirm line, notes); complete/archive
  with reason picklist; parent completed/revised prompts on children;
  reorder; period carry-forward flow.
- **P3 Dynamic view — BUILT 2026-08-19 (dev, app-only)** — Simple |
  Dynamic toggle live. Ben's call the same day: Dynamic keeps THE SAME
  MATRIX (pillars over sub-pillar columns) — only the card gets richer
  and the Objectives row folds into it (no title strip; the column head
  names the pillar). Card = 14.5px statement · headline metric block (22px value + target
  line + 96×40 sparkline — placeholders reading "No metric set" until
  P5) · owner initials chip + name · ✓ ! ✕ tallies + "n initiatives" ·
  lineage line · flags; same overlay/kebab as the matrix. PREFS
  (`priorities/prefs.ts`, parser in model.ts): view mode per user PER
  ORG + last org + rule/Other/group-by, stored under the `priorities`
  key of ben_ltkuserprefs.ben_preferences via the new `mergeUserPrefs`
  (read-merge-write; the hub's onPrefs now merges too instead of
  overwriting) — no schema change; localStorage prefs retired. Design as
  specified — card per priority (pillar title strip, 14.5px
  statement, 22px metric + 96×40 sparkline with target line, owner chip,
  tallies + count); per-user-per-org persistence.
- **CASCADE CUSTOMISATION FLOOR (Ben, 2026-08-19)**: per-site setting
  (Settings → Priorities → "Cascade customisation"; superadmin any site,
  siteadmin their own) = the deepest org level that may "Accept &
  customise" a cascade — Site only / Down to department / Down to team
  (area, the default). Below the floor the review list offers Accept /
  Hold / Reject only with a quiet note, AND ＋ Priority is withheld (the
  header reads "Adopts priorities from above") — below the floor an org
  only carries what cascades down; existing own rows keep their kebab.
  Adopt as-is keeps decision 2. Stored in the SITE row's
  ben_prioritysettings as {customiseLevel}; model `canCustomiseAt`.
  Also since P4: re-send a declined/parked cascade (Lineage rail
  Re-send; re-tickable rows in every Cascade to list; "re-sent" event).
- **LAYOUT CONSOLIDATION (Ben, 2026-08-19, after P4)**: the presentation
  layout IS the Priorities view — one header "FY26 Cascaded Priorities |
  Company › Site ▾" (lead in the accent; ancestors click up, ▾ = Switch ·
  Descend · Browse all…) · ⇩ cascade chip · **▶ Walk through** · **＋
  Priority** · ⋮ (Period · Status · View = "Priority/Objective view"
  (was Simple) / "Priority only view" (was Dynamic) · Roll-up rule · Show
  Other · Group by pillar · Carry forward). No separate org bar, toolbar
  or presentation toggle; card kebabs and vision edit stay. The ×1.4
  type, full-width title and plain labels apply always.
- **P4 TV walk mode + embedded ritual card — BUILT 2026-08-19 (dev,
  app-only)** — `priorities/walk.ts` (mountWalk into any host: one
  objective per step, header strip in the sub-pillar colour with L1 · org
  · period, progress dots + n/N, rows = 6px status edge · 19px statement
  · owner chip · worded flags · three large tallies · metric cell; footer
  ‹ named prev · ⊞ All objectives · named next ›; ←/→, Esc, swipe;
  final "Cascades to accept · n" step renders the same review list —
  `renderReviewList` extracted from the modal). Screen: ⋮ → Present: Presentation
  mode (Ben's name for the spec's TV mode; org name + ▶ Walk + Exit
  presentation, vision band full-width, toolbar hidden, ×1.4 type, kebabs/
  add-cells hidden, Esc exits) · Walk objectives. CARD `PrioritiesCard`
  (registry spec, group Reference, config prSite/prDepartment/prArea
  blank = the board's own org via getBoard, prPillar name filter, prView;
  LINK_SOURCE_EXCLUDED) — mounter is a dynamic import of
  `priorities/prioritiesCard.ts` (+0.5 kB on cardRegistry); tile vs
  focused decided by host size (≥700×400 = focused → PRESENTATION
  matrix of the focus pillars all at once, ⊞ All pillars / ◎ Focus
  pillars toggle — no walk in the card, Ben 2026-08-19; tile = compact
  non-interactive matrix); period from instanceWhen; tile
  snapshot `prioritiesSnapshotSvg` (vision band + objective headings +
  status edges, no metric text). Card mounts never persist prefs. ROTATION
  FOCUS (Ben, 2026-08-19: an explicit topic→pillars map, since rotation
  names are usually simpler than pillar names): card setting `prTopicMap`
  = a `topicPillars` builder in Card settings listing the board's rotation
  topics (from the wizard blob via `rotationTopics()` in
  shared/schema/recurrence.ts) + a "No topic / ad hoc" row + stale rows,
  each a chip list of pillars/sub-pillars (ids); the studio feeds the pane
  `setRotationContext` (topics + pillars, lazy). At meeting time the
  occurrence's topic (`topicForDate`, same rule the engine stamps) rides
  `CardMount.instanceTopic` from both mount paths → `focusForTopic` →
  the screen's focus SET (`objectiveColumns` accepts an id set: pillar ids
  keep their sub-pillars, sub-pillar ids keep themselves) → matrix, walk
  and snapshot narrow to it; no focus → `prPillar` name → all. Title in
  presentation shows " · Topic". Design as specified — walk one objective per
  step (progress dots, named prev/next, ⊞ All objectives, keyboard /
  remote / swipe), final "Cascades to accept" step, filters carry in;
  the card: settings (org, pillar, view mode), tile = displayed matrix
  (vision band + headings + status edges), focused editor opens in walk
  mode at step 1 with the meeting's week as the window.
- **— next design pass —** templates builder, actions Gantt, VDT
  editor + simulation, reporting shapes (brief §4.4–4.5, §6 Q7/11/12).
  Entry points (`Gantt ›`, settings tabs) stay stubs until then.
  BRIEF DRAFTED 2026-08-19: `leanboard-cascade-design-brief-2.md` (what
  is built, the new primitives to reuse, §4.1–4.5 scope, 12 questions,
  deliverables) — hand it over with brief 1, the two specs and the
  review HTML.
- **P5 Improvement tab** — three-group table with scope select, row
  anatomy, List/Tiles, filters, three-step create modal incl. Single
  action (needs templates → after the templates builder).
- **P6 Initiative board** — two-tier header, stepper + gate line +
  request/approve/decline (+ Teams/email to approvers), flag/escalate
  (+ sponsor prompt), commentary, health check, stage-tagged grid with
  Current/All filter, future-stage placeholders, optional-card add,
  undeletable mandatory cards, Canvas bound fields, metric blocks,
  kanban Verify column + evidence + reschedule prompt + endorsement,
  bulk reassign, open-actions digest.
- **— design pass 2 RECEIVED 2026-08-19** —
  `leanboard-cascade-templates-gantt-vdt-reporting-design.md` (§1
  templates builder, §2 Gantt one-control-two-scopes, §3 VDT tree +
  simulation, §4 reporting shapes, §5 health questions + carry-forward;
  visual reference sections 11a/12a of the review HTML). Indicative for
  styling/layout, not 1:1 (Ben); notably the board editor is the SAME
  composer as meeting boards, not the spec's re-drawn tile editor. No §5
  decision changed. Model notes adopted: initiatives will snapshot their
  resolved stages/gates/mandatory sets at creation (P5); metric `Link to
  a value driver` arrives with the VDT (P9).
- **P7 Templates builder — BUILT 2026-08-19 (dev; next release
  SOLUTION-CARRYING: ben_ltkinitiativetemplate)** — model
  `improvement/templateModel.ts` (stages+gates incl. the always-shown
  Complete gate, PDCA tokens, method presets, roles/fields/metrics
  parsing, stepperChips, validation, propagation words, slot
  stage/mandatory flags; 6 tests); store `store/templates.ts` (+
  `ensureTemplateBoard`: a project-kind isTemplate board seeded with
  Charter (Canvas, mandatory) + Action plan); reusable wizard shell
  `improvement/wizardShell.ts` (the meeting wizard's chrome as a
  function); wizard `improvement/templateWizard.ts` at
  `#/template/<id|new>` — 7 steps per §1 (Basics with method-preset
  offer; Stages & gates with live chevron preview, boundary gate rows,
  delete-blocked-with-reason, amber propagation note on steps 2/5/6/7;
  Roles standard-locked/label-editable, remove blocked while a gate
  names it; Fields; Metrics with target-required validation; Initiative
  board = the COMPOSER as a full-screen overlay + a stage/mandatory
  table, charter always mandatory; Review = linked summary grid, Save
  blocks and lists with fix › links); Settings → Improvement landing
  (cards, retired last, ⋮ Duplicate/Retire/Delete). DEFERRED to P6: the
  ⛓ bound-field toggle in the Canvas builder + stage/mandatory on the
  card studio Common tab (§1.5–1.6 runtime halves); "n initiatives use
  this" reads 0 until P5. REVISED same day (Ben): METHODS are an
  app-level configurable list and STANDARD ROLES (e.g. Finance lead —
  addable to any template as role/gate approver, several people per
  role) live beside them — both in `ben_improvementsettings` on the
  APP_ROW, edited at the top of Settings → Improvement; the wizard's
  Method select reads the list, its Roles step offers ＋ chips for
  standard roles, added roles default to several people; standard roles carry
  WHO FILLS THEM PER SITE (Ben, 2026-08-19: a people list per role per
  site in the same JSON, edited under each role in Settings →
  Improvement via the owner picker) — the template carries only the role
  key; at runtime ANY of the initiative's site's fillers may complete an
  approval step assigned to the role (`roleFillersAt`, the rule P6's
  gates implement). The board step is
  INLINE (mountDesigner in .ltk-mw-boardhost, the meeting wizard's exact
  pattern) — no overlay. FURTHER (Ben, 2026-08-20): step order is Basics ·
  ROLES · Stages & gates · Fields · Metrics · Board · Review (roles
  before the gates that name them); STANDARD FIELDS join the improvement
  settings (header fields every initiative carries, template regardless
  — shown read-only atop the wizard's Fields step); standard roles are
  org-styled cards with per-site app-owner people chips.
- **P5 Improvement tab + create flow — BUILT 2026-08-20 (dev; next
  release SOLUTION-CARRYING: ben_ltkinitiative + ben_ltkinitiativeevent)**
  — schema: ONE initiative row + ONE event table (the priorities
  pattern; the plan's provisional junction tables folded into JSON
  columns: snapshot / roles {roleKey:[people]} / priority links /
  field values / metrics / pending gate / stage target dates; gate
  HISTORY = events, gate STATE = a JSON column). Model
  `improvement/initiativeModel.ts` (snapshotOf per design 1.7's rule,
  stageTargetsFrom cumulative target weeks — LOCAL date math,
  nextGateFor, the three groups incl. confidentiality with honest
  hidden-count, myRoles/canSee, validation; 5 tests). Store
  `store/initiatives.ts` (createInitiative snapshots the template,
  computes stage targets, clones the template board's MANDATORY slots
  into a fresh `init-<id>` project board with stage tags kept; the
  single-action variant writes one linked action instead). UI: hub tab
  "Improvement" (after Priorities in HUB_TABS — the per-site tab
  setting picks it up; `#/improvement`): toolbar (site · PDCA · period ·
  status · method · ⚑ Flagged · Tiles DISABLED until P6 · ＋
  Initiative), three-group table per design 1.1–1.2 (team group with
  scope select, `Gantt ›` stub, first-5 + Show all; rows = grey status
  edge until metric values exist · title + ▲/⚐/◈ chips · meta (role or
  owner·org) · PDCA stage chip · metric "no value yet" · next gate
  with overdue red + "awaiting you" · health "Not checked" · ⋮ Open /
  Flag / Escalate (confirm; Teams notify arrives P6) / Archive, Health
  check + Move stage stubbed); create flow per 1.3 (template picker
  with single-action last, header form with org selects, priority
  links with ★ primary, roles PRE-FILLED from the site's standard-role
  fillers, standard + template fields, metric targets, confidential;
  lands on the new board).
- **P6a Initiative board header — BUILT 2026-08-20 (dev, app-only)** —
  board.ts gains a STANDALONE mode (kind=project: synthetic live
  instance, live rows, scheduler pane + toggle hidden, cards edit via
  the "live" editor without the standard-content suffix); `init-` boards
  mount `improvement/boardHeader.ts` above the grid (lazy; board chunk
  +1 kB). Tier 1: Improvement crumb · org · title · flag/confidential
  chips · overlapped role avatars +n · Health button (score · date once
  checked; stored in fieldValues.__health so the tab's Health column
  reads it without an event query) · ▴/▾ (persisted) · ⋮ (flag,
  escalate, endorsement toggle, archive). Tier 2: stage stepper (done ✓
  tinted → gate history popup; current filled+outlined; next tappable →
  move dialog, gated → request; future ⚑ dashed when gated), gate line
  ("Next gate — Do → Check, date" red when overdue; per-role ✓/◐/✕
  chips; Request gate / Approve / Decline — approvers = header people +
  the site's standard-role fillers via actorsForRole; all-approved moves
  the stage, a decline holds with the reason), commentary (latest
  High/Low/Next + Add + History; events kind=comment). Escalate prompts
  "say what you need", then notifies the sponsors via the docs notify
  road (dynamic import; Teams chat + card, email fallback). Current
  stage / All stages filter narrows the grid by slot.template.stage.
  HEALTH QUESTIONS joined the improvement settings (label · yes-no or
  1–5 · weight; score normalised to /10). Events reader
  `listInitiativeEvents`.
- **P6b — BUILT 2026-08-20 (dev, app-only)** — THE CASCADE GOES LIVE:
  the priorities screen's ragsFor now rolls up real initiatives (direct
  links + through child priorities via descendantPriorities;
  `initiativeRag` on flags + linked-action position — metric state joins
  with reporting/P9; `actionsForInitiatives` one-query;
  `ragInputsFor`/`initiativesByPriority` pure + tested). The overlay's
  Initiatives tab lists the real rows (status edge, ↓ inherited-from
  prefix, stage chip, org · owner · n open · overdue, click → board;
  confidential collapse "+ n confidential"), Actions tab + rail count
  open/overdue, and **Add initiative** is LIVE — a sessionStorage handoff
  opens the Improvement create flow pre-linked and LOCKED to the source
  priority. createInitiative seeds one KpiTrendCard per mandatory metric
  (titled "OEE (%) → 75"; values in-card). Header ⋮ gains **＋ Add card
  from template** (the template's optional set not yet on the board,
  stage-named). Improvement rows wear their live RAG edge; the metric
  column reads "name → target".
- **P6c — BUILT 2026-08-20 (dev, app-only)** — KANBAN: the ActionBoard
  gains a config-gated **Verify column** (To do · Doing · Verify · Done;
  verify = work done awaiting the owner, assignees marked done; Verify →
  Done stamps `verified` {who, when} via the new setActor) and
  **reschedule reasons** (an existing action's due move prompts the
  design's four-reason picklist — cancel restores the date — and records
  an ActionHistoryEntry); both are registry fields any card can toggle
  and are FORCED ON (with kanban view) for the action plan cloned into
  every new initiative board. METRIC VALUES: seeded KPI slots carry
  `settings.metric.key`; `rowsForInitiativeBoards` (one startswith query)
  + `buildMetricState` (metricValues.ts) read each card's last charted
  point vs in-card target/limits (definition target as fallback,
  goodDirection from the metric def) → `metricRag`/`worstMetricRag`
  (pure, tested) → the initiative's RAG now includes its METRIC STATE in
  the Improvement rows, the priorities tallies and the overlay; the
  tab's metric column reads "OEE 61% / 75%" with the value coloured only
  when off-target.
- **P6d — BUILT 2026-08-20 (dev, app-only)** — BOUND CHARTER FIELDS
  (design 2.5): CanvasField gains `bound` ("" = free; title ·
  description · owner · stage · period · field:<key>); the canvas
  layout inspector grows the ⛓ select — header targets + the HEADER
  FIELDS as grouped options ("Standard fields" / "Template fields ·
  <name>") when the studio sits on a `tpl-`/`init-` board (Ben,
  2026-08-22: selectable, not typed — `headerFieldsForBoard` in
  improvement/binding.ts feeds `setBindingContext`; a typed key remains
  only the no-context fallback, and a key the template no longer defines
  stays visible as "(not in template)"); at
  runtime a bound field renders as the sunken dashed ⛓ tile — on an
  `init-` board a CanvasBinding provider (improvement/binding.ts,
  passed through CardMount.binding by board.ts tiles AND the focused
  editor) reads the header and edits write it back (owner via the
  people picker, stage read-only — the stepper edits it); off an
  initiative the ⛓ renders grey and the field stays free. STAGE CHIPS
  on tile title bars in PDCA colour + a 2px ring on current-stage
  cards (BoardTile badge/ring); FUTURE-STAGE cards render "Opens at
  the <stage> stage · Open anyway" instead of an empty card; the
  header passes the stage list through onStageFilter. TILES VIEW on
  the Improvement tab (List | Tiles segmented): summary tiles — RAG
  top edge, title, stage chip, flag glyph, metric value/target, owner
  · org. DEFERRED to backlog: evidence attach on actions (the
  ben_ltkactionfile road exists; needs upload/list/download UI in the
  action dialog).
- **Improvement tab polish — BUILT 2026-08-21/22 (dev, app-only)** —
  brought to the Documents-register standard (docs/ui-standard.md):
  one 44px control rail (＋ Initiative · search · Filters · List|Tiles),
  My initiatives → Owned by my team → Other initiatives, escalation as
  the notify-panel dialog, Edit details dialog (improvement/editDetails.ts),
  cards with the canonical 10px-radius full border, and the FILTERS
  POPOVER (the Documents one: `.app-docs-filterpop` groups of pills —
  Site · Stage · Period · Status · Method · Flags — Clear all / Done,
  pill clicks repaint the list beneath) replacing the tinted row of
  selects. Row review (external findings, 2026-08-22): meta line =
  priority STATEMENT · my roles / owner · org (method dropped — a filter
  dimension); "matching" only while search/filters narrow (the Documents
  rule); next-gate cell = "Define → Measure" / "28 Aug" (red when
  overdue) / "awaiting you" ONLY on a pending request the viewer (assigned
  OR site standard-role filler) has not decided, else "awaiting <roles>".
  Register columns remade (Ben, 2026-08-26): Initiative (meta = priority
  statement · owner) · Org (dept/site, chain on hover) · Your role(s) ·
  Stage (current chip; "gate · awaiting you/<roles>" when a request is
  open, else the stage target date red-when-past — replaces Next gate) ·
  Primary metric · Actions (n open · n overdue) · Health · ⋮.
  Header remade on the Priorities pattern (Ben, 2026-08-23):
  "Improvement Initiatives | Company › Site ▾" — accent lead, clickable
  crumbs, ▾ popover (Switch · Descend · Browse all…); the crumb IS the
  org scope (at-or-below, all four levels), so the Site filter group,
  the period subtitle and the count line are gone — one title + controls
  row. buildTree/OrgSiteRow moved to priorities/dialogs.ts for reuse.
  REJECTED: grey edge on escalation (the RAG rule folds escalation in so
  edge = tally colour), "All initiatives I can see" wording and a dark
  segmented (both reverse Ben's calls / ui-standard).
- **Priority overlay remake — BUILT 2026-08-24 (dev, app-only)** — per
  Ben's markup: pillar chip is a CHIP (pill, tinted with the pillar
  colour) sitting ABOVE the statement; the rail's foot actions promoted
  to the header (Add initiative primary · Cascade to… · ⋮
  Edit/Complete/Archive, Reopen when closed); lineage became the
  **Cascade** tab (before History, Re-send kept); the rail's Status
  tallies/roll-up sentence and Actions section DELETED (Ben's call —
  the Initiatives tab now groups rows by RAG: Issue · At risk · On
  track · No signal, dot + count heads, empty groups omitted); the rail
  itself removed — single-column desk, overlay narrowed 1100→860px.
- **P8 Actions Gantt — BUILT 2026-08-25 (dev, app-only)** — ONE control
  (`improvement/gantt.ts`, §2): List | Gantt switch (Ben's addition —
  every surface flips to a plain action list), scope seg, window presets
  2w/4w/8w/13w (per-preset day widths), assignee/status filters (org
  scope), ⋮ show-completed + CSV export. Bars per §2.2 (accent / red
  overdue / hatched-amber verify / grey done, diamond = no start date),
  PDCA stage bands from stageTargets with target-date labels, weekend
  tint, 55%-red today line, footer legend. Editing per §2.3: drag moves
  both dates, edge-resize, ANY due move opens the reschedule dialog
  (ActionBoard's four reasons + note → ActionHistoryEntry), Cancel/Esc
  snaps back, left-edge start drag silent; touch taps select →
  ±1d/±1w steppers + Set dates…. Org scope per §2.4: group row per
  initiative (RAG edge, stage chip, count), collapsed summary bar,
  3-row cap with "n more ›" + Open board. Entry points: the priority
  overlay's ACTIONS TAB (ctx.ganttFor — raw initiatives+actions,
  confidential excluded; overlay widened 860→1080px for it), the
  Improvement tab's header segmented **List | Tiles | Gantt** (inline,
  whole crumb scope + filters; replaced the buried owner-only team-group
  Gantt › link and its scrim overlay, Ben 2026-08-25; the control's
  internal List switch hides when the host provides one), and the
  **GanttCard** ritual card (registry + lazy mounter; gxSite/gxDept/
  gxWeeks config, centres on the meeting's week, readOnly follows the
  card). Actions matched by initiativeId (instanceKey fallback). NOT
  built: TV mode ⋮ toggle (present-mode sizing) — the card at tile size
  is already the at-distance view; revisit if a wall needs it.
- **P6e — initiative board remake — BUILT 2026-08-28 (dev, app-only;
  Ben's markup review)** — ONE title (board toolbar): stage pill +
  flag/confidential chips beside the name, `Current | All` accent seg
  (default ALL — flipped), ⋮ (Edit details / flag / escalate /
  endorsement / add-card / archive), Show details; the two-tier header
  band DELETED (crumb covered by ‹ Back). DETAILS PANE in the schedule
  pane's column, always collapsed on open, Show details reveals and
  scrolls to the ACTIVE stage: key details (org · period · method ·
  role chips · health) → STAGE RAIL replacing the chevron stepper
  (per-stage PDCA edge, target date red-when-past, gate block with
  per-role approval detail — decisions with who/date/comment, pool
  names, Request/Approve/Decline in place, done-stage history from
  events) → COMMENTARY now High/Low/Next/**Support needed** with
  ‹ older / newer › stepping (latest first) and a raise-⚐ tick when
  support text is entered (pre-armed, author's call). GATE SNAPSHOTS:
  final gate approval stamps a CLOSED instance (gate marker in its
  manifest JSON; live rows + tile svgs copied — store/instances
  createGateSnapshot/gateMarkerOf, no schema change); the Live chip
  becomes the picker (● Live board / Gate — Stage · date), snapshots
  render stored tiles read-only under an amber banner with Back to
  live. Forward-only.
- **Priority delete + org-scoped linking — BUILT 2026-08-29 (dev,
  app-only; role delete grants already existed on priority/assignment
  tables)** — overlay ⋮ gains Delete… (danger confirm counting children
  + linked initiatives): cascade records removed BOTH directions,
  customised children stand alone (parentId cleared), linked initiatives
  unlinked (removed primary promotes the first remaining —
  store/initiatives unlinkPriorityEverywhere; store/priorities
  deletePriority), events kept as history. LINK PICKERS (create form +
  Edit details) now offer only priorities at the initiative's org or
  ABOVE it (sameOrg/isDescendant against the form's site/dept/area) —
  never a sibling org's.
- **P9a — value driver tree model + engine — BUILT 2026-09-01 (dev;
  SCHEMA-CARRYING: ben_ltkvaluedriver, ben_ltkvdtscenario)** — per the
  critical review amendments: period-free structure, dated values
  (baseline/plan/forecast/actual per period) with a capped change log,
  driver vs LEADING nodes (dashed edge, never in a formula), cadence
  (shiftly…annually) + aggregate (sum/avg/last/min/max) per node with
  the "can't be finer than its drivers" rule, value source manual|metric,
  display format. Engine `improvement/vdt/formula.ts`: parser → AST
  (+ − × ÷ ^ %, SUM/AVG/MIN/MAX/ABS/ROUND, CHILDREN; conditionals HELD
  by decision), unit algebra (warn-only), the spec's sentences,
  computeTree with leaf overrides for simulation, cycle-safe. 20 tests.
  Store `store/valueDrivers.ts`. **P9b BUILT 2026-09-02**: Settings →
  Value drivers (superadmin) — site select, the Edit-values/Adopt role
  select (imp.vdtEditorRole), ONE tree component (`vdt/tree.ts`,
  left→right, SVG elbow links, dashed for leading, per-branch collapse
  with "n drivers" pill, modes structure/values/simulate) + the node
  rail (`vdt/settingsTab.ts`: name/definition/kind/unit/source/
  cadence+aggregate/actuals source/display; formula input takes child
  NAMES with an autocomplete popover, stored as {id}, chip line +
  "= value ✓ resolves · children n of m used · unit" + error/warn
  sentences; Save blocks on errors; add beneath / ▲▼ / Remove subtree).
  **Actuals model amended 2026-09-02 (Ben)**: no "actuals come from"
  switch — a driver's actuals are ONE dated series (card-series table,
  virtual board "vdt" · cardId = driver id · key "actual";
  store/driverSeries.ts) folded to the period at the node's
  cadence/aggregate, written from the values tab (dated points) or any
  linked KPI card (P9e); plus a source HYPERLINK (ben_sourceurl) on the
  card's source line. **P9c BUILT 2026-09-02**: hub tab "Value drivers"
  (HUB_TABS key `drivers`, site-enabled): header on the Priorities bar
  metric (site select · ‹ period › pager from the Priorities period
  settings via prevPeriod/periodWindow · Read | Edit values | Simulate
  (P9d)), Read = the tree in values mode with Show series + comparison
  delta chips, Edit values (superadmin or the vdtEditorRole's site
  fillers) = flat rows table with exactly baseline/plan/forecast inputs
  on leaves (setValue → history → saveDriver), computed rows grey ⨍,
  Actual DERIVED with ＋ to record a dated point (recent points shown),
  "Import from finance pack…" paste (name, baseline, plan, forecast).
  **P9d BUILT 2026-09-02**: Simulate mode (`vdt/simulate.ts`) — the
  panel lists initiatives whose metric links into the tree: DRIVES rows
  (toggle + delta in the leaf's unit; default = target − baseline only
  when units agree, else typed), LEADS rows grouped under the driver
  they lead (toggle only, optional ASSUMED EFFECT on the driver — dashed
  card/edge, "incl. assumed effects" in the foot); live recompute, only
  what moved marked (green border/chips/path); foot sentence "n of m on ·
  ROOT ± x vs plan" + causal path; Reset to plan · Save scenario…
  (ben_ltkvdtscenario, per period) · load saved · **Adopt as forecast**
  (canEdit-gated; writes LEAF forecasts = plan + toggled deltas, assumed
  effects never written). Metric link road: TemplateMetric.driverId +
  driverLink (drives|leads, JSON — no schema); "⛓ Link to a value
  driver" on the create form + Edit details metric rows opens the picker
  (`vdt/linkPicker.ts`: full-path search; Drives only for a LEAF with a
  matching unit, else Leads). **P9e BUILT 2026-09-02**: a KPI card on an init- board whose metric
  DRIVES a driver reads/writes the driver's ONE series (cardRegistry
  KpiTrendCard: series location swaps to vdt/<driverId>, points keyed
  by date via the model's adapters, window follows the driver's cadence,
  chrome "Title · VDT" + "Monthly · from value driver X"); template
  Metrics step gains a VDT "require link" tick (TemplateMetric.
  requireDriver → validateNewInitiative blocks an unlinked initiative);
  `· VDT` on the Improvement register's metric cell. **P9 COMPLETE** —
  next release SOLUTION-CARRYING (ben_ltkvaluedriver incl.
  ben_sourceurl, ben_ltkvdtscenario, ben_pdca).
- **Metric rework — BUILT 2026-09-03 (dev, app-only)** — metrics belong
  to the INITIATIVE, not the template: `TemplateMetric.kind` driver|own +
  `primary` (★, exactly one — normalizeMetrics/primaryMetric); the
  template's Metrics step is now a RULE (none / at least one / from the
  tree) riding the metrics column as {rule, metrics: []}; the shared
  `improvement/metricsList.ts` on the create form + Edit details — ＋ From
  the value driver tree (leaves + leading only; computed refused with
  "comes from its formula"; name/unit inherited, link drives|leads
  automatic), ＋ Initiative-specific (name/unit/target/direction/
  tracking), ★, target per row, ×; own metrics: Link… (merge the card's
  points into the driver's series — driver's dates win, tally shown) or
  Promote… (new node under a chosen parent, leaf or leading; editor-role
  gated); `ensureMetricCards` adds KPI cards for new metrics and drops
  removed ones only when their series is empty (kept ones named);
  register/tiles/roll-up read the ★ primary (metricValues sorts it
  first). Driver-linked metrics' VALUES read the driver's series
  (metricValues.loadDriverLasts feeds buildMetricState on the Improvement
  tab and the Priorities screen), so the register/tiles/roll-up show the
  same last point the card and the values tab do.
- **Metric limits — BUILT 2026-09-03** (Ben: target + upper/lower,
  aligned with the KPI card's spec): `TemplateMetric.usl/lsl`; direction
  is DERIVED (`directionOf`: lower only → higher is better, upper only →
  lower is better, both → within range; legacy goodDirection when none);
  `limitsInWords`; the metrics list's rows carry lower · target · upper
  inputs and the own-metric form drops the direction select; the seeded
  KPI card's config starts as the metric's target/limits/unit; metric
  readings fall back to the definition's limits; metricRag unchanged
  (outside a limit = red, target decides green/amber by direction).
- **Grid entry for KPI values — BUILT 2026-09-08** (Ben's mock: a column
  per period at the KPI's cadence, rows Date · Target · Lower · Upper ·
  Actual; all five recommendations taken). Model (`vdt/gridModel.ts`,
  pure, 12 tests): columns are the cadence BUCKETS intersecting a window
  — full buckets (a weekly column is Mon→Sun even at a period boundary),
  anchor = bucket start = the date an entered value is written on;
  Actual per column sits on the EXISTING dated series (one point at the
  anchor; a bucket already holding several finer points is folded and
  read-only, "·n"); Target/Lower/Upper are three more dated series on
  the same location (`spec:target` / `spec:lsl` / `spec:usl`,
  `shared/schema/specSeries.ts`) that CARRY FORWARD — a column's spec is
  the latest point at or before its anchor, else the single level value
  on the metric/card (kept as the fallback; grey italic = inherited);
  RAG per column from the column's own limits, shown as a dot inside the
  Actual cell once a value is in (no separate state row — Ben, same day). Component
  (`vdt/grid.ts`, one for both surfaces): sticky first column, scroll
  inside the grid, PAGED WITHOUT BOUND through time (Ben, same day: a KPI
  is never bounded by a period) — ‹ › at the top on either side of the
  grid, a page = 13 weeks / 7 days (× shifts) / 12 months / 10 years
  from a movable origin, each page loads on arrival, the first page puts
  today third from the right (a period-home outside today opens on the
  period's start), a "Today" link returns; today's column tinted and
  scrolled into view, future columns faint,
  Tab/Enter/arrow movement, blur commits, writes DEBOUNCED into one
  `applySeries` per grid then re-read (the typist's cell survives the
  repaint), Excel-style paste (labelled rows map by label — Period/Date
  rows dropped — unlabelled by position from the pasted row; blanks =
  no change), CSV out. Locations: `driverGridSource` (vdt · driver id ·
  "actual") and `cardGridSource` (the card · point ids; `pointsFromCells`
  now skips `spec:` keys; `mergeCardSeriesIntoDriver` carries spec cells
  under their own keys). Value drivers tab: ⊞ on each leaf row opens a
  DRAWER under it (window = the period; "Fill plan from targets" folds
  the columns' targets at the driver's aggregate into the period's Plan
  on request, confirmed, never automatic; the period's Actual re-folds
  on save). KPI card: "⊞ Grid…" beside Add reading opens the grid in a
  wide dialog (`vdt/gridDialog.ts`, lazy) on the card's own location or
  the linked driver's; the card loads the spec history
  (`listSpecSeries`, a `startswith(spec:)` read) and draws the target /
  limit lines as STEPS through the readings' dates, colours each
  reading by the spec in force on ITS date, and reads out the latest
  date's target; own cards gain a `cadence` setting (daily / weekly /
  monthly / annually, default weekly — shiftly stays driver-only since
  card points carry no shift), seeded from the own metric's new
  `cadence` (own-metric form select). Register/tiles RAG: driver-linked
  metrics resolve the spec at the last reading's date
  (`loadDriverLasts` now returns last + date + spec history). No schema
  change (the card-series table carries the new keys). Harness pages
  `app/harness/grid.html` (in-memory series stub via `vite.config.ts`
  alias) and `kpi.html` for screenshots.
- **Metrics card + meeting-board driver link — BUILT 2026-09-08** (Ben's
  two cases: a KPI card on a meeting board is either standalone or a
  window onto a value driver an initiative also works; updating it
  anywhere updates everywhere; decisions: any board editor may link;
  site chooser when the board has none; picklist configured per metric;
  no migration; Metrics card 1×1 second after the charter; shiftly on
  cards; add-reading defaults to the current period or the next when
  taken; OPTION C for targets).
  · **Driver link on any KPI card**: kebab "Link to value driver…" /
    "Unlink from …" (`vdt/cardDriverLink.ts`, lazy) → site (board's, or a
    chooser) → the full-path picker (leaves + leading only) → the card's
    private readings merge onto the driver (driver's dates win, tally
    shown) → Option C seed → the link saved in the slot's settings
    (`settings.driver = {site, driverId}` via `patchSlotSettings`); the
    mounter resolves a link from the slot first, else the initiative
    metric (`driverLinkForCard(boardId, metricKey, settings)`), chrome
    "· VDT", window by cadence.
  · **Option C (driver-owned targets with write-through)**: a driver's
    target/limits ARE its `spec:*` series; linking a metric or card whose
    level values are set to a driver with no spec seeds the driver's
    first spec point at the current bucket (`seedDriverSpecIfEmpty`, also
    on mount); a DRIVES-linked metric's lower·target·upper inputs in the
    metrics list read and write the driver's CURRENT-period spec
    (`putDriverSpec`), mirroring into the metric's fields; card settings'
    level values on a linked card only seed — the grid is where targets
    are edited afterwards.
  · **Reading entry**: `KpiPoint.shift`; `ReadingMode {cadence, shifts}`
    — the default date is the current bucket's start or the next
    bucket's when that already holds a reading (`defaultReadingDate`,
    `shared/schema/buckets.ts` — bucketSpan/addBuckets moved there);
    shiftly drivers add a shift select; one reading per date+shift.
  · **Metrics card** (`MetricsCard`, `improvement/metricsCard.ts`, lazy,
    Performance group): rows from the initiative DEFINITION, ★ first —
    name (· VDT), sparkline of the last page of buckets (target as a
    faint step, dots in state colour), latest value / this period's
    target, state dot; a value row expands into the KPI editor (no chrome)
    bound to the row's location: readings, per-reading actions (driver
    point ids prefixed by metric key so two driver rows never collide),
    ⊞ Grid. Good/bad rows: a strip of bucket cells cycling none → ✓ → ✗;
    picklist rows: a select per cell over the metric's options (each
    option carries a state; editor on the own-metric form). Locations via
    `improvement/metricLocation.ts`: driver (drives) → `vdt`/driver;
    own → the seeded single card when one exists on the board, else
    `<metricsCardId>/<metricKey>`. Seeding: ONE Metrics card, 1×1, second
    after the charter, in place of per-metric KPI cards;
    `ensureMetricCards` now ensures that one card. Register/tiles/roll-up
    read every metric's last reading from its location
    (`loadMetricLasts(initiatives, boards)`), good/bad and picklist show a
    label and colour by state (`MetricValue.display`).
- **Rituals in several organisations' cadence — BUILT 2026-09-08** (Ben:
  optionally link a ritual to multiple organisations so it is visible in
  their cadence; a primary organisation owner remains). `MeetingInfo`
  gains `alsoOrgs: MeetingOrg[]` (sparse in the blob, never the primary,
  de-duplicated; `orgKey` / `orgLabel` / `meetingInOrg` in
  shared/schema/meeting.ts); the wizard's organisation step gains "Also
  shown in" — chips + a site / department / area add row (same picklists
  as the primary), reviewed on the summary; the hub's Cadence tab scope
  (`meetingMatchesOrg`) and its derived org tree honour also-orgs. The
  PRIMARY org alone drives the board's site/department columns, protected
  times, admin scope in Settings → Rituals, and every org-scoped card —
  ownership stays with one organisation. No schema change.
- **Driver popup replaces Edit values — BUILT 2026-09-09** (Ben: the
  grid as a popup from clicking the tree, no Edit values tab). Value
  drivers is now Read | Simulate; in Read, clicking a driver opens a wide
  dialog: name, path · cadence · unit · aggregate · source link; this
  period's Baseline / Plan / Forecast (editable for editors on a leaf)
  and derived Actual as four tiles; beneath, for a leaf, the unbounded
  values grid with "＋ Dated reading" (any date/shift; folds) and "Fill
  plan from targets"; a computed driver shows its formula in words and
  its numbers read-only with a pointer to its children. "Import from
  finance pack…" stays at tab level in the Read bar (editors). The
  drawer-under-a-row and the indented edit table are gone.
- **KPI rows + plan = target — BUILT 2026-09-09** (Ben: configuring a KPI
  decides which rows it has — plan/target, forecast, upper, lower — the
  grid shows only those plus Actual; plan and target are one thing; the
  cadence bucket is the unit of entry). `SpecRows {plan, forecast, lsl,
  usl}` (shared/schema/specSeries.ts; defaults: drivers plan+forecast,
  cards/own metrics plan+limits); spec series keys are now `spec:plan` /
  `spec:forecast` / `spec:lsl` / `spec:usl` (legacy `spec:target` reads
  as plan); `specFor` still returns `target` (= plan) for the card and
  RAG. Rows live: on a driver in its format JSON (Settings → Value
  drivers rail "Grid rows" checkboxes), on an own metric (`rows`, form
  checkboxes that hide the level inputs), on a standalone KPI card
  (settings booleans showPlan/showForecast/showLsl/showUsl; "Target" →
  "Plan (target)"). Grid (`rowsFor`), CSV and paste follow the rows.
  A PERIOD's plan / forecast is now the FOLD of its buckets
  (`refoldDriverPeriod` after grid writes; `writePeriodSpread` for the
  finance-pack import and Simulate's Adopt — a sum splits evenly, other
  aggregates repeat); the driver popup's Plan / Forecast tiles are
  derived read-only ("· sum of buckets"), Baseline stays a period number;
  "Fill plan from targets" is gone. KPI card draws the forecast as a
  muted dotted step and reads out "Plan". `store/gridCells.ts` holds the
  shared cell loader.
- **Good / bad and picklist value drivers — BUILT 2026-09-09** (Ben: a
  non-numeric option for value driver KPIs). `DriverNode.tracking
  {kind: value|goodbad|picklist, options[{label,state}]}` in the NEW
  `ben_trackingjson` column (deployed to dev, grants confirmed; next
  release stays solution-carrying); rail "Measured as" select + the
  shared options editor (`improvement/optionsEditor.ts`); unit / display /
  grid rows hide for non-numeric. A non-numeric driver never enters a
  formula (`checkFormula` names it; `computeTree` yields null) and units
  are moot for linking. Readings are the option label on the driver's
  one series (`stateOf` also reads the initiative form's 1/0). Grid:
  the only row is the state — good / bad cycles on click, a picklist is
  a select per bucket, paste maps labels (`stateCellsFor`,
  `loadGridCells` branches on `tracking`). Tree: a state chip instead of
  a number; the popup shows the latest state over the grid. Linked KPI
  card: state mode (latest chip + a strip of recent states + "Set
  state…", `KpiPoint.label`, `driverStatePointsFromCells` /
  `driverDiffStatePoints`). Metrics card rows and the register colour by
  the driver's tracking (`DriverLast.display`); a from-tree metric
  inherits the driver's tracking and options.
- **P10 Reporting** — designed (spec §4).

Each phase ships behind the usual gates + `pac code push`; the specs'
acceptance checks are the PR checklist. Schema phases make the next
release solution-carrying.
