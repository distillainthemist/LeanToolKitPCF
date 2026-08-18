# UI design brief — Cascaded Priorities & Improvement in LeanBoard

(2026-08-19. Hand this to the design pass as-is. Its output — screen
designs, interaction model, component decisions — updates
`leanboard-cascade-improvement-plan.md` before implementation.)

## 1. What you are designing, in one paragraph

LeanBoard is a Power Apps code app used on laptops, wall TVs in
meeting rooms and phones by a manufacturing business (a distillery
group). It already runs **meeting boards** (grids of card tiles that
open into full-screen editors, walked card-by-card in a ritual) and a
**document management system**. We are adding two things: **cascaded
priorities** — every organisation level (company → site → department →
area) keeps a short list of priorities that cascade down and across,
each carrying a strategic pillar and a status derived from the work
underneath — and **improvement / problem-solving initiatives** — project
boards built from templates with stages, roles, metrics, a charter, and
an action plan, linked to the priorities they deliver. Plus a value
driver tree of metrics per site (with formulas and what-if simulation)
and reporting. Design the screens and interactions; the engine and
data model are decided (§5).

## 2. The design system you must live inside

- **Look**: warm neutral canvas (cream/off-white surfaces, dark
  charcoal text, warm greys), one accent per site palette (a title-strip
  palette and a state palette — Green/Amber/Red-style *state colours are
  configured per site*, never hard-coded), sentence-case labels
  everywhere, no all-caps except tiny section labels, kebab (⋮) menus
  for secondary actions, chips for status/tags/people, 44px minimum
  touch targets, generous whitespace. Cards have an optional coloured
  title strip with a right-hand action slot (＋ Action, kebab).
- **Primitives that exist and should be reused, not reinvented**: the
  board grid of tiles; the focused card editor with prev/next walk and
  a tab strip; the card studio (left: live card, right: properties
  tabs); the Canvas card (fields in a 1–3 column grid; inline typing,
  dialog pickers; status chips from the palette; people initials-chips;
  percent bars; mini tables); the Capture/Canvas rollups (one merged
  table over cards on other boards); the KPI-trend chart; the actions
  kanban and the action dialog (description, one assignee, due date,
  comments); the escalation viewer; the Documents register's overlay
  pattern (a right-hand details rail over a desk); the DMS left-nav
  folder tree with expand/collapse and a "my site first" default; the
  settings screen's tabbed sections; the ⚐ Report dialog (evidence: we
  favour dialogs over inline forms for records).
- **Constraints**: runs inside the Power Apps player (no browser chrome
  of ours; popups only on user gesture); wall TVs are read-mostly at
  distance (big status, few words); phones stack to one column; every
  card must render a static **tile snapshot** (SVG) of itself for the
  board grid, so a card's "resting" state must be legible as an image
  — no state that only exists in hover or animation. Dialogs are
  centred modals. Rich interactions must degrade to touch.

## 3. Personas (all internal staff)

- **Site GM / department manager (org owner)**: sets their org's
  vision and priorities, accepts or rejects cascades from above/peers,
  reviews the priorities view weekly on a TV in a ritual, wants
  status at a glance and drill-down on demand.
- **Improvement lead / project owner**: creates initiatives from a
  template, keeps the charter, metrics, actions and commentary current,
  moves stages, asks for approvals, flags for support, runs health
  checks.
- **Team member**: sees "my initiatives", their actions, evidence,
  gets digests; occasionally proposes an initiative.
- **Sponsor / finance / improvement-lead approver**: approves stage
  gates from wherever they are (a notification → the initiative).
- **Superadmin**: defines pillars, initiative templates (stages/PDCA
  map/roles/custom fields/cards), health-check questions, RAG ratio,
  period; per site: the value driver tree.
- **Anyone**: browses priorities read-only; confidential initiatives
  are invisible to them (and honestly counted as "n confidential").

## 4. Screens & flows to design (in build order)

### 4.1 Cascaded priorities screen (a new top-level tab)
- **Org navigator**: choose the org in focus (company / site /
  department / area) — default the viewer's own site; must make moving
  **up and down the cascade intuitive** (breadcrumb + children? a
  tree? both?). Show the org's **vision statement**.
- **Filters**: pillar (two-level), period (default current), status
  (active / on hold / completed…), "show Other" (initiatives not linked
  to any open priority).
- **Two view modes** (a toggle): **Simple** — priorities in a compact
  list/table with key metrics from the primary initiative; **Dynamic** —
  a card per priority (statement, pillar chip, R/A/G **counts** of
  linked initiatives, headline metric sparkline/value from the primary
  initiative, owner, flags). Both show where a priority came from
  (own / cascaded from X / adopted from peer Y) and where it went (n
  child orgs, acceptance state).
- **Roll-up rule toggle** on the view: *Strict* (any red → red) vs
  *Ratio* (red above X% → red).
- **Actions on the view** (owner only): add priority, cascade to…,
  accept/reject/hold a cascade sent to me (with reason), complete/
  archive with reason, reorder, edit vision. **Flags**: a cascade I
  sent that was rejected/parked shows on MY view; a child priority
  whose parent was completed/revised shows a prompt.
- **Priority detail** (drill-down — overlay or page?): the primary
  initiative's charter (the Canvas card, read-only here), R/A/G counts
  and the list of underlying initiatives (each with stage, owner,
  metrics, flag) — INCLUDING those linked through child priorities
  down the cascade — plus their open actions and metrics; the lineage
  (parent chain, children with their acceptance status); the period
  history. From here: open an initiative, add an initiative to this
  priority, cascade, complete.
