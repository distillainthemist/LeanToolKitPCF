# ParetoCard (`ParetoCard`)

Labelled counts drawn as descending bars with a cumulative-% line. It also
ingests a Fishbone / FiveWhys vote export directly (a `causes` array of
`{ text, votes }`) and converts it to items.

- **Schema id:** `ltk/pareto@1`
- **Document:** yes · **Actions:** ✖ · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson).

## outputJSON — `data`

```json
{
  "items": [
    { "id": "p_1", "label": "Torque out of spec", "count": 12 },
    { "id": "p_2", "label": "Cap misfeed", "count": 7 }
  ],
  "unit": "defects"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `items` | `{ id, label, count }[]` | `id` auto-generated if missing; `label` required; `count` ≥ 0, rounded. |
| `unit` | string | Unit label for the counts. |

**Ingest:** if `data.items` is absent but `data.causes` is an array, each cause
`{ text, votes }` maps to an item `{ label: text, count: votes }` — so a
Fishbone/FiveWhys export drops straight in. Output always serialises the
canonical `items`.

## actionsOutputJSON

**Not emitted.** ParetoCard is document-only, with no actions channel.
