# BoardGrid (`BoardGrid`)

The **master-leanboard tile wall**: renders each card's stored snapshot in a
configurable grid, and turns taps and drags into outputs the board app acts
on. So tiles stay at SVG size (~15KB) instead of PNG (~50–250KB), snapshots
are never scaled through SVG viewports: WebKit does not apply viewBox
scaling to `foreignObject` content (in `<img>` **and** inline). Instead the
snapshot's HTML content is **extracted and fitted with a CSS
`transform: scale()`**, which WebKit handles correctly; pure-vector SVGs
render inline, and `data:image` URIs go through an `<img>`.
See [master-leanboard.md](../master-leanboard.md).

**Tile anatomy:** the card type as a quiet tag along the top; the snapshot
filling the middle; the **title bar along the bottom** showing the title
only — with the **✎ configure button at its right end in edit mode**.

- **Schema id:** none (display/selection only) · **Document:** ✖ ·
  **Actions:** ✖ · **Snapshots:** ✖ (a board-of-boards image would
  reintroduce the very problem this control avoids)

## Modes

| | Tap a tile | Tap an empty slot | Drag a tile |
| --- | --- | --- | --- |
| **Read mode** (`editMode` false) | emits `action: "open"` — navigate to the card's full-screen editor | — | — |
| **Edit mode** (`editMode` true) | emits `action: "configure"` — open the composer for this slot | emits `action: "add"` with the position | drop on another slot to **swap** positions — emits `layoutJSON` |
| **Read only** | inert wallboard — no taps, no editing | | |

## Inputs

| Input | Notes |
| --- | --- |
| `tilesJSON` | `[{pos, cardId, cardType, title, svg}]` — the board slots joined to their card rows. `svg` is raw `svgExport` markup (rendered inline, sanitised: scripts / event handlers / `javascript:` hrefs stripped) **or** a `data:image/…` URI (rendered as an image — plain PNG data URIs are WebKit-safe). Empty `svg` shows a typed placeholder. |
| `gridSize` | **columns × rows**: `"3x3"`, `"5x5"`, `"2x1"` (2 cols × 1 row), `"3x1"`, `"3x2"` (3 cols × 2 rows)… or a bare column count, or empty for a near-square auto fit. Rows grow so every tile always fits; a tile with a taken/invalid `pos` takes the next free slot. |
| `editMode` | Boolean; also settable via `settingsJSON` `config.editMode`. |
| `readOnly` | Display-only wallboard. |

Plus the standard chrome/styling surface (`cardTitle` — typically the board
name, `prompts` as the empty-board text, theme colours, font,
`settingsJSON`).

## Outputs

### `selectedSlotJSON`

```json
{ "action": "open", "pos": 2, "cardId": "b-bottling-5y",
  "cardType": "FiveWhys", "title": "Top issue",
  "selectedAt": "2026-07-16T05:20:00.000Z" }
```

`action` is `"open"` (read-mode tap), `"configure"` (edit-mode tap on a
filled tile) or `"add"` (edit-mode tap on an empty slot — `cardId` empty,
`pos` set). `selectedAt` changes on every tap so `OnChange` always fires.

### `layoutJSON`

```json
{ "movedAt": "2026-07-16T05:21:00.000Z",
  "slots": [ { "cardId": "b-bottling-actions", "pos": 1 },
             { "cardId": "b-bottling-5y", "pos": 2 } ] }
```

Emitted after a drag rearranges tiles: every filled slot's new position.
Persist into the board manifest in `OnChange`.

## App wiring sketch

```powerfx
BoardGrid.OnChange =
  If(Self.layoutJSON <> varLastLayout,
     Set(varLastLayout, Self.layoutJSON);
     PersistLayout(ParseJSON(Self.layoutJSON).slots),   // patch manifest slot positions
     With({ s: ParseJSON(Self.selectedSlotJSON) },
        Switch(Text(s.action),
           "open",      Set(varSlot, s); Navigate(EditorScreen),
           "configure", Set(varSlot, s); Navigate(ComposerScreen),
           "add",       Set(varSlot, s); Navigate(ComposerScreen))))
```

Full board-app recipes: [board-app-build.md](../board-app-build.md).
