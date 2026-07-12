# FaultTree (`FaultTree`)

Break a top event down through a branching cause tree to root causes, and raise
actions on them. Nodes form an arbitrary tree via `parentId`; each node carries
an AND/OR gate describing how its children combine.

- **Schema id:** `ltk/faulttree@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "problem": "Batch failed QC",
  "rootGate": "or",
  "causes": [
    { "id": "c_1", "text": "Contamination", "status": "Hypothesis", "votes": 0, "isRoot": false, "category": "", "parentId": null, "gate": "and" },
    { "id": "c_2", "text": "CIP cycle skipped", "status": "Confirmed", "votes": 0, "isRoot": true, "category": "", "parentId": "c_1" }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `problem` | string | The **top event** (stored in `problem`, not a separate `topEvent` key). |
| `rootGate` | `"and" \| "or"`? | How the top event's direct causes combine. Omitted when unset; lower-cased on parse (accepts `AND`/`OR`). |
| `causes` | `CauseNode[]` | The tree of causes. |

### CauseNode (shared)

Same shape as [FiveWhys](FiveWhys.md#causenode-shared). FaultTree uses:

- **`parentId`** — the tree link. `null` = a direct cause of the top event.
- **`gate`** — `"and" \| "or"`, how *this* node's own children combine. Toggled
  and persisted per node. Omitted when unset.
- **`isRoot`** — marks a root cause.
- plus `text`/`status`/`votes`.

`probability` is parsed and sanitised but not currently used by the editor.

## actionsOutputJSON

Emitted. Actions raised on a cause carry:

- `context.source` = `"faulttree"`
- `context.sourceId` = the **cause id**
- `context.hint` = `"root-cause"` when raised from a cause marked `isRoot`;
  omitted otherwise.
