# Master Leanboard — design of record

The master leanboard is a **canvas-app board engine** over the LeanToolKit
controls: a configurable grid of cards that runs either a **meeting board**
(a new instance per occurrence) or a **problem-solving / project board** (one
living instance). This page records the reviewed architecture, the data
model, the Power Fx recipes and the phased plan.

Status: **Phases 1–2 done** (data model designed; PCF enhancements shipped in
v0.4.0). Phase 0 spike kit and the Phase 3 build recipe are ready — see
[board-app-build.md](board-app-build.md); the spikes need a run on the
target devices, then the board app is a paste-job from that page.
Related: [Actions in Dataverse](actions-dataverse.md) ·
[Controls reference](controls/README.md)

---

## The core constraint, and the pattern

PCF controls cannot nest other PCF controls, and canvas apps do not allow
code components inside galleries — so a config-driven grid of **live** cards
is not buildable, and pre-placing every card type in every slot (N slots × 21
types of hidden controls) is a load-time and maintenance disaster.

**The pattern: snapshot tiles + one editor screen.**

- **Board screen** — a plain gallery of **Image controls** rendering each
  card's stored snapshot (`pngExport` — see the spike verdict under Tile
  defaults), with the configured title overlaid as a label. Grid size is just `WrapCount`. Empty
  slots render as "＋ add card" tiles in edit mode. A **meeting board** keeps
  a fixed left pane hosting a *live* MeetingScheduler (one fixed control —
  no slot problem).
- **Card editor screen** — one full-screen instance of each card type
  (stacked, one visible), bound to whichever tile was tapped. On save the app
  patches `outputJSON` + fresh `pngExport` back to the card's row; the tile
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
| Instance | Lookup → LTK Board Instance | |
| Card Id | Text (80) | The slot's `cardId` — also the `instanceId` fed to the control (actions stamp themselves with it) |
| Card Type | Text (40) | e.g. `FiveWhys` |
| Output (JSON) | Multiline (1,000,000) | The card document |
| Tile (data URI) | Multiline (500,000) | `pngExport` at last save — the board tile (see the spike verdict under Tile defaults) |

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
| Default Tile (data URI) | Multiline (500,000) | The card's rendered **empty state** (see tile defaults) |
| Solution Version | Text (20) | Which release generated it |

Dual purpose: (1) default tiles for never-opened cards; (2) the palette
source for the board composer, seeded from CardSettings' `catalogJSON`
output so it can never drift from the installed solution version.

### LTK Action — one addition

Add **`ben_boardid`** (Text 80) to the
[actions table](actions-dataverse.md), stamped by the app's upsert. Board
rollups become one delegable filter (see recipes).

---

## The board manifest

Lives in `LTK Board.Manifest (JSON)`; snapshotted onto each instance.

```json
{ "grid": "3x3",
  "slots": [
    { "pos": 1, "cardId": "b-bottling-sqdpc", "cardType": "SqdpcCard",
      "title": "Daily SQDPC",
      "settingsJSON": { "cardType": "SqdpcCard", "title": "Daily SQDPC",
                        "config": { "granularity": "shift2" },
                        "board": { "policy": "carry" } } },
    { "pos": 2, "cardId": "b-bottling-5y", "cardType": "FiveWhys",
      "title": "Top issue",
      "settingsJSON": { "cardType": "FiveWhys", "title": "Top issue",
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
- The **`board` section inside `settingsJSON`** is written by the
  CardSettings composer (see below) and read only by the app at instance
  creation. Controls ignore unknown settings keys, so the same blob feeds the
  card directly.

### Data policies (`settingsJSON.board.policy`)

| Policy | At instance creation |
| --- | --- |
| `clear` | Card row created with empty `outputJSON`; tile falls back to the catalog default |
| `carry` (default) | Copy `outputJSON` + `Tile SVG` from the same card in the **previous instance** |
| `link` | Read the **latest** card row of `board.source.{boardId, cardId}`; feed as `inputJSON`, normally with `readOnly: true` in the slot settings |

ActionBoard / EscalationViewer slots ignore `policy` (they render the actions
table live); `board.source.boardId` overrides *which board's* actions they
roll up — empty means this board.

---

## Tile defaults

A freshly configured board must not be a wall of blank tiles.

**Spike verdict (2026-07-15): tiles are PNG.** 16 of 19 `svgExport` tiles are
`foreignObject`-wrapped HTML, and WebKit renders those **unscaled inside an
`<img>`** — on Safari/iPad the tile shows a zoomed-in corner of the card.
The PNG fallback rendered correctly on the same devices, so tiles ship as
**`pngExport`** (~50–250KB per tile) stored as complete data URIs, directly
bindable with no `EncodeUrl`. EmbedCard's hand-drawn placeholder is pure
vector (no foreignObject) and stays SVG safely.

- **A — generated defaults (baseline):** every control renders a meaningful
  empty state; `node tools/tile-defaults.js` serves the generator that
  captures each card's empty-state `pngExport` and writes
  `tools/tile-defaults.json` (`{generated, format, tiles: {cardType:
  dataUri}}`). Regenerate per release; seed the Card Catalog table from it.
- **C — hand-authored:** EmbedCard / CardSettings / MeetingScheduler have no
  snapshot outputs by design; the generator includes a static placeholder
  for the one that can sit on a board (EmbedCard).
- **B — priming (later, optional):** for settings-accurate empty tiles, the
  app can cycle a new board's slots through the editor-screen host behind a
  "Preparing board…" overlay and harvest real `pngExport` per slot. Nothing
  in A blocks B — a saved/primed tile always wins over the catalog default.

Tile image formula (both values are complete data URIs):

```powerfx
Image = Coalesce(ThisItem.cardRow.ben_tilepng,
    LookUp('LTK Card Catalog', ben_cardtype = ThisItem.cardType).ben_defaulttile)
