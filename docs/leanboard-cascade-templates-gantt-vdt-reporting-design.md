# Templates builder · Actions Gantt · VDT · Reporting — design spec

Design pass output for brief 2 (`leanboard-cascade-design-brief-2.md`)
§4.1–4.5. Visual reference: sections **11a** (templates builder, Gantt)
and **12a** (VDT, reporting, small settings) of
`LeanBoard Design Review.dc.html`. Answers §6 questions 1–12.

Companions: `cascade-priorities-design.md`,
`initiative-board-design.md`. **No §5 decision needs changing** — every
answer below fits the decided model. Two model notes are flagged
inline as *model note* where the design needs a field the plan may not
have yet.

Build order stays as the brief has it: templates first (nothing can be
created without them), then the Gantt upgrades, then VDT, then
reporting.

---

# 1. Initiative templates builder (§4.1)

**Home:** Settings → Improvement → Initiative templates. Superadmin.

## 1.1 Shape — Q1: reuse the meeting wizard

**Reuse `controls/MeetingWizard` wholesale** — same modal chrome, step
strip, centred column and footer. Authoring a template is the same job
as authoring a ritual: a long structured setup done rarely, in an order
where later steps depend on earlier ones (gates need roles; cards need
stages). A second settings idiom would be a second thing to learn.

**Seven steps:** 1 Basics · 2 Stages & gates · 3 Roles · 4 Fields ·
5 Metrics · 6 Initiative board · 7 Review.

Wizard chrome, matching 1f exactly:
- Accent header bar: "Edit template — <name>", 40px ✕.
- **Step strip**: done steps = tinted pill with ✓, current = filled
  accent circle + 2px underline, upcoming = outlined circle in muted
  grey; every pill a 44px target. **Clickable** — editing is never
  forced to be linear.
- **620px centred content column**, each step opening with an 18px
  bold step title and a one-line purpose.
- **Footer**: `‹ Back` · centred "Step n of 7" · `Next: <name> ›`;
  step 7's primary is `Save template`.

**Landing** (Settings → Improvement → Initiative templates) is a list,
not an editor: one card per template — name, method chip, "n stages ·
n cards · n initiatives use this"; retired templates last at 60%
opacity with a "Retired" tag. Picking one opens the wizard at step 1;
`＋ New template` opens it empty. Card ⋮ holds Duplicate, Retire,
Export, Delete (only at zero initiatives).

**Validation** follows the wizard's existing rules: a step with an
error keeps its number in the strip and shows the message in place,
Next stays enabled so an author can range around, and only
`Save template` blocks — listing what is unresolved and linking to it.

## 1.1b Step 1 — Basics

