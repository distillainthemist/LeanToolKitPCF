# Documents — Vault design integration plan (adapted)

Adapts the Claude Design "Document Vault v3" integration plan
(Phases D0–D5) to what LeanBoard's Documents section actually is at
v0.24.0. The Vault plan's structure and findings are kept; this
document records where its assumptions diverge from the repo and how
each phase is adapted. Scope is unchanged: **Documents only** —
`app/src/docs/*` and the `.app-docs-*` blocks of `style.css`.

Status: PROPOSED — awaiting Ben's review. No code has changed.

---

## 1. Reconciliation — Vault plan vs the repo at v0.24.0

| Vault plan assumes | Repo reality | Adaptation |
| --- | --- | --- |
| `docsCards.ts` is the register's tiles view | `docsCards.ts` is the *board cards* module (Standard documents / Document health tiles with SVG snapshots) — nothing to do with the register | Tiles view is a **new** module `docsTiles.ts`; `docsCards.ts` untouched |
| A FOLDERS tree fed by folder structure | Documents are metadata-driven; the left nav has a **Browse by** group-by select + taxonomy term tree (Phase 3a) | The Vault "FOLDERS" region becomes the existing taxonomy tree, restyled to Vault structure. The group-by select is kept — it is a shipped 3a feature the Vault prototype lacks |
| Multi-select library checkboxes | Left nav is All documents / per-library links / ★ Favourites (single selection) | Adopt multi-select, with a data caveat: browse mode is one REST feed per library, so 2+ selected libraries route through search-mode union. Single selection keeps the fast browse path |
| Action needed fed by SharePoint moderation + `CheckedOutTo` + retention date | No moderation/check-out code exists (DMS Phases 4–5 ON HOLD); but column **roles** exist: `status`, `approvers`, `nextReviewDate`, `retainUntil` | Feed the dropdown from configured roles instead: *Awaiting your review* = status-role value pending/in-review AND viewer in approvers-role column; *Review due* = `nextReviewDate` within N days (same derivation as the Document health board card); *Checked out by you* = **deferred to Phase 4**, slot reserved |
| Viewer preview via embed/preview API | Cookie-free architecture is load-bearing (v0.23): office → presigned `/transform/pdf`, PDF → tempauth blob. Cookie-auth'd frames render as a blocked AAD login | Vault overlay **layout** adopted; preview plumbing unchanged |
| Details pane "Open + Share" | Ben cut viewer actions to **Open PDF + Copy PDF link** (explicit decision, this release) | Those two stay the actions; no Share/Teams/Print/Download return |
| Row kebabs may be removed after action parity | Row kebab holds: favourite toggle, Properties & history, Open PDF, Copy PDF link, disabled "Request check-out" | Parity is cheap (all four move into the overlay). Keep a slim row kebab anyway for favourite + Open PDF — one-click actions shouldn't cost an overlay open |
| Version history is new | `openDocProperties` already fetches version history | History pane moves/merges into the overlay details pane; the standalone properties dialog goes away once the overlay covers it |
| Filters popover replaces filter UI | 3a shipped "＋ Filter" term chips + Show superseded + scope select + Search everything checkbox | Popover becomes the *editor*; applied filters keep rendering as the existing chip row. Scope dropdown replaces both the scope select and the Search everything checkbox (D2.2 as written) |
| Live per-option/per-term counts throughout | No count queries exist; search refiners would add a query per paint | Counts land in two steps: counts over *loaded* rows immediately (cheap, honest "of what you can see"), search-refiner live counts as a V5 follow-up if the dev-site cost is acceptable |
| Sortable sticky header | `listView.ts` header is static; browse order comes from REST, search from rank | Add real sorting: `$orderby` in browse, `sortlist` in search — server-side per mode, never a client sort over a partial page |
| Nav/selection state persists via `prefs.ts` | `prefs.ts` stores favourites + saved views in Dataverse (`ben_ltkuserprefs`) | Presentation state (library selection, collapsed groups, density, list/tiles) goes to **localStorage** — device-level, no Dataverse schema change. Favourites/views stay in Dataverse. Flagged as a decision below |

Findings ledger (from the review): finding 1 contrast, 2 touch,
3 solo-select discoverability, 4 scope dropdown, 5 glyph+word status,
6 extension-preserving ellipsis, 7 amber = alert only, 9 saved views
as nav group. All are honoured in the phases below.

---

## 2. Phases

### V0 — Style mapping (Vault D0, as written)

Files: `app/src/style.css`, `shared/tokens.ts`, `shared/ui/format.ts`

