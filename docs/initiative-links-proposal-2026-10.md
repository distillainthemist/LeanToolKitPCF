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

### 3.1 Clarification — the working folder on the card (Ben, 2026-10-08)

- **Primary link.** With a working folder set, the card's first entry
  is that folder, visually distinct (folder glyph, "Working folder",
  host › path as the text, new tab). It comes from the initiative
  header through the binding and is not edited in the card; changing
  it on the initiative changes it everywhere. Without one, the card
  shows "No working folder set" and "Set folder…" for editors.
- **Folder contents — phase two, SharePoint-backed folders only.** The
  card can list a folder's files (name, modified, a link each;
  read-only, fetched after the tile paints and cached, as the
  Documents cards do) through the SharePoint connector passthrough
  reached by dynamic import, the Documents cards' road. A Teams
  channel's files folder is a SharePoint library underneath and lists
  the same way; a `teams.microsoft.com/l/…` deep link is not a path
  and cannot; a folder the viewer cannot open shows "You don't have
  access to this folder". Sharing-style `/:f:/r/` links must be
  resolved to a path first — the fiddly part. An opt-in toggle on the
  card ("Show folder contents") keeps a card on a busy wall short by
  default. Nothing is ever written back.
- **Manual links — always.** The curated list sits under the primary
  link; the card is useful with a working folder, without, or both.

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

### 4.1 Status — the walk BUILT 2026-10-08

`cardEditor.ts`: `templateRow = isLive && board.kind !== "project"`;
the walk engages on any board with more than one card that is not a
template row; the title line carries the initiative's stage pill
(loaded lazily from the initiative's snapshot, PDCA-toned); the
"＋ Action" extra follows the same rule, so initiative cards raise
actions in the walk. On dev, unreleased; Ben's check: open an
initiative card, see the tabs and rails, hop with NEXT, Back to board.

### 2.1 / 3.2 Status — the working folder and the card BUILT 2026-10-08

- **Working folder** (`app/src/improvement/workingFolder.ts`, pure +
  tested): `BUILTIN_STANDARD_FIELDS` in `templateModel.ts` seeds the
  field (key `workingFolder`, kind url) on every read of the
  Improvement settings; it is never written back, and a site's removal
  is remembered in `hiddenBuiltins` with a "Restore the built-in…" link
  in Settings → Improvement → Standard fields. Surfaces: the initiative
  pane's key details ("Folder" row — the link as host › path, "Set
  folder…" / "Change…" through `promptText` for the initiative's people
  while it is active); a 📁 glyph on the Improvement list row and tile
  that opens the folder without opening the initiative; the charter as
  before; Edit details as any standard field.
- **Documentation & links** (`controls/LinksCard/`, registered as
  `LinksCard`, group Reference, default policy shared): document
  `{ links: [{ id, title, url, note, group }] }` (https only, tolerant
  parse, tested); read mode = grouped list with a service glyph
  (SharePoint / OneDrive / Teams / web), the title as a new-tab link,
  the note and a host › path line; no edit mode (Ben, 2026-10-08: the
  first edit row rendered squashed — the × was row-locked without a
  column, so the grid placed it before the inputs — and "just have the
  add link button permanently available"): "＋ Add link" sits under
  the list whenever the card is open and the viewer may edit, each row
  offers Edit and ⠿, and the form (url first — a pasted URL titles
  itself — title, note, group; Add / Save, Cancel, Remove; Enter and
  Esc) replaces the row inline and lands only on Add / Save; the tile =
  titles only, six then "+n more". On an initiative board the mounter pins the working folder
  from the charter binding (`field:workingFolder`) with "Set folder…"
  for those who may edit it — one place to set it. Harness
  `app/harness/links.html`. The 📁 shortcut on the Improvement list
  and tiles was built and then removed the same day (Ben: the folder
  belongs on the pane and the card, not the main tabs).
- **Folder contents — BUILT 2026-10-08 for path-carrying links.** The
  open card (never a tile) offers "Show contents ▾" on the pinned
  folder and on any link that `folderTarget` resolves to a SharePoint
  folder path: a library path, a Forms/AllItems.aspx?id= or
  onedrive.aspx?id= view link, a "/:f:/r/<path>" sharing link, a
  OneDrive personal-site path. `app/src/improvement/folderContents.ts`
  lists folders then files (name, link, modified) through SharePoint
  REST on the SharePoint connector as the viewer, reached by dynamic
  import of `docs/sp` (the import gate's sanctioned door); no access
  reads as "You don't have access to this folder". A "/:f:/g/<token>"
  share (OneDrive's default "Copy link") carries no path: it opens, but
  it cannot be listed — the card shows ⓘ with the way round: open the
  link, paste the folder's address from the address bar (…id=…). The
  limit was WEB-VERIFIED (2026-10-08): SharePoint REST has no supported
  way to resolve a user-pasted sharing link (Microsoft points at Graph
  `/shares`); the Office 365 Groups connector's HTTP action reaches
  only `/groups` and the Office 365 Users connector's only `/me` and
  `/users/…`, so none of the app's connectors reach `/shares`. Lifting
  it would mean the "HTTP with Microsoft Entra ID" connector — a new
  connector reference and a DLP conversation, not a code change.

## 5. Order

The walk first (half a day, no new concepts); then the working folder
field and its surfaces; then the card with the primary link and the
manual list; then folder contents as its own step once the card has
been used. Each its own release.
