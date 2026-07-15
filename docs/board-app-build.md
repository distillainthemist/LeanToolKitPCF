# Board app — build kit (Phase 3)

The screen-by-screen recipe for building the master-leanboard canvas app.
Architecture and data model: [master-leanboard.md](master-leanboard.md).
Everything here is paste-ready Power Fx; adapt logical names to taste.

Phase 0 spikes:

1. **Tile format — RESOLVED (v0.5.0): tiles are `svgExport`, rendered by
   BoardGrid.** WebKit renders `foreignObject` SVGs unscaled inside an
   `<img>` (confirmed on device), so the grid is not a gallery of Image
   controls — it is the **[BoardGrid](controls/BoardGrid.md) control**,
   which renders the SVG markup inline where WebKit scales it correctly.
   Tiles stay ~15KB.
2. **Editor screen load** — an empty test app with all 22 controls on one
   screen, `Visible` switched by a variable. If load is unacceptable, split
   the editor into 2–3 screens by card family; nothing else changes.

## 0. Prerequisites

- Import **LeanToolKit v0.5.0+**.
- Create the five tables from the
  [design page](master-leanboard.md#data-model-five-tables): LTK Board,
  LTK Board Instance, LTK Card Data, LTK Card Catalog, and add
  `ben_boardid` to LTK Actions.
- Add all 22 code components to the app (Insert → Get more components →
  Code).

## 1. Seed the Card Catalog

One-time (and after each solution upgrade). On a hidden admin screen, place
a **CardSettings** control (`cmpCatalog`) and a button:

```powerfx
// Button.OnSelect — upsert one catalog row per card type
ForAll(
    Table(ParseJSON(cmpCatalog.catalogJSON)) As C,
    Patch('LTK Card Catalogs',
        Coalesce(LookUp('LTK Card Catalogs', ben_cardtype = Text(C.Value.type)),
                 Defaults('LTK Card Catalogs')),
        { ben_cardtype: Text(C.Value.type),
          ben_label: Text(C.Value.label),
          ben_description: Text(C.Value.description) }))
```

Default tile SVGs come from `tools/tile-defaults.json` — paste each card's
`tiles.<Type>` svg markup into its row's `ben_defaultsvg` (or bulk-load with
a Power Automate flow reading the JSON file). Stamp `ben_solutionversion`.

## 2. App.OnStart

```powerfx
Set(varMe, User());
// the boards manifest fed to the composer: every board + its cards
Set(varBoardsManifest,
    JSON(ForAll(Filter('LTK Boards', ben_istemplate <> true) As B,
        { boardId: Text(B.'LTK Board'), name: B.ben_name,
          cards: ForAll(Table(ParseJSON(Coalesce(B.ben_manifestjson, "{}")).slots) As S,
              { cardId: Text(S.Value.cardId),
                cardType: Text(S.Value.cardType),
                title: Text(S.Value.title) }) }),
        JSONFormat.Compact))
```

## 3. Boards screen

A vertical gallery of `Filter('LTK Boards', ben_istemplate <> true)` —
name, kind, site/department/team. `OnSelect`:

```powerfx
Set(varBoard, ThisItem);
Set(varManifest, ParseJSON(Coalesce(varBoard.ben_manifestjson, "{""slots"":[]}")));
Set(varBoardId, Text(varBoard.'LTK Board'));
If(varBoard.ben_boardkind = "project",
   // project boards: exactly one living instance — open (or create) it
   Set(varInstance, LookUp('LTK Board Instances', ben_board.'LTK Board' = varBoard.'LTK Board'));
   If(IsBlank(varInstance), CreateInstance(varBoard, Now())); // see §5
   Navigate(BoardScreen),
   Navigate(BoardScreen))
```

## 4. Board screen

Layout: a fixed **left pane** (meeting boards only) + the **tile grid**.

### Left pane — MeetingScheduler (meeting boards)

| Property | Binding |
| --- | --- |
| `settingsJSON` | `varBoard.ben_occurrencesettings` |
| `peopleJSON` | `varBoard.ben_peoplejson` |
| `existingMeetingsJSON` | `JSON(ForAll(Filter('LTK Board Instances', ben_board.'LTK Board' = varBoard.'LTK Board') As I, { date: Text(I.ben_when, "yyyy-mm-dd hh:mm"), recordId: Text(I.'LTK Board Instance') }), JSONFormat.Compact)` |
| `Visible` | `varBoard.ben_boardkind = "meeting"` |

