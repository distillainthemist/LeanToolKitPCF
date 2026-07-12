# StatusTile (`StatusTile`)

One big tap-to-cycle state with a reason — the line-of-sight element of a
cascade (e.g. a tier-2 board showing one tile per tier-1 board). State labels
come from the `states` input; colours from `legendColors`.

- **Schema id:** `ltk/statustile@1`
- **Document:** yes · **Actions:** ✖ · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson).

## outputJSON — `data`

```json
{
  "stateIndex": 1,
  "reason": "Waiting on spares for filler head 3"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `stateIndex` | number | Index into the (input-supplied) `states` list. `≥ 0`, rounded; default `0`. |
| `reason` | string | Free-text reason; default `""`. |

The state **labels** themselves live in the `states` input (default
`["On track", "At risk", "Off track"]`), not in the document — the document
stores only which state is selected. There is no history array; the only time
signal is the envelope's `meta.updated`.

## actionsOutputJSON

**Not emitted.** A status tile is line-of-sight state, not an action register —
it has no actions channel.
