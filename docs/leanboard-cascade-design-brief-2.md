# UI design brief 2 — Templates builder, actions Gantt, VDT + simulation, reporting

(2026-08-19. The second design pass for the Cascaded Priorities &
Improvement phase. Hand this to the design pass as-is, together with the
first brief, its two specs, and the review HTML. Its output — screen
designs, interaction model, component decisions, copy — updates
`leanboard-cascade-improvement-plan.md` before build items 5–10 start.)

## 1. Where we are, in one paragraph

Since the first pass, the **cascade spine is built and on dev**: the
Priorities tab (org crumbs with one ▾ popover, dark vision band, pillar
rectangles over sub-pillar columns in settings order, Simple and Dynamic
cards on the same matrix, Objectives row), the detail overlay with its
rail (status tallies + rule words, lineage, history), the whole cascade
lifecycle (accept / accept & customise / hold / reject with reasons,
complete / archive with the four reasons, carry-forward, reopen),
**presentation mode** (▶ Present: org-chain title in the accent, ×1.4
type, ▶ Walk one sub-pillar per step with a final cascades step), and
the **Priorities ritual card** (presentation matrix on the board;
**rotation focus** maps the meeting's wizard topics to pillars in card
settings). Every R/A/G tally reads grey "0 initiatives" and every
objective cell "No metric set" — **initiatives do not exist yet**. This
pass designs the four things that were deliberately parked until the
priorities screen was real: the **initiative templates builder**
(prerequisite for creating any initiative), the **actions Gantt**, the
**value driver tree editor + simulation**, and the **reporting shapes**.
The Improvement tab and the initiative board are already designed
(`leanboard-cascade-initiative-board-design.md`) and will be built as
soon as templates exist — design these four so they fit that spec.

## 2. The design system — what is new since the first brief

Everything in brief 1 §2 still holds (warm neutrals, per-site state
palette, sentence case, kebabs, chips, 44px targets, tile snapshots,
centred modal dialogs, touch-degradable). New primitives now exist and
must be reused rather than re-drawn:

