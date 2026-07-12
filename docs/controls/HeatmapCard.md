# HeatmapCard (`HeatmapCard`)

Issues pinned onto a fixed background image — a floor plan, machine photo or
body map. Pins are numbered and severity-coloured; their coordinates are
normalised 0..1 relative to the image. The background image comes from the
`image` input, not the document.

- **Schema id:** `ltk/heatmap@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "pins": [
    { "id": "pin_1", "x": 0.42, "y": 0.61, "note": "Guard interlock intermittent", "severity": 3 }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `pins` | `HeatmapPin[]` | The pinned issues (the array is `pins`). |

### HeatmapPin

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `x` | number | `0..1` across the image (clamped). |
| `y` | number | `0..1` down the image (clamped). |
| `note` | string | The issue text (field name is `note`). |
| `severity` | number | `1` low, `2` medium, `3` high. Default `2`. |

## actionsOutputJSON

Emitted. Actions raised at pin time carry:

- `context.source` = `"heatmap"`
- `context.sourceId` = the **pin id**

Deleting a pin cancels its open actions.