- Mapping comment block atop the docs CSS: Vault accent/greys/radii/
  shadows/type → the app's existing vars and styles. No Vault hex, no
  Plus Jakarta Sans, anywhere.
- `fileTypeChip` tint set in `tokens.ts` (DOCX/XLSX/PPTX/PDF/PNG/DWG),
  hue-coded, derived from the app palette via color-mix — replaces the
  bare `extGlyph` emoji in the register cell (glyph stays inside the
  chip).
- Status glyph map for `statusChip`: `✓` approved · `●` retained ·
  `◐` in review · `⚠` superseded · `○` draft · `🔒` checked out.
  Site status values are free text, so mapping is by normalised
  keyword match with a neutral no-glyph fallback — unit-tested in
  `format.test.ts`.
- Amber = alert channel only (Action needed, due-soon); selection
  stays accent-filled/tinted per the app convention.
- Accept: axe zero contrast criticals on the docs screen; changing the
  site accent re-themes Documents.

### V1 — Left nav (Vault D1, adapted)

Files: `docsScreen.ts`, `model.ts`, `prefs.ts`, `views.ts`, `style.css`

- **LIBRARIES card**: checkbox rows over the site's real exposed
  libraries (from `docsStore.ts`), min 1 ticked; row click =
  solo-select with an explicit "Only" affordance on hover/focus
  (finding 3); header "Select all" (stable label). ★ Favourites stays
  as a pinned pseudo-row.
  - Data: 1 library ticked → existing browse path; 2+ → search-mode
    union across the ticked list ids (search already carries
    multi-library rows; `byListId` labels them). "All documents"
    becomes simply all boxes ticked.
- **SAVED VIEWS group**: existing views + kebab + "＋ Save view",
  restyled to Vault nav-row anatomy (finding 9). No behaviour change.
- **BROWSE BY tree**: keep the group-by select; restyle the term tree
  to Vault structure — "All <group>" clear-pill, caret = expand only
  with a 44×44 hit area, term click = filter toggle, selected =
  filled accent pill. Counts over loaded rows (see reconciliation).
- No org header block (hub provides chrome — Vault "Drop" finding).
- Persistence: ticked libraries + collapsed groups → localStorage.
- Targets: rows ≥40px, carets 44×44, checkboxes 20px in a ≥40px row.
- Accept: solo-select undoable with one click on Select all; keyboard
  arrows traverse the tree, Left/Right drive carets; multi-library
  rows show their library name.

### V2 — Toolbar (Vault D2, adapted)

Files: `docsScreen.ts`, `model.ts`, `data.ts`, `style.css`

