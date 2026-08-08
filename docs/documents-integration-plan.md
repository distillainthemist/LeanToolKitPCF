# Documents — Vault design integration plan for Claude Code

Integrates the **Document Vault v3** design (`uploads/Document Vault
Interface Design/` — README, `Document Vault v3.dc.html` prototype,
screenshots) into LeanBoard's Documents section. **Scope: the
Documents section only** — the rest of the app is already implemented;
touch nothing outside `app/src/docs/*` and the `.app-docs-*` /
docs-specific blocks of `style.css`. Critique and keep/adapt/drop
decisions: section 2a of `LeanBoard Design Review.dc.html`.

Repo: `distillainthemist/LeanToolKitPCF@main`. Docs code lives in
`app/src/docs/` — `docsScreen.ts` (screen), `model.ts` (derived state),
`docsStore.ts` + `sp.ts` (SharePoint data), `rows.ts` (list rows),
`docsCards.ts` (tiles), `views.ts` (saved views), `viewer.ts` (open
document), `prefs.ts`, `listView.ts`, `data.ts`; styles in
`app/src/style.css` (`.app-docs-*`).

**Ground rules**
- The Vault prototype is the **structure and layout** source of truth;
  its theme is not. Do NOT copy the Vault's colours, fonts, radii, or
  shadows — Documents must be built from LeanBoard's existing visual
  language: the app's tokens (`shared/tokens.ts`, CSS vars in
  `style.css`), the app's font stack, the app's existing button/input/
  chip/pill/card styles. Where the register already has an equivalent
  style (`.app-btn`, `.app-input`, existing status-pill classes, kebab
  styling), reuse it rather than inventing a docs-local variant.
- The app-wide floors are already implemented elsewhere in the app —
  match them here: 44px targets, ≥4.5:1 muted text, `:focus-visible`
  rings, glyph + colour + word for every state. Reuse the existing
  global rules/helpers (`shared/ui/format.ts` `statusChip`, the
  app-wide focus rule) instead of re-adding them.
- The prototype's `Component` class documents the intended state
  machine (`query`, `libraries[]`, `nav`, `sort`, `view`, filter
  state, derived lists/counts) — port the logic, don't import the file.

---

## Phase D0 — Style mapping (no new theme)

**Files:** `app/src/style.css`, `shared/tokens.ts`

1. Write a short mapping table (comment block atop the docs CSS)
   translating each Vault region to an existing LeanBoard style —
   then use only the right-hand side:
   - Vault accent + tints → the app accent var and its existing
     tint/selected/filter-chip treatments (as used app-wide).
   - Vault cool greys → LeanBoard's existing neutral tokens
     (page/card/border/divider). No new grey values.
   - Vault radii/shadows → the app's card, popover, and menu styles
     already in `style.css`.
   - Vault type scale → the app's existing scale: keep the structural
     hierarchy (H1 / uppercase section labels / row name / meta) but
     at LeanBoard's sizes, weights, and font stack.
   - Muted text everywhere at the app's AA muted tone (finding 1).
2. Additions genuinely new to the app (keep minimal, derive from the
   existing palette with oklch/tints rather than Vault hexes):
   - `fileTypeChip` tint set for DOCX/XLSX/PPTX/PDF/PNG/DWG in
     `tokens.ts` — hue-coded per type, LeanBoard-toned.
   - Docs status glyph mapping for `statusChip` (reuse the existing
     helper): `✓` approved, `●` retained, `◐` in review,
     `⚠` superseded, `○` draft, `🔒` checked out (finding 5).
   - Amber alert treatment for Action needed — reuse the app's
     existing amber/warn tone; **alert channel only**, never
     selection (finding 7).
- **Accept:** no Vault hex value or Plus Jakarta Sans reference
  appears in the codebase; switching the site accent re-themes
  Documents; visually, Documents reads as the same product as the
  rest of the app; axe reports no contrast fails.

## Phase D1 — Left nav (Libraries card + folder tree + saved views)

**Files:** `app/src/docs/docsScreen.ts`, `model.ts`, `prefs.ts`,
`views.ts`, `style.css`

