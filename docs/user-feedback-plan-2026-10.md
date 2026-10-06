# User feedback round 1 — the plan (2026-10-06)

Source: the Issues export of 2026-10-05 (50 reports, v0.42 → v0.55 builds,
Rio Tinto pilot users). Reviewed with Ben's answers to eight
clarifications. Numbers are the export's section numbers; the Issue ids
are in the export. Everything below is app-only unless marked.

## Ben's decisions (2026-10-06)

- Versions 403 → BOTH: a prod site step (View Versions in the reader
  permission level, deploy-to-new-org.md) AND a quiet fallback in the pane.
- Preview failures (38, 40) → unknown cause; Ben checks a failing file
  for a sensitivity label / protection before any repair.
- Search scope → visible toggle beside the search box, still opt-in.
- Multi-select filters → within a category; hierarchy later.
- Report 2 (package-validation error) → ask Marie what she clicked.
- Tags (13) → Ellen IS a controller: the add genuinely failed; reproduce.
- Mobile → a LIMITED Documents register on a phone: search + basic
  filters + open; not the full desktop register.
- Report 12 (lost view) → treated as fixed by named views; ask Ellen to
  confirm on v0.63+.

## Tranche A — quick wins and clear bugs (first release) — BUILT 2026-10-06, unreleased

Status per item: A1 fallback + site step ✓ · A2 ✓ (the register now
honours a chosen column order; the dictionary orders only the
defaults — this reverses the 2026-08-04 "dictionary orders" rule for
views that carry their own order) · A3 ✓ (date-only prefill from the
site's midnight; the access-request "granted" date too) · A4 ✓
("Download as PDF" / "Download original" in the pane's ⋯, fetched to a
blob so the name holds; a refused fetch opens the URL instead) · A5 ✓
(every scroll offset restored after the overlay closes) · A6 ✓ (the
toggle beside the search box, in step with the scope menu) · A7 ✓
(the nav entry toggles off; a ☆ column on every row for signed-in
people) · A8 ✓ (roles resolved per library) · A9 ✓ (the real fault:
the tags editor was a SINGLE select on a multi-value column — it
replaced every tag and prefilled only the first; now chips + an adder,
every term written) · A10 ✓ (type and status rows inside their
sections, the id chip stays; a "Details ›" button in the head).
Hosted checks: the version history line on prod, a tag added beside
existing ones, the PDF download's name, the scroll after closing a
preview, the health report's review dates on the library that failed.

| # | Report | Fix |
|---|---|---|
| A1 | 29, 40, 41 | Version history: when the versions call is refused, one quiet line ("Version history needs View Versions on this site") instead of the JSON; plus the prod site step in deploy-to-new-org.md. |
| A2 | 21 | Column chooser: Apply keeps the dragged order. |
| A3 | 6 | Superseded / modified timestamps render in the viewer's local day, not UTC. |
| A4 | 7 | PDF rendition download carries the document's name. |
| A5 | 16 | Closing the preview restores the register's scroll position. |
| A6 | 3, 5, 37 | "Match contents & every field" as a labelled toggle beside the search box (the scope menu keeps it too). |
| A7 | 4, 25, 42 | Favourites: the nav entry toggles off; a ☆ on each row (and in the details header) favourites in one click. |
| A8 | 11 | Health report: resolve the review column per library so a dated document is never "no next review date". |
| A9 | 13 | Reproduce the controller's failed tag add on dev; fix what it finds (likely the proposal road wrongly engaged for a controller). |
| A10 | 15, 39 | Details pane: a stronger "Details" affordance; the type and status chips move under Categorisation; section order follows the filter order. |

## Tranche B — register features

| # | Report | Fix |
|---|---|---|
| B1 | 9, 14, 36 | Multi-select within a filter category (status, document type, importance…); the chip reads "Status · 2". Hierarchy (parent term includes children) logged, not built. |
| B2 | 1 | Sort by column header (date, type, owner) on the register. |
| B3 | 8 | Favourite star as an optional column. |
| B4 | 26, 27 | Views: edit and save an existing view; the current view's name shown on the register head. |
| B5 | 49 | Hide / show the left panel. |
| B6 | 17, 46 | Owner / relationship visibility: an Owner filter and "documents by owner" CSV; linked / tagged documents reachable from a filter. |
| B7 | 44 | Default columns per site: confirm the column manager already answers it (Organisation, Document Type, Standard); document how. |

## Tranche C — governance and roles

| # | Report | Fix |
|---|---|---|
| C1 | 30, 33 | Roles health: owners / reviewers not on the roles lists or no longer in the directory, as health-report findings; bulk find-and-replace of a person across documents (controller-only). |
| C2 | 31 | Reviewer picker searches the roster, controllers included. |
| C3 | 28, 45 | Tag management in settings (site-specific tag sets); controllers mint a small set directly, everyone else proposes. |
| C4 | 23, 24 | Document-type definitions shown in the type picker; a naming-convention note on upload (text per site in settings). |
| C5 | 19 | Reviewer request: a confirmation in place and the same Teams message the owner request sends; version history explains "each save is a draft". |
| C6 | 32 | MOC record / link as a configured column (SharePoint column + column manager) — configuration, with a cookbook recipe. |

## Tranche D — mobile (its own release)

| # | Report | Fix |
|---|---|---|
| D1 | 43, 20 | A phone layout for the Documents register: search box, the basic filters (status, type, organisation), a single-column list, open in the viewer / new tab; folders and the full column set stay desktop. The hub already fits. |

## Configuration, not code (Ben / controllers)

- 34 department order: Settings → Organisation already orders departments by drag.
- 35 stale Carbon folders, 47 missing process area: term store / org sync.
- 20 missing Documents tab on the phone: that site's hub-tab setting.
- 22 links inside documents: practice guidance for eLearning.

## Declined or waiting

- 2 (package validation error): asked Marie what she clicked; the message is Power Apps' own.
- 10 (QR → "no app to open"): the phone needs an Office app for a .docx link; the kiosk page itself is fine. Note in the kiosk text.
- 12 (lost view): treated as fixed by named views; Ellen to confirm.
- 18 (old version downloads, current opens): expected; reply in the thread.
- 38, 40 (preview fails): waiting on Ben's check of a failing file.
- 48 (translation): strategy question, parked.
- 50 (area-level folders): logged for the hierarchy tranche with B1's parent-term work.

## Order of work

A (one release, roughly two days) → B1, B2, B4 → C1, C2, C3 → D → the rest
of B and C as capacity allows. Each tranche: fix, update the threads of
the reports it closes (status + a line to the reporter), release.
