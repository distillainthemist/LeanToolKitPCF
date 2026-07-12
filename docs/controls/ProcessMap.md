# ProcessMap (`ProcessMap`)

One control rendering a simple flowchart, a swimlane map, a SIPOC, or a value
stream map — selected by the `mapType` setting. Supports drag-drop nodes,
connectors, post-it notes, colour coding, VSM data boxes and a lead-time ladder.
Kaizen-burst nodes raise actions.

- **Schema id:** `ltk/processmap@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

The whole diagram is the `data`:

```json
{
  "mode": "swimlane",
  "showTimeline": false,
  "lanes": ["Customer", "Operations", "Support"],
  "nodes": [
    { "id": "n_1", "kind": "process", "label": "Fill", "detail": "Line 2", "x": 320, "y": 140, "lane": 1 }
  ],
  "edges": [
    { "id": "e_1", "from": "n_1", "to": "n_2", "kind": "flow", "label": "OK" }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `mode` | enum | `"simple" \| "swimlane" \| "sipoc" \| "vsm"` — the map type. |
| `showTimeline` | boolean | VSM lead-time ladder toggle. |
| `lanes` | string[] | Swimlane row titles (default `["Customer","Operations","Support"]`). |
| `nodes` | `PmNode[]` | The shapes. |
| `edges` | `PmEdge[]` | The connectors. |

### PmNode

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `kind` | enum | `start \| process \| decision \| data \| document \| end \| card \| outside \| vsmProcess \| inventory \| truck \| kaizen \| note`. |
| `label` | string | |
| `detail` | string? | Secondary line (owner / system / note). |
| `color` | string? | Fill override; empty = default. |
| `x`, `y` | number | Integer **canvas** coordinates (not normalised). |
| `lane` | number? | SIPOC column index `0..4`, or swimlane row index (clamped `0..32`). |
| `metrics` | `PmMetrics`? | VSM data-box fields: `{ ct?, co?, uptime?, operators?, wait? }`, all strings. |

### PmEdge

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `from`, `to` | string | Node ids. |
| `kind` | enum | `"flow" \| "info" \| "electronic"`. |
| `label` | string? | Branch label, e.g. Yes/No on a decision. |

## actionsOutputJSON

Emitted. Only **kaizen-burst** nodes raise actions:

- `context.source` = `"processmap"`
- `context.sourceId` = the kaizen **node id**
- `context.hint` = `"kaizen"`

Deleting a kaizen burst cancels its open actions.
