# Master Leanboard — design of record

The master leanboard is a board engine over the LeanToolKit cards: a
configurable grid that runs either a **meeting board** (a new instance per
occurrence) or a **problem-solving / project board** (one living instance).
This page records the reviewed architecture, the data model and the phased
plan.

> **Read this for the data model and the board manifest**, which remain the
> design of record. The board shipped as a **code app**, not a canvas app —
> so the *Power Fx recipes* and *PCF enhancements* sections below are
> historical: they describe canvas wiring and manifest properties that no
> longer exist ([leanboard-pcf-retirement-plan.md](leanboard-pcf-retirement-plan.md)).
> The equivalents live in `app/src` — see
> [code-app-plan.md](code-app-plan.md) and
> [code-app-build.md](code-app-build.md).

Related: [Actions in Dataverse](actions-dataverse.md) ·
[Controls reference](controls/README.md)

---

## The core constraint, and the pattern

PCF controls cannot nest other PCF controls, and canvas apps do not allow
code components inside galleries — so a config-driven grid of **live** cards
is not buildable, and pre-placing every card type in every slot (N slots × 21
types of hidden controls) is a load-time and maintenance disaster.

**The pattern: snapshot tiles + one editor screen.**

- **Board screen** — one **[BoardGrid](controls/BoardGrid.md) control**
  rendering the cards' stored `svgExport` snapshots **inline** (never in an
  `<img>` — see the spike verdict under Tile defaults), with title chips,
  read/edit modes, tap-to-open and drag-to-rearrange built in. Grid size is just `WrapCount`. Empty
  slots render as "＋ add card" tiles in edit mode. A **meeting board** keeps
  a fixed left pane hosting a *live* MeetingScheduler (one fixed control —
  no slot problem).
- **Card editor screen** — one full-screen instance of each card type
  (stacked, one visible), bound to whichever tile was tapped. On save the app
  patches `outputJSON` + fresh `svgExport` back to the card's row; the tile
  updates.

Cost of a future card type: **one control instance on the editor screen +
its CardSettings registry entry** — O(1), not O(slots).

Accepted trade-offs: tiles refresh on save (not keystroke-live), and editing
is one card at a time full-screen — on a meeting TV that is better UX anyway.
EmbedCard has no snapshot (cross-origin iframe); its tile is a static
placeholder that opens the live embed.

---

## Data model (five tables)

Publisher `BenOBrien`, prefix `ben`. The actions table is specified in
[Actions in Dataverse](actions-dataverse.md); it gains one column here.

### LTK Board (`ben_ltkboard`) — config / template, both kinds

| Column | Type | Notes |
| --- | --- | --- |
| Name (primary) | Text (300) | Board name |
| Board Kind | Text (20) | `meeting` \| `project` |
| Site / Department / Team | Text (100) ×3 | Owning org unit |
| Manifest (JSON) | Multiline (100,000) | The slot manifest — see below |
| Occurrence Settings (JSON) | Multiline (10,000) | MeetingScheduler `settingsJSON` (meeting boards) |
| People (JSON) | Multiline (10,000) | `[{whoId, who, crew?}]` — the board's roster |
| Is Template | Yes/No | Templates are copied, never instanced directly |

### LTK Board Instance (`ben_ltkboardinstance`)

| Column | Type | Notes |
| --- | --- | --- |
| Board | Lookup → LTK Board | |
| Name (primary) | Text (300) | e.g. "Monthly ops review — 2026-08-03" |
| When | DateTime (TZ independent) | The occurrence datetime |
| Settings Snapshot (JSON) | Multiline (100,000) | The board manifest **as it was** at creation — protects history from config drift |
| Status | Text (20) | `open` \| `closed` |

A **project board has exactly one instance** — same engine, same write
paths, no parallel schema. A meeting board gets one instance per occurrence.

### LTK Card Data (`ben_ltkcarddata`) — one row per instance × card

| Column | Type | Notes |
| --- | --- | --- |
| Instance | Lookup → LTK Board Instance | **Blank on a `shared` card's live row** |
| Board Id | Text (80) | The board's id — lets a live row (no instance) key by `(boardId, cardId)` |
| Card Id | Text (80) | The slot's `cardId` — also the `instanceId` fed to the control (actions stamp themselves with it) |
| Card Type | Text (40) | e.g. `FiveWhys` |
| Output (JSON) | Multiline (1,000,000) | The card document |
| Tile SVG | Multiline (200,000) | `svgExport` at last save — rendered inline by BoardGrid (a `data:image/png` URI is also accepted per tile, as a fallback) |