1. Replace the current left column with the Vault structure, minus the
   org header (the hub provides chrome — drop it, finding "Drop"):
   - **LIBRARIES card**: checkbox rows for the mapped libraries
     (map Vault's Standards/Records/Working files onto the site's real
     SharePoint libraries from `docsStore.ts`); checkbox = include
     toggle (min 1), row = solo-select. Fix discoverability
     (finding 3): label click selects, and an explicit **"Only"**
     text affordance appears on row hover/focus for solo-select;
     checkbox zone stays a toggle. Header action keeps a stable label
     ("Select all" / "Reset") instead of relabelling itself.
   - **FOLDERS tree**: All folders pill + department/team rows from
     the org structure LeanBoard already has (settings → Organisation
     data), caret = expand only, name = filter toggle. Selected =
     filled accent pill (location, rule 1). Live counts per current
     library selection from `model.ts`.
   - **SAVED VIEWS group** (finding 9): keep `views.ts` views as a
     third nav group above FOLDERS, Vault row styling, kebab per view.
2. Targets: nav rows ≥40px, carets 44×44 hit area (visual glyph
   unchanged), checkboxes 20px in a ≥40px row (finding 2).
3. Collapse/expansion and library selection persist via `prefs.ts`.
- **Accept:** dept/team counts match the register under every library
  combination; keyboard: arrow keys traverse the tree, caret via
  Left/Right; misclick recovery — solo-select is undoable with one
  click on "Select all".

## Phase D2 — Toolbar (search, scope, Action needed)

**Files:** `docsScreen.ts`, `model.ts`, `sp.ts`, `style.css`

1. **Search field** 44px using the app's existing input styling and
   focus treatment; live substring match over name/path/owner/tags;
   Ctrl/Cmd+K focuses; keycap badge hidden on coarse pointers
   (`@media (pointer:coarse)`).
2. **Scope control** → a real dropdown menu (finding 4): "Selected
   libraries" / "All libraries" / "Everything (all sites)" — the third
   option replaces the old "search everything" checkbox. No cycling
   button.
3. **Action needed**: button (amber dot + count) + 392px dropdown
   (app popover/menu styling) with the three groups, fed from real
   data:
   - *Awaiting your review* — items where approval status = pending
     and the viewer is an approver (`sp.ts` moderation fields);
   - *Checked out by you* — `CheckedOutTo = viewer`;
   - *Retention expiring* — retention date within N days (`model.ts`).
   Group click applies the matching library+status filter and closes.
   Due labels get glyphs: `⚑ Overdue` red pill, "Due in 3 days" amber
   (finding 5 — never bare red text). When total = 0 keep the button
   in place with neutral styling and a quiet "Nothing needs your
   attention" dropdown — stable location.
4. Toolbar buttons all 44px.
- **Accept:** the three action counts reconcile with a manual
  SharePoint query on the dev site; each group click lands on a
  filtered register whose count matches the badge.

## Phase D3 — Title row, filters, register (list + tiles)

**Files:** `docsScreen.ts`, `rows.ts`, `docsCards.ts`, `listView.ts`,
`model.ts`, `prefs.ts`, `style.css`

1. **Title block**: H1 `{Folder} {Libraries}` composition + breadcrumb
   line, per the README's pattern; right-aligned Filters button
   (badge = active count), List/Tiles segmented toggle, settings
   kebab. Merge the existing register kebab items (Row density,
   Columns, Group by folder, Show superseded, Export CSV) into the
   Vault menu; segmented buttons ≥36px in a 44px frame.
2. **Filters popover** (400px, app popover styling): Status /
   Document type / File type / Modified / Tags pill groups +
   Modified-by people checklist, all with live per-option counts;
   footer match count + Clear all + Done. Chips 36px, app filter-chip
   styling (finding 2). AND across groups, OR within.
3. **List view**: sticky sortable header (active sort 700 + accent
   arrow); rows ≥44px comfortable / ≥36px compact (gate the compact
   density so it never goes lower — finding 2); grid
   `minmax(190px,3fr) 124px minmax(130px,170px)`; **restore the
   file-type chip** in the document cell and ellipsize the middle of
   the filename so the extension survives (`Crane Pre-start …
   Form.docx`, finding 6); status pill = glyph + word via the app's
   `statusChip` helper; owner avatar + name; hover / selected-with-
   inset-accent-bar / focus-ring states in the app's existing row-state
   colours; Status then Owner columns drop out under ~525px/~350px.
