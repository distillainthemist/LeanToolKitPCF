# Initiative documentation links, and the walk on initiative boards (proposal, 2026-10-08)

Ben: "maintain links to documentation associated to an initiative — a
working folder link for an initiative (SharePoint / Teams), plus a
documentation & links card for a meeting or initiative board; and the
focus view with tabs and back / forward exactly as meeting boards have
it, for initiative boards."

## 1. What is there today

- **Header fields.** An initiative carries header fields in
  `ben_fieldsjson` (`fieldValues`): the template's own fields plus the
  app-level STANDARD fields every initiative gets (Settings →
  Improvement → Standard fields). Seventeen kinds exist, among them
  `url`, and the charter card displays a `url` value as a link that
  opens in a new tab. So a "Working folder" field can be added TODAY
  with no code: a standard field of kind url. What that gives is a
  link on the charter card only — the initiative's details pane shows
  key details and health but no header fields, the Improvement list
  and tiles show none, and the field is free text.
- **Board cards about documents and links.** Three exist and none is
  the one asked for: `DocsCard` / `DocHealth` show the Documents
  register's own rows for a pasted register link (one source of
  filter truth — by design not a place for ad-hoc URLs); `LinkCard` is
  a window onto another board's card; `EmbedCard` frames a URL (heavy,
  sign-in prone — the Power BI saga — and not a list).
- **The walk.** `cardEditor` builds the walk (tabs, PREV / NEXT rails,
  "Card n of m", Back to board) only when `!isLive && sequence.length >
  1`. Initiative boards have no occurrences: their cards open on the
  `live` row, so `isLive` is true and every initiative card gets the
  classic toolbar with ‹ Back. The same flag hides the title-bar
  "＋ Action" extra on live rows — meant for template rows, but it
  also hides it on initiative cards.

## 2. The working folder — recommendation

**A first-class standard field, not a new column.**

- Ship "Working folder" as a BUILT-IN standard field (key
  `workingFolder`, kind `url`, seeded into the Improvement settings so
  every site has it; removable there like any standard field). No
  schema change: it lives in `ben_fieldsjson` like every header field.
- Show it where an initiative is looked at, not only on the charter:
  - the initiative details pane's key details — "Working folder ↗"
    opening in a new tab, with "Set folder…" (a `promptText`) when
    empty, for people who may edit the initiative;
  - the Improvement list row and tile — a small folder glyph that is
    the link;
  - the initiative's charter, as now.
- A SharePoint or Teams folder is a URL; nothing here needs a
  connector. Accept `https://` only; show the URL's host and last path
  segment as the display text ("sharepoint.com › Shared Documents ›
  Line 2 changeover") so a long link reads.

Why not a column: the header JSON already carries per-initiative
values, the binding reads and writes it, and a column would make the
next release solution-carrying for one string.

## 3. The Documentation & links card — recommendation

**A new card type, `LinksCard` ("Documentation & links"), whose
document is a curated list of links.**

- **Document.** `{ links: [{ title, url, note?, group? }] }` in the
  card's own `outputJson`, the same road every card uses. No schema.
- **Editor.** Rows of title · URL · note with ⠿ drag order and a ×
  (the card document is draft-saved by the card save loop, so no
  confirmation is needed — Back without saving is the undo). "＋ Add
  link" adds a row; paste a URL and the title defaults to the URL's
  last segment. `https://` only.
- **Display and tile.** A clean list: a host glyph (SharePoint, Teams,
  web — by hostname), the title as a link opening in a new tab, the
  note muted beneath; optional group heads. The tile shows titles
  only, the first six and "+n more". No controls on the tile (the
  `.ltk-tile` rule).
- **On an initiative board**, the card lists the initiative's Working
  folder first, automatically, through the charter binding — one place
  to set it, every surface shows it.
- **On a meeting board**, the card's default data policy is SHARED
  (standing content): the links persist across occurrences, which is
  what a documentation list means; a meeting that needs a one-off
  list can switch the policy as any card can.
- **Not** an extension of the Documents card: that card is the
  register's view and must stay one source of filter truth. The two
  sit side by side — "the controlled documents that apply here" and
  "the working folders and references for this work".

Effort: about a day — the control (editor, display, tile mode), the
settings registration, the binding hook for the working folder, CSS,
tests for the pure parts (URL parsing, display text), a harness page.

## 4. The walk on initiative boards — recommendation

**Engage the same walk for project boards; the only differences are
the title line and the Back target.**

- `walk = sequence.length > 1 && (!isLive || board.kind ===
  "project")`. The sequence is the manifest's nav order, unset cards
  trailing in layout order — the same rule as meetings — regardless
  of the board's Current | All stage filter (the filter is a wall
  view; the walk is the whole initiative).
- The title row shows the initiative's name and its stage pill (from
  the band) where a meeting shows its occurrence and Closed chip; "Card
  n of m", ▶ Present, saved status and "‹ Back to board" are
  identical. Back lands on `#/board/init-…` as today.
- The "＋ Action" title-bar extra is shown on project boards (the
  `!isLive` guard becomes "not a template row"), so an initiative card
  in the walk raises actions like any meeting card. That also fixes
  the quiet gap where initiative cards lack the extra today.
- Nothing else changes: the hold-until-ready hop, the ± 3 tab window
  and the "＋ n more ▾" menu, the phone's stacked rails (M2) all come
  with the walk.

Effort: about half a day, and a phone-friendly one since M2 already
stacks the rails.

## 5. Order

The walk first (half a day, no new concepts); then the working folder
field and its surfaces; then the card. Each its own release.