```

---

## Power Fx recipes

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
      Patch('LTK Card Data', Defaults('LTK Card Data'), {
        ben_instance: inst,
        ben_cardid: Text(S.Value.cardId),
        ben_cardtype: Text(S.Value.cardType),
        ben_outputjson:
          Switch(policy,
            "carry", LookUp('LTK Card Data',
                       ben_instance.'LTK Board Instance' = prev.'LTK Board Instance'
                       && ben_cardid = Text(S.Value.cardId)).ben_outputjson,
            "link",  LookUp('LTK Card Data',
                       ben_cardid = srcCard).ben_outputjson,   // latest via sort/filter as needed
            /* clear */ Blank()),
        ben_tilepng:
          If(policy = "carry",
             LookUp('LTK Card Data',
                    ben_instance.'LTK Board Instance' = prev.'LTK Board Instance'
                    && ben_cardid = Text(S.Value.cardId)).ben_tilepng,
             Blank()) }))))
```

(Adapt lookups to taste — the shape is what matters: one Card Data row per
slot, seeded per policy, snapshot stored on the instance.)

### Card editor save (on the card's `OnChange`)

```powerfx
Patch('LTK Card Data', varCardRow,
      { ben_outputjson: Self.outputJSON, ben_tilepng: Self.pngExport });
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

## PCF enhancements (Phase 2, shipped with this design)

1. **CardSettings — board composer mode.** New optional input
   `boardsManifestJSON` (`[{boardId, name, cards:[{cardId, cardType, title}]}]`
   — all boards, supplied up front; there is no runtime round-trip). When
   non-empty, the form gains a **Board** section that edits
   `settingsJSON.board`: the data policy (`clear` / `carry` / `link`) with
   board + card pickers for `link`; ActionBoard / EscalationViewer get a
   source-board picker only. The `board` section rides inside the same
   settings blob (sparse, lossless), so the slot stores ONE blob.
2. **CardSettings — `catalogJSON` output.** The registry, as JSON
   (`[{type, label, description}]`), for seeding the Card Catalog table and
   the app palette — the palette can never drift from the installed version.
3. **Crew-linked attendees.** `peopleJSON` gains an optional `crew` field
   (`[{whoId, who, crew:"A"}]`). MeetingScheduler gains a `peopleJSON` input
   and an **`attendeesJSON` output**: on selection it emits the people whose
   crew matches the selected instance's on-shift crew, plus everyone without
   a crew (staff who always attend). No roster / no crew on the instance =
   everyone. Bind `MeetingScheduler.attendeesJSON` straight into each card's
   `peopleJSON`.
4. **Tile defaults generator.** `tools/tile-defaults.html` +
   `tools/tile-defaults.json` (see above).

---

## Risks / decisions log

- **Version re-adoption**: the board app hosts every control; each release
  needs re-adopt + republish in that one app. Deliberate release events.
- **Safari SVG tiles — RESOLVED (2026-07-15)**: the Phase 0 spike confirmed
  WebKit renders the 16 `foreignObject`-wrapped SVG tiles **unscaled** inside
  an `<img>` (zoomed-to-a-corner tiles), while the PNG fallback rendered
  correctly. Verdict: tiles are **`pngExport`** everywhere (see Tile
  defaults). Consequence: ~50–250KB per tile per instance — set an instance
  **retention** policy (e.g. clear `ben_tilepng` on instances older than N
  months; the `outputJSON` stays, so a tile can always be re-rendered by
  opening the card).
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
| 0 | Spikes: Safari SVG-in-Image (**done — verdict: PNG tiles**); 21-control editor screen load (in-studio) | **half done** |
| 1 | Tables + manifest schema + Power Fx recipes (this page) | **done — this page** |
| 2 | PCF: CardSettings board mode + catalogJSON; crew attendees; tile defaults | **done — v0.4.0** |
| 3 | Board app: board list → grid screen → editor screen → meeting flow | pending |
| 4 | Project boards + templates | pending |
| 5 | Pilot (monthly ops review) + hardening | pending |