4. **Tiles view** in `docsCards.ts`: Vault card anatomy (thumbnail
   area, chip row, name, owner) in the app's card styling; the status
   becomes the same pill as list rows, not a bare coloured word
   (finding 5).
5. **Empty states**: Vault copy + "Clear all filters" tinted button.
- **Accept:** sort, filters, view toggle, and density all preserve
  each other's state; no row under 36px in any density; extension
  visible at every column width; axe clean.

## Phase D4 — Document overlay

**Files:** `viewer.ts`, `sp.ts`, `docsScreen.ts`, `style.css`

1. Rebuild `viewer.ts` as the Vault overlay structure: right-anchored
   panel (26px margins, `min(1080px, 100vw - 52px)`), preview area +
   340px details pane — app surface/border/shadow styling throughout.
2. **Preview**: real first-page render via SharePoint's preview/
   thumbnail API (`sp.ts`); fall back to the file-type striped
   placeholder + "Preview unavailable" if the API can't render the
   type. "Preview · page 1 of N" badge when page count is known.
3. **Details pane**: type chip + status pill, title, path, Open +
   Share (44px), PROPERTIES (Modified, Modified by, Size, Type, Tags,
   Retention — from existing model fields), VERSION HISTORY from the
   SharePoint versions endpoint (`sp.ts`).
4. **Action-parity audit** (blocking): list every action in the
   current row kebab (`rows.ts`) — check out/in, download, supersede,
   rename, move, delete, permissions — and give each a home in the
   details pane (primary buttons or an overflow section) **before**
   removing row kebabs. If any action can't move, the row kebab stays
   for that release.
5. Focus trap, Escape/backdrop close, focus returns to the opening
   row; close button 44px (finding 2).
- **Accept:** every previously-available document action reachable
  from the overlay; keyboard-only walkthrough passes; preview loads
  or degrades gracefully for DOCX/XLSX/PDF/PNG/DWG.

## Phase D6 — Post-implementation review fixes (R1–R10)

From the 8-Aug-2026 build review — section 3a of `LeanBoard Design
Review.dc.html`. Priorities: **Now** R1/R2, R6, R7 · **Next** R5, R8,
R10 · **Then** R3, R4, R9.

**Progress (2026-08-08): Now + Next tiers BUILT** — R1/R2 (decision
zone + one solid primary + 4-up utility row + ⋯ overflow, mock
refinements incl. "review first" caption, ✓ Approve, Cancel revision…
link), R6 (statusChip due pills, one date format in the panel), R7
(Document tasks rename; badge = the panel's row count from ONE
selector), R5 (pill·name/meta·chevron rows, Mark reviewed moved into
the overlay decision zone — primary exactly when due — and the
"Show all N in register" footer as a per-library idIn filter with a
removable chip that suspends/restores "Show only Approved"), R8
(approved = outline via .app-docs-chip-quiet keyed on the mapped
stage; tiles inherit through the shared statusChip), R10 (kebab
grouped with dividers: Open PDF / link+share / work-on-it+favourites /
Mark reviewed / lifecycle transitions last; "Copy link" naming).
Copy fixes done ("All libraries" H1, no "matching" on plain browse).
Bulk select stays the noted follow-on.

