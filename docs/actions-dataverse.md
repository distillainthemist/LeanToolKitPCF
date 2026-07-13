# Actions in Dataverse — Power Fx recipes

How to persist the [actions channel](controls/README.md#the-actions-channel-actionsoutputjson)
in a central Dataverse table, and the Power Fx to move actions between the
controls' JSON and canvas-app collections.

The design in one line: **one Dataverse row per action, upserted by action
`id`** — scalar fields as real columns (filterable, chartable), and the three
nested structures (`assignees`, `comments`, `acknowledged`) stored verbatim as
plain-text JSON columns.

Canonical schema: [`shared/schema/actions.ts`](../shared/schema/actions.ts) —
see the [controls reference](controls/README.md#the-actions-channel-actionsoutputjson)
for the field-by-field description of `LtkAction`.

---

## The people list (`peopleJSON`)

Assignee selection uses a **curated roster**, not the whole directory. Every
application of a card is a meeting or problem-solving activity with defined
participants, so the app passes the relevant 10–50 people into each card's
`peopleJSON` as `[{ "whoId": "...", "who": "..." }]` — from a team table, an
M365 group expanded once, or a static collection.

Pick what `whoId` is **once** and keep it forever — actions persist assignees,
so switching identity schemes later orphans them. Use the Entra object id if
actions are loosely coupled JSON (stable, works with Graph lookups later), or
the Dataverse `systemuser` GUID if you will ever make assignees real lookups.

---

## Dataverse table: **LTK Action** (`ben_ltkaction`)

Publisher `BenOBrien`, prefix `ben` (same as the solution). Standard columns
(`createdon`, `modifiedon`, `ownerid`) provide audit and ownership for free.

| Display name | Logical name | Type | Notes |
| --- | --- | --- | --- |
| Name (primary) | `ben_name` | Text (300) | Set to the issue text on upsert — readable model-driven views/lookups only, not the identity. |
| **Action Id** | `ben_actionid` | Text (40) | The control's `id` (`a_…`). **Alternate key** — the upsert identity. Required. |
| **Instance Id** | `ben_instanceid` | Text (80) | Owning card instance (`instanceId`). The main filter column for feeding cards and the ActionBoard. |
| Issue | `ben_issue` | Text (400) | `issue` |
| Description | `ben_description` | Multiline text (4,000) | `description` |
| Assignees (JSON) | `ben_assigneesjson` | Multiline text (10,000), plain text | `assignees` array verbatim: `[{whoId,who,done}]` |
| Start | `ben_start` | Date Only, **time-zone independent** | `start`; blank ↔ `""` |
| Due | `ben_due` | Date Only, **time-zone independent** | `due`; blank ↔ `""` |
| Status | `ben_status` | Text (20) | `open` / `in-progress` / `done` / `cancelled`, stored verbatim |
| Comments (JSON) | `ben_commentsjson` | Multiline text (100,000), plain text | `comments` array verbatim — this one grows, hence the headroom |
| Escalated | `ben_escalated` | Yes/No, default No | `escalated` |
| Acknowledged (JSON) | `ben_acknowledgedjson` | Multiline text (2,000), plain text | The optional `acknowledged` record, or blank. JSON keeps the absent-vs-present distinction cleanly. |
| Source | `ben_source` | Text (40) | `context.source`, e.g. `fivewhys` |
| Source Id | `ben_sourceid` | Text (80) | `context.sourceId` |
| Hint | `ben_hint` | Text (200) | `context.hint` |

Design decisions:

- **Alternate key on `ben_actionid` alone.** Control-generated ids are globally
  unique, so no composite key is needed. The key gives a real upsert and a
  uniqueness guard.
- **Status as text, not Choice.** Verbatim round-trip with zero mapping, still
  filterable/delegable. A Choice column would buy model-driven charts at the
  cost of a `Switch()` in every formula in both directions.
- **Dates as Date Only, time-zone independent.** TZ-independent is the
  important part — "User local" would shift `2026-07-13` to the 12th or 14th
  depending on who saved it. Costs a `Text(…, "yyyy-mm-dd")` on the way out;
  buys native overdue views and Gantt sorting.
- **No overdue / complete columns.** Both are derived, never stored (overdue =
  `due` in the past and status not `done`/`cancelled`).
- **No deletes, ever.** Matches the channel contract — deleting the element an
  action hangs off sets its status to `cancelled`. Upsert only.
- **Anticipated extension:** a `ben_boardid` Text (80) column, so one central
  table can serve multiple boards/areas without every app pulling everything.

---

## Power Fx recipes

All recipes assume modern Power Fx with `ParseJSON` (GA). Two rules recur:

1. `ParseJSON` returns **untyped** objects — every field needs an explicit
   `Text()` / `Boolean()` cast, and `JSON()` will not serialize untyped values,
   so anything going back out must be re-typed first.
2. Nested `ForAll`s shadow `ThisRecord` — always use `As` aliases.

Keep `start` / `due` / `when` as **text** (`yyyy-mm-dd`) inside collections;
converting to real dates makes `JSON()` emit full ISO datetimes on the way
back. Dates only become real `Date` values at the Dataverse column boundary.

### 1. `actionsOutputJSON` → collection

Column names deliberately match the JSON schema exactly, so serializing back
is a one-liner (recipe 2). Run in the control's `OnChange`:

```powerfx
ClearCollect(
    colActions,
    ForAll(
        Table(ParseJSON(FiveWhys1.actionsOutputJSON)) As A,
        {
            id: Text(A.Value.id),
            instanceId: Coalesce(Text(A.Value.instanceId), ""),
            issue: Coalesce(Text(A.Value.issue), ""),
            description: Coalesce(Text(A.Value.description), ""),
            assignees: ForAll(
                Table(A.Value.assignees) As S,
                {
                    whoId: Coalesce(Text(S.Value.whoId), ""),
                    who:   Coalesce(Text(S.Value.who), ""),
                    done:  Coalesce(Boolean(S.Value.done), false)
                }
            ),
            start:  Coalesce(Text(A.Value.start), ""),
            due:    Coalesce(Text(A.Value.due), ""),
            status: Coalesce(Text(A.Value.status), "open"),
            comments: ForAll(
                Table(A.Value.comments) As C,
                {
                    whoId: Coalesce(Text(C.Value.whoId), ""),
                    who:   Coalesce(Text(C.Value.who), ""),
                    when:  Coalesce(Text(C.Value.when), ""),
                    text:  Coalesce(Text(C.Value.text), "")
                }
            ),
            escalated: Coalesce(Boolean(A.Value.escalated), false),
            acknowledged: {
                whoId: Coalesce(Text(A.Value.acknowledged.whoId), ""),
                who:   Coalesce(Text(A.Value.acknowledged.who), ""),
                when:  Coalesce(Text(A.Value.acknowledged.when), "")
            },
            context: {
                source:   Coalesce(Text(A.Value.context.source), ""),
                sourceId: Coalesce(Text(A.Value.context.sourceId), ""),
                hint:     Coalesce(Text(A.Value.context.hint), "")
            }
        }
    )
)
```

Missing optional properties (`acknowledged`, `hint`) propagate as blank
untyped values → `""` after `Coalesce`, and the controls' sanitizer discards
an acknowledgement whose `when` is empty — so the blanket `acknowledged`
record is safe.

### 2. Collection → `actionsInputJSON`

Because the column names match the schema:

```powerfx
Set(varActionsIn, JSON(colActions, JSONFormat.Compact))
```

with the card's **Actions Input (JSON)** bound to `varActionsIn`. The
controls' load gate keys on `actionsInputJSON` changes, so setting the
variable is enough to reload — no `resetTrigger` pulse needed. Blank fields
serialize as `null`/`""`; `sanitizeAction` normalises all of that on ingest.

**Avoid the echo loop:** let `OnChange` only *collect* (and upsert). Only set
`varActionsIn` when deliberately pushing external state in — e.g. on screen
load from Dataverse. The controls tolerate being handed their own output
(identical content → no reload), but the tidy pattern doesn't rely on that.

### 3. Upsert collection → Dataverse (control `OnChange`)

```powerfx
ForAll(
    colActions As A,
    Patch(
        'LTK Actions',
        Coalesce(
            LookUp('LTK Actions', ben_actionid = A.id),
            Defaults('LTK Actions')
        ),
        {
            ben_actionid: A.id,
            ben_instanceid: A.instanceId,
            ben_name: Left(Coalesce(A.issue, A.id), 300),
            ben_issue: A.issue,
            ben_description: A.description,
            ben_assigneesjson: JSON(A.assignees, JSONFormat.Compact),
            ben_start: If(A.start = "", Blank(), DateValue(A.start)),
            ben_due: If(A.due = "", Blank(), DateValue(A.due)),
            ben_status: A.status,
            ben_commentsjson: JSON(A.comments, JSONFormat.Compact),
            ben_escalated: A.escalated,
            ben_acknowledgedjson: If(
                A.acknowledged.when = "",
                Blank(),
                JSON(A.acknowledged, JSONFormat.Compact)
            ),
            ben_source: A.context.source,
            ben_sourceid: A.context.sourceId,
            ben_hint: A.context.hint
        }
    )
)
```

`ForAll` + `LookUp` per row is fine at meeting scale (a handful of actions per
change). The alternate key guards against duplicates even if two sessions race.

### 4. Dataverse rows → `actionsInputJSON` (feed a card)

On screen load / reset — filter to the card's instance and rebuild the typed
structure (nested JSON columns are re-typed through `ParseJSON` so the outer
`JSON()` can serialize them):

```powerfx
Set(
    varActionsIn,
    JSON(
        ForAll(
            Filter('LTK Actions', ben_instanceid = varInstanceId) As R,
            {
                id: R.ben_actionid,
                instanceId: R.ben_instanceid,
                issue: R.ben_issue,
                description: R.ben_description,
                assignees: ForAll(
                    Table(ParseJSON(Coalesce(R.ben_assigneesjson, "[]"))) As S,
                    {
                        whoId: Coalesce(Text(S.Value.whoId), ""),
                        who:   Coalesce(Text(S.Value.who), ""),
                        done:  Coalesce(Boolean(S.Value.done), false)
                    }
                ),
                start: If(IsBlank(R.ben_start), "", Text(R.ben_start, "yyyy-mm-dd")),
                due:   If(IsBlank(R.ben_due),   "", Text(R.ben_due,   "yyyy-mm-dd")),
                status: Coalesce(R.ben_status, "open"),
                comments: ForAll(
                    Table(ParseJSON(Coalesce(R.ben_commentsjson, "[]"))) As C,
                    {
                        whoId: Coalesce(Text(C.Value.whoId), ""),
                        who:   Coalesce(Text(C.Value.who), ""),
                        when:  Coalesce(Text(C.Value.when), ""),
                        text:  Coalesce(Text(C.Value.text), "")
                    }
                ),
                escalated: R.ben_escalated,
                acknowledged: {
                    whoId: Coalesce(Text(ParseJSON(Coalesce(R.ben_acknowledgedjson, "{}")).whoId), ""),
                    who:   Coalesce(Text(ParseJSON(Coalesce(R.ben_acknowledgedjson, "{}")).who), ""),
                    when:  Coalesce(Text(ParseJSON(Coalesce(R.ben_acknowledgedjson, "{}")).when), "")
                },
                context: {
                    source:   Coalesce(R.ben_source, ""),
                    sourceId: Coalesce(R.ben_sourceid, ""),
                    hint:     Coalesce(R.ben_hint, "")
                }
            }
        ),
        JSONFormat.Compact
    )
)
```

### 5. Feeding the ActionBoard / EscalationViewer

Same reassembly as recipe 4 with a different filter — these boards want *all*
actions in scope, not one instance:

- **ActionBoard:** the whole table, or scoped by a future `ben_boardid`.
- **EscalationViewer:** `Filter('LTK Actions', ben_escalated = true)`.

The EscalationViewer passes `instanceId` through unchanged (it does not
re-stamp its own), so acknowledged/updated actions upsert back to the row of
the card that raised them — recipe 3 works unmodified in its `OnChange`.

---

## Round-trip flow summary

```text
card edit ──OnChange──▶ colActions (recipe 1) ──▶ Patch upsert (recipe 3)
                                                          │
screen load / reset ◀── varActionsIn (recipe 4) ◀── Filter by instanceId
        │
        └──▶ actionsInputJSON ──▶ card load gate reloads the card
```

One direction per trigger: `OnChange` writes to Dataverse; screen
load/refresh reads from Dataverse. Never both in the same handler — that is
the echo loop.
