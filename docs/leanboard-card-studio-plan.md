# LeanBoard card studio — phased plan

Written 2026-07-26, from Ben's markup of the board editor (Edit meeting →
Meeting board).

## What Ben asked for

1. **Drop the ✎ button** on each tile — clicking the card already means
   "edit/add".
2. **One overlay per card instead of two surfaces.** Today configuration is a
   right-hand pane in the composer and "Edit standard content" is a separate
   screen. Replace both with a large popup: the **live card, directly
   editable, as a big left pane** (that IS setting standard content) and a
   **properties pane** on the right, styled as a proper inspector.
   **Cancel / Save** at the bottom right of the overlay complete the edit.
3. **Card selection**: never change a card's type; **archive** instead of
   remove, so a card can come back later. Adding a card = choose a new card
   **or** re-add an archived one.
4. Propose enhancements that make the whole thing more seamless.

## What the code already gives us (checked, not assumed)

- **Tile tap already configures.** `BoardGrid.renderTile` in edit mode wires
  `makeInteractive(card, { onTap: () => onSelect({action:"configure"}) })`,
  with drag-vs-tap discrimination in the drag helper. Removing ✎ is a
  deletion; no new event plumbing.
- **The overlay pattern exists.** `openStandardContent()` in composer.ts
  already mounts a full-screen overlay on `document.body` hosting the card
  editor bound to the LIVE (standard-content) row — so it survives inside the
  wizard's embedded designer. The studio is that pattern, grown up.
- **`saver()` debounces document saves by 400ms and exposes no flush**
  (`app/src/saver.ts`). Mounters own their saver internally, so a host cannot
  force a write. This is the single biggest constraint on both Cancel and the
  live preview (see Risks).
- **`promptUnsaved()`** ("save" | "discard" | "cancel") already exists for the
  dirty guard; `openDialog()` for the picker.
- Removing a slot today just drops it from `manifest.slots`. The Card Data
  rows, actions and series rows **stay in Dataverse** — invisible and
  unreachable. Archive is therefore mostly a manifest concern: the data is
  already there waiting.

---

## The transaction model (the crux)

Cancel/Save only mean something if BOTH halves of the edit are buffered:

| Edit | Today | In the studio |
| --- | --- | --- |
| Settings | `onChange` → mutate the slot → debounced manifest write | Draft held in memory; the slot is mutated only on **Save** |
| Standard content | card's `saver()` → live Card Data row | `onSave` captured to memory; the row is written only on **Save** |
| Tile svg | offscreen re-render on "Save card" | the left pane's own `onTile` snapshot — already the freshest |

**Save** = apply the draft to the slot → persist the manifest → write the live
row's `outputJson` + `tileSvg` → close.
**Cancel** = drop the buffers; for a **newly added** card, also remove the slot
(nothing was ever committed).

Two things escape a callback buffer and must be handled explicitly:

1. **Series writes.** SQDPC / Conditions / KPI / Pareto call `applySeries()`
   directly from their mounters, and StatusTile logs a state row on change.
   Those bypass `onSave` entirely, so a Cancel could not undo them.
2. **Action upserts** in the card editor screen go straight to the store.

Handled by (a) making series cards **preview-only** in the studio (below) and
(b) a new `designTime: true` flag on `CardMount` meaning *"the host buffers
all persistence — do not write to the store yourself"*, which StatusTile's
series log and any future direct writer must respect. This mirrors the
existing `mountTile` no-write contract, which today is safe only because
tiles are read-only.

### What the left pane is, per card type

"Standard content" is the card's live (instance-less) row — what a new meeting
starts from. Not every card has one, and pretending otherwise is how you get a
Cancel that doesn't cancel.

