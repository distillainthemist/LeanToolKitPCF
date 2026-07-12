# SqdpcCard (`SqdpcCard`)

One month of status ratings per SQDPC dimension, each dimension's days laid out
in the shape of its big letter (S/Q/D/P/C templates; `+` draws a safety cross).
Tap a tile to cycle the configured status codes; long-press raises an action.
Granularity can split each tile into two shifts.

- **Schema id:** `ltk/sqdpc@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "month": "2026-07",
  "ratings": {
    "S|2026-07-01": "good",
    "S|2026-07-02": "issue",
    "D|2026-07-02|N": "good"
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `month` | string | `yyyy-mm`. The month rendered (there is no in-card month nav — the month comes from the document). Defaults to the current month. |
| `ratings` | `Record<string, string>` | Per-tile status. **Key** and **value** formats below. |

**Rating value** — a **status code string**, i.e. the `code` of one of the
configured status codes (e.g. `"good"`, `"issue"`). The code→label/colour/icon
definitions, the dimensions, granularity and subtitles are all supplied by
**inputs/settings**, not stored in the document. Values are kept only when a
non-empty string ≤ 24 chars.

**Rating key** — `"<dimension>|<yyyy-mm-dd>"` at day/weekday granularity; at
two-shift granularity a shift suffix is added: `"<dimension>|<yyyy-mm-dd>|D"`
(day) or `"|N"` (night).

## actionsOutputJSON

Emitted. Actions raised by long-pressing a tile carry:

- `context.source` = `"sqdpc"`
- `context.sourceId` = the rating key — `"<dimension>|<yyyy-mm-dd>"`, or
  `"<dimension>|<yyyy-mm-dd>|D"` / `"|N"` for a shift half.
