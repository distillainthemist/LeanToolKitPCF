# Cascaded priorities — design spec for implementation

Design pass output for §4.1 of `leanboard-cascade-design-brief.md`.
Visual reference: section **9a** of `LeanBoard Design Review.dc.html`.
Nothing here changes a §5 decision.

Improvement tab (§4.2), initiative board (§4.3), Gantt, templates
builder and VDT are a later pass; §6 questions 5–7 and 11–12 are
deliberately unanswered here.

---

## 1. Principle: the physical template is the Simple view

The wall template is a strategy-deployment matrix — rows are levels of
abstraction, columns are strategic objectives. Emulate that structure.
Do **not** emulate its styling: the corporate green bands become the
site's configured accent on the existing card title strip, and the
PowerPoint cell borders become app cards on the warm neutral canvas.
Same rule we applied to the document Vault — structure travels, theme
does not.

Row mapping (no new data concepts):

| Template row | LeanBoard |
| --- | --- |
| Vision | Org's vision statement — dark band spanning all columns, ⋮ edit for owner |
| Medium term strategy + Strategic objectives | One row label, **Strategic Priorities**, spanning both level rows: **level-1 pillars** as chips (clicking one filters the view) above **level-2 pillars** as the matrix columns in accent title strips |
| Priorities | Org's priorities grouped into their L2 pillar column |
| Metrics (process and lagging) | Row label **Objectives**: the headline metric/objective of each priority's primary initiative |

Columns come from the company pillar set, so the matrix is stable
across orgs. An L2 pillar with no priorities still renders its column
with a dashed "＋ Add priority" cell (owner) or stays empty (viewer).

## 2. Screen anatomy (top to bottom)

1. **Org bar** — breadcrumb `Company › Pacific ▾ › Bendigo Distillery ▾`
   (each level a dropdown of siblings), then `Descend:` chip row of
   child orgs, then `⌗ Org picker` opening a dialog with the DMS-style
   tree for far jumps. Default org = viewer's own site.
2. **Vision band** — spans the matrix, dark surface, centred 14–15px
   text (TV: 1.4×), ⋮ → Edit vision (owner only).
3. **Toolbar** — pillar filter (two-level) · period (default current) ·
   status · Simple/Dynamic segmented toggle · cascade inbox chip
   (`⇩ n cascades to accept`, amber, filters the view when tapped) ·
   `＋ Priority` (owner) · ⋮ view options.
   ⋮ view options holds: roll-up rule **Strict / Ratio (X%)**, show
   Other, show completed, TV mode.
4. **Matrix** — `grid-template-columns: 126px repeat(n, 1fr)`, 8px gap.
   Row label rail is 11px uppercase warm grey.
5. **Other strip** — one dashed line under the matrix, off by default:
   "Other — n initiatives not linked to an open priority · m
   confidential in this org · Show ›".

## 3. Priority card (matrix cell item)

Reuses the card primitive. Anatomy, in order:

- 4px left status edge in the site's configured state colour — the only
  full-strength state colour on the card, so it survives the SVG tile
  snapshot and reads at TV distance.
- Statement, 12.5px semibold, 2–3 lines, `text-wrap: pretty`.
- Meta row: **status tallies as symbols, plus the total** —
  `✓ 3` (green) `! 1` (amber) `✕ 0` (red) `· 4 initiatives`. Always
  all three symbols, zeros in muted grey so a clean priority is as
  legible as a red one, and the total always present so the size of the
  effort reads as fast as its health. Symbols not letters: no legend,
  no colour dependence, and they survive a monochrome snapshot.
- **No owner chip on the matrix card.** Ownership is not what the
  matrix is scanned for, and eight initials chips add noise at TV
  distance. Owner appears in the Dynamic view card, the detail overlay
  header and walk mode.
- Lineage line (below the tallies).
- Lineage glyph line: `↑ Pacific` received/adopted · `↓ 3 areas` sent
  and all accepted · `↓ 2 areas · 1 pending` · `↓ 3 areas · 1 declined`
  (declined shown in red).
- Flags, worded: `⚐ Needs support` (amber outline) and `▲ Escalated`
  (red filled). Never colour alone.
- Whole card opens the detail overlay; ⋮ on hover/focus for owner
  actions (Edit, Cascade to…, Reorder, Complete/Archive).

**Inbound cascades do NOT render as cards in the matrix cells**, and
there is no second inbox surface. The matrix stays a picture of what
this org has committed to. The toolbar's amber
**`⇩ n cascades to accept`** chip is the single surface: tapping it
opens a review list:

- One row per request: statement · sender org + its owner · pillar ·
  parent lineage · period, then **Accept / Hold / Reject** (44px each).