- **Priorities matrix vocabulary**: 126px gutter with small-caps row
  labels (Vision · Strategic pillars · Priorities · Objectives); pillar
  rectangles filled with the pillar colour spanning their sub-pillar
  columns; the ✓ ! ✕ tally triplet + "· n initiatives"; the 4px status
  edge; the dark vision band; the ▶ Present bar (title "FY26 Cascaded
  Priorities | Company › Site › Dept · Topic", lead in the accent).
- **The walk** (one column per step: coloured header strip, progress
  dots + n/N, full-width rows with 6px edge, three large tallies, a
  right-hand metric cell divided by a rule; footer ‹ named prev · ⊞ All
  pillars · named next ›; ←/→, Esc, swipe).
- **Overlay + rail** as built for priorities (header chip · statement ·
  meta · ✕; tab strip; rail sections with small-caps headings; foot with
  one solid primary). Use the same for anything that opens "over" a list.
- **Card-settings builders**: `captureColumns` / `canvasFields`
  (dedicated builders inside the properties pane) and the new
  **`topicPillars`** builder — rows from context (the board's rotation
  topics), each a chip list with an "Add…" select, stale rows flagged
  red with *remove row*. This is the house pattern for "map things to
  things" inside settings.
- **Settings → Priorities tab**: sections with h3 headings, pillar rows
  with ▲▼ reorder arrows, colour swatch, active toggle, "＋ Add
  sub-pillar" text link under each pillar; period + roll-up rule;
  vision statements per company / site / department.
- **PDCA tokens** are fixed app colours (Plan amber · Do blue · Check
  green · Act purple); stage chips wear them. The kanban gains a
  **Verify** column (built in the model; the column shows "◐ awaiting
  verification" in Done today).
- **An actions Gantt already exists per Actions card** (`Gantt` view:
  bars start→due, zoom −/+, horizontally scrollable, today pinned,
  overdue obvious). It is the starting point for the org-wide Gantt —
  extend its grammar, do not invent a second one.
- **KPI-trend chart** exists (dated points, target line, USL/LSL,
  unit); sparklines in the matrix and walk are its shrunk form.
- **Composer** = the board layout builder (slots on a grid, add card
  from the catalogue, card studio per slot: left live card, right
  properties tabs). The templates builder's "mandatory cards mapped to
  stages" should ride the composer + studio, not a new layout tool.

## 3. Personas for this pass

- **Superadmin / improvement system owner**: authors initiative
  templates (stages, PDCA map, gate approver roles, roles, custom
  fields, mandatory metrics, mandatory/optional cards, board layout),
  the company health-check question set, and — with a site's finance /
  ops lead — the site's value driver tree.
- **Site GM / finance lead**: reads the VDT, enters plan/forecast/
  actual, runs what-ifs ("if we stop initiative X, what does the tree
  do?"), reads reporting for their org.
- **Improvement lead / initiative owner**: plans actions on the Gantt
  (start/due, reschedule with reason), reads the org-wide Gantt in the
  weekly review, keeps metrics current.
- **Meeting room (TV)**: the org Gantt and the reporting tiles must read
  at distance.

## 4. Screens & flows to design

### 4.1 Initiative templates builder (Settings → Improvement, superadmin)

What a template IS (decided): name · method (A3, DMAIC, Kaizen, 8D,
project, single action…) · **stages** (ordered; each with a name, a
PDCA mapping, optional **gate** = one or more **approver roles**, and
an optional target-duration hint) · **roles** (the standard five —
sponsor, owner, improvement lead, team, support — plus template-
specific ones; each role: label, single/multi-person, optional time
commitment field) · **custom header fields** (text / number / date /
picklist / person) · **mandatory metrics** (name, unit, target, good
direction, tracking method) · **board layout** from the composer, where
every slot is tagged with a **stage** and **mandatory / optional**, and
the charter slot is a Canvas card with **bound fields** · **optional
cards** the owner may add later · a **single-action** flag (header +
actions, no board).

Design:
- The builder's overall shape: one long settings form? A left list of
  templates + a tabbed editor (Stages · Roles · Fields · Metrics ·
  Cards)? A wizard for new, tabs for edit? Recommend.
- **Stages editor**: reorder, PDCA chip per stage (the four fixed
  tokens), gate toggle per stage boundary with the approver roles as
  chips drawn from the template's roles, the "Complete" gate as a
  first-class last boundary. The stepper on the initiative board is a
  chevron row — the builder should preview the same chevron row live
  as stages are edited.
- **Roles editor**: the five standard roles locked-but-editable-label,
  add template roles, single/multi, time-commitment on/off.
- **Cards**: how "open the composer for this template" feels inside
  settings; how a slot gets its stage tag and mandatory flag (in the
  card studio's Common tab? a stage strip on the composer tile?); how
  the mandatory charter is shown as undeletable; how optional cards are
  listed for later adding.
- **Bound fields on the charter**: the designer decided "sunken dashed
  tiles with ⛓". Design how the *template author* chooses which header
  fields the charter binds (a picker in the Canvas layout builder? a
  fixed set per method?).
- **Lifecycle**: templates are versioned or not? Editing a template
  that live initiatives use — what changes propagate (roles? stages?)
  and what is frozen? Recommend the simplest safe rule and its copy.
- **Create-initiative flow** (already designed: three-step modal) —
  confirm the template picker step's anatomy now that templates have a
  shape (method chip, stage count, "n initiatives use this", single-
  action variant).

### 4.2 Actions Gantt — org-wide and per-initiative

- **Per-initiative** (the initiative board's Actions card in Gantt view)
  exists; design the upgrades the plan requires: start dates as first
  class, drag to move/resize (touch: handles), reschedule prompts the
  reason picklist (so a drag is not silent), dependencies **out of
  scope** (say so if you agree), stage bands behind the bars (the
  initiative's stages with target dates), today line, overdue in the
  state palette, "awaiting verification" distinct from done.
- **Org-wide** (`Gantt ›` from a priority's overlay, from the
  Improvement tab, and a ritual card): all open actions across an org's
  initiatives on one timeline, **grouped by initiative** (collapsible
  groups; group row shows the initiative's stage chip and R/A/G edge),
  default **4-week window** centred on today (meeting's week when
  embedded), adjustable window (2 / 4 / 8 / 13 weeks), filters (org,
  pillar, assignee, flag), density at TV distance, row cap and "n more"
  behaviour. Touch: pinch? buttons only? Decide.
- One control or two? Recommend how much of the per-card Gantt's
  grammar the org-wide one shares.

### 4.3 Value driver tree — editor, values grid, simulation (per site)

Decided: nodes (name · definition · source link · units · tracking
method · **formula over children** — a small expression language: + − ×
÷, parentheses, child references, constants; no eval) · values per
node × period (baseline / plan / forecast / actual) · initiative metrics
can **link to a VDT leaf** and carry plan/forecast/actual · simulation =
toggle initiatives on/off or edit their forecast deltas at the leaves →
recompute the tree → highlight what moved.

Design:
- **Tree editor**: vertical tree (root left, leaves right) or indented
  list with formulas inline? How a formula is written and validated
  (inline text with child chips autocompleting? a small formula bar
  with a live result?). Error states (refers to a missing child; divide
  by zero; units mismatch warning only).
- **Values grid**: node rows × period columns × the four series — how
  not to become a spreadsheet; which cells are editable (leaves) vs
  computed (formula nodes, read-only with a ⨍ mark); per-period rollup
  vs "current period" default.
- **Simulation view**: the manager's what-if — a side panel listing the
  initiatives linked to leaves with on/off switches and editable
  forecast deltas; the tree re-computes live; moved values show a
  delta chip and a trail back to the leaf that moved it; "reset to
  plan". Must feel like a picture, not a workbook (brief 1 §6 Q11).
- **Where it lives**: Settings (structure, superadmin) vs a site page
  (values + simulation, owners/finance) — recommend, and how an
  initiative's metric picker reaches the leaves.

### 4.4 Reporting — shapes only (org-filterable)

Decided content: initiative counts (total / overdue / completed /
flagged); action counts (overdue / completed / due soon / stopped-
cancelled / rescheduled); value delivered (VDT hard value; metric
trends — line vs target if numeric, status square if not); site value
delivery; health-check trend across initiatives; period comparison.

Design the *shapes*: a tiles-over-drill-list page (the Document Control
Health report is the house precedent: summary tiles → grouped lists);
the org picker (same crumbs + ▾ popover as Priorities); the period
selector (same period select); which tiles survive as **ritual cards**
(tile snapshot legible) and which are page-only; TV legibility. Not
chart design in detail — just enough that the data shapes are fixed.

### 4.5 Small settings pieces (design only if novel)

- **Health-check questions** (company-level list; each question with a
  scale type — yes/no, 1–5 — and a weight); where the initiative's
  health score shows its trend.
- **Period settings** exist (FY / calendar / custom, start month,
  prefix); the custom mode needs the **next period name** for carry-
  forward — a tiny addition to the existing section.

## 5. Decided already — do not redesign

Everything in brief 1 §5, the first pass's outcomes (priorities matrix,
overlay + rail, one cascade surface, walk, Improvement tab shape,
initiative board two-tier header, chevron stepper as gate control,
bound-field tiles, Verify column, PDCA tokens), plus the model answers
taken since: accept = adopt (no child unless customised); initiative
R/A/G = worst of metric AND actions; `initiativegate` rows for
approvals; stage target dates; template `mandatoryMetrics`; per-slot
stage + mandatory flags in the board manifest; actions `verify` status,
start date, evidence files, history with a reason picklist; the card's
rotation focus is an explicit topic → pillars map. Full text:
`leanboard-cascade-improvement-plan.md` (decisions 1–13 + "model points
answered" + "model additions").

## 6. Questions this pass should answer

1. Templates builder shape: list + tabbed editor, or wizard-then-tabs?
   How does "open the composer for this template" sit inside settings?
2. Slot stage-tagging and mandatory flags: in the card studio's Common
   tab, or on the composer tiles themselves?
3. Charter binding: who chooses the bound fields — the template author
   per template, or a fixed set per method?
4. Template editing under live initiatives: what propagates, what
   freezes; versioning yes/no; the copy that explains it.
5. Gantt: one control with two modes, or two? Drag/resize on touch;
   reschedule reason on drag; stage bands; dependencies out of scope?
6. Org-wide Gantt density: grouping, collapse, row caps, window
   presets, TV mode.
7. VDT editor: tree vs indented list; formula authoring + validation
   states; units.
8. VDT values: the grid that isn't a spreadsheet; editable vs computed
   cells; period handling.
9. Simulation: the what-if panel and the "what moved" trail.
10. VDT home: settings vs site page; the metric picker's road to leaves.
11. Reporting: which tiles become ritual cards; the drill pattern; TV.
12. Health-check questions: scale types + weighting UI; where the trend
    lives on the initiative board.

## 7. Deliverables wanted from the design pass

Screen designs (desktop; TV and phone where different) for 4.1–4.4 and
the novel parts of 4.5; an interaction map for (a) template → create
initiative → board, (b) Gantt reschedule, (c) VDT simulate; component
decisions in the existing vocabulary (which primitive, which new); copy
strings for empty states, validation and confirmations; and — as before
— anything that needs a change to a §5 decision called out explicitly,
not designed around.
