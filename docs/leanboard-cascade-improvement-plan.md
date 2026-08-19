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
- **P1 Priorities — Simple view spine** — org bar (breadcrumb dropdowns
  + Descend chips + Org-picker dialog on the DMS tree), vision band,
  toolbar (pillar two-level filter, period, status, Simple/Dynamic
  toggle, cascade chip, ＋ Priority, ⋮ view options incl. strict/ratio,
  Other, completed, TV mode), the matrix (`126px repeat(n,1fr)`), the
  priority card (status edge, statement, tallies + total, lineage
  glyph line, worded flags), Objectives row (metric line + sparkline),
  Other strip, density rule (≤4 / 5–6 compact + collapsed Objectives
  strip / 7+ scroll + group-by-strategy), phone stacking, empty/vision
  copy. Statuses read from a stub resolver until initiatives exist.
- **P2 Detail overlay + rail + cascade lifecycle** — overlay
  (Initiatives / Charter / Actions / History tabs; Status / Lineage /
  Actions rail; one solid primary; restore org+filters+scroll on
  close); the cascade review list (Accept / Accept & customise / Hold /
  Reject with reasons; sender's-view flags for declined/parked); add /
  edit priority dialog (statement, pillar, owner, period, primary
  initiative, cascade-to with confirm line, notes); complete/archive
  with reason picklist; parent completed/revised prompts on children;
  reorder; period carry-forward flow.
- **P3 Dynamic view** — card per priority (pillar title strip, 14.5px
  statement, 22px metric + 96×40 sparkline with target line, owner chip,
  tallies + count); per-user-per-org persistence.
- **P4 TV walk mode + embedded ritual card** — walk one objective per
  step (progress dots, named prev/next, ⊞ All objectives, keyboard /
  remote / swipe), final "Cascades to accept" step, filters carry in;
  the card: settings (org, pillar, view mode), tile = displayed matrix
  (vision band + headings + status edges), focused editor opens in walk
  mode at step 1 with the meeting's week as the window.
- **— next design pass —** templates builder, actions Gantt, VDT
  editor + simulation, reporting shapes (brief §4.4–4.5, §6 Q7/11/12).
  Entry points (`Gantt ›`, settings tabs) stay stubs until then.
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
- **P7 Templates builder · P8 Gantt · P9 VDT + simulation · P10
  Reporting** — after their design.

Each phase ships behind the usual gates + `pac code push`; the specs'
acceptance checks are the PR checklist. Schema phases make the next
release solution-carrying.
