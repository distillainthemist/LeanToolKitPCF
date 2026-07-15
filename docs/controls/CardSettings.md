# CardSettings (`CardSettings`)

A settings **composer** for the other toolkit cards. Pick a card type (or load an
existing `settingsJSON` to edit), fill in common, theme and card-specific
configuration with typed fields, and emit a complete `settingsJSON` — stamped
with `cardType` — ready to store against the card's row. It is a form: no
snapshot outputs, no actions.

- **Schema id:** none — it composes *other* cards' settings ·
  **Document channel:** `inputJSON` → `outputJSON` · **Actions:** ✖

The blob it edits rides the standard document channel: an existing blob comes in
on `inputJSON` (edit mode; empty = compose new), and the composed blob goes out
on `outputJSON`. It deliberately has **no `settingsJSON` input of its own** — the
name would mislead, since it composes settings *for other cards*.

## outputJSON — the composed settings blob

Sparse: only the keys the maker actually set are emitted, so a stored blob keeps
inheriting future control defaults. Returns `""` when nothing is set.

```json
{
  "cardType": "SqdpcCard",
  "title": "Daily SQDPC board",
  "prompts": ["What made today hard?"],
  "readOnly": true,
  "theme": { "background": "#fffdf7", "accent": "#a02832" },
  "config": {
    "granularity": "shift2",
    "dimensions": "S,Q,D,P,C",
    "statusCodes": [{ "code": "good", "label": "Good", "color": "#2e7d32", "icon": "✓" }]
  }
}
```

| Key | Type | Notes |
| --- | --- | --- |
| `cardType` | string? | The target control name (e.g. `SqdpcCard`). Omitted when unset. |
| `title` | string? | Trimmed; omitted when blank. |
| `prompts` | string \| string[] \| `{field,hint}[]`? | Coaching prompts. Omitted when empty. |
| `readOnly` | `true`? | Emitted only when true. |
| `theme` | object? | Only the non-blank keys of `{ background, foreground, accent, legend, font }`, plus any preserved unknown theme keys. Omitted if empty. |
| `config` | object? | Per-card keys, named after that card's own settings/inputs (e.g. `granularity`, `dimensions`, `columnsJSON`). Only "set" values; omitted if empty. |
| `board` | object? | Board-composer mode only (see below): `{ policy, source: { boardId, cardId } }`. Read by the **board app** at instance creation; the cards themselves ignore it. |

Unrecognised top-level keys from an input blob are preserved verbatim on output
(lossless round-trip) — including a `board` key when the composer is used
outside board mode. This blob is what each target control reads via its
`settingsJSON` input.

## Board-composer mode (`boardsManifestJSON`)

Supplying the **Boards Manifest (JSON)** input —
`[{boardId, name, cards:[{cardId, cardType, title}]}]`, all boards up front,
no runtime round-trip — adds a **Board** section to the form that edits the
blob's `board` key (see the
[master leanboard design](../master-leanboard.md)):

- **Capture cards** get the new-instance **data policy**: default/carry,
  `clear`, `carry`, or `link` — `link` adds source **board** and **card**
  pickers fed from the manifest.
- **ActionBoard / EscalationViewer** have no document to seed, so they get a
  rollup **source board** picker instead (`empty = the board this card sits
  on`), emitted as `board.source.boardId` with no policy.

Leave the input empty when composing a standalone card — the section
disappears, and any existing `board` key still round-trips untouched.

## selectedCardType

`SingleLine.Text`. The chosen card type (the control name), also stamped inside
`outputJSON`. Bind it to the card row's type column.

## catalogJSON

Read-only output: the card registry of the **installed solution version**, as
`[{type, label, description, actionCapable}]`. Seed the board app's palette
and the LTK Card Catalog table from it so neither can drift from the solution
(pairs with `tools/tile-defaults.json` for the default tile SVGs).

## Actions channel

Not used.
