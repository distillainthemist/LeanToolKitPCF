# FiveWhys (`FiveWhys`)

Drill from a problem through why-chains to root causes, and raise actions on
them. Each chain starts at a top-level cause and follows `parentId` links; the
answer at the end of a chain is flagged as a root cause.

- **Schema id:** `ltk/fivewhys@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson) for the
wrapper and the `LtkAction` shape.

## outputJSON — `data`

```json
{
  "problem": "Line stopped for 40 minutes",
  "causes": [
    { "id": "c_1", "text": "Filler jammed", "status": "Confirmed", "votes": 0, "isRoot": false, "category": "", "parentId": null },
    { "id": "c_2", "text": "O-ring perished", "status": "Confirmed", "votes": 0, "isRoot": true, "category": "", "parentId": "c_1" }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `problem` | string | The problem statement the chains hang from. |
| `causes` | `CauseNode[]` | The whys. See the cause model below. |

### CauseNode (shared)

Each cause is a `CauseNode`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `text` | string | The "why" answer (≤ 140 chars). |
| `status` | enum | `"Hypothesis" \| "Confirmed" \| "Rejected"`. |
| `votes` | number | ≥ 0. |
| `isRoot` | boolean | **Used** — marks the root cause at a chain's end. |
| `category` | string | Unused here (stays `""`); it's the Fishbone bone field. |
| `parentId` | string \| null | **Used** — the linear chain link. `null` = the head of a chain. |
| `gate` | `"and" \| "or"`? | Unused here (FaultTree field). Omitted when unset. |
| `probability` | number? | Unused here. Omitted when unset. |

The fields that carry meaning for FiveWhys are `parentId` (the chain) and
`isRoot` (the answer), plus `text`/`status`/`votes`.

## actionsOutputJSON

Emitted. Actions raised on a cause carry:

- `context.source` = `"fivewhys"`
- `context.sourceId` = the **cause id**
- `context.hint` = `"root-cause"` when raised from a cause already marked
  `isRoot`; omitted otherwise.