| Class | Cards | Left pane |
| --- | --- | --- |
| **Editable** | FiveWhys, Fishbone, FaultTree, BenefitEffort, RiskMatrix, Raci, SkillsMatrix, Agenda, Capture, Heatmap, ProcessMap, StatusTile | Live, editable — this IS the standard content |
| **Preview** | SQDPC, Conditions, KPI trend, Pareto | Read-only live render + note: *"This card's data is a dated series — there is nothing to pre-fill; configure it on the right."* |
| **Preview** | ActionBoard, EscalationViewer | Read-only + note: *"Renders the live actions table."* |
| **Preview** | LinkCard | Read-only render of the resolved source |
| **Editable, frame off** | EmbedCard | Commentary notes editable; the iframe is **not** loaded (`embedPreload: false`) — the composer already refuses to fire report loads while designing |

Declared as `CardSpec.standardContent?: "edit" | "preview"` (default `"edit"`)
so it is one testable table, not a condition scattered across the studio.

---

## Phase 0 — Contracts (no visible change)

1. `CardMount.designTime?: boolean` — documented no-direct-writes contract;
   StatusTile's series log respects it.
2. `CardSpec.standardContent` classifier + a test asserting every registered
   card declares (or defaults) sensibly, and that every `seriesBacked` card is
   `"preview"`.
3. Manifest gains **`archivedSlots: ManifestSlot[]`** in
   `parseManifest`/`serializeManifest` (absent = `[]`, round-trip tested).
   A **separate array, not a flag on `slots`**, deliberately: `slots` has many
   consumers (tiles join, seeding, close-archive, board render, editor
   sequence, link/escalation source lists) and a missed filter would silently
   resurrect or re-seed an archived card. A separate array is fail-safe by
   construction — every existing consumer stays correct with no change.

Tests: round-trip with/without `archivedSlots`; classifier coverage.

---

## Phase 1 — The card studio overlay

New `app/src/screens/cardStudio.ts`. Opened with `(boardId, slot, mode)` and
resolving to `"saved" | "cancelled" | "archived"`.

```
┌───────────────────────────────────────────────────────────────┐
│ Problem Pareto  ·  Pareto                            •   ⋮  ✕ │  header
├──────────────────────────────────────┬────────────────────────┤
│ STANDARD CONTENT                     │ PROPERTIES             │
│ what a new meeting starts from       │  Common                │
│                                      │  Configuration         │
│      ( live, editable card )         │  New meeting instance  │
│                                      │  Appearance            │
│                                      │        (scrolls)       │
├──────────────────────────────────────┴────────────────────────┤
│                                        [ Cancel ]  [ Save ]   │  footer
└───────────────────────────────────────────────────────────────┘
```

1. **Layout**: overlay on `document.body` (survives the wizard's embedded
   designer). Left pane flexes; properties fixed ~360px; both scroll
   independently; stacks vertically under ~900px.
2. **Left pane**: `cardMounter(cardType)` mounted directly (not the
   `mountCardEditor` screen — no nav chrome, no walk tabs), with `designTime:
   true`, the pending settings, the app palettes, and the resolved title strip.
   Editable or read-only per the class table. A small band labels it.
3. **Right pane**: `CardSettingsEditor`, minus the picker (type is fixed) and
   minus "Change card type".
4. **Buffers**: `pendingDoc`, `pendingSvg`, `draft`. A dirty dot in the header.
5. **Live feedback**: a settings change re-mounts the left pane with the
   pending settings + buffered document, after a **600ms quiet window** —
   longer than the card saver's 400ms debounce, so in-card edits have landed
   in `pendingDoc` before the re-mount (see Risks).
6. **Footer**: Cancel / Save. Save persists as above and stamps the freshest
   `onTile` snapshot — **deleting `regenerateTile()`'s offscreen 640×420
   re-render and its 8s timeout** from composer.ts.
7. **Guards**: Esc and backdrop click route through `promptUnsaved()` when
   dirty; ⌘/Ctrl+S saves.
8. **Header kebab**: "Archive card" (confirm → archive + close) — board-setup
   mode only.
9. **No action raising**: `designTime` forces `disableActions` for every card
   and the studio passes `actions: []`, so a template cannot accumulate
   actions on the meetings' channel.