A `shared` card has **one live row** (Instance blank, keyed by Board Id +
Card Id) holding the running document, **plus** the normal per-instance
rows — which for shared cards hold only the Tile SVG, stamped at meeting
close. That per-instance SVG trail is the archive: opening a past instance
renders what the card showed when that meeting ended, exactly as `carry`
cards render their historical copies.

One row per card (not one blob per instance) so that: patches are small and
per-card (two people editing different cards never collide), the 1MB
multiline ceiling applies per card not per board, and the `link` policy can
look up a single card's output directly.

### LTK Card Catalog (`ben_ltkcardcatalog`) — one row per card TYPE

| Column | Type | Notes |
| --- | --- | --- |
| Card Type (primary-ish) | Text (40) | Alternate key |
| Label | Text (100) | |
| Description | Text (400) | |
| Default Tile SVG | Multiline (200,000) | The card's rendered **empty state** (see tile defaults) |
| Solution Version | Text (20) | Which release generated it |

**What the app actually reads from this table: `Card Type` + `Default Tile
SVG`, and nothing else** (`catalogSvgByType()` in `app/src/store/catalog.ts`).
That art is the fallback for a card with nothing saved, on the **stored**
rendering path — an archived meeting, or a board switched off live tiles. A
live board renders each card's own empty state instead, and either way a tile
with nothing behind it carries a **NO DATA** badge
([leanboard-live-tiles-plan.md](leanboard-live-tiles-plan.md)).

**The board composer's palette does NOT come from here.** It is built in code
from the CardSettings registry (`buildCatalogJson()`), with no Dataverse round
trip — so it cannot drift from the deployed app, which is stronger than the
"cannot drift from the installed solution version" this page used to claim for
the table. `selfHealCatalog()` still writes Label, Description and Solution
Version, but the app never reads them back; they are there for anyone
inspecting the table in Dataverse.

### LTK Action — one addition

Add **`ben_boardid`** (Text 80) to the
[actions table](actions-dataverse.md), stamped by the app's upsert. Board
rollups become one delegable filter (see recipes).

### LeanHub config — two small tables

| Table | Columns | Notes |
| --- | --- | --- |
| **LTK Site Settings** (`ben_ltksitesettings`) | Site Text (100), Protected Times (JSON) Multiline (10,000) | One row per site; the protected time zones (`[{label, color, days, start, end}]`) fed to LeanHub's calendar and edited from its Settings tab by site admins (`canEditSite`) |
| **LTK User Prefs** (`ben_ltkuserprefs`) | User Lookup → systemuser (or Text whoId), Preferences (JSON) Multiline (4,000) | One row per person; LeanHub's calendar preferences, persisted from `preferencesOutputJSON` |

---

## The board manifest

Lives in `LTK Board.Manifest (JSON)`; snapshotted onto each instance.

```json
{ "grid": "3",
  "columnTitles": ["Perform", "Improve", "Act"],
  "slots": [
    { "pos": 1, "w": 2, "h": 1, "nav": 1,
      "cardId": "b-bottling-sqdpc", "cardType": "SqdpcCard",
      "title": "Daily SQDPC",
      "settingsJSON": { "cardType": "SqdpcCard", "title": "Daily SQDPC",
                        "config": { "granularity": "shift2" },
                        "board": { "policy": "carry" } } },
    { "pos": 2, "nav": 2, "cardId": "b-bottling-5y", "cardType": "FiveWhys",
      "title": "Top issue",
      "settingsJSON": { "cardType": "FiveWhys", "title": "Top issue",
                        "theme": { "titlebar": "#8b1e1e" },
                        "board": { "policy": "clear" } } },
    { "pos": 3, "cardId": "b-bottling-actions", "cardType": "ActionBoard",
      "title": "Actions",
      "settingsJSON": { "cardType": "ActionBoard",
                        "board": { "source": { "boardId": "board-packaging" } } } }
  ] }
```

- `cardId` is minted once when the slot is configured
  (e.g. `<board>-<slug>`), never changes, and is the `instanceId` the card
  runs under — so its actions key themselves correctly with zero extra wiring.
- `nav` is the **meeting navigation order** (distinct from the layout
  `pos`): the editor screen's next/previous buttons walk slots in `nav`
  order, skipping blanks. Set from the number field in each tile's title bar
  in BoardGrid's edit mode; persisted from `layoutJSON`.
- `columnTitles` renders optional headers above the board columns; the
  slot's `theme.titlebar` colours both the card's own title strip and its
  tile chip on the board (`barColor` in the tilesJSON join) — one colour
  across related cards associates them visually.
