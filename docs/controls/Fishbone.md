# Fishbone (`Fishbone`)

An Ishikawa (cause-and-effect) diagram: categorised root causes with votes and
status, dragged between bones, with action capture on any cause. The bones
(categories) for a new diagram come from the `categories` setting, defaulting
to the classic 6M set.

- **Schema id:** `ltk/fishbone@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "problem": "High reject rate at bottling",
  "categories": ["Measurements", "Materials", "People", "Environment", "Methods", "Machines"],
  "causes": [
    { "id": "c_1", "text": "Torque spec unclear", "status": "Hypothesis", "votes": 2, "isRoot": false, "category": "Methods", "parentId": null }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `problem` | string | The effect / problem at the fish's head. |
| `categories` | string[] | The bone names, in order. Deduped; seeded from the `categories` setting for a new diagram, then owned by the document. |
| `causes` | `CauseNode[]` | The causes on the bones. |

### CauseNode (shared)

Same shape as [FiveWhys](FiveWhys.md#causenode-shared). For Fishbone the
defining field is **`category`** — which bone a cause sits on — plus
`text`/`status`/`votes`. `parentId` is not used (causes are depth-1; new causes
are written with `parentId: null`), and there is no root-cause concept, so
`isRoot` is not set here.

## actionsOutputJSON

Emitted. Actions raised on a cause carry:

- `context.source` = `"fishbone"`
- `context.sourceId` = the **cause id**
- `context.hint` — not set (Fishbone has no root-cause hint).