- Hold and Reject open the reason dialog; the reason shows on the
  sender's view.
- Accept creates the child priority and it appears in its pillar column
  immediately.
- A notification link opens the same list.
- Empty state: the chip is absent, not a zero chip.

## 4. Objectives row (headline metrics)

One cell per objective column, containing one metric line per priority
in that column (order matches the priorities above it):
metric name (11.5px), value + `/ target` (14px semibold, value takes
the state colour only when off-target), 52×22 sparkline in the same
state colour. Non-numeric metrics show a status square instead of a
value. No metric → "No metric set" in muted grey.

## 5. Dynamic view

Card per priority in a wrapping grid (min 320px). Differences from
Simple, and only these:

- Pillar becomes the card's coloured **title strip** with ⋮ in the
  action slot.
- Statement at 14.5px.
- Headline metric gets a large value (22px), target line, and a 96×40
  sparkline with a dashed target line.
- Owner shown as chip + name (the matrix card omits it — see §3).
- R/A/G counts plus "n initiatives".

Simple is the default for TV and first load; the toggle persists per
user per org.

## 6. Priority detail — overlay + right rail

Reuse the Documents overlay pattern (modal over a dimmed desk, right
details rail, single ✕). Closing returns to the same org, scroll
position and filters — the reason this is an overlay and not a page.

- **Header**: pillar chip · statement · meta line (org · period ·
  owner) · ✕.
- **Left body, tab strip**: `Initiatives n` (default) · `Charter` ·
  `Actions` · `History`.
  - *Initiatives*: rows with status edge, title, PDCA stage chip, then
    "org · owner · n open actions · n overdue". Initiatives inherited
    through child priorities are prefixed `↓ ChildOrg` so the whole
    cascade depth is visible without another screen. Gate waits read
    "gate: Plan → Do awaiting sponsor". Confidential items collapse to
    a plain grey line "+ n confidential initiative(s)" — no chip, no
    chevron, no hover, not clickable.
  - *Charter*: the primary initiative's Canvas card, read-only.
  - *Actions*: open actions across all listed initiatives, overdue
    first; `Gantt ›` opens the org Gantt pre-filtered to this priority.
  - *History*: period history, cascade events, completion reasons.
- **Rail**: Status (R/A/G tallies + the active roll-up rule in words,
  e.g. "Red — strict rule (any red)") · Lineage (parent chain, children
  with ✓ accepted / ⏳ pending / ✕ declined) · Actions summary ·
  bottom-anchored `Add initiative` (solid primary), `Cascade to…`
  (outline), `⋮ More` (Complete, Archive, Edit, Reorder).

One solid primary in the overlay at a time, per the R1/R2 rule already
adopted for Documents.

## 7. TV and phone

**TV (read-mostly, at distance):** org bar collapses to org name,
toolbar hides (filters preserved from the last laptop session), type
scales ~1.4×, sparklines and initials chips grow, hover-only affordances
are absent by design. No control smaller than 44px remains on screen.

**Phone:** the matrix cannot survive one column. Render objective
headings (11px uppercase) with their priority cards stacked beneath, in
matrix reading order; metrics move into the detail overlay; the org bar
becomes a single dropdown.

## 8. Embedded ritual card

Same view compressed: tile snapshot shows the vision band, objective
headings and status edges only (no metrics text — unreadable at tile
size). The focused editor shows the Simple matrix with the meeting's
week as the period context. Card settings hold org, pillar filter and
view mode.

## 9. Add / edit priority dialog

Centred modal, one column, in this order: Statement (multiline,
required) · Pillar (two-level select, required) · Owner (people picker,
defaults to current user) · Period (defaults to current) · Primary
initiative (optional, search existing or "create later") · Cascade to
(multi-select of child orgs and peers, each row showing the org and its
owner) · Notes. Footer: Cancel · Save. Saving with cascade targets
selected shows a confirm line: "This will send the priority to 3 orgs
for acceptance."

## 10. Copy strings

- No priorities, owner: "No priorities for FY26 yet. Add the few things
  this org must achieve, or accept one cascaded from above."
- No priorities, viewer: "This org hasn't published priorities for
  FY26."
- No vision: "No vision statement set for this org."
- No metric: "No metric set"
- Cascade received: "Cascaded from Pacific · awaiting your decision"
- Reject/hold reason dialog: "Tell Pacific why — they'll see this on
  their view." Placeholder: "e.g. no capacity until Q3"
- Rejected flag, sender's view: "Warehouse declined this priority —
  'no capacity until Q3'"
- Parent completed prompt: "Pacific completed the parent of this
  priority. Complete yours, or keep it and note why."