- **Search** 44px, app input styling; Ctrl/Cmd+K focuses; keycap badge
  hidden on `pointer: coarse`. (Live matching stays server-side as
  today — debounced search, not the prototype's in-memory substring.)
- **Scope dropdown** replaces the scope `<select>` *and* the "Search
  everything" checkbox: "Selected libraries" / "All libraries" /
  "Everything (all sites)" (finding 4).
- **Action needed** ships as a greyed placeholder only (Ben's call,
  2026-08-01): the button sits in its final toolbar position, neutral
  and disabled, tooltip "Arrives with document control (Phase 4)".
  No data wiring now. The live version — *Awaiting your review*
  (status role pending + viewer in approvers role), *Review due*
  (`nextReviewDate`, sharing the Document health card's derivation),
  *Checked out by you* — is specced above and builds in Phase 4, with
  due labels `⚑ Overdue` red pill / "Due in N days" amber (finding 5)
  and the quiet "Nothing needs your attention" zero state.
- "Show superseded" moves into the register kebab (V3 merges menus).
- Accept: scope dropdown drives browse/search correctly in all three
  modes; Cmd/Ctrl+K focuses search; placeholder button present,
  disabled, correctly positioned, and invisible to the tab-order trap
  (still focusable with an explanatory tooltip/aria-description).

### V3 — Title row, filters, register (Vault D3, adapted)

Files: `docsScreen.ts`, `rows.ts`, `listView.ts`, **new**
`docsTiles.ts`, `model.ts`, `style.css`

- **Title block**: H1 `{Filter} {Libraries}` + breadcrumb line;
  right: Filters button (badge = active count), List/Tiles segmented
  toggle (≥36px in a 44px frame), register kebab (Copy link to this
  view, Export register CSV, Row density, Show superseded — the
  existing kebab plus the two relocated toggles).
- **Filters popover** (~400px, app popover styling): pill groups from
  the library's *available* taxonomy/choice columns + Modified ranges,
  per-option counts over loaded rows; footer match count + Clear all +
  Done. AND across groups, OR within (matches shipped `termFilters`
  semantics). Applied state continues to paint as the existing chip
  row.
- **List view** (`listView.ts` grows): sticky sortable header (active
  sort bold + accent arrow; server-side `$orderby`/`sortlist`);
  comfortable ≥44px / compact ≥36px density (hard floor); document
  cell = fileTypeChip + middle-ellipsized name so the extension always
  survives (finding 6 — ellipsis helper unit-tested); status role →
  glyph statusChip; owner role → initials avatar + name; row states =
  hover / selected-with-inset-accent-bar / focus ring in app colours;
  responsive column drop (status ~525px, owner ~350px).
- **Tiles view** — new `docsTiles.ts`: Vault card anatomy (thumbnail
  via existing presigned `thumbnailUrlFor`, chip row, name, owner) in
  app card styling; status pill identical to list rows.
- **Empty states**: Vault copy + tinted "Clear all filters" button.
- Accept: sort, filters, view toggle, density all preserve each
  other's state; no row under 36px; extension visible at every width.

### V4 — Document overlay (Vault D4, adapted)

Files: `viewer.ts`, `data.ts`, `docsScreen.ts`, `style.css`

- Overlay geometry per Vault: right-anchored, 26px margins,
  `min(1080px, 100vw − 52px)`, preview + 340px details pane — app
  surface/border/hairline styling.
- **Preview: the cookie-free pipeline stays** (transform/pdf for
  office, tempauth blob for PDF). Fallback = file-type placeholder +
  "Preview unavailable". No embed.aspx, ever.
- **Details pane**: fileTypeChip + status pill, title, library/path,
  **Open PDF + Copy PDF link** (44px — Ben's two actions, unchanged),
  PROPERTIES from exactly the columns ticked *available* in library
  settings (the existing rule), VERSION HISTORY merged in from
  `openDocProperties`; the standalone properties dialog retires once
  parity holds.
- **Action parity**: favourite toggle joins the details pane; the row
  kebab slims to favourite + Open PDF + Copy PDF link (kept — see
  reconciliation); disabled "Request check-out" hint stays for
  working libraries until Phase 4.
- Focus trap, Escape/backdrop close, focus returns to the opening
  row; 44px close. Blob URLs still revoked on close.
- Accept: every current action reachable from the overlay;
  keyboard-only walkthrough passes; DOCX/XLSX/PDF/PNG/DWG preview or
  degrade gracefully.

### V5 — Hardening & verification (Vault D5, trimmed to what I can prove)

- axe on nav / register (both views) / filters / action dropdown /
  overlay — zero criticals.
- Colour-blind sim: status, due, file-type readable from glyph/word
  alone.
- Touch DOM scan ≥44 primary / ≥36 dense, gaps ≥8px.
- Keyboard map: Cmd/Ctrl+K, tree arrows, row Enter/Space, Escape
  cascade popover → overlay, ring everywhere.
- Consistency: accent = site theme, filled/tinted selection semantics,
  kebab convention, statusChip glyph vocabulary shared with the rest
  of the app.
- Tests green + new units: multi-library union merge, filter chain
  AND/OR, action-needed grouping (role-driven), middle-ellipsis,
  status-glyph keyword mapping, count derivation over loaded rows.
- Ben's checks (hosted): counts vs manual SharePoint query; touch
  device tree expand-vs-select; production search filtering.

---

## 3. Decisions (Ben, 2026-08-01)

1. **Multi-library selection: IN.** 2+ ticked libraries route through
   search-mode union; a single ticked library keeps the fast browse
   path.
2. **Action needed: greyed placeholder now, live control held for
   Phase 4** (spec retained in V2 for that build).
3. **Presentation prefs: DATAVERSE** (Ben's call). One new JSON
   column on `ben_ltkuserprefs` (working name `ben_docuijson`)
   holding {libraries, viewMode, density, collapsed}. Cross-device,
   survives browser resets, consistent with favourites/views on the
   same row. Writes are debounced. This makes the design pass a
   schema-changing release: the managed solution must be re-imported
   into production, not just an app push.
4. **Counts: loaded-row counts first** (load speed wins); live
   refiner counts are a later update.
5. **Verification gate after each phase** — each of V0–V5 lands as
   its own commit, Ben verifies before the next begins. Releases cut
   on Ben's "verified — cut a release" at whichever gates he chooses.