Tests: buffer semantics (no store write before Save); cancel-new-card removes
the slot; class table drives editability; save writes manifest + row + svg.
Dev page `app/card-studio.html` mounting the studio per card type.

**Built 2026-07-26** (`app/src/screens/cardStudio.ts`). Two changes the build
forced, both improvements:

- **The panes paint synchronously.** The first cut awaited the roster,
  palettes and live row before rendering anything, which left a blank overlay
  until Dataverse answered — and a dead one if it never did. The studio now
  opens instantly with defaults and upgrades in place as data lands.
- **`standardDoc` is passed in by the caller.** The composer already loads
  every card's document to draw its previews, so re-reading it per open was a
  wasted round trip. When it is not supplied the studio fetches, and the pane
  stays **read-only until it arrives** — an edit typed into a document that
  had not loaded could otherwise be saved over real content.

Proof: `app/card-studio.html` — 12 checks ALL PASS (pane class and its reason
per card, both panes render, nothing persists before Save, Save persists once
and applies the draft, clean Cancel writes nothing, no action affordance on
FiveWhys/RiskMatrix/Agenda, a settings change re-renders the preview), plus
visual confirmation of the side-by-side layout and the <900px stacking.

---

## Phase 2 — Composer integration

1. **Remove ✎** from `BoardGrid.renderTile` (tap already configures). The nav
   number field stays on the tile — it is a fast bulk operation and moving it
   into the studio would mean opening 12 overlays to order 12 cards.
2. Composer's right-hand pane and `openStandardContent()` **both go**; the
   composer becomes grid + toolbar, and `configure` opens the studio.
3. `CardSettingsEditor`: drop "Change card type" and its config-reset branch.
   Type is chosen once, at add time.
4. **Instance-adjust mode** ("adjust board layout for this instance"): the
   studio opens with the left pane **preview-only**, showing that meeting's
   own content, labelled *"This meeting's content — edit it on the board"*;
   Save writes the instance override manifest. Standard content stays a
   board-template concept.
5. Save/refresh: `renderGrid()` after a studio save uses the returned snapshot
   — no re-fetch round trip.

**Done 2026-07-26.** The composer is now grid + toolbar only: the ✎ button,
the settings pane, "Edit standard content", "Save card", "Remove from board"
and the offscreen `regenerateTile()` are all gone, replaced by tap-a-tile →
studio. Layout (moves, resizes, nav order, column headings, column count) is
the only thing it still saves directly — there is nothing to cancel about a
drag. `policyOnPick` moved here, since the composer now mints the slots.

The add flow needed a picker of its own once the settings pane went, so
**`screens/cardPicker.ts`** landed early (it was phase 3 work): an overlay
showing each card's real tile art, grouped and searchable. Its result is a
union — `{kind:"new"}` today — so phase 3 adds `"archived"` and `"copy"`
without touching a call site.

Archive is wired now too (the studio's button moves the slot into
`archivedSlots` and persists). **Restore arrives in phase 3** — until then an
archived card is safely stored but not reachable from the UI.

Dead CSS went with the surfaces it styled: `.app-content-overlay/panel`, the
five `.app-composer-*` pane rules, `.ltk-bg-editbtn`.

Proof: `app/card-studio.html` — 18 checks ALL PASS, including the three that
matter for this phase: no ✎ on the tile, **tapping the tile fires configure**
(now the only path in), and the nav-order field still takes its own clicks
rather than being swallowed by the tap handler.

---

## Phase 3 — Add, archive, duplicate

**Add-card overlay** (from any empty cell's ＋) — three sources:

1. **New card** — the grouped, searchable catalogue, now showing each type's
   **tile art** from `tools/tile-defaults.json` (we generate it for all 20
   types already) instead of a text-only list. Picking a type mints the slot
   and opens the **studio immediately** — add and configure become one flow.
2. **Archived** — this board's `archivedSlots`, each with its stored tile svg,
   title and type; click restores it into the clicked cell (`pos` updated,
   `cardId`/settings/history intact, so its Card Data rows, actions and series
   reconnect automatically). Returns straight to the grid — it is already
   configured.
3. **Copy an existing card** — board picker → card picker, over **every board
   the viewer can see**, this one included.

### Copy / duplicate

Board list from `listBoards()`, filtered by `canViewBoard(...)` with the
current viewer so confidential meetings never leak into the picker, and
excluding archived boards. Card list = that board's `slots` (its own
`archivedSlots` too, greyed, is a possible refinement — not v1).

