# Feedback round 1 — test script (Tranches A–C, dev build of 2026-10-06)

Close and reopen the player first. Use a superadmin account for the
Settings steps and a second, ordinary account where a step says so.
Reports in brackets are the export's section numbers.

## Tranche A

1. **Version history refused (29, 40, 41)** — Documents, open a document
   as a reader whose permission level lacks View Versions (prod), or
   temporarily remove View Versions from a test level. Details pane →
   Version history reads one line: "needs the View Versions
   permission on this site". No JSON.
2. **Column order (21)** — Register ⋮ → Choose columns. Drag Owner above
   Approval Date, Apply. The register shows the columns in that order.
   Reset to default returns the dictionary order.
3. **Date a day out (6)** — As an Australian-zone user, open Edit
   properties on a document with an Effective or Review date. The
   prefilled date matches what the pane shows (not the day before).
4. **Download name (7)** — Open a .docx. Details ⋯ → "Download as PDF":
   the file saves as `<document name>.pdf`. (The original-file download
   was dropped on 2026-10-06 — nobody asked for it.)
5. **Scroll position (16)** — Scroll the register well down, open a
   document, close the preview. You are where you were.
6. **Search scope (3, 5, 37)** — Beside the search box: the "Match
   contents & every field" toggle. Tick it, search a word that is only
   inside a document; it appears. The scope menu's item shows the same
   state.
7. **Favourites (4, 25, 42)** — Click ☆ on a row: it fills. Click the
   Favourites nav entry: the starred documents show. Click the entry
   again: back to the libraries.
8. **Health report review dates (11)** — Register ⋮ → Document control
   health, on the library that previously listed dated documents under
   "No next review date". They are gone from that finding.
9. **Tags editor (13)** — Edit properties on a document that already has
   a tag. The Tags field shows the existing tag as a chip; "＋ Add a
   tag…" adds a second; ✕ removes one. Save. Both tags remain on the
   document.
10. **Details pane (15, 39)** — Open a document with the pane collapsed:
    a "Details ›" button sits in the head. Open it: the document type
    reads inside Categorisation and the status inside Status; the id
    chip stays at the top.

## Tranche B

11. **Several terms per filter (9, 14, 36)** — Filters → Status: tick
    Approved AND Awaiting approval. The chip reads "Status: Approved,
    Awaiting approval" and the list shows both. Untick one.
    **Approved by default (Ben, 2026-10-06)**: the register OPENS with
    "Approval status: Approved" as a visible chip; × on it shows every
    status; the kebab's "Show only Approved" is gone. A saved view or
    link opens exactly as it was saved.
12. **Sort by any header (1)** — Click the Owner or Document Type
    header. Rows reorder; while more pages remain the status line says
    "sorted by Owner within the loaded documents". Click Document or
    Modified: a server sort, no note.
13. **Named view (26, 27)** — Register ⋮ → Views: save "Test view". The
    head shows "View · Test view". Change a filter, open Views again:
    "Update ‘Test view’ with the current view". Open the view from the
    menu later: the change is there. × on the chip drops the name.
14. **Hide the panel (49)** — "« Hide panel" at the top of the left
    panel. A slim rail labelled "Libraries & folders" brings it back.
    Reload: the choice is remembered.
15. **People and Has filters (17, 46)** — Filters → Owner: search
    people (the group lists first, then Office 365 users), pick one.
    Only their documents show; the chip reads "Owner: <name>". Filters → Has → Linked documents / Tags. Register
    ⋮ → Export CSV with the owner filter on: the file is their list.
16. **Default columns (44)** — Settings → Documents → Document columns:
    ★ a column for the standard type. A new user's register (or Reset
    to default) shows it.

## Tranche C

17. **Roles health (30, 33)** — Register ⋮ → Document control health.
    After the first paint two findings may appear: "Named owner or
    approver is not in the owners & approvers group" and "Named person
    is no longer in the directory". Open one: each row names the
    person and role. A failed lookup shows as "Not checked: …".
18. **Replace a person (33, 46)** — In the same report, "Replace a
    person…". Pick someone from the list, search the group for the
    replacement, leave all roles ticked: the preview counts the
    documents. Replace. Each row reports ✓ or the refusal. Open one
    document: the new name is in the role; version history shows a
    minor version "Role reassigned". Try an approved document on the
    moderated library: it stays published.
19. **Reviewers from anyone (31)** — Edit properties → Reviewers, or
    Submit for review → add reviewers: the group's people list first;
    typing two letters of a controller's name finds them from the
    directory. Owner and Approvers still search the group only.