Name · method select · description · single-action flag. Choosing a
method offers its standard stage set as a starting point ("Start from
A3's four stages?"); declining leaves step 2 empty.

## 1.2 Step 2 — Stages & gates

- **Live stepper preview** pinned at the top of the step, inside a
  sunken panel headed "The stepper owners will see": the exact chevron
  row the initiative board will render, updating as stages are edited,
  with a caption "⚑ marks a boundary that needs approval". This is how
  an author sees the consequence of their edit without opening a board.
- **Stage rows**: ▲▼ reorder · name · **PDCA select** (the four fixed
  tokens, chip-styled in its token colour) · optional target-duration
  hint · card count · ⋮ (Delete stage — blocked with a reason when
  mandatory cards are tagged to it).
- **Gate rows sit between stage rows**, indented and 44px tall, reading
  as boundaries rather than stages: `Gate` toggle + approver-role chips
  drawn from step 3's roles + `Add…`. A gate with its toggle on and no
  roles is invalid and blocks `Save template`.
- **The Complete gate is always shown** as the last boundary, gated or
  not, so "who signs an initiative off" is never an invisible default.
- `＋ Add stage` appends; new stages default to the PDCA token of the
  stage above.

## 1.3 Step 3 — Roles

Roles follow stages rather than lead them because step 2's gate
approvers are drawn from this list — authors set the path first, then
say who guards it, then return to step 2 via the strip if needed.

- The five standard roles (sponsor, owner, improvement lead, team,
  support) are always present and **cannot be removed, but their labels
  are editable** — companies rename these constantly.
- Per role: label · single or multi person · time-commitment field
  on/off.
- Template-specific roles add below, same row shape, removable when not
  referenced by a gate.

## 1.4 Steps 4 and 5 — Fields, Metrics

- **Fields**: custom header fields — label · type (text / number /
  date / picklist / person) · required · picklist options where
  relevant. Reuse the canvas-card field-builder row pattern.
- **Metrics**: mandatory metrics — name · unit · target · good
  direction (up/down) · tracking method · optional
  `Link to a value driver` (see §3.6). Every mandatory metric must have
  a target and a direction before save; the create-initiative flow
  makes the owner fill the values.

## 1.5 Step 6 — Initiative board — Q2: stage tagging on the tile

- Step header row: card count, "n mandatory", `＋ Add card`,
  `Open composer` (full-screen overlay, returns to this step on close —
  the wizard stays the spine and settings never becomes a layout tool).
- **Each card tile carries, on the tile itself:** a **stage colour bar
  along its top edge**, a **stage select** in the body, and a
  **mandatory dot** (● mandatory / ○ optional) in the title row, with a
  legend line beneath the grid. Stage assignment is a layout decision
  made while looking at the layout.
- The select names **the stage's own name** ("Understand", "Trial"),
  not its PDCA token — that is what owners read on the board. The
  colour bar carries the token.
- The **card studio's Common tab shows the same two controls** for
  anyone already inside a card — same state, two routes, no third
  place to look.
- Mandatory cards: Delete is absent from the tile ⋮ (not disabled with
  a tooltip — absent).
- Optional cards appear in the owner's `＋ Add card from template` list
  on the live board, grouped by stage.

## 1.6 Charter bound fields — Q3: the template author chooses

- Inside step 6, the charter's **Canvas field builder** gives each
  field row a **⛓ toggle**; on, a `Bound to` select offers the header fields (owner,
  primary priority, stage, period, custom header fields).
- Bound rows render tinted with the ⛓ in accent; free rows keep the ⛓
  grey and inactive.
- **Not a fixed set per method** — companies' methods differ too much
  for a hard-coded list, and the control is one toggle on a row the
  author is already editing. Method presets ship with owner, primary
  priority and stage pre-bound so no one starts from nothing.
- Runtime rendering of bound fields is already specced:
  `initiative-board-design.md` §2.5 (sunken dashed tile + ⛓ label).

## 1.7 Lifecycle — Q4: no versioning, split by kind of change

Simplest safe rule:

- **Propagates to live initiatives:** stage renames, role renames, new
  roles, new optional cards, field label changes, help text.
- **Applies to new initiatives only:** stage order, adding or removing
  a stage, gate changes (on/off or approver roles), mandatory cards,
  mandatory metrics, PDCA remapping.
- **Retire, never break:** retiring hides the template from the picker
  and leaves live boards untouched.

The wizard shows this as an amber note inside the steps where such
edits happen (2, 5, 6) and again on step 7 — never as a dialog after
saving:

> **3 initiatives are running on this template.** Renamed stages, new
> roles and new optional cards reach them. Changes to stage order,
> gates, mandatory cards and mandatory metrics apply to new initiatives
> only.

*Model note:* this needs each initiative to hold its own resolved copy
of stages/gates/mandatory sets at creation (a snapshot), with only the
propagating fields read live from the template.

## 1.7b Step 7 — Review

A summary grid — method · stages ("4 · 3 gated") · roles · fields ·
metrics · board — where **every row links back to its step**, so a fix
is one click. Footer primary is `Save template`; it blocks on
unresolved validation and lists what is missing with links.

## 1.8 Create-initiative picker — confirmed anatomy

Step 1 cards show: template name · method chip · stage count · "n
initiatives use this" · a one-line description. **Single action**
templates are visually distinct (blue method chip, "No board") and
listed last. Steps 2–3 are unchanged from
`initiative-board-design.md` §1.3.

---

# 2. Actions Gantt (§4.2)

## 2.1 Q5 — one control, two scopes

One component, one grammar, a **scope segmented control** in the
toolbar: `This initiative` | `<Org name>`. Per-initiative hides group
rows and the org/pillar/assignee filters; org scope adds them and
groups by initiative. Two components would drift apart within a
release.

Toolbar: scope · pillar · assignee · status · window presets
(**2w / 4w / 8w / 13w**) · ⋮ (TV mode, show completed, export).

## 2.2 Bars and bands

- **Bar states**, each with a shape as well as a colour: on-track solid
  accent; **overdue** solid red; **awaiting verification** diagonal
  hatch amber; completed flat grey. Legend strip along the footer.
- **Stage bands** behind the bars: translucent PDCA-coloured rails
  spanning each stage's dates, labelled with the stage's target date —
  so "due after its stage is meant to close" is visible, not
  calculated.
- **Today line** pinned, labelled, red at 55% opacity.
- **Start dates first class:** every bar has a start; actions without
  one render as a diamond on the due date until a start is set.
- **Dependencies: out of scope — agreed.** They need a scheduling
  engine and a critical-path story; lean actions are short and
  owner-managed. Sequencing is carried by stage bands and the Verify
  column.

## 2.3 Editing — reschedule is never silent

- **Desktop:** drag the bar to move both dates; drag an edge to resize.
- **Moving the due date (whole-bar drag or right-edge drag) opens the
  reschedule dialog**: "Move due date to 29 Aug?", the previous date
  with its overdue state, the **reason picklist** (Waiting on parts ·
  Resource unavailable · Scope changed · Blocked by another action),
  optional note, Cancel / `Move date`. Cancel snaps the bar back.
  Dragging the **left edge only** (start date) does not prompt.
- **Touch: no drag.** Tapping a bar selects it and reveals
  ±1 day / ±1 week steppers plus `Set dates…`. A 15px bar in a 4-week
  window cannot be dragged accurately with a thumb.
- **No pinch zoom** — the four window presets are the only zoom, and
  they keep the column headers honest.

## 2.4 Q6 — org-wide density

- **Group row per initiative:** disclosure caret · 3px status edge ·
  name · stage chip · action count. Collapsed, it shows **one summary
  bar** spanning its actions, so a 20-initiative org fits one screen
  and expands where the meeting is looking.
- **Row cap 3 per expanded group**, then `3 more ›` (expands, or opens
  the board) — one busy initiative can't push the rest off-screen.
- **Default window 4 weeks centred on today**; the embedded ritual card
  centres on the meeting's week.
- **Left label column fixed at 300px**, never scrolls; the timeline
  scrolls under it.
- **TV mode:** all groups collapsed, 40px rows, labels ×1.4, only
  overdue and awaiting-verification bars keep their pattern. A wall
  needs to show which initiatives are slipping, not every action.
- Entry points: `Gantt ›` from a priority overlay rail, from the
  Improvement tab's team group, and as a ritual card. All open the
  same control with scope and filters pre-set.

## 2.5 Copy

- Empty, initiative scope: "No actions on this initiative yet. Add one
  from the Action plan card."
- Empty, org scope: "No open actions in this window. Try 8 or 13
  weeks."
- Reschedule: "Move due date to 29 Aug?" · "Why is this moving?"
- No start date: "No start date — set one to show this as a bar."
- Row cap: "3 more ›"

---

# 3. Value driver tree (§4.3)

## 3.1 Q7 — a tree, not an indented list

The tree's job is to make a causal argument visible, so it is drawn
**left to right: root at the left, leaves at the right**, with elbow
connectors. An outline hides the shape that is the whole point.

- **Root node**: dark band card, large value, delta chip vs the
  comparison series.
- **Computed nodes**: white card, ⨍ mark, value, formula in words
  underneath ("volume × unit margin").
- **Leaf nodes**: white card, value, and **its source named under the
  title** ("kL / yr · from OEE model", "$ / yr · payroll") so no one
  argues about where a number came from.
- Nodes linked to initiatives carry a count chip ("2 initiatives").
- Deep trees: nodes collapse per branch; a branch collapsed shows
  "n drivers" on the connector.

## 3.2 Node editor and formula authoring

Selecting a node opens the editor (rail or panel): name · definition ·
unit select · source link · formula.

- **Formula = a chip bar.** Typing a child's name autocompletes it into
  a **chip**; operators (`+ − × ÷`, parentheses) and constants stay
  plain text. A reference can therefore never be a typo, and renaming a
  child updates every formula automatically.
- **Live result directly beneath**: "= $7.91m ✓ resolves", plus
  "children: 2 of 2 used" so an unused child is visible.
- **Error states, in words, under the bar:**
  - "'Yield %' is not a child of this node — add it or remove the
    reference" (blocks save)
  - "Divides by a node that can be zero — result shows '—' when it is"
    (warns)
  - Units: "kL × $/L gives $ — matches this node"; a mismatch **warns,
    never blocks** (companies keep unit fudges deliberately).
- No `eval`: the expression language is parsed to a small AST of
  operators, child references and constants.

## 3.3 Q8 — values that aren't a spreadsheet

Three rules keep the values view out of workbook territory:

1. **One period at a time.** A period header with `‹ FY25` / `FY27 ›`
   arrows; no horizontal sprawl of period columns.
2. **Exactly four series as fixed columns** — baseline, plan, forecast,
   actual. No user-defined columns.
3. **Computed rows are visibly not editable** — grey text, ⨍ mark, no
   input box. Only leaves get input cells.

Node rows keep the tree's indentation so the structure carries over
from the canvas. `Import from finance pack` sits in the footer for bulk
entry. **Editing is a mode** (`Edit values`), not the default: most
people only ever see Read.

## 3.4 Q9 — simulation: the trail is the answer

`Simulate` mode keeps the same tree and adds a right panel:

- **Only initiatives already linked to a leaf** are listed — each a
  toggle plus an **editable forecast delta** in the leaf's unit.
- Recompute is **live** on every toggle or delta edit.
- **Only what moved is marked**: green node border, delta chip, and a
  **green path drawn from the moved leaf up to the root**. Untouched
  branches stay grey and quiet — this is what stops it feeling like a
  diff table.
- Panel foot states the scenario in one sentence: "2 of 3 on · EBITDA
  + $180k vs plan", with the causal path named beneath ("Saleable
  volume → Gross margin → EBITDA").
- `Reset to plan` in the toolbar; `Save scenario` and
  **`Adopt as forecast`** in the panel foot — adopting is the only way
  this screen ever writes tree values, and it is permission-gated.

*Model note:* saved scenarios need a small record (name, author, date,
the set of toggles + deltas).

## 3.5 Q10 — where it lives

- **Structure** (nodes, formulas, units, sources) → **Settings → Value
  drivers**, superadmin with the site's finance lead. It is
  configuration and changes rarely.
- **Values + simulation** → a **site page**, a `Value drivers` tab
  beside Reporting. Weekly work for owners and finance, not
  configuration.
- Both render the same tree component; the mode control
  (`Read / Simulate / Edit values`) is what differs by permission.

## 3.6 The metric picker's road to leaves

In an initiative metric editor (and template mandatory metrics):
`Link to a value driver` → a search over the site's tree where **each
hit shows its full path** — `EBITDA › Gross margin › Saleable volume` —
so two same-named leaves on different branches can't be confused. Once
linked, the metric shows `· VDT` beside its name on the board's Metrics
card (already specced) and appears in the simulation panel.

## 3.7 Copy

- No tree yet: "No value drivers for this site yet. Start with the
  measure the site is judged on, then add what drives it."
- Unlinked leaf: "No initiative is linked to this driver."
- Simulate, nothing linked: "Link an initiative metric to a driver to
  run what-ifs."
- Adopt: "Make this scenario the forecast for FY26? Plan and actual
  are untouched."
- Formula empty on a parent: "No formula — this node won't roll its
  children up."

---

# 4. Reporting (§4.4)

## 4.1 Shape

Follows the Document Control Health precedent: **summary tiles over
drill lists**, one page, org-filterable.

- Header: the **same org crumbs + ▾ popover** as Priorities, the same
  **period select**, a comparison select (`vs FY25`), `Export`.
- **Four summary tiles**, each one big number plus at most three
  tallies or a sparkline:
  1. **Initiatives** — total, ✓ ! ✕ tallies, "n completed this period"
  2. **Actions** — total, overdue, due soon, "n rescheduled ·
     n cancelled"
  3. **Value delivered** — VDT hard value, target, trend sparkline
  4. **Health check** — mean score, delta, "n of n checked", sparkline
- **Drill list below**, one pattern used everywhere: clicking any tally
  opens the list already filtered, **with the filter named in the
  header** ("from Actions · ⚑ 17 overdue"). Columns: initiative (status
  edge) · stage · the drilled measure · value linked · health.
- Period comparison is a page-only block beneath the drill.

## 4.2 Q11 — which tiles become ritual cards

- **Ritual cards:** Initiatives · Actions · Value delivered · Health
  check. Each is legible as a tile snapshot and across a room.
- **Page-only:** period comparison and every drill list. A table at
  tile size is a grey smudge, and drilling needs a click a wall does
  not have.
- TV: tiles scale ×1.4; the four tiles fill the width in one row.

## 4.3 Copy

- No data: "Nothing to report for FY26 in this org yet."
- Not linked: "not linked" (value column, grey — never $0)
- Drill header: "from Actions · ⚑ 17 overdue"

---

# 5. Small settings (§4.5)

## 5.1 Q12 — health-check questions

Settings → Improvement → Health check. Ordered question list, ▲▼
reorder, each row: **label · scale (yes/no or 1–5) · weight**. Weight
is a plain number with a live "these weights total 100%" line under the
list — no interdependent sliders. Retiring a question keeps historic
scores intact and stops it being asked.

**Where the trend lives:** the score is a **chip in the board's tier-1
header** ("Health 7 / 10"); the trend is on the **Health check card** —
value, sparkline, date of last check, and per-question answers under a
disclosure. One place for the number, one for the why.

## 5.2 Period settings — carry-forward

Custom mode gains **one field**: `Next period name`, directly under the
period list, with the sentence carry-forward will use: "Priorities
carried forward will move to *FY27*." That is the whole addition.

---

# 6. Interaction maps

**(a) Template → create initiative → board**

```
Settings → Initiative templates (landing list) → ＋ New / pick one
        │
        ▼
   MEETING-WIZARD SHELL, 7 steps (strip is clickable)
   1 Basics ──> name · method · "start from A3's four stages?"
   2 Stages & gates ──> live stepper preview; stage rows; gate rows
   3 Roles ──> five standard (labels editable) + template roles
   4 Fields ──> custom header fields
   5 Metrics ──> mandatory metrics (+ optional VDT link)
   6 Initiative board ──> cards tagged stage + mandatory; charter ⛓ bindings
        │           └── Open composer (overlay) ──> back to step 6
   7 Review ──> rows link back to steps
        │
        ▼
   Save template ──> appears in the create picker
                     │
Improvement → ＋ Initiative
   step 1 pick template ──> step 2 header form ──> step 3 save
                     │
                     ▼
   board opens: first stage current, its mandatory cards created,
   charter's bound fields already filled from the header
```

**(b) Gantt reschedule**

```
drag bar / right edge ──> due date changes
        │
        ▼
   reschedule dialog: new date · old date + overdue state
        │              reason picklist (required) · note
        ├── Cancel ──> bar snaps back, nothing written
        └── Move date ──> action dates updated
                          history row written (who, when, reason, note)
                          bar re-renders; overdue clears if now future
```

**(c) VDT simulate**

```
Value drivers (site page) → Simulate
        │
        ▼
   panel lists initiatives linked to leaves
        │
   toggle off / edit forecast delta
        │
        ▼
   recompute leaf → parents → root (live)
   mark only moved nodes: border + delta chip
   draw green trail leaf → root
   state one sentence + the causal path
        │
        ├── Reset to plan
        ├── Save scenario
        └── Adopt as forecast (permission) ──> writes forecast series
```

---

# 7. Component decisions

**Reuse as-is:** `controls/MeetingWizard` (chrome, step strip, footer,
validation behaviour) as the templates builder's shell; settings
section shells with h3 headings and ▲▼ reorder rows; the chevron stepper (as the builder's live preview);
PDCA tokens; composer + card studio; canvas field-builder rows;
`topicPillars`-style chip-list-with-Add rows (gate approvers); the
per-card Gantt (extended, not replaced); KPI-trend chart and its
sparkline form; overlay + rail; centred modals with reason picklists;
org crumbs + ▾ popover; period select; tile snapshots; the ✓ ! ✕ tally
triplet; status edges.

**New, small:** stage-row + gate-row editor inside a wizard step; the
live stepper preview panel; card tile stage bar + mandatory dot; ⛓ bind toggle on a canvas field row; Gantt group rows
with summary bars and stage bands; the reschedule dialog; the VDT tree
canvas with elbow connectors; the chip formula bar with live result;
the four-series values grid; the simulation panel and moved-node trail;
reporting summary tiles; the health-question row.

**Explicitly not new:** no second Gantt, no chart builder, no separate
reporting page per measure, no template versioning UI, no scheduling
engine, no free-form formula text field.

---

# 8. Acceptance checks

- The templates wizard is the same component as the meeting wizard —
  step strip, 620px column, footer grammar identical to 1f.
- Step strip pills are clickable and 44px; done steps show ✓.
- Editing stages updates the live stepper preview without a save.
- A gate toggled on with no approver roles blocks save with a named
  reason.
- Every card tile shows its stage and mandatory state without opening
  the studio; mandatory tiles have no Delete.
- A template with live initiatives always shows the propagation note.
- One Gantt component serves both scopes; switching scope preserves the
  window preset.
- Any due-date change through the Gantt writes a history row with a
  reason; cancelling writes nothing.
- Bar states differ by pattern as well as colour (greyscale and
  deuteranopia sim).
- Org Gantt: 20 initiatives collapsed fit 1280×800 without vertical
  scroll.
- Formula chips survive a child rename; a missing reference blocks
  save, a unit mismatch only warns.
- Computed VDT cells have no input affordance anywhere.
- Simulation marks only moved nodes and draws one trail to the root;
  `Reset to plan` restores every value.
- Four reporting tiles are legible as tile snapshots at ×1.4 with no
  hover state.
- All targets ≥44px on touch and TV.
