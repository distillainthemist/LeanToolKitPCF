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
22. **Guidance (23, 24)** — Settings → Documents → Guidance: write a
    naming note and a definition for one document type. Save. Add
    document shows the note at the top; picking that type shows its
    definition under the picker. Edit properties shows it too.
23. **Review request confirmation (19)** — On a draft with NO reviewers
    named, Submit for review without adding any: the dialog stays open
    with "Sent for review … nobody was messaged". With reviewers: the
    notify panel offers the Teams message. Details → Version history
    shows the one-line note about drafts.
24. **MOC column (32)** — docs/deployment-cookbook.md Recipe 3; a
    configuration step, nothing to test in the app until the column
    exists.