A copy is an **independent card**: a freshly minted `cardId`, so it shares no
data with its source.

| Copied | Not copied |
| --- | --- |
| `cardType` (never changeable afterwards) | Actions (keyed `board:cardId`) |
| `title` (offered as "X (copy)" when copying within the same board) | Card Series rows (keyed `boardId+cardId`) |
| The whole settings blob — config, prompts, title strip, policy | Instance history / archived tile svgs |
| **Standard content** — the source's live row `outputJson` + `tileSvg`, **if the "Copy its standard content" toggle is on (default on)** | |

The toggle matters because a **shared**-policy source (a risk register, a RACI)
keeps its *running* content in that live row — copying it clones real content
into the new board, which is sometimes exactly what you want (seed a new
site's register from an existing one) and sometimes not. Turning it off copies
the configuration alone.

The picker states the difference from LinkCard in one line, since the two now
sit side by side conceptually: **Copy** makes an independent card that then
goes its own way; **Linked card** mirrors the original, live and read-only.

**Archive** (studio kebab → confirm): move the slot from `slots` to
`archivedSlots`. Nothing is deleted; the board simply stops rendering and
seeding it.

**Permanent delete** from the archived list: confirm, then drop the slot from
`archivedSlots`. Manifest-only — the card's Card Data rows stay in Dataverse
untouched. That is deliberate: those rows include the **per-meeting archived
tile svgs of past meetings**, and deleting them would destroy history to tidy
a list. The confirm says so plainly.

**Discoverability**: the composer toolbar shows "3 archived" when non-empty.

Tests: archive/restore round-trip through parse/serialize; restored card keeps
its cardId; archived slots never reach `joinTiles`, seeding or close-archive;
copy mints a new cardId and carries settings (+ document only when asked);
copy source list respects `canViewBoard`.

### Related finding — past meetings re-render from the CURRENT manifest

Worth deciding while we are here: a closed meeting has no manifest of its own
unless someone adjusted that instance, so it renders from the board's
manifest **as it stands today**. Archiving (or removing) a card therefore
also removes it from every past meeting's board — the tile images survive in
their rows, but nothing displays them.

That contradicts the archive philosophy the live-tiles work established: *a
closed meeting shows what it showed*. The fix is small and fits here —
**`closeInstance()` snapshots the board manifest onto the instance** when it
has no override, freezing each meeting's composition alongside its tile
images. Cost: a few KB per closed instance row. It does not reduce
editability (closed meetings are already immutable).

Recommended, but called out separately because it changes what past meetings
display and is not strictly part of the studio work.

**Done 2026-07-26 — and it stopped being optional.** Phase 3 is what makes
archiving a card easy, so without the snapshot this phase would have shipped
a feature that silently rewrites history. `closeInstance()` now freezes the
board composition onto any instance that has no override of its own
(`archivedSlots` excluded — the archive list is design-time only).

Consequence worth knowing: reopening a closed meeting and adjusting it now
edits that frozen layout rather than re-inheriting the board's current one.
That is the right behaviour for a meeting that has already happened, but it
is a change.

### Phase 3 as built

The picker gained its other two sources behind tabs (Archived only appears
when there is something in it, with a count). Restore puts the slot back
whole — same `cardId`, so its rows, actions and series reconnect — into the
cell that was clicked, and returns straight to the grid. Copy reads its
source on demand (only once a maker actually picks one), mints a fresh
`cardId`, clones the settings, titles a same-board copy "X (copy)", and
opens the studio so the copy is reviewed before it is committed.

That last part needed one addition to the studio: `seedDoc`. A copied
document has never been stored, so it must be written on Save even if the
maker never touches the card — otherwise the copy would arrive empty. The
harness covers both directions: a seeded card writes on an untouched Save, an
unseeded one still writes nothing.

Permanent delete removes the slot from `archivedSlots` only; the confirm says
plainly that the card's saved content — including the images past meetings
archived — stays in the database. The composer's toolbar shows an "N
archived" count, since the archive is otherwise only reachable from inside
＋ Add card.

Proof: `app/card-studio.html` — 26 checks ALL PASS (six new for the picker's
archived/copy sources and delete, two for the seeded-document rule), plus 201
unit tests including the frozen-manifest cases.

---

## Phase 4 — Seamless-UX enhancements (proposed)

Beyond the four asks:

1. **Add → studio in one flow** (above) — no "pick, then find the pane".
2. **Settings change → live preview updates** — today you must press "Save
   card" and then look at the tile to see what a dimension/status-code change
   did.
3. **Save stamps the tile from the live render** — kills the offscreen
   re-render, so saving is visibly faster and cannot time out.
4. **Cancel on a new card removes it** — no half-configured orphans.
5. **Cards explain themselves**: the preview-class notes tell a maker *why*
   there is nothing to pre-fill on a KPI or an Actions card.
6. **No report loads while designing** — embed frames stay unloaded in the
   studio.
7. **Keyboard**: Esc (guarded), ⌘/Ctrl+S.
8. **Duplicate across boards** (Phase 3) turns every existing card into a
   reusable template — a proven SQDPC or Capture grid becomes the starting
   point for the next board instead of being rebuilt field by field.
9. **Picker shows real art**, so a maker recognises the card visually.
10. **Optional** draft stash in `sessionStorage` so a browser crash mid-studio
    doesn't lose a long standard-content edit (see Risks).

---

## Risks / decisions

1. **400ms saver debounce, no flush.** A re-mount triggered by a settings
   change could drop up to 400ms of in-card typing. Mitigated by the 600ms
   quiet window; the residual race is a settings change made *while* typing in
   the card, which is not a real interaction pattern. Alternative if it ever
   bites: add `flush()` to the saver and expose it through the mount teardown.
2. **Buffered saves mean more to lose** if the tab dies mid-edit than today's
   autosave. Accepted for a coherent Cancel; enhancement 10 is the hedge.
3. **Direct store writes** (series, actions) bypass buffering — handled by the
   preview class + `designTime`, and guarded by a test so a future card that
   writes directly cannot quietly break Cancel.
4. **`archivedSlots` as a separate array** rather than a flag, for the
   fail-safe reason in Phase 0.
5. **Wizard-embedded designer** must keep working — the studio is a
   body-level overlay exactly like today's standard-content overlay.

## Decisions (Ben, 2026-07-26)

1. **Archive is board-setup only.** The instance composer keeps a plain
   "Remove from this meeting" — the board template is untouched there, so
   nothing is lost.
2. **Action raising is hidden in the studio.** It is a template, not a
   meeting. Implemented in one place: `actionsOff(opts)` in cardRegistry
   becomes `opts.designTime === true || config(opts).disableActions === true`,
   so every card obeys it, and the studio passes `actions: []`.
3. **Permanent delete is offered** from the archived list (Phase 3).
4. **Duplicate is in scope, and wider than one board**: duplicate a card from
   the current meeting **or any other meeting visible to the viewer on the
   site** (Phase 3).

---

## Phases

- [x] Phase 0 — contracts (designTime, standardContent classifier, archivedSlots) — DONE 2026-07-26
- [x] Phase 1 — the card studio overlay — DONE 2026-07-26 (built + verified in isolation; wired up in phase 2)
- [x] Phase 2 — composer integration — DONE 2026-07-26
- [x] Phase 3 — add / archive / duplicate flow (+ the close-time manifest snapshot) — DONE 2026-07-26
- [ ] Phase 4 — enhancements + polish
- [ ] Phase 5 — docs (master-leanboard.md), release, deploy
