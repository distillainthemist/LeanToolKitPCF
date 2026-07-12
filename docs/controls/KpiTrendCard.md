# KpiTrendCard (`KpiTrendCard`)

A run chart of dated values with an optional target (a reference goal line) and
optional specification limits (USL/LSL). A reading is flagged red only when it
falls outside the spec limits.

- **Schema id:** `ltk/kpitrend@1`
- **Document:** yes · **Actions:** ✖ · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson).

## outputJSON — `data`

```json
{
  "points": [
    { "date": "2026-07-01", "value": 96.2 },
    { "date": "2026-07-02", "value": 94.8 }
  ],
  "target": 95,
  "usl": 100,
  "lsl": 90,
  "unit": "%"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `points` | `{ date, value }[]` | `date` is `yyyy-mm-dd`, `value` is a number. Only valid dated numeric points are kept; the array is **sorted ascending by date**. |
| `target` | number \| null | The reference goal line. |
| `usl` | number \| null | Upper specification limit. |
| `lsl` | number \| null | Lower specification limit. |
| `unit` | string | Unit label for the readout. |

**Legacy aliases:** on input, `ucl` maps to `usl` and `lcl` maps to `lsl`.
Output always uses the canonical `usl` / `lsl` names.

## actionsOutputJSON

**Not emitted.** KpiTrendCard is document-only, with no actions channel.
