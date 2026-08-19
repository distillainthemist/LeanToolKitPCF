# Improvement tab & initiative board — design spec

Design pass output for §4.2 and §4.3 of
`leanboard-cascade-design-brief.md`. Visual reference: section **10a**
of `LeanBoard Design Review.dc.html`. Answers §6 questions 5 and 6.
Companion to `cascade-priorities-design.md`. No §5 decision changes.

Still to come in a later pass: Actions Gantt, templates builder, value
driver tree + simulation, reporting shapes (§6 questions 7, 11, 12).

---

## 1. Improvement tab (§4.2)

### 1.1 Structure

Toolbar: org select (defaults to viewer's site) · stage/PDCA · period ·
status · flag · template/method · confidential (if permitted) ·
List/Tiles toggle · `＋ Initiative`.

Body is **one table with three groups**, same columns throughout so
scanning doesn't reset:

1. `My initiatives · n` — initiatives where I personally hold a role.
   My **role** is named in the row's meta line ("owner",
   "facilitator", "sponsor").
2. `Owned by my team · n` — **org owners only**: every initiative
   belonging to an org I own, whether or not I hold a role on it. This
   is the org owner's answer to "what is my team running?".
   - Group header carries a **scope select**: "Bendigo Distillery + 3
     child orgs ▾" — my org only, my org + children, or a specific
     child. Independent of the toolbar org filter (which switches
     which org you are looking at); this one widens or narrows
     ownership depth. Default: my org + children.
   - Meta line names the **initiative's owner and org**, not my role.
   - Header also carries `Gantt ›` — the org-wide actions timeline
     filtered to the same scope, which is how an owner reviews the
     team's actions in one place.
   - Collapsed to the first 5 rows with "Show all n ›" when longer.
   - An owner of several orgs (e.g. a site GM) sees one group covering
     all of them; the scope select lists each.
3. `All initiatives I can see · n` — no role prefix; footer line
   counts confidential items ("· 2 confidential in this org").

An initiative can appear in more than one group (I hold a role on an
initiative my team owns). That repetition is intentional — each group
answers a different question — and rows are identical in both.

### 1.2 Row anatomy

Columns: Initiative · Stage · Primary metric · Next gate · Health · ⋮

- **Initiative**: 4px status edge (metric/RAG state, matching the ✓ ! ✕ vocabulary) + title + flag chip
  (`▲` escalated red, `⚐` needs support amber, `◈ Confidential`
  outline); meta line beneath = linked priority · my role · org.
  Initiatives with no linked priority read "Other".
- **Stage**: PDCA-coloured chip — Plan amber, Do blue, Check green, Act
  purple. **The status edge and the stage chip are never merged**; one
  is performance, the other is position in the cycle.
- **Primary metric**: value + `/ target`, value takes the state colour
  only when off-target. "No metric set" in muted grey when absent.
- **Next gate**: "Do → Check" + date; overdue in red; "awaiting you"
  when the viewer is a required approver — this is the row that earns
  the click.
- **Health**: "7 / 10 · Jul", or "Not checked".
- Whole row opens the board; ⋮ holds Open, Flag, Escalate, Health
  check, Move stage, Archive (permission-filtered).

List is the default (comparison); Tiles is for wall display and reuses
the board tile snapshot.

### 1.3 Create initiative

Three steps in one modal, from here or from a priority's detail rail:

1. **Template picker** — cards with template name, its stage set, and
   "used n times"; plus a **Single action** option (lightweight
   variant: writes one action, no board).
2. **Header form** — title · org · linked priorities (multi-select,
   one marked **primary**; pre-filled and locked to the source priority
   when entered from 9a) · roles (people pickers, standard + template
   roles) · confidentiality · period · template custom fields ·
   mandatory metrics (each needs target and good direction).
3. **Save** lands on the new board with the first stage current and its
   mandatory cards created.

Copy: "Pick how you'll run this" (step 1) · "One action instead — no
board, no stages" (single-action option) · "Mandatory for this
template" (metric section) · "This initiative will only be visible to
its roles and org owners" (confidential toggle).

## 2. Initiative board (§4.3)

### 2.1 Answer to §6 Q5 — header vs cards

**Two tiers; the second collapses.** Together ≤150px expanded, so a row
of cards is always visible.

- **Tier 1 (always)**, one line: breadcrumb (Improvement › Org) ·
  title · escalation/flag chip · role avatars (overlapped, "+2"
  overflow) · health score · `▴ Less / ▾ More` · ⋮.
- **Tier 2 (collapsible, persisted per user)**: stage stepper + gate
  line on the left, commentary block on the right (latest entry with
  High / Low / Next labels, `History`, `Add`).
- TVs open with tier 2 collapsed. Phones: tier 1 only, tier 2 behind
  "Details".

### 2.2 Stage stepper doubles as the gate control — yes