20. **Tags in settings (28, 45)** — Settings → Documents → Tags: the
    tags in use as chips. ＋ Add tag "Test tag": it appears. Click a chip
    to rename it; a document carrying it shows the new name.
21. **Controller mints a tag (13, 45)** — As a document controller, Edit
    properties → Tags → "Add a new tag…" → type a name → Add tag. The
    tag lands on the document at once. As an ordinary user the same
    control reads "Propose a new tag…".
22. **Guidance (23, 24)** — REMOVED before release (Ben, 2026-10-06):
    to be clarified with Holly first. Nothing to test.
23. **Review request confirmation (19)** — On a draft with NO reviewers
    named, Submit for review without adding any: the dialog stays open
    with "Sent for review … nobody was messaged". With reviewers: the
    notify panel offers the Teams message. Details → Version history
    shows the one-line note about drafts.
24. **MOC column (32)** — docs/deployment-cookbook.md Recipe 3; a
    configuration step, nothing to test in the app until the column
    exists.

## Walkthrough outcome (Ben, 2026-10-06, dev build 01541e6)

| Item | Result |
|---|---|
| A1 versions 403 | End-user testing (prod reader without View Versions) |
| A2 column order | Good |
| A3 date a day out | End-user testing (Australian-zone user) |
| A4 download name | Good — "Download original" dropped (nobody asked for it) |
| A5 scroll position | Good |
| A6 search scope toggle | Good |
| A7 favourites | Good |
| A8 health review dates | End-user testing (the pilot library) |
| A9 tags editor | End-user testing (Ellen) |
| A10 details pane | Good |
| B1 several terms per filter | Good — and the register now OPENS with a visible "Approval status: Approved" filter; the kebab toggle is gone |
| B2 sort by header | Good |
| B4 named views | Good after two changes: a saved view is the active one at once; its name is the TITLE (scope in the crumb, "Close" in the Views menu) |
| B5 hide the panel | Good |
| B6 people / Has filters | Good after three changes: people filters are a directory search (group first); chips use the dictionary labels; Export CSV follows every filter (it never had) |
| B6 follow-up | Tags (and any big term set) are searched in the Filters popover |
| B7 default columns | End-user testing (Christelle) |
| C1 roles health | Good |
| C1 replace a person | Good — controllers only, confirmed |
| C2 reviewers from anyone | Good |
| C3 tags in settings | Good |
| C3 controller mints | End-user testing (needs a non-controller account) |
| C4 guidance | REMOVED pending clarification with Holly |
| C5 review confirmation | End-user testing |
| C6 MOC recipe | Configuration — nothing to test |

## Phone pass — v0.66.0 (2026-10-07)

On a phone, in the Power Apps mobile app AND a phone browser; close
and reopen the player first. Each line is one screen.

1. **The frame** — the bar shows ⚑ ⚙ ＋ as squares and nothing is cut
   off; the tab strip scrolls sideways to Actions and Documents and the
   open tab is in view when you land.
2. **My day / Actions** — action rows are two lines (title in full,
   then with · due · flags); the Actions head stacks with the add field
   full width and the state chips in one scrolling row; a tick closes
   a part.
