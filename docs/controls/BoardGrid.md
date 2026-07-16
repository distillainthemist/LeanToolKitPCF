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

**Tile anatomy:** a **title bar along the top** showing the title only (the
card type appears only as a fallback for untitled cards), with the **✎
configure button at its right end in edit mode**; the snapshot filling the
rest. The bar takes the tile's `barColor` (auto-contrast text) so related
cards can share a colour, and shows the tile's **nav order** — a quiet
numbered tag in read mode, an **editable number field in edit mode**. Edit
mode also adds a **⤡ resize handle at the bottom-right corner** — drag it
to stretch the tile across multiple cells.

- **Schema id:** none (display/selection only) · **Document:** ✖ ·
  **Actions:** ✖ · **Snapshots:** ✖ (a board-of-boards image would
  reintroduce the very problem this control avoids)

## Modes

| | Tap a tile | Tap an empty cell | Drag a tile | Drag the ⤡ handle |
| --- | --- | --- | --- | --- |
| **Read mode** (`editMode` false) | emits `action: "open"` — navigate to the card's full-screen editor | — | — | — |
| **Edit mode** (`editMode` true) | emits `action: "configure"` — open the composer for this slot | emits `action: "add"` with the position | drop on a free cell to **move**, on another tile to **swap** — emits `layoutJSON` | stretch the tile to the cell under the pointer — emits `layoutJSON` |
| **Read only** | inert wallboard — no taps, no editing | | | |

Edit mode also keeps a **spare blank row** at the bottom whenever the final
row has no free cell, so there is always somewhere to add or drop a card.
The spare row disappears outside edit mode — rows are derived from the
content, never stored.

## Inputs

| Input | Notes |
| --- | --- |
| `tilesJSON` | `[{pos, cardId, cardType, title, svg, w, h, barColor, nav}]` — the board slots joined to their card rows. `svg` is raw `svgExport` markup (rendered inline, sanitised: scripts / event handlers / `javascript:` hrefs stripped) **or** a `data:image/…` URI (rendered as an image — plain PNG data URIs are WebKit-safe). Empty `svg` shows a typed placeholder. `w`/`h` are optional column/row **spans** (default 1) for stretched cards. `barColor` fills the tile's title chip (typically the card's `theme.titlebar` — one colour across related cards). `nav` is the optional **meeting navigation order** (1-based, distinct from `pos`; 0/absent = not in the flow). |
| `columnTitles` | Optional headers rendered above the board columns: a JSON array of strings or a comma-separated list, one per column (e.g. `["Perform","Improve","Act"]`). Empty entries leave a column unheaded; empty input hides the row. |
| `gridSize` | the **number of columns, 1–6** (e.g. `"3"`), or empty for a near-square auto fit. Rows are never specified — they grow to fit the tiles. `pos` is the tile's anchor cell (1-based, row-major); a tile whose anchor is taken, or whose span no longer fits, scans forward to the first free area. Legacy `"CxR"` values still parse (the column count is used, the row count ignored). |
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
  "slots": [ { "cardId": "b-bottling-actions", "pos": 1, "w": 2, "h": 1, "nav": 4 },
             { "cardId": "b-bottling-5y", "pos": 3, "w": 1, "h": 1, "nav": 2 } ] }
```

Emitted after a drag moves, swaps or resizes a tile, **or a tile's nav
order is edited**: every tile's resolved anchor position, span and
navigation order. Persist into the board manifest in `OnChange`. The nav
order drives next/previous-card navigation on the editor screen when
running a meeting (see the board-app recipe).

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