- Complete/archive dialog: "Why is this closing?" — Achieved ·
  Superseded · No longer relevant (the carry-forward reason left with
  the copies — §16)
- Cascade confirm: "This will send the priority to n orgs for
  acceptance."
- Other strip: "Other — n initiatives not linked to an open priority"
- Confidential: "+ n confidential initiative", "· n confidential in
  this org"

## 11. Interaction map — cascade lifecycle

```
Owner adds priority ──> (optionally) cascade to child/peer orgs
                             │
                             ▼
        target org sees amber pending card on its own matrix
                             │
        ┌────────────┬───────┴────────┬─────────────┐
        ▼            ▼                ▼             ▼
     Accept        Hold(reason)    Reject(reason)  (no action)
        │            │                │             │
        ▼            ▼                ▼             ▼
  child priority  parked, shows   sender's card   inbox chip
  created, links  on sender as    shows "declined  keeps counting
  to parent       "⏸ parked"      — reason"
        │
        ▼
  child links initiatives ──> R/A/G rolls up to parent
                                   (strict or ratio)
        │
        ▼
  parent completed/revised ──> child sees "parent completed" prompt
        │
        ▼
  complete with reason ──> the span ends in that period (§16)
```

## 12. Component decisions

**Reuse as-is:** card + coloured title strip with action slot; status
chips from the site palette; people initials chips; kebab menus; the
Documents overlay + rail; the DMS tree (inside the Org picker dialog);
the KPI-trend chart (shrunk to sparkline); the Canvas card (read-only
charter); centred modal dialogs with reason fields; the tile-snapshot
renderer.

**New, small:** the matrix grid layout; the R/A/G tally triplet; the
lineage glyph line; the pending-cascade card variant; the breadcrumb +
child-chip org bar; the Other strip.

**Explicitly not new:** no inbox screen, no separate cascade admin
view, no tree in the page body, no new state colours.

## 13. Acceptance checks

- Matrix renders 2–6 objective columns without horizontal scroll at
  1280px; degrades to stacked headings below 720px.
- Every status is glyph-or-text plus colour; the ✓ ! ✕ tallies stay
  distinguishable in a deuteranopia sim and in greyscale.
- Every priority shows its total initiative count alongside the
  tallies.
- Priority tile snapshot legible at tile size with no hover state.
- One solid primary visible in the detail overlay at a time.
- Closing the overlay preserves org, filters and scroll position.
- All interactive targets ≥44px on touch and TV.
- Cascade inbox chip count equals the number of pending cards rendered.

---

## 14. Amendment — 5–6 objectives (confirmed typical count)

Visual reference: section **10a**.

Column density is a function of column count:

- **≤4 columns — comfortable.** As specced above.
- **5–6 columns — compact.** Statement 10.5–11px clamped to 3 lines;
  tallies tighten to symbol+digit (`✓3 !1 ✕0`) with the total as
  `·4`; lineage
  compresses to `↓3` / `↑`; owner to initials only; **the Objectives row
  collapses to a strip** with "▸ Objectives row collapsed at 6 columns —
  expand from ⋮ view options". Six sparklines across 1180px is
  decoration.
- **7+ columns.** Horizontal scroll with the label rail pinned, plus a
  ⋮ option "Group by strategy" — one matrix per L1 pillar, stacked.

Compact must not break minimums: 10.5px is laptop-only (TV scales
1.4×) and tap targets stay ≥44px via padding, never text size.

**The primary answer to width is the pillar filter, not shrinking.**
Selecting one medium-term strategy narrows the matrix to that
strategy's objectives — 6 columns become 2 at comfortable density.
Make the L1 pillar chip row visibly interactive (selected chip goes
dark with an ✕ to clear) and let a TV card's saved settings default to
the pillar that ritual is about.

## 15. Amendment — TV walk mode (displayed *and* walked)

Two TV states, one view:

- **Displayed** (resting, between rituals) — the compact matrix. Also
  what the tile snapshot renders.
- **Walked** (in the ritual) — **one objective per step**, not one
  priority. Six objectives is a six-step walk; walking individual
  priorities is too long and loses the strategy shape.

Walk step anatomy: objective title strip (18px, accent) with its L1
pillar, org and period beside it, progress dots + "2 / 6" right; then
each priority in that column as a full-width row — 6px status edge,
statement 19px, owner chip + name, worded flags, R/A/G as three large
single-digit tallies, and the headline metric (24px value, target,
62×34 sparkline) in a right-hand cell divided by a rule.

Footer uses the existing card-walk grammar: named prev/next
("‹ People and safety first" / "Quality every batch ›"), **⊞ All
objectives** to return to the matrix, keyboard ←/→, remote left/right,
swipe on touch. All controls ≥44px.