3. **Documents** — the register is search, Library / Organisation /
   Type / Status selects, chips, a one-column list with titles wrapping;
   a row opens the viewer full-screen with Details › and Open in new
   tab ↗ reachable. (Report 20's reporter: is the Documents tab there?)
4. **A ritual board** — tiles as a full-width list in reading order,
   live cards readable; Details opens the sheet, picking an occurrence
   closes it; a tile opens the card with PREV above and NEXT below.
5. **Priorities** — the select strip, the vision band, the walk inline;
   swipe or the rails step objectives; a row opens the overlay; ＋
   Priority and the ⋮ share link work.
6. **An initiative** — the stacked band and cards; Details from the
   sheet button; the actions card shows its list with the one-line
   note; the Improvement tab lists initiatives as tiles.
7. **Cadence** — opens in Day view, one full-width column; ‹ Today ›
   step days; picking Week sticks for the session.
8. **Settings** — My profile has no desktop note; a changed Site shows
   a save bar whose buttons sit on their own line; Users opens on the
   add card, a directory search adds someone, Edit ▾ opens their
   controls; the other tabs say "best on a desktop".
9. **Settings on a desktop** — Documents, Priorities, Site cadence,
   Branding and My profile show the section strip under the tabs; it
   sticks while scrolling, the pill follows the section, a click lands
   its heading under the strip; Branding carries Ritual categories.

| Item | Outcome |
|---|---|
| 1–9 | _Ben's pass pending_ |

## Settings and poster pass — v0.67.0 (2026-10-08)

On a desktop.

1. **Documents settings** — the section strip under the tabs (ten
   pills over two rows), sticky while scrolling, the pill following
   the section; a click lands its heading under the strip; each
   section is a white card on the tinted ground.
2. **Site cadence** — the three pills and "Site: Mine ▾" on one row;
   three cards below; clicking into Time zone holds focus; switching
   the site repaints the cards.
3. **Priorities settings** (super admin) — two pills, two cards; as a
   site admin the tab is absent.
4. **Improvement settings** — Initiative templates first with its note
   under the heading; Methods, Standard fields and Health-check
   questions follow.
5. **Organisation** — a site card shows Hub tabs and Cascade
   customisation; changing the level saves without a bar.
6. **Branding** — Ritual categories under the palettes; a swatch
   change saves; a ritual still shows its colour.
7. **Users** — type a name not on the roster, use "Search directory &
   add" (or the empty-result link), add someone with a site and
   department, and see them in the list already placed.
8. **Rituals** — one row of search, filters and the blue ＋ New ritual.
9. **Request admin** (as a user) — the super admins listed with mail
   links.
10. **Priorities tab** — ⋮ → Download PDF version on the Mine view:
    one A3 page, the org chain in the title, the rail labels, wrapped
    heads, rounded cards, the export date, no page count.

| Item | Outcome |
|---|---|
| 1–10 | _Ben's pass pending_ |

## Document ingestion pass — after v0.68.0 (2026-10-08, dev)

Needs the ingestion library set up (document-ingestion-proposal §8).

1. **Hidden library** — the register, phone selects, filters, views
   and exports never list the ingestion library.
2. **New task** — the register's ⋮ → New ingestion task… (controllers only):
   name, destination, two assignees, a default or two; the folder
   appears in the library; assignees get a Teams card.
3. **Document tasks** — the task lists for assignees and controllers;
   the badge counts it; the row opens the task sheet.
4. **Files** — Open folder ↗, drop three files; the sheet lists them
   with the destination's columns and a Ready pill naming what is
   missing.
5. **Details** — a row opens Edit properties with the effective date
   editable; select two rows → Set for selected… writes one column;
   Fill blanks from defaults fills the rest.
6. **Run** — Run ingestion… names the counts; files move into the
   destination as approved 1.0 with the check-in comment naming the
   task; a file with a missing detail stays with its reason; a name
   already in the destination is refused; when the folder empties the
   task closes and the folder is gone; the log reads on the closed task.

| Item | Outcome |
|---|---|
| 1–6 | _Ben's pass pending_ |

## Initiative links pass — after v0.67.0 (2026-10-08)

1. **Settings → Improvement → Standard fields** — "Working folder"
   (url) leads the list; remove it, see "Restore the built-in…", restore.
2. **An initiative's pane** — a "Folder" row with "Set folder…"; paste
   a SharePoint folder link; the row shows host › path and opens it in
   a new tab; the Improvement list row and tile show 📁.
3. **An initiative board** — add the "Documentation & links" card
   (Reference); it opens with the working folder pinned and "Change…";
   "＋ Add link" (always under the list), paste a URL, Add; Edit on a
   row, change the title, Save; the tile shows titles only.
4. **A meeting board** — the same card as standing content; its links
   hold across occurrences.
5. **The walk** — open any card on an initiative board: tabs, PREV /
   NEXT, "Card n of m", the stage pill, "＋ Action" in the title bar,
   Back to board.
6. **Template chip** — every Improvement row and tile shows a tinted
   "Template · Method" chip beside the title (the method alone when the
   template was deleted); hover gives both in full.
7. **Working folder button** — with a folder set, the initiative
   board's control row (left of Current stage / All stages) shows
   "📁 Working folder", which opens the folder in a new tab; no button
   without a folder.
8. **Edit details** — six groups (About · Organisation · Priorities &
   people · Details · Metrics · Rules) in a narrower modal, no Period;
   "Also shown in" folded under Organisation (open when it has
   entries); short fields two to a row; Save with an empty required
   field names the group and lands the cursor on it. New initiative's
   second step is the same form.
9. **Folder contents** — on the links card, a working folder given as
   a SharePoint folder address (…/Shared Documents/… or …?id=…) shows
   "Show contents ▾" and lists its folders and files; a OneDrive
   "/:f:/g/" share shows ⓘ and no list; the Improvement list and tiles
   show no folder shortcut.

| Item | Outcome |
|---|---|
| 1–9 | _Ben's pass pending_ |
