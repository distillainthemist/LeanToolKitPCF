# Board app — build kit (Phase 3)

The screen-by-screen recipe for building the master-leanboard canvas app.
Architecture and data model: [master-leanboard.md](master-leanboard.md).
Everything here is paste-ready Power Fx; adapt logical names to taste.

Phase 0 spikes:

1. **Tile format — RESOLVED (v0.5.0): tiles are `svgExport`, rendered by
   BoardGrid.** WebKit renders `foreignObject` SVGs unscaled inside an
   `<img>` (confirmed on device — and inline too), so the grid is not a
   gallery of Image controls — it is the
   **[BoardGrid](controls/BoardGrid.md) control**, which extracts each
   snapshot's HTML and fits it with a CSS transform, which WebKit scales
   correctly. Tiles stay ~15KB.
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

## 3a. Home screen — LeanHub

The app's landing screen: one **LeanHub** control `cmpHub`.

| Property | Binding |
| --- | --- |
| `meetingsJSON` | `JSON(ForAll(Filter('LTK Boards', ben_boardkind = "meeting") As B, { boardId: Text(B.ben_boardid), settingsJSON: B.ben_occurrencesettings }), JSONFormat.Compact)` |
| `protectedTimesJSON` | `LookUp('LTK Site Settings', ben_site = varMySite).ben_protectedtimes` |
| `actionsInputJSON` | the viewer's rollup — `JSON(Filter('LTK Actions', ben_assigneeids contains varMyWhoId), …)` reassembled per [actions-dataverse.md](actions-dataverse.md) |
| `actionSourcesJSON` | `JSON(ForAll(colSlots As S, { instanceId: S.cardId, label: S.boardName & " · " & S.title }), JSONFormat.Compact)` |
| `orgJSON` | `varOrgTree` — the same site/department/area tree bound to MeetingWizard (§6b) |
| `peopleJSON` / `viewerId` | the org roster; the signed-in person's whoId |
| `preferencesJSON` | `LookUp('LTK User Prefs', ben_user = varMyWhoId).ben_preferences` |
| `canEditSite` | the viewer's site-admin flag |

`OnChange` — calendar taps navigate (deep-linking the scheduler), edits
persist:

```powerfx
With({ sel: ParseJSON(Self.selectedMeetingJSON) },
  If(Text(sel.selectedAt) <> varLastHubSel && Text(sel.selectedAt) <> "",
     Set(varLastHubSel, Text(sel.selectedAt));
     Set(varBoard, LookUp('LTK Boards', ben_boardid = Text(sel.boardId)));
     Set(varManifest, ParseJSON(varBoard.ben_manifestjson));
     Set(varSelectIso, Text(sel.iso));         // → the scheduler's selectIso
     Navigate(BoardScreen)));
If(Self.actionsOutputJSON <> varLastHubActions,
   Set(varLastHubActions, Self.actionsOutputJSON);
   UpsertActions(Self.actionsOutputJSON));     // recipe 3, actions-dataverse.md
If(Self.preferencesOutputJSON <> varLastHubPrefs,
   Set(varLastHubPrefs, Self.preferencesOutputJSON);
   Patch('LTK User Prefs',
       Coalesce(LookUp('LTK User Prefs', ben_user = varMyWhoId),
                Defaults('LTK User Prefs')),
       { ben_user: varMyWhoId, ben_preferences: Self.preferencesOutputJSON }));
If(Self.protectedTimesOutputJSON <> varLastHubZones,
   Set(varLastHubZones, Self.protectedTimesOutputJSON);
   Patch('LTK Site Settings',
       LookUp('LTK Site Settings', ben_site = varMySite),
       { ben_protectedtimes: Self.protectedTimesOutputJSON }))
```

On the board screen, clear `varSelectIso` after the scheduler consumes it
(`Set(varSelectIso, "")` in `OnVisible` after a short timer, or on leaving
the screen) so the same meeting can be deep-linked again later.

## 4. Board screen

Layout: a fixed **left pane** (meeting boards only) + the **tile grid**.

### Left pane — MeetingScheduler (meeting boards)