Rules:
- **Cascades to accept are one extra, final step** when any are
  pending: "Cascades to accept · n", showing the same review list as
  the toolbar chip, so decisions cannot be walked past while the
  objective steps stay a picture of committed work.
- Filters carry into walk mode; the walk covers only the objectives
  currently visible.
- No hover-only content anywhere in walk mode.
- The embedded ritual card's focused editor opens in walk mode at
  step 1; its tile snapshot shows the displayed matrix.

## 16. Amendment — spans, not periods (2026-10-02)

A priority no longer BELONGS to a period; it RUNS from a start period
until it closes, and the period picker is a lens over what was live in
the viewed year. Nothing is copied at a boundary, so lineage, the
primary initiative and the cascade records stay on the one row across
years. Pillars carry the same span, so a strategy refresh adds the new
pillars and ends the old ones without losing either view.

- **Fields**: `ben_period` is the START; `ben_toperiod` is stamped at
  close from the closing date (never typed) and cleared on reopen;
  `ben_plannedend` is optional. Pillars: `ben_fromperiod` /
  `ben_toperiod`. Initiatives: `ben_toperiod` stamped on completion or
  archive. No migration: a row closed before ends were stamped reads
  as ending in its start (`effectiveEnd`).
- **Live rule** (`priorityLiveIn` / `pillarLiveIn`): start empty or at
  most the year, end empty or at least the year. A future start hides
  the priority until its year. The status filter still narrows to
  active only. Custom period labels compare by the ordered label list
  in Settings → Priorities; FY and calendar by their year.
- **Picker**: every period from the earliest start in the data to the
  later of the next period and the latest end or planned end.
- **Review flag**: open past its planned end, as seen from the viewed
  year, a card reads "⟳ Past its planned end (FY27) — review". It never
  closes on its own; this replaces the yearly carry-forward.
- **Gone**: the carry-forward copy, the bulk "Carry forward … to next
  period" flow and the close reason. Old `carriedForward` events still
  read in History.
- **Re-parenting after the fact**: on the Cascade tab, "Link to a
  parent priority…" (or "Change parent…" / "Unlink") for anyone who
  manages the child's org. Candidates are active priorities at orgs
  above the child or peers at its level, never beneath it; a parent
  not live in the child's start period is offered with a note. The
  write (`relinkParent`) sets the parent, records an accepted
  assignment on the parent naming the child as its customised row,
  removes the old parent's record for that child, and writes a
  `linked` / `unlinked` event on both rows. The dialog offers to take
  the parent's sub-pillar when they differ (ticked by default when the
  child has none).

## 17. Amendment — the phone view is the walk (2026-10-07, v0.66.0)

Under 600px of window width the matrix (126px label + one column per
sub-pillar) gives each column ~50px, so the tab renders the walk of
§15 inline instead: a stacked head of native selects (organisation —
the tree in order, indented; period; status; pillar when several), the
vision band, then one objective per screen with the PREV / NEXT rails
and swipe, rows opening the overlay (already stacked under 720px). No
fixed layer, no fullscreen, no Exit — there is nothing to exit to. The
state is the desktop's `ScreenState`, so the person's prefs and a
shared view link (`prview`) mean the same thing on both; a card mount
of the screen keeps its own tile / focused modes. `renderPhone()` in
`prioritiesScreen.ts`; `mountWalk({ inline: true })` in `walk.ts`;
`orgSelectOptions` in `dialogs.ts` (pure, tested).

## 18. Amendment — the poster (2026-10-08)

The tab's ⋮ offers "Download PDF version": the CURRENT view — org,
period, status, pillar filter — as an A3 landscape PDF with no
controls, for a wall or a deck. `priorities/pdfPoster.ts` is pure:
a `PosterDoc` (title, org chain, vision, columns with their pillar and
colour, one `PosterPriority` each — statement, owner, roll-up colour,
R/A/G counts, starred objectives with plan and actual, flags) in,
pages of PDF operators out, drawn on the issues export's writer
(`issues/pdf.ts`, now with a size-agnostic `buildPagesPdf`; the single
guillemets joined its WinAnsi map). The page: title and subtitle, the
vision as a dark band, pillar spans merged over consecutive
sub-pillar columns, colour-filled column heads, cards with a 4pt
roll-up edge, coloured tally dots (the screen's ✓ ! ✕ are not WinAnsi
glyphs), and the objectives under a hairline. More than eight columns
go to further pages; a column whose cards overrun continues on the
next page under repeated heads, marked "continued". The screen
gathers the doc from the same selectors the matrix paints from, so the
poster never shows a priority the screen would not. Vector text
throughout: print-sharp and extractable.
