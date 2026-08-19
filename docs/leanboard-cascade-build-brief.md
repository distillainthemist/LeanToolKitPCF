# Design pass → Claude Code brief: cascaded priorities & improvement

Design review is signed off. This is the hand-off. Read it first, then
the two specs it points at.

**Files**
- `cascade-priorities-design.md` — priorities screen (brief §4.1), full
  spec.
- `initiative-board-design.md` — improvement tab + initiative board
  (brief §4.2, §4.3), full spec.
- `LeanBoard Design Review.dc.html` — visual reference. Sections **9a**
  (priorities: matrix, dynamic view, detail overlay, phone) and **10a**
  (density + TV walk mode, improvement tab, board header). Section
  ids are stable; cite them in PRs.
- `leanboard-cascade-improvement-plan.md` — the decided engine and data
  model. Where it and the specs disagree on *presentation*, the specs
  win; where they disagree on *model*, stop and ask.

## Build order

1. **Priorities screen, Simple view** — org bar, vision band, toolbar,
   the matrix, Other strip. This is the spine; everything else hangs
   off it.
2. **Priority detail overlay + rail**, including the cascade review
   list behind the toolbar chip and the add/edit priority dialog.
3. **Dynamic view** (same data, card per priority) and the
   compact/6-column density rules.
4. **TV walk mode** and the embedded ritual card.
5. **Improvement tab** — three-group table, filters, create flow.
6. **Initiative board** — two-tier header, stage stepper as gate
   control, template cards, bound charter fields.

Ship 1–2 before starting 5; the improvement tab's rows link back to
priorities and it is cheaper to build once the priority record exists.

## Decisions taken during review — these overrode earlier drafts

- The physical wall template maps onto **existing concepts only**: L1
  pillars = "Medium-term strategy" chips, L2 pillars = matrix columns.
  One rail label, **"Strategic Priorities"**, spans both level rows.
  Structure travels from the template; its green styling does not —
  site accent on the existing card title strip.
- The bottom row is labelled **"Objectives"** (not "Metrics").
- Status indicators are **symbols, not letters**: `✓ n` green, `! n`
  amber, `✕ n` red, always all three, followed by the **total**
  ("· 4 initiatives"). No legend, no colour dependence, greyscale-safe.
- **No owner chip on matrix priority cards.** Owner appears in the
  Dynamic card, the detail overlay header and walk mode.
- **No per-column "add priority" cells.** Adding is the toolbar's
  `＋ Priority`, which pre-selects the column last interacted with.
- **One cascade surface**: the toolbar's `⇩ n cascades to accept` chip
  opens the review list (Accept / Hold / Reject per row). Nothing
  renders in matrix cells; no inbox screen; walk mode adds a final
  "Cascades to accept" step when any are pending.
- **Improvement tab has three groups**: My initiatives → **Owned by my
  team** (org owners; scope select for child orgs; its own `Gantt ›`)
  → All initiatives I can see. Same columns in all three.
- **5–6 objectives is the typical count.** Narrow before you shrink:
  the L1 pillar filter is the primary answer to width; compact density
  and a collapsed Objectives row are the fallback.
- **The TV is both displayed and walked.** Displayed = the matrix.
  Walked = one objective per step, not one priority.

## Non-negotiables

- Every state is glyph or word **plus** colour, never colour alone, and
  must survive the monochrome SVG tile snapshot.
- No state that exists only on hover or in animation — wall TVs and
  snapshots have neither.
- 44px minimum targets on touch and TV; achieve density with padding,
  never by shrinking below the minimum type sizes.
- One solid primary button per surface, and it is always the
  workflow-critical action (`Request gate`, `Approve`, `Add
  initiative`).
- Reuse the listed primitives rather than new components — the specs
  name which primitive per element, and the genuinely new pieces are
  short lists in each spec's "Component decisions".
- Sentence-case labels; no all-caps beyond the small rail labels.
- Site-configured state and accent palettes; no hard-coded colours.

## Not designed yet — do not improvise

Actions Gantt, initiative templates builder, value driver tree editor
and simulation, and reporting shapes (brief §4.4–4.5, §6 questions 7,
11, 12). Leave entry points (`Gantt ›` links, settings tabs) as stubs
and come back for the design.

## Gates

Each spec ends with acceptance checks — treat them as the PR checklist.
The three that catch the most regressions:

- Matrix renders 2–6 objective columns with no horizontal scroll at
  1280px and stacks to headings + cards below 720px.
- Closing the priority overlay restores org, filters and scroll
  position.
- Board header tiers stay ≤150px expanded, so a row of cards is always
  visible.
