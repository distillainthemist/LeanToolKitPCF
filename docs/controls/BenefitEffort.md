# BenefitEffort (`BenefitEffort`)

A 2×2 prioritisation canvas. Candidate solutions are dragged onto a benefit (y)
× effort (x) field, both normalised 0..1; priority falls out of the quadrants —
quick wins (high benefit, low effort) rise to the top-left. A follow-up action
can be captured against any idea.

- **Schema id:** `ltk/benefiteffort@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "items": [
    { "id": "i_1", "text": "Auto-label reprint", "benefit": 0.8, "effort": 0.2, "priority": true }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `items` | `BenefitEffortItem[]` | The candidate solutions (note: `items`, not "ideas"). |

### BenefitEffortItem

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `text` | string | The label (field name is `text`). Items with empty text are dropped on parse. |
| `benefit` | number | `0..1`, `1` = high benefit — the **y** coordinate. Default `0.5`. |
| `effort` | number | `0..1`, `1` = high effort — the **x** coordinate. Default `0.5`. |
| `priority` | boolean | Flagged as an idea to take forward. |

## actionsOutputJSON

Emitted. A follow-up action taken forward against an idea carries:

- `context.source` = `"benefiteffort"`
- `context.sourceId` = the **item id**

Deleting an idea cancels its open actions.
