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

Unrecognised top-level keys from an input blob are preserved verbatim on output
(lossless round-trip). This blob is what each target control reads via its
`settingsJSON` input.

## selectedCardType

`SingleLine.Text`. The chosen card type (the control name), also stamped inside
`outputJSON`. Bind it to the card row's type column.

## Actions channel

Not used.