- The **`board` section inside `settingsJSON`** is written by the
  CardSettings composer (see below) and read only by the app at instance
  creation. Controls ignore unknown settings keys, so the same blob feeds the
  card directly.

### Data policies (`settingsJSON.board.policy`)

The policy is **per card** — every slot's `settingsJSON` carries its own
(the CardSettings section is titled "New meeting instance").

| Policy | At instance creation |
| --- | --- |
| `clear` | Card row created with empty `outputJSON`; tile falls back to the catalog default |
| `carry` (default) | Copy `outputJSON` + `Tile SVG` from the same card in the **previous instance** — a snapshot per meeting |
| `shared` | No copy: every instance reads and writes **one live row** (Instance blank). The per-instance row is created empty and receives only the **Tile SVG at meeting close** — the archive of what each meeting saw. Best for cumulative data that crews hand between them: KPI trends, Paretos |
| `link` | Read the **latest** card row of `board.source.{boardId, cardId}`; feed as `inputJSON`, normally with `readOnly: true` in the slot settings |

"Previous instance" for `carry` means **latest by scheduled datetime**, so
shiftly boards carry deterministically across crews — the chain follows the
meeting, never the crew; date-indexed documents (SQDPC, Winning
Conditions) accumulate every crew's entries in one history.

ActionBoard / EscalationViewer slots ignore `policy` (they render the actions
table live); `board.source.boardId` overrides *which board's* actions they
roll up — empty means this board.

**Series cards** (Conditions, SQDPC, KPI trend, Pareto) also ignore
`policy` for their data: it lives in the **LTK Card Series** table — one
row per `(boardId, cardId, seriesKey, date, shift)` datum, shift
`-`/`D`/`N` — and each meeting reads the window derived from its own
scheduled date (SQDPC: the instance's month; Conditions: the 7 periods
ending on the instance date; KPI trend: the trailing `kpiWindowDays` —
default 91 — ending on the instance date, rows keyed by point id so
per-reading actions stay linked, target/spec/unit staying in the document;
Pareto: daily count rows per category summed over the trailing
`paretoWindowDays` — default 30 — with ＋1 tallies and count edits landing
as deltas on the meeting-day row, definitions staying in the document).
**StatusTile** keeps its document behaviour but additively logs each state
change as a day-grain series row (key `state`, value = the label) for
status-over-time reporting. Legacy documents self-heal into rows on first
open. The card document remains only as the
tile-svg carrier; close-time SVG stamping is unchanged. Legacy documents
self-heal into rows on first open. See
[leanboard-card-series-plan.md](leanboard-card-series-plan.md).

---

## Tile defaults

A freshly configured board must not be a wall of blank tiles.

**Spike verdict (2026-07-15) and its resolution.** 16 of 19 `svgExport`
tiles are `foreignObject`-wrapped HTML, and WebKit renders those **unscaled
inside an `<img>`** — on Safari/iPad the tile shows a zoomed-in corner of
the card (confirmed on device). Rather than paying for PNG tiles
(~50–250KB per card per instance in database capacity), the
**[BoardGrid](controls/BoardGrid.md) control** extracts each snapshot's
HTML content and fits it with a **CSS `transform: scale()`** — WebKit does
not apply svg viewport scaling to foreignObject content even inline, but it
scales CSS transforms correctly. Tiles therefore stay **`svgExport` markup
(~15KB)**; BoardGrid also accepts a `data:image/png` URI per tile, so a PNG
path remains available as a per-card fallback.

- **A — generated defaults (baseline):** every control renders a meaningful
  empty state; the generator captures each card's empty-state `svgExport`
  and writes `tools/tile-defaults.json` (`{generated, format: "svg-markup",
  tiles: {cardType: svg}}`), which `app/src/store/catalog.ts` imports to seed
  the Card Catalog table.

  **Regenerating** (per release, or after any change to a card's empty state
  or styling — the tiles inline each card's CSS, so they freeze at capture
  time):

  ```bash
  cd app && npm run dev
  ```

  Open <http://localhost:5180/tile-defaults.html>, check the rendered grid,
  then press **Write tools/tile-defaults.json**. Then **bump `APP_VERSION` in
  `app/src/store/catalog.ts`** — `selfHealCatalog()` skips catalogs already
  stamped with the current version, so without the bump the new tiles never
  reach Dataverse.

  The page mounts each card's editor class directly and harvests its
  `onSnapshot` markup. Its card list comes from CardSettings' registry, so a
  newly registered type is reported as MISSING rather than silently skipped.
  (It replaced a generator that drove the retired PCF bundles — see
  [leanboard-pcf-retirement-plan.md](leanboard-pcf-retirement-plan.md).)
