# Raci (`Raci`)

A RACI responsibility-assignment matrix: deliverables (tasks) as rows, roles as
columns; each cell cycles R / A / C / I. It warns unless exactly one role is
Accountable per row. Roles, tasks and assignments are all editable in-card.

- **Schema id:** `ltk/raci@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "roles": ["Ops lead", "QA", "Maintenance"],
  "tasks": [
    { "id": "t_1", "label": "Release the batch" }
  ],
  "assign": {
    "t_1": { "Ops lead": "A", "QA": "R", "Maintenance": "C" }
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `roles` | string[] | The matrix columns (role names). |
| `tasks` | `{ id, label }[]` | The deliverables (rows). |
| `assign` | `Record<taskId, Record<role, letter>>` | Nested map: task id → role **name** → letter. `letter` is `"R" \| "A" \| "C" \| "I"`. |

## actionsOutputJSON

Emitted. Actions raised on a deliverable row carry:

- `context.source` = `"raci"`
- `context.sourceId` = the **task id** (the deliverable's id)