- Chevron segments in the template's stage order, each in its PDCA
  colour: completed stages tinted with ✓, **current stage filled and
  labelled "current"**, gated future stages show ⚑ and a dashed border,
  later stages tinted flat.
- Tap the **next** stage → stage-move dialog (target stage, comment;
  if gated, lists required approver roles and their status). Tap a
  **completed** stage → what happened at that gate (who approved, when,
  comment). Tap the **current** stage → nothing (it's a state, not a
  button).
- **Gate line** under the stepper: "Next gate — Do → Check, 28 Aug",
  then each approver role with ✓ approved / ◐ waiting / ✕ declined,
  and one solid primary: `Request gate`. Approvers see
  `Approve` / `Decline` in that slot instead. Overdue gate date in red.
- Escalation is a header chip, not a stepper state: `⚐ Needs support`
  (amber outline) → `▲ Escalated to sponsor` (red filled, names the
  sponsor). Two levels, worded, snapshot-safe.

### 2.3 Board grid

- Existing board grid of card tiles, unchanged mechanics.
- Card title bars carry the **stage chip they belong to** in stage
  colour; **current-stage cards get a 2px ring**.
- `Current stage / All stages` filter above the grid — a
  twenty-card template must not dump everything at once. Default:
  current stage.
- Future-stage cards (when All stages is on) render a one-line
  placeholder: "Opens at the Check stage" + "Open anyway" — never an
  empty card.
- `＋ Add card from template` offers only the template's optional set.
- Mandatory cards cannot be deleted; ⋮ hides Delete for them.

### 2.4 Cards on the board

- **Charter** — Canvas card, with bound fields (§2.5).
- **Metrics** — one KPI-trend block per metric: name (+ `· VDT` when
  tree-linked), value in state colour, target/limit line; VDT-linked
  metrics add "plan · fcst · target"; non-numeric metrics render a
  status square + picklist value.
- **Action plan** — kanban columns To do / Doing / **Verify** / Done.
  New per brief: start date, evidence attach (paperclip + count),
  `◐ awaiting verification`, `⚑ overdue` in red, and a reschedule
  reason prompt when a due date moves ("Why is this moving?").
- **Health check** — button in tier 1 opens the company question set;
  score + trend history live on a board card.

### 2.5 Answer to §6 Q6 — bound fields

A bound field renders as a **sunken tile with a dashed edge and a ⛓
glyph on its label** — visually a slot holding data from elsewhere, not
a box someone typed in. One footnote per card, said once: "⛓ Fields
shown in the header — edit here or there, same data."

- Editing is permitted in both places and writes the same record.
- No lock icons and no read-only charter: forcing people to the header
  to change an owner is the failure mode being avoided.
- The dashed edge is in the tile snapshot, so the distinction survives
  as an image.

## 3. Copy strings

- Empty board (new initiative): "Cards for the Plan stage are ready.
  Add optional cards from the template when you need them."
- No initiatives, mine: "You don't hold a role on any initiative yet."
- No initiatives, team: "No initiatives in Bendigo Distillery or its
  child orgs for FY26."
- No initiatives, org: "No initiatives for FY26 in this org."
- Future-stage card: "Opens at the Check stage" · "Open anyway"
- Gate request: "Ask the sponsor and finance to approve Do → Check?"
- Gate declined: "Finance declined this gate — 'need the cost case
  first'"
- Escalate confirm: "This notifies the sponsor by Teams and email.
  Say what you need." Placeholder: "e.g. two fitters for one shift"
- Reschedule prompt: "Why is this moving?" — Waiting on parts ·
  Resource unavailable · Scope changed · Blocked by another action
- Awaiting verification: "Done — awaiting verification by S. Boyd"
- Confidential: "Visible to its roles and org owners only"

## 4. Component decisions

**Reuse as-is:** board grid + tile snapshots; focused card editor with
prev/next walk and tab strip; Canvas card; KPI-trend chart; actions
kanban + action dialog; escalation viewer; people pickers and initials
chips; centred modals with reason fields; settings-style tabbed
sections for the create flow's steps.

**New, small:** the two-tier header band; the chevron stage stepper
(doubling as gate control); the gate approver line; the bound-field
tile treatment; the Current stage / All stages card filter; the Verify
kanban column; the initiative table row (status edge + stage chip +
next gate).

**Explicitly not new:** no separate approvals screen (gates live on the
board, reached from a notification), no new state colours, no second
flag vocabulary.

## 5. Acceptance checks

- Header tiers ≤150px expanded at 1280px; one card row visible without
  scrolling.
- Exactly one solid primary in the header (`Request gate`, or
  `Approve` for approvers).
- Stage colours identical between stepper segments, card title chips
  and the improvement table's stage column.
- Bound fields visually distinct from free fields in the tile snapshot
  (no colour-only cue).
- Every stage/gate/flag state is glyph + word; deuteranopia sim keeps
  approved / waiting / declined distinguishable.
- Current-stage filter default leaves ≤6 cards on a 20-card template.
- All targets ≥44px on touch and TV.
