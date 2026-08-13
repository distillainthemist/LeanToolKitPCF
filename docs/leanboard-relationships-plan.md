# The relationships tranche — linking, hashtags, audit view (plan v2, 2026-08-13)

Ben's next tranche from the BBA disposition (`bba-dms-gap-analysis.md`),
REVISED per Ben's review of plan v1 (same day):

- **Links live IN SharePoint** — JSON in the existing
  `DMSLinkedDocuments` multiline column, anchored by document GUID,
  with parent / peer / child relationships. No Dataverse link table.
- **Management-system filters: DROPPED** — the existing management
  process column already does this; no new features needed.
- **Audit: NO separate event store** — an audit VIEW over the
  SharePoint version history the properties pane already partially
  shows: who did the step, what the step was, what comments were
  provided.

## L — document linking (JSON in `DMSLinkedDocuments`)

### The shape

One JSON array in the document's own `DMSLinkedDocuments` column:

```json
[{ "uid": "b7c0…", "rel": "parent", "site": "/sites/Corp",
   "listId": "…", "name": "Crane Standard.pdf", "docId": "STD-1035" }]
```

- `uid` = the linked document's uniqueId (GUID) — the ANCHOR. Renames
  don't break it; `name`/`docId` are cached display, refreshed
  opportunistically when the link is painted and the anchor resolves.
- `rel` ∈ parent | peer | child (Ben's set). Corporate↔site: a site
  document declares `parent` → its corporate document.
- `site`+`listId` ride along so the anchor can be resolved and opened
  without guessing which register it lives in.

### Why this shape works (and its honest limits)

- **Writes stay on your own document.** Declaring a parent edits the
  CHILD's column only — the corporate document is untouched, so
  cross-site linking needs no rights on the far side. The write rides
  the EXISTING quick-property-edit bracket (check-out → write →
  minor check-in → moderation publish on reader-facing stages), so
  links behave like any property edit: versioned, publishable, honest.
- **Inbound ("what links here?") is derived, not stored.** Note
  columns cannot be CAML-filtered, so children of a corporate document
  are found by SEARCH (contains its GUID) across registers — correct
  but crawl-lagged (minutes-to-hours). The overlay says so on that
  section ("found by search — recently added links can lag"). No
  double-write mirroring: writing "child" entries onto the far
  document would need far-side edit rights and mint far-side versions;
  declared-one-way + derived-inbound avoids both.
- **Bare SharePoint sees a JSON blob** in the column. Acceptable — the
  register is the interface — and stated. Old plain-text values in the
  column keep rendering as they do today (backward compatible parse:
  JSON array → link cards, anything else → the current text render).

### The build

- model.ts: `parseDocLinks` / `serializeDocLinks` (pure, tested),
  tolerant of hand-edited or legacy content; `rel` inverse readings
  (parent ↔ "parent of this document" / child ↔ …).
- Overlay "Linked documents" section: grouped Parent / Peers /
  Children (declared), each row = name · docId · open action
  (cross-site open = the document's own register when reachable, else
  SharePoint); add-link picker (search across registers — the share
  dialog's search road) with rel choice; unlink. Gated like property
  edits (content-stage editors + controllers).
- The derived "Documents naming this one" list under the declared
  groups, via searchPage contains(uid), with the crawl-lag note.
- Register linkColumns rendering updated for the JSON shape.
- Health: dangling-anchor check (uid resolves nowhere) + rel-cycle
  sanity (A parent of B parent of A) in Document Control Health.

## H — governed hashtags (unchanged from v1)

- Vocabulary in a CLOSED "Hashtags" term set; a multi-value taxonomy
  column mapped to a new `hashtags` dictionary role — tagging, filters
  and browse-by reuse the existing taxonomy machinery unchanged.
- Proposals in Dataverse (`ben_ltktagproposal`: label, note, status,
  proposer, decision, termid) — filed from the tagging editor
  ("Propose a new tag…"), approved by DOCUMENT CONTROLLERS in Settings
  → Documents; approve = `createTerm` (the 5F road) + term-cache
  invalidation; decline = message the proposer (the issues pattern).
- The ampersand/invisible-character guard applies before approval —
  a phone-hostile tag must not be mintable (the U+FF06 lesson).
- Pending report = the queue; usage counts on demand in the same
  settings section.
- The tranche's ONLY schema: one small table → the release after H is
  SCHEMA-CARRYING.

## A — the audit view (a reading of version history, no new store)

What exists: O3's version cards (author, check-in comment, moderation
word, current pill). What the auditor wants: a flat chronological
answer to "who did the step, what was the step, what did they say".

- **The step is derived, not stored**: the app's own acts already
  leave recognisable check-in comments ("Periodic review — no
  changes…", "Properties updated", approve/submit comments) plus
  version shape (major = an approval act, minor + published =
  a property fix, moderation status words). A small pure
  `auditRowsFor(versions)` maps each version to when · who · step ·
  comment. Steps the heuristic cannot name render as "Edit" with the
  comment carrying the detail — honest, never guessed.
- **Forward tightening, no schema**: lifecycle acts that today write
  bare or free-text comments gain CONSISTENT prefixes ("Approved — ",
  "Submitted for review — ", "Reinstated — ") so the trail gets
  sharper from here on. (Old versions keep whatever they say.)
- UI: an "Audit" toggle on the overlay's version history — the same
  data as the cards, presented as the flat table above — plus CSV
  export of the table. Visible to whoever can see version history
  today (it is the same information, differently arranged).

## Phases

- **L1 — link model + overlay section + picker + health** (1.5–2 days;
  app-only)
- **L2 — derived inbound via search** (0.5 day; app-only)
- **H1 — hashtags role, proposals, controllers' queue** (1.5 days;
  SCHEMA-CARRYING: `ben_ltktagproposal` + Ben creates the Hashtags
  term set once per environment and maps the column)
- **A1 — audit view + comment prefixes + CSV** (1 day; app-only)

Order: L1 → A1 → H1 → L2 (A1's comment prefixes want to land early so
the trail sharpens sooner; L2 rides a search index that benefits from
links existing first).

## Open questions for Ben

1. **Who may link?** Recommend: whoever can edit properties on the
   document (content-stage editors + controllers) — linking is
   metadata.
2. **Peer symmetry**: a peer declared on A does not appear on B until
   the search-derived list finds it. Acceptable, or should the picker
   nudge "declare it on both" when the user can edit both?
3. **Hashtag term set**: one tenant-wide set shared by dev and prod
   site collections (like the org set), created by you per environment
   — confirm.