`OnChange` — open the tapped instance, creating it (with data policies) when
it has no record yet:

```powerfx
With({ sel: ParseJSON(Self.selectedMeetingJSON) },
    If(Text(sel.recordId) <> "",
        Set(varInstance, LookUp('LTK Board Instances',
            'LTK Board Instance' = GUID(Text(sel.recordId)))),
        CreateInstance(varBoard, DateTimeValue(Text(sel.iso))));  // §5
    Set(varAttendees, Self.attendeesJSON);
    Set(varClosed, varInstance.ben_status = "closed"));
```

Bind every card's `peopleJSON` to
`Coalesce(varAttendees, varBoard.ben_peoplejson)` — attendees when an
instance is selected, the whole roster otherwise.

### The tile grid — one BoardGrid control

| Property | Binding |
| --- | --- |
| `tilesJSON` | the join below |
| `gridSize` | `Text(varManifest.grid)` (e.g. `"3x3"`) |
| `editMode` | `varEditMode` (board owners' toggle) |
| `readOnly` | `false` (or `true` for a wallboard screen) |
| `cardTitle` | `varBoard.ben_name` |

```powerfx
// tilesJSON — one entry per manifest slot, joined to its Card Data row;
// the catalog default fills tiles that have never been saved
BoardGrid.tilesJSON =
JSON(ForAll(Table(varManifest.slots) As S,
    With({ row: LookUp('LTK Card Datas',
                ben_instance.'LTK Board Instance' = varInstance.'LTK Board Instance'
                && ben_cardid = Text(S.Value.cardId)) },
        { pos: Value(S.Value.pos),
          cardId: Text(S.Value.cardId),
          cardType: Text(S.Value.cardType),
          title: Text(S.Value.title),
          svg: Coalesce(row.ben_tilesvg,
               LookUp('LTK Card Catalogs',
                      ben_cardtype = Text(S.Value.cardType)).ben_defaultsvg) })),
    JSONFormat.Compact)
```

`OnChange` — taps navigate, drags persist:

```powerfx
If(Self.layoutJSON <> varLastLayout,
   // a drag rearranged the tiles: write the new positions into the manifest
   Set(varLastLayout, Self.layoutJSON);
   Patch('LTK Boards', varBoard, { ben_manifestjson:
       JSON({ grid: Text(varManifest.grid),
              slots: ForAll(Table(varManifest.slots) As S,
                  Patch(S.Value, { pos:
                      LookUp(Table(ParseJSON(Self.layoutJSON).slots),
                             Text(Value.cardId) = Text(S.Value.cardId)).Value.pos })) },
            JSONFormat.Compact) });
   Set(varBoard, LookUp('LTK Boards', 'LTK Board' = varBoard.'LTK Board'));
   Set(varManifest, ParseJSON(varBoard.ben_manifestjson)),
   // otherwise a tap: open / configure / add
   With({ s: ParseJSON(Self.selectedSlotJSON) },
      Set(varSlot, LookUp(colSlots, cardId = Text(s.cardId)));  // your slot lookup
      Switch(Text(s.action),
         "open",      Navigate(EditorScreen),
         "configure", Navigate(ComposerScreen),
         "add",       Set(varSlotPos, Value(s.pos)); Navigate(ComposerScreen))))
```

## 5. Creating an instance — the data policies

Wrap the design page's
[instance-creation recipe](master-leanboard.md#create-a-meeting-instance-apply-the-policies)
in a reusable way (canvas: a hidden button `btnCreateInstance` whose
`OnSelect` runs it against `varBoard`/`varWhen`, or inline it). It:

1. Patches the **LTK Board Instance** (settings snapshot, `open`).
2. For each slot, creates its **LTK Card Data** row seeded per
   `settingsJSON.board.policy` — `clear` (blank), `carry` (previous
   instance's row), `link` (latest row of `board.source`).
3. Sets `varInstance` to the new row.

**Close meeting** button: `Patch('LTK Board Instances', varInstance,
{ ben_status: "closed" })` — with `varClosed` feeding every card's
`readOnly`, a closed meeting becomes view-only automatically.

## 6. Composer screen (board layout edit)

One **CardSettings** control `cmpComposer`:

| Property | Binding |
| --- | --- |
| `inputJSON` | `varSlot.settings` (empty for a new slot) |
| `boardsManifestJSON` | `varBoardsManifest` |
| `resetTrigger` | `varComposerReset` |

Save button — write the slot back into the board manifest, minting a
`cardId` for a new slot:

```powerfx
With({ newCardId: If(IsBlank(varSlot.cardId) || varSlot.cardId = "",
                     varBoardId & "-" & Lower(cmpComposer.selectedCardType) & "-" & Text(RandBetween(1000,9999)),
                     varSlot.cardId),
       blob: ParseJSON(cmpComposer.outputJSON) },
    Patch('LTK Boards', varBoard, { ben_manifestjson:
        JSON({ grid: Text(varManifest.grid),
               slots: ForAll(Table(varManifest.slots) As S,
                   If(Text(S.Value.cardId) = newCardId,
                      { pos: Value(S.Value.pos), cardId: newCardId,
                        cardType: cmpComposer.selectedCardType,
                        title: Text(blob.title),
                        settingsJSON: blob },
                      S.Value)) },   // append instead when it's a NEW slot
             JSONFormat.Compact) }));
Set(varBoard, LookUp('LTK Boards', 'LTK Board' = varBoard.'LTK Board'));
Set(varManifest, ParseJSON(varBoard.ben_manifestjson));
```

(For a brand-new slot, `Patch` the manifest with the slot **appended** —
`Table(varManifest.slots)` plus the new record; shown merged above for
brevity.)

## 7. Editor screen

All 21 card controls stacked full-screen (BoardGrid stays on the board screen), exactly one visible:

```powerfx
cmpFiveWhys.Visible = varSlot.cardType = "FiveWhys"   // …and so on per control
```

Common bindings (per control):

| Property | Binding |
| --- | --- |
| `inputJSON` | `varSlot.rowRef.ben_outputjson` |
| `settingsJSON` | `varSlot.settings` |
| `instanceId` | `varSlot.cardId` |
| `peopleJSON` | `Coalesce(varAttendees, varBoard.ben_peoplejson)` |
| `actionsInputJSON` | `JSON(Filter('LTK Actions', ben_instanceid = varSlot.cardId), …)` — reassembled per [actions-dataverse.md](actions-dataverse.md) recipe 4 |
| `readOnly` | `varClosed \|\| ParseJSON(varSlot.settings).readOnly = true` |
| `resetTrigger` | `varEditorReset` (set on entry: `Set(varEditorReset, Text(Now()))`) |

`OnChange` (document channel):

```powerfx
Patch('LTK Card Datas', varSlot.rowRef,
    { ben_outputjson: Self.outputJSON, ben_tilesvg: Self.svgExport })
```

`OnChange` (actions channel): recipe 3 of
[actions-dataverse.md](actions-dataverse.md) **plus** `ben_boardid:
Coalesce(Text(ParseJSON(varSlot.settings).board.source.boardId), varBoardId)`.

The EmbedCard slot binds `embedUrl` etc. from its settings and skips the
save patch (no outputs). ActionBoard/EscalationViewer slots bind
`actionsInputJSON` to the **board rollup**:

```powerfx
Filter('LTK Actions',
    ben_boardid = Coalesce(Text(ParseJSON(varSlot.settings).board.source.boardId), varBoardId))
```

## 8. Templates & project boards (Phase 4)

"Create from template": copy the Board row, re-mint every slot's `cardId`
(`<newBoardId>-<suffix>`), clear `ben_istemplate`, and for project boards
immediately `CreateInstance` once. The board screen then works unchanged —
a project board is a meeting board whose instance never rotates.

## Build order that works

1. Tables + catalog seed (§0–1) — verify tiles render from defaults alone.
2. Boards + Board screens read-only (§3–4) — a board of default tiles.
3. Editor screen for **two** card types (§7) — prove the save/tile loop.
4. Instance creation with policies (§5) — prove carry/clear/link.
5. Composer (§6), remaining 19 card bindings, meeting close, polish.