- **C — hand-authored:** EmbedCard / CardSettings / MeetingScheduler have no
  snapshot outputs by design; the generator includes a static placeholder
  for the one that can sit on a board (EmbedCard).
- **B — priming (later, optional):** for settings-accurate empty tiles, the
  app can cycle a new board's slots through the editor-screen host behind a
  "Preparing board…" overlay and harvest real `svgExport` per slot. Nothing
  in A blocks B — a saved/primed tile always wins over the catalog default.

The default lands in each BoardGrid tile via the `tilesJSON` join:

```powerfx
svg: Coalesce(row.ben_tilesvg,
     LookUp('LTK Card Catalog', ben_cardtype = ThisItem.cardType).ben_defaultsvg)
```

---

## Power Fx recipes  *(historical — canvas era)*

> The code app implements these in `app/src/store`; the recipes below are
> kept for the policy logic they spell out, not as a build path.

### Create a meeting instance (apply the policies)

```powerfx
// varBoard: the LTK Board row; varWhen: occurrence datetime;
// varManifest: ParseJSON(varBoard.ben_manifestjson)
With({ inst: Patch('LTK Board Instances', Defaults('LTK Board Instances'), {
        ben_board: varBoard,
        ben_name: varBoard.ben_name & " — " & Text(varWhen, "yyyy-mm-dd"),
        ben_when: varWhen,
        ben_settingssnapshot: varBoard.ben_manifestjson,
        ben_status: "open" }),
       prev: LookUp('LTK Board Instances',
                    ben_board.'LTK Board' = varBoard.'LTK Board' && ben_status = "closed",
                    // newest first
                    ben_when = Max('LTK Board Instances',
                                   ben_board.'LTK Board' = varBoard.'LTK Board' && ben_status = "closed",
                                   ben_when)) },
  ForAll(Table(varManifest.slots) As S,
    With({ policy: Coalesce(Text(S.Value.settingsJSON.board.policy), "carry"),
           srcBoard: Text(S.Value.settingsJSON.board.source.boardId),
           srcCard:  Text(S.Value.settingsJSON.board.source.cardId) },
      // shared cards keep ONE live row — ensure it exists, never copy into it
      If(policy = "shared" && IsBlank(LookUp('LTK Card Data',
             IsBlank(ben_instance) && ben_boardid = varBoardId
             && ben_cardid = Text(S.Value.cardId))),
         Patch('LTK Card Data', Defaults('LTK Card Data'), {
           ben_boardid: varBoardId,
           ben_cardid: Text(S.Value.cardId),
           ben_cardtype: Text(S.Value.cardType) }));
      Patch('LTK Card Data', Defaults('LTK Card Data'), {
        ben_instance: inst,
        ben_boardid: varBoardId,
        ben_cardid: Text(S.Value.cardId),
        ben_cardtype: Text(S.Value.cardType),
        ben_outputjson:
          Switch(policy,
            "carry", LookUp('LTK Card Data',
                       ben_instance.'LTK Board Instance' = prev.'LTK Board Instance'
                       && ben_cardid = Text(S.Value.cardId)).ben_outputjson,
            "link",  LookUp('LTK Card Data',
                       ben_cardid = srcCard).ben_outputjson,   // latest via sort/filter as needed
            /* clear, shared */ Blank()),
        ben_tilesvg:
          If(policy = "carry",
             LookUp('LTK Card Data',
                    ben_instance.'LTK Board Instance' = prev.'LTK Board Instance'
                    && ben_cardid = Text(S.Value.cardId)).ben_tilesvg,
             Blank()) }))))   // shared: stays blank until stamped at close
```

(Adapt lookups to taste — the shape is what matters: one Card Data row per
slot, seeded per policy, snapshot stored on the instance; shared cards add
a single live row per board that instance creation never touches.)

### Card editor save (on the card's `OnChange`)

```powerfx
Patch('LTK Card Data', varCardRow,
      { ben_outputjson: Self.outputJSON, ben_tilesvg: Self.svgExport });
// actions: recipe 3 of docs/actions-dataverse.md, plus the board stamp:
//   ben_boardid: varBoardId
```

### Actions rollup

```powerfx
// ActionBoard pane / slot: this board unless the slot sources another
Filter('LTK Actions',
       ben_boardid = Coalesce(varSlotSourceBoardId, varBoardId))
```

---

## PCF enhancements  *(historical — canvas era)*

> These describe manifest inputs on the retired PCF wrappers. The
> capabilities themselves live on in the card editors and card settings.

