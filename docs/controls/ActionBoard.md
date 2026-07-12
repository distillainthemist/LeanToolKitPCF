# ActionBoard (`ActionBoard`)

The central action register, rendered as a **list**, **kanban** (columns by
status or by issue) or **gantt** (start→due bars), selected by the `view`
setting. The actions channel *is* its data — it has no document of its own.

- **Schema id:** none (no document)
- **Document:** ✖ · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [actions channel](README.md#the-actions-channel-actionsoutputjson) for
the `LtkAction` shape.

## outputJSON

**Not emitted.** ActionBoard has no `inputJSON`/`outputJSON` document property —
it binds directly to the central actions table. Feed it the actions to show via
`actionsInputJSON` (e.g. `JSON(Filter(Actions, …))`).

## actionsOutputJSON

Emitted — this is the board's only data channel. It returns the full current
action set (each stamped with `instanceId` when that input is set), so edits
made on the board — status changes, reassignment, tick-offs, new actions — flow
straight back to the table.

Actions created *on the board itself* carry:

- `context.source` = `"actionboard"`
- `context.sourceId` = `""` (the board is not an owning element; these actions
  belong to the board, not to a card element)

Actions that arrived from other cards keep their original `context` untouched.