**Then tier BUILT too (2026-08-08)** — R3 (two-column label/value
propgrid; filename appears ONCE: name columns and name-echo values
dropped from properties, overlay header slims to library · date —
the kiosk keeps the name, it has no pane to carry it), R4 (one close
control: ✕ alone in the header; the details toggle is a slim »/«
strip ON the pane edge, absent in the kiosk), R9 (tiles: middle
ellipsis keeps the stem tail + extension, meta = document type +
"Modified 7 Aug 2026", owner moved to the overlay, thumbnail band
capped ~half the card). Field fixes from Ben's testing: task-filter
footer clears query/filters/folder/date and scopes to the tasks'
libraries; details auto-expand when the document awaits the viewer
(needsMyActivity = card's pending rule); revision-needed card offers
Check out & edit → Edit source; standards feeds carry the review-date
column so reviewDue can judge from a register row (Ship Loader).
D6 COMPLETE pending Ben's hosted sweep.

**Overlay** (`viewer.ts`, `style.css`)
- **R1 — Action hierarchy.** Replace the flat 8-button stack with:
  (a) a decision zone card (amber alert tint) shown only when the
  viewer has a pending decision — heading "Awaiting your approval",
  containing Open PDF (outline, "review first"), Approve (the single
  solid accent button in the pane), Request revision (outline),
  Cancel revision as a text link; (b) a 4-up utility icon row
  (Copy link · Share · Favourite · ⋯ overflow with Edit properties);
  (c) properties. When no decision is pending, Open PDF is the solid
  primary and the decision card is absent.
- **R2 — One solid primary per pane**, and it is always the
  workflow-critical action. Never two filled accent buttons.
- **R3 — Properties as a 2-col label/value grid** directly under the
  utility row; drop the PROPERTIES→DOCUMENT entry (filename already
  in the pane title) and the overlay-header filename; all key fields
  visible without scrolling at 900px height.
- **R4 — One close control.** Keep ✕ (44px); "Hide details" becomes a
  details-pane collapse toggle inside the pane edge, or is dropped.

**Document tasks** (`docsScreen.ts`, `model.ts`, `sp.ts`)
- **R5 — Uniform row anatomy:** status pill + name + meta + chevron;
  whole row (44px min) opens the overlay where the decision zone
  handles approve/mark-reviewed. No per-group inline buttons.
- **R6 — Due labels as pills** via `statusChip`: `⚑ Overdue` red,
  `● Due soon` amber, `◐ Approve` amber — glyph + word, never bare
  red text. One date format app-wide: `7 Aug 2026`.
- **R7 — One inbox identity.** Rename to "Document tasks"; badge
  count = the panel's item count from a single `model.ts` selector
  (the 11-vs-13 drift is a bug — find and kill the second counter).
  Footer "Show all N in register" applies the task filter.

**Register** (`rows.ts`, `docsCards.ts`, `listView.ts`)
- **R8 — Quiet/loud status rule:** Approved renders as an outline
  (quiet) pill in list and tiles; only exception states (Awaiting
  approval, Overdue review, Superseded, Checked out) get filled
  pills. Applies to the Approval Status column and tile chip row.
- **R9 — Tile anatomy:** thumbnail ≤50% of card height with a
  type-tinted placeholder when no real preview renders (D4.2);
  middle-ellipsis preserves the extension; meta line = document type
  + labelled date ("Modified 2 Aug 2026"); owner moves to overlay.
- **R10 — Kebab grouping + defaults:** order Open PDF first, then
  separator-grouped: (Copy link, Share), (Edit properties, Start
  revision, Add to favourites), (Mark reviewed), lifecycle zone
  (Mark superseded, Mark obsolete) last with a separator. Row
  click / Enter opens the overlay. Add checkbox multi-select +
  bulk bar (Download, Move, Mark reviewed) as a follow-on.

**Copy** (`docsScreen.ts`)
- "8 documents matching" → "8 documents" unless a query/filter is
  active. H1 library suffix collapses to "All libraries" when every
  library is selected.
- **Accept:** exactly one filled accent button visible in the overlay
  at any time; task badge equals panel count on every screen; axe
  clean on the decision zone; deuteranopia sim — overdue/due-soon
  distinguishable by glyph.

## Phase D5 — Hardening & verification

- **Contrast:** axe on nav, register (both views), filters, action
  dropdown, overlay — zero critical (finding 1 resolved by D0).
- **Colour-blind:** deuteranopia/protanopia sim — every status, due
  label, and file type readable from glyph/word alone.
- **Touch audit:** DOM scan ≥44×44 primary / ≥36 dense-secondary,
  gaps ≥8px; test on a touch device incl. tree expand vs select.
- **Keyboard map:** Ctrl/Cmd+K, tree arrows, row Enter/Space, Escape
  cascade (popover → overlay), visible ring everywhere.
- **Consistency check** against the rest of the app: accent = the
  site theme, filled/tinted selection semantics, kebab convention
  (register keeps LeanBoard's kebab styling where kebabs remain),
  status chips share the glyph vocabulary from
  `implementation-plan.md` Phase 0.4.
- Existing suite `cd app && npm test` green; new tests: library/folder
  count derivation, filter chain (AND/OR), action-needed grouping,
  middle-ellipsis helper.
