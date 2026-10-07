# LeanBoard on a phone — review of the main interface (2026-10-07)

Prompted by Ben after the limited phone register (feedback round 1,
Tranche D) shipped to dev: "review the mobile layout of the other main
tabs and identify where we need to design and implement a more suitable
mobile interface".

## How the review was done

- The dev app (`npm run dev`, demo mode — no host) at a 375 × 812
  viewport: the top bar, the hub tab strip, My day, Cadence, Actions and
  Settings render in demo mode and were looked at directly.
- Priorities, Improvement, Value drivers and ritual boards need the
  Power Apps host and never load in demo mode; those findings come from
  the stylesheets and the layout code (`app/src/style.css`,
  `controls/LeanHub/styles.ts`, `controls/BoardGrid/editor.ts`,
  `controls/ActionBoard/styles.ts`) and should be confirmed on Ben's
  phone before the matching tranche is designed.
- The card harness pages (`app/harness/*.html`) carry no viewport meta,
  so a phone renders them at a desktop layout width scaled down; they
  are no evidence either way and would need a `<meta name="viewport">`
  before they can serve a phone pass.
- "Phone" here means the register's own rule: a pane under 600px, and
  a window under 720px for body-level overlays.

## What already fits

- **Documents register** — the limited phone register (Tranche D):
  search, four selects, chips, one-column list, full-bleed viewer.
- **My day's two columns** stack under 760px (`.ltk-lh-myday`).
- **Priorities walk / present mode and the card overlay** stack under
  720px (`.app-cp-walk-row`, `.app-cp-ov-desk`).
- **Value drivers' split** stacks under 900px (`.app-vd-split`).
- **Organisation settings** stack under 720px (`.app-org-split`).
- **Dialogs**: `.app-modal` is `min(440px, 100%)` and `.ltk-dialog`
  `min(420px, 100% − 32px)`; prompts and confirms fit. The document
  viewer is full-bleed with the details under the preview.
- Touch floors: most controls sit on the 44px / 36px floors.

## Findings, by surface

Severity: **blocks** = a phone user cannot do the job; **cramped** =
works with scrolling or effort; **desktop-only** = leave it, say so.

### 1. The frame — top bar and hub tab strip (blocks)

- **Top bar** (`.app-bar`: 55px, 18px gaps and padding; brand + Report
  + Settings + Add action / Home): at 375px the primary "＋ Add action"
  is pushed off the right edge — a blue sliver shows. Capturing an
  action is the phone's first job and the button is unreachable.