1. **CardSettings — board composer mode.** New optional input
   `boardsManifestJSON` (`[{boardId, name, cards:[{cardId, cardType, title}]}]`
   — all boards, supplied up front; there is no runtime round-trip). When
   non-empty, the form gains a **New meeting instance** section that edits
   `settingsJSON.board`: the per-card data policy (`clear` / `carry` /
   `shared` / `link`) with
   board + card pickers for `link`; ActionBoard / EscalationViewer get a
   source-board picker only. The `board` section rides inside the same
   settings blob (sparse, lossless), so the slot stores ONE blob.
2. **CardSettings — `catalogJSON` output.** The registry, as JSON
   (`[{type, label, description}]`). The code app still uses this function
   directly for its palette; it also seeds the Card Catalog table, but the
   palette is read from the registry, not from the table.
3. **Crew-linked attendees.** `peopleJSON` gains an optional `crew` field
   (`[{whoId, who, crew:"A"}]`). MeetingScheduler gains a `peopleJSON` input
   and an **`attendeesJSON` output**: on selection it emits the people whose
   crew matches the selected instance's on-shift crew, plus everyone without
   a crew (staff who always attend). No roster / no crew on the instance =
   everyone. Bind `MeetingScheduler.attendeesJSON` straight into each card's
   `peopleJSON`.
4. **BoardGrid control (v0.5.0).** The tile wall itself — inline snapshot
   rendering (WebKit-safe), read/edit modes, tap → `selectedSlotJSON`
   (`open` / `configure` / `add`), drag-to-swap → `layoutJSON`. See
   [BoardGrid](controls/BoardGrid.md).
5. **Tile defaults generator.** `tools/tile-defaults.html` +
   `tools/tile-defaults.json` (see above).
6. **MeetingWizard (v0.7.0).** Guided meeting setup: title / purpose /
   owner, hierarchical site → department → area picklists (`orgJSON`),
   cadence, crews + roster, participants with crew linkage, record columns,
   review. Emits a complete MeetingScheduler `settingsJSON` (including the
   **`meeting` section** the scheduler renders as its identity strip) and
   `submittedAt` for the app's create-board flow — recipe §6b of the
   [build kit](board-app-build.md). See
   [MeetingWizard](controls/MeetingWizard.md).
7. **LeanHub (v0.8.0).** The person's home: a Calendar tab projecting every
   meeting's cadence (shared recurrence engine, scoped person / area /
   department / site, protected time zones as coloured bands), an Actions
   tab (the viewer's actions from every source on the standard channel),
   and a Settings tab (preferences + site protected-time editor). Tapping
   an occurrence deep-links the board's scheduler via its new **`selectIso`**
   input. See [LeanHub](controls/LeanHub.md).

---

## Risks / decisions log

- **Version re-adoption**: the board app hosts every control; each release
  needs re-adopt + republish in that one app. Deliberate release events.
- **Safari SVG tiles — RESOLVED (2026-07-16)**: the Phase 0 spike confirmed
  WebKit renders the 16 `foreignObject`-wrapped SVG tiles **unscaled** inside
  an `<img>` (zoomed-to-a-corner tiles, confirmed on device). Resolution: the
  **BoardGrid control** renders tiles inline instead of via Image controls,
  so tiles stay `svgExport` (~15KB) and the interim PNG-tile decision is
  superseded. Storage stays modest (a daily 9-card board ≈ 34MB/yr), and a
  per-tile PNG data-URI fallback remains supported by BoardGrid. Retention
  (clearing old instances' `ben_tilesvg`) is still worthwhile, just far less
  urgent.
- **Instance accumulation**: a daily meeting ≈ 250 instances/yr × cards.
  Decide retention; closed instances should set `readOnly` on their cards.
- **Concurrency**: per-card rows make same-meeting different-card edits safe;
  same-card is last-write-wins — acceptable for a facilitated meeting.
- **Templates**: a template is a Board row with `Is Template = true`;
  "create from template" copies the row, mints fresh `cardId`s
  (`<newboard>-<slug>`), and (project boards) spawns the single instance.

## Phased plan

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Spikes: Safari SVG-in-Image (**done — resolved by BoardGrid, tiles stay SVG**); 22-control editor screen load (in-studio) | **half done** |
| 1 | Tables + manifest schema + Power Fx recipes (this page) | **done — this page** |
| 2 | PCF: CardSettings board mode + catalogJSON; crew attendees; tile defaults | **done — v0.4.0** |
| 3 | Board app: board list → grid screen → editor screen → meeting flow | pending |
| 4 | Project boards + templates | pending |
| 5 | Pilot (monthly ops review) + hardening | pending |
