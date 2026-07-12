# CaptureCard (`CaptureCard`)

A config-driven capture grid. The columns are defined by the `columnsJSON`
**input** — typed text / number / decimal / yes-no / picklist, with
multi-select, option icons, and two-layer dependent picklists. Rows are free
(add/delete) or fixed via `rowsJSON`. The default single-text-column config is
the "simple capture card".

- **Schema id:** `ltk/capture@1`
- **Document:** yes · **Actions:** ✖ · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson).

## outputJSON — `data`

```json
{
  "rows": [
    {
      "id": "row_1",
      "rowKey": "line1",
      "cells": { "station": "fv1", "faults": ["stuck", "foam"], "count": 3, "ok": true }
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `rows` | `CaptureRow[]` | The captured rows. |

### CaptureRow

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `rowKey` | string | Matches a fixed row header's key when rows are fixed; `""` for a free row. |
| `cells` | `Record<columnKey, CellValue>` | Keyed by each column's `key`. |

**`CellValue`** is a 4-way union, chosen by the column's type:

| Column type | Cell value |
| --- | --- |
| text, single picklist | `string` |
| number, decimal | `number` |
| yes-no | `boolean` |
| multi-select picklist | `string[]` |

The **column definitions are not in the output** — they come from the
`columnsJSON` input. The document holds only the captured `rows`. (For the
structured column-builder that produces a `columnsJSON`, see the
[CardSettings](CardSettings.md) capture-columns editor.)

## actionsOutputJSON

**Not emitted.** CaptureCard is document-only, with no actions channel.