- **Hub tab strip** (`.ltk-lh-tabs`: flex, no overflow rule, no wrap):
  seven tabs — My day, Cadence, Priorities, Improvement, Value drivers,
  Actions, Documents. Four fit; "My day" wraps to two lines; Actions
  and Documents are clipped with no scroll and no affordance. On a
  phone the Documents tab does not exist as far as the user can tell.
  **This is a likely cause of report 20 ("missing Documents tab on the
  phone"), which the plan filed under configuration.** Check the
  reporter's site setting, but the strip clips on every site.

Design: a phone frame. Top bar: brand, then icon-only 44px buttons
(⚑, ⚙, ＋ as the one solid), 8px gaps, 12px padding. Tab strip: either
(a) horizontally scrollable with fading edges and the active tab
scrolled into view, or (b) a bottom tab bar with the phone's four jobs
— My day, Actions, Documents, More — and the rest behind More. (b) is
the phone convention and keeps thumbs at the bottom; (a) is a CSS-only
afternoon. Recommend (a) now, (b) when the phone surfaces below exist.

### 2. Action rows — My day "My actions" and the Actions tab (blocks)

`.ltk-lh-action` is one flex row: tick · PDCA disc · title + description
· "with Sam Patel" · due pill · Escalated. At 375px the title is
squeezed to one word per line and "with …" paints over the due pill
(seen in demo mode). Ticking an action is the second phone job.

Design: under 600px the row becomes two lines — line 1 tick + disc +
title (wrapping in full, the register's rule); line 2 a meta line:
description (one line, ellipsis) · with · due pill · flags. The tick
keeps the whole row as its target. One CSS block on the control; no
behaviour change.

### 3. Actions tab head (cramped)

Person select · name field · "Add an action…" + date + Add · All /
Overdue / Due today / Done · By source / By person — five rows at
375px, the add field 100px wide, before the first action shows.

Design: a phone head of two rows — the add field full width with the
date and Add beneath it (or Add opens the action dialog, which already
takes a date); the four state pills in one scrollable row; grouping and
the Person picker behind the tab's kebab.

### 4. Cadence — the week calendar (cramped)

`.ltk-lh-grid` has `min-width: 640px`, so the week scrolls sideways in
its own pane; day columns are ~90px and event chips truncate to
"Assemb…"; the head (Person · name · Week view · ‹ Today › · range)
wraps to three rows. It works, with effort. A Day view already exists
(`"day"` in the view select).

Design: default to Day view under 600px with ‹ › stepping days, event
rows full width (time · name · crew · Open board), the Person picker
behind the kebab. Week stays available from the select. Mostly a
default plus a few CSS lines; My day already shows today.

### 5. Priorities — the matrix (blocks)

`prioritiesScreen` sets the matrix to `126px` + one `minmax(0, 1fr)`
column per pillar inside `overflow-x: auto`. With four or five pillars
on 375px each column is ~50px: the L1 spans and the cell objectives are
unreadable, and the org / period / filter bar wraps to several rows.
The walk (present) mode already stacks and reads well at this width —
one pillar per screen, objectives as full-width cards with their
initiative tallies.

Design: under 600px open the tab in the walk layout — org and period
as two stacked selects (the register's pattern), one pillar per screen
with ‹ › and dots, objectives as cards, tap = the card overlay (already
stacked). The matrix stays desktop. The view-link (`prview`) keeps
working because it carries org / period / filters, not the layout.

### 6. Ritual boards (blocks)

`.app-board-split` is `5fr minmax(380px, 2.4fr)`: on a 375px screen
the details / schedule pane takes everything and the board column
collapses; with the handle, `minmax(380px, …)` again. BoardGrid lays
tiles on a fixed `cols × rows` grid of `1fr` tracks (a wallboard), so
even solo the tiles are stamps. Cards' tile modes are
container-queried but none is a phone card.

Design: a phone board = the layout's tiles as a vertical list in
row-major order, each card full width in its tile mode, tap to open
the card's focused mode full-screen (exists), back returns to the list.
Details / schedule / agenda as a bottom sheet from the board title.
Meeting mode (agenda stepping) stays TV / desktop. This is the largest
piece and the most valuable after the frame: standups happen on the
floor with a phone in hand.

### 7. Improvement — initiatives and the initiative screen (mixed)

- The initiative tiles grid (`auto-fill, minmax(210px, 1fr)`) becomes
  one column at 375px: fits.
- The initiative screen reuses `.app-board-hashandle` (`5fr 40px
  minmax(380px, 2.4fr)`): the details pane swallows the width, the
  board column collapses — **blocks**.
- The charter card reflows by container query: fits inside any width.
- The action board (kanban): columns `min-width: 200px` in a
  horizontal scroller — swipeable, but drag-and-drop on touch is
  unreliable; the list mode is the phone's mode.
- Gantt (`.app-gx-label` 300px sticky + timeline): the label column is
  most of a phone; **desktop-only**, say so in the ⋮.

Design: under 600px the initiative screen stacks — status band (its
container queries already narrow the stage bar), then segmented
Charter / Actions (list) / Updates, details as a bottom sheet; kanban
and Gantt hidden behind "Open on a desktop for the board and Gantt".

### 8. Value drivers (desktop-only)

The split stacks at 900px, but the values rows are `1fr 130px 130px
130px 170px` (`1fr 100 100 100 130` under 900) — 530px minimum — and
the tree is a wide canvas. An analysis surface; nobody will model a
value tree on a phone.

Design: none now. Show the rail (values and simulation) stacked and
let the rows scroll sideways; a one-line note "best on a desktop".

### 9. Settings, Users, Card studio (desktop-only)

Users is a seven-column fixed grid (~1,050px); Documents settings is
`250px + 1fr`; Card studio keeps a 446px right pane. Organisation
already stacks. Admin surfaces.

Design: a note at the top under 600px: "Settings is best on a
desktop." Nothing else.

### 10. Overlays to check on a phone (unknown)

Demo mode cannot open them: the action dialog's who-form (owner / with
parts rows), Edit details, Escalate, the add-document dialog, the
Report-a-problem wizard with its screenshot step, the share / QR
dialog, and every kebab menu positioned by `window.innerWidth − 420`
(`.app-docs-menu` is 400px wide — it will clip at 375px wherever it is
still used). First phone pass: open each from the dev app and note.

### 11. Cross-cutting

- **One phone flag.** Each surface decides on its own today (the
  register reads its pane; My day reads the window). Keep the pane
  rule for panes that can be split (register, board), and add one
  `app-phone` class on the shell from the window for the frame (top
  bar, tab strip, hub rows). Document in ui-standard §3.6.
- **Hover-only affordances** (`.app-docs-only` on hover, row kebabs
  that appear on hover) have no hover on touch: show them always under
  the phone flag or fold them into a long-press / row tap.
- **Harness pages** need `<meta name="viewport" …>` to be useful for
  phone passes; add it to `app/harness/*.html` and `app/docs-*.html`.
- **The Power Apps mobile player** adds its own chrome at the top; the
  55px top bar plus a 48px tab strip plus the player's bar is a quarter
  of a 812px screen before content. The phone frame should be one bar.

## Status

- **M1 Frame — built 2026-10-07** (on dev, unreleased): icon-only top
  bar under 600px; the hub tab strip scrolls with the open tab kept in
  view; two-line action rows; the Actions head stacked with the add
  field full width and chips in one scrolling row; the Settings note;
  viewport meta on every harness and dev page. Verified in demo mode at
  375px; Ben's phone check pending — in particular whether the
  Documents tab now shows for the report-20 reporter.
- **M2 Ritual board — built 2026-10-07** (on dev, unreleased): the
  BoardGrid's list mode by its own width (one tile per row in reading
  order, live cards at natural size, `listOrder` tested); the board
  screen's details & schedule pane as a bottom sheet from a phone-only
  Details button, closing on a pick; the card walk with PREV / NEXT
  stacked above and below the card. Verified on `app/board-live.html`
  at 375px (list order, natural-size stages); the board screen and the
  walk need the host — Ben's phone check. **Card follow-ups seen at
  ~330px**: SQDPC's month grid wraps under its legend; RiskMatrix and
  RACI overflow sideways (scrollable); Fishbone shows a corner of its
  canvas. Each is that card's tile layout, not the list — fix per card
  under a container query when Ben's pass confirms which boards matter.
- **M3 Priorities — built 2026-10-07** (on dev, unreleased): under
  600px the tab renders a stacked head of native selects (organisation
  from `orgSelectOptions`, tested; period; status; pillar when several),
  the vision band, and the walk inline with no Exit — one objective
  per screen, swipe or PREV / NEXT, rows opening the overlay. A window
  crossing 600px re-renders. Needs the host: Ben's phone check (the
  select strip, stepping, a row tap, ＋ Priority, the ⋮ share link).
- M4–M5: not started.

## Recommended order (each its own release, phone-only CSS where it can be)

| Tranche | Scope | Size | Why first |
|---|---|---|---|
| M1 Frame | Top bar icon-only + scrollable tab strip + two-line action rows + Actions head + Settings note + viewport meta on harnesses | ~1 day | Unblocks Add action, Documents and ticking actions — the three phone jobs; likely closes report 20 |
| M2 Ritual board | Vertical card list, focused card full-screen, details sheet | ~2–3 days | Standups on the floor |
| M3 Priorities | Walk layout under 600px with stacked org / period selects | ~1 day | The matrix is unreadable; the walk already exists |
| M4 Initiative screen | Stacked band / charter / actions list / updates; kanban and Gantt desktop-only | ~1–2 days | Follows M2's sheet pattern |
| M5 Cadence | Day view default on phones, head folded | ~½ day | My day covers most of it already |
| — | Value drivers, Settings, Users, Card studio | notes only | Desktop surfaces |

Before M2–M4 are designed: one pass on Ben's phone through the hosted
dev app (Priorities, an initiative, a board, the overlays in §10) to
confirm the code-read findings and catch what demo mode could not show.