| Property | Binding |
| --- | --- |
| `settingsJSON` | `varBoard.ben_occurrencesettings` |
| `selectIso` | `varSelectIso` — set by the LeanHub calendar (§3a); the scheduler lands with that instance selected |
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
| `gridSize` | `Text(varManifest.grid)` — the column count, e.g. `"3"` (rows derive from the tiles) |
| `columnTitles` | `Text(varManifest.columnTitles)` — optional JSON array / CSV of column headers |
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
          w: Coalesce(Value(S.Value.w), 1),
          h: Coalesce(Value(S.Value.h), 1),
          nav: Coalesce(Value(S.Value.nav), 0),
          barColor: Coalesce(Text(S.Value.settingsJSON.theme.titlebar), ""),
          cardId: Text(S.Value.cardId),
          cardType: Text(S.Value.cardType),
          title: Text(S.Value.title),
          svg: Coalesce(row.ben_tilesvg,
               // shared cards: current instance shows the LIVE document's
               // tile until the archive svg is stamped at close
               LookUp('LTK Card Datas',
                      IsBlank(ben_instance) && ben_boardid = varBoardId
                      && ben_cardid = Text(S.Value.cardId)).ben_tilesvg,
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
              columnTitles: ParseJSON(Self.layoutJSON).columnTitles,
              slots: ForAll(Table(varManifest.slots) As S,
                  With({ moved: LookUp(Table(ParseJSON(Self.layoutJSON).slots),
                             Text(Value.cardId) = Text(S.Value.cardId)).Value },
                      Patch(S.Value, { pos: moved.pos, w: moved.w, h: moved.h,
                                       nav: moved.nav }))) },
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
   instance's row), `shared` (blank row; the live document is a separate
   instance-less row, created once), `link` (latest row of `board.source`).
3. Sets `varInstance` to the new row.

**Close meeting** button — close the instance AND stamp the SVG archive
for shared cards (freeze what this meeting saw):

```powerfx
Patch('LTK Board Instances', varInstance, { ben_status: "closed" });
ForAll(Filter(colSlots, policy = "shared") As S,
    Patch('LTK Card Datas',
        LookUp('LTK Card Datas',
            ben_instance.'LTK Board Instance' = varInstance.'LTK Board Instance'
            && ben_cardid = S.cardId),
        { ben_tilesvg: LookUp('LTK Card Datas',
              IsBlank(ben_instance) && ben_boardid = varBoardId
              && ben_cardid = S.cardId).ben_tilesvg }))
```

With `varClosed` feeding every card's `readOnly`, a closed meeting becomes
view-only automatically.

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

## 6b. New meeting — MeetingWizard

One **MeetingWizard** control `cmpWizard` on its own screen:

| Property | Binding |
| --- | --- |
| `inputJSON` | empty for a new meeting, or `varBoard.ben_occurrencesettings` to re-edit one |
| `peopleJSON` | the tenant/site roster (`JSON(colRoster)`) |
| `orgJSON` | `varOrgTree` — `[{site, departments:[{department, areas:[…]}]}]`, from a table or a static formula |
| `resetTrigger` | `varWizardReset` (set on entry) |

`OnChange` — the Create meeting press creates the board row, seeds its
roster from the wizard's participants, and opens it:

```powerfx
If(Self.submittedAt <> varLastSubmit && Self.submittedAt <> "",
   Set(varLastSubmit, Self.submittedAt);
   With({ blob: ParseJSON(Self.outputJSON) },
       Set(varBoard, Patch('LTK Boards', Defaults('LTK Boards'), {
           ben_name: Text(blob.title),
           ben_boardkind: "meeting",
           ben_occurrencesettings: Self.outputJSON,        // the scheduler card reads this
           ben_peoplejson: JSON(Table(blob.meeting.participants), JSONFormat.Compact),
           ben_manifestjson: JSON({ grid: "3", slots: [] }, JSONFormat.Compact) })));
   Set(varManifest, ParseJSON(varBoard.ben_manifestjson));
   Navigate(BoardScreen))
```

The new board opens with an empty grid — compose its cards in BoardGrid's
edit mode (§4/§6). Re-editing the meeting later: bind `inputJSON` to the
stored `ben_occurrencesettings` — keys the wizard does not manage (theme,
per-card `board` policies on other slots, prompts) ride through untouched.

## 7. Editor screen

All 21 card controls stacked full-screen (BoardGrid stays on the board screen), exactly one visible:

```powerfx
cmpFiveWhys.Visible = varSlot.cardType = "FiveWhys"   // …and so on per control
```

Common bindings (per control):

| Property | Binding |
| --- | --- |
| `inputJSON` | `varSlot.rowRef.ben_outputjson` — for a **shared** slot, `rowRef` is the card's **live row** (`IsBlank(ben_instance) && ben_boardid && ben_cardid`), not the instance row; resolve it when the slot is selected |
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

### Meeting flow — next / previous card

Each manifest slot's `nav` (set from the tile's number field in BoardGrid's
edit mode) is the running order, distinct from the layout `pos`. Slots with
`nav` 0/blank are skipped. Two buttons on the editor screen walk the flow,
wrapping at the ends:

```powerfx
// btnNextCard.OnSelect — btnPrevCard is the mirror image (Last / nav < …)
With({ flow: SortByColumns(Filter(colSlots, nav > 0), "nav", SortOrder.Ascending) },
    Set(varSlot,
        Coalesce(LookUp(flow, nav > varSlot.nav),   // first slot later in the flow
                 First(flow))))                     // wrap to the start
```

(Bindings all key off `varSlot`, so setting it is the whole navigation —
the visible card switches via the per-control `Visible` rules. Disable or
hide the buttons when `CountRows(Filter(colSlots, nav > 0)) < 2`.)

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