- **Actions Gantt overview**: all open actions across the org's
  initiatives on a timeline, default 4-week window, adjustable, grouped
  by initiative, overdue obvious. Also reachable per initiative.
- **Embedded card version** for rituals: the same view compressed to a
  card tile + focused editor; time window centres on the meeting's
  week; filters saved in card settings (org, pillar, view mode).
- **Add / edit priority dialog**: statement, pillar, owner, period,
  applicable orgs (children + peers to cascade to), primary initiative
  (optional), notes.

### 4.2 Improvement tab (a new top-level tab)
- **"Mine first"**: initiatives where I hold a role or that belong to
  an org I own; then everything I may see. Filters: org, stage/PDCA,
  status, flag, template/method, period, confidential (if allowed).
- Row/tile per initiative: title, org, stage chip in PDCA colour,
  owner, primary metric state, flag/escalation, next gate, health.
- **Create initiative** flow (from here AND from a priority):
  template picker (superadmin-defined) → header form (title, org,
  linked priorities with a primary, roles with people pickers,
  confidentiality, period, template custom fields, mandatory metrics)
  → lands on the new initiative's board. Also the "single action"
  lightweight variant.

### 4.3 The initiative board (a project board with a header)
- A **header band** above the board grid: title, org, stage stepper
  (template stages coloured by PDCA), current gate & approvers with
  approve/request buttons, roles (avatars), flag/escalate control (two
  levels; escalate prompts a Teams/email to the sponsor), health-check
  button + last score, commentary entry (highs/lows/next steps) with
  history, confidential badge.
- **Cards** from the template: the charter (Canvas with **bound
  fields** mirroring header data), metrics (KPI-trend per metric with
  target/limits/good-bad/picklist rendering; VDT-linked ones show
  plan/forecast/actual), the action plan (kanban; new: start date,
  evidence attach, "awaiting verification", reschedule reason prompt),
  optional cards the user can add from the template's optional set.
  Card title bars carry the stage chip they belong to; the current
  stage's cards are emphasised.
- **Stage move** dialog: to which stage, comment; if gated, shows
  required approver roles and their status; approvers see an approve/
  decline with comment.
- **Health check** dialog: the company question set, answers, score;
  history/trend view on the board.

### 4.4 Settings (superadmin / owners)
- **Pillars** (two levels, colours, order, active).
- **Org owners & vision** per site/department (in the existing org
  dictionary section).
- **Period definition** and **RAG ratio %**.
- **Initiative templates** builder: stages (name, PDCA map, gate
  approver roles), roles (standard + template-specific), custom
  fields, mandatory cards mapped to stages, optional cards, board
  layout (reuses the composer).
- **Health-check questions**.
- **Value driver tree** per site: tree editor (nodes: name, definition,
  source link, units, tracking method, **formula over children**),
  values grid (baseline / plan / forecast / actual by period), a
  **simulation view** (toggle initiatives on/off / edit their forecast
  deltas → see the tree recompute; highlight what moved).

### 4.5 Reporting (org-filterable)
- Initiative counts (total / overdue / completed / flagged); action
  counts (overdue / completed / due soon / stopped-cancelled /
  rescheduled); value delivered (hard via VDT, trend for specific
  metrics — line vs target if numeric, status square if not); site
  overall value delivery; health trend across initiatives; period
  comparison. Design the *shape* of these (tiles + drill lists), not
  charts in detail.

## 5. Decided already — do not redesign

The org model, cascade model (assignments + child priorities), the
initiative = header + project board (charter = Canvas with bound
fields), metrics/VDT scope incl. formulas and simulation, stage/PDCA
gates with multi-role approval, action extensions, permissions,
live-data-with-meeting-week for the embedded card, priority status as
R/A/G counts with a strict/ratio toggle, periods with carry-forward,
confidentiality, periodic health checks, cascade-first sequencing.
Full text: `leanboard-cascade-improvement-plan.md`.

## 6. Questions the design pass should answer

1. Org navigation up/down the cascade: what pattern (breadcrumb + child
   chips, a collapsible tree like the DMS folders, a level slider…)?
2. Priority detail: overlay-with-rail (DMS pattern) or full page? How
   does the drill-down "carry" the org context back out?
3. Simple vs Dynamic view: what exactly differs, and which is the TV
   default?
4. Where the R/A/G counts, strict/ratio toggle, and "Other" live so
   they read at TV distance without clutter.
5. The initiative header band vs the board grid: how much header
   before the cards feel buried? Does the stage stepper double as the
   gate control?
6. Bound fields on the Canvas charter: how do they signal "this is live
   header data, edit here or there"?
7. The Gantt: density, grouping, and touch behaviour; the same control
   for org-wide and per-initiative?
8. Cascade acceptance UX: an inbox on the hub? Inline on the priorities
   view? Both?
9. Flag vs escalate: distinct visual language that survives a tile
   snapshot and a TV.
10. Confidential counting: how "3 confidential" reads without inviting
    curiosity.
11. VDT simulation: how a manager toggles initiatives and reads impact
    on the tree without a spreadsheet feel.
12. Templates builder: how much of the existing composer/card studio to
    reuse for "mandatory cards mapped to stages".

## 7. Deliverables wanted from the design pass

Screen designs (desktop + TV + phone where different) for 4.1–4.3 and
the settings pieces of 4.4 that have novel UI (templates builder, VDT
editor + simulation); an interaction map for the cascade
(add → cascade → accept/reject → child → complete → carry forward);
component decisions expressed in the existing vocabulary (which
existing primitive, which new); and a list of copy strings for the
empty states, prompts and reasons dialogs. Anything that requires a
change to a decision in §5 should be called out explicitly rather than
designed around.
