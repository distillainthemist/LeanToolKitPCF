# AgendaCard (`AgendaCard`)

Runs a traditional meeting from one card, in three collapsible sections:

- **Pre-work** — items to arrive prepared with (title, optional link, who),
  checked off as they are confirmed done.
- **Agenda** — the running order (title, coaching prompt, who, timing in
  minutes, links). Actions are captured against each item; the section header
  shows the item count and total planned minutes. Reorder items by **dragging
  the ⠿ grip** or with the up/down chevrons.
- **Outputs** — a simple checklist of what the meeting must produce.

Pre-work and outputs start collapsed; the agenda starts open. Collapse is
view state only — toggling a section never dirties the document. Links show
their title and open the url in a new tab. A who can be picked from
`peopleJSON` or typed free-text.

- **Schema id:** `ltk/agenda@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "prework": [
    {
      "id": "p_9f3c",
      "title": "Read last month pack",
      "link": { "title": "June pack", "url": "https://…" },
      "whoId": "u-123",
      "who": "Sam Lee",
      "done": false
    }
  ],
  "items": [
    {
      "id": "g_7a21",
      "title": "KPI review",
      "prompt": "Focus on misses",
      "whoId": "",
      "who": "Jo Poole",
      "minutes": 20,
      "links": [{ "title": "Dashboard", "url": "https://…" }]
    }
  ],
  "outputs": [
    { "id": "o_4b02", "text": "Actions logged with owners", "done": false }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `prework[]` | array | Checkable preparation items, in display order. |
| `prework[].title` | string | Required — items without a title are dropped on parse. |
| `prework[].link` | `{title, url}?` | Optional. The title is displayed; the url opens in a new tab. A link without a url is dropped; a link without a title displays its url. |
| `prework[].whoId`, `.who` | string | The owner — a `peopleJSON` person (`whoId` set) or a free-text name (`whoId` empty). Both empty = unowned. |
| `prework[].done` | boolean | Checked off. |
| `items[]` | array | The agenda running order, in display order (rows carry move up/down). |
| `items[].title` | string | Required. |
| `items[].prompt` | string | Coaching prompt shown under the title. |
| `items[].whoId`, `.who` | string | Who leads the item — same rules as pre-work. |
| `items[].minutes` | number | Planned minutes; `0` = untimed. Section header totals the timed items. |
| `items[].links[]` | `{title, url}[]` | Any number of associated links. |
| `outputs[]` | array | Expected outputs, in display order. |
| `outputs[].text` | string | Required (a legacy `title` key is accepted on parse). |
| `outputs[].done` | boolean | Checked off. |

Only http/https links are opened — a url without a scheme is treated as
https; any other scheme is refused.

## actionsOutputJSON

Emitted. Each agenda row carries an **actions column** to the right of the
who / timing: a **＋ action** button raises an action for that item directly
(no need to open the item editor), and a **⚑ N** chip opens an
action-focused dialog to complete, comment on, edit or cancel the actions
already on the item. Actions can also still be raised and managed from the
item's own edit dialog. However raised, they carry:

- `context.source` = `"agenda"`
- `context.sourceId` = the agenda item's `id`

Deleting an agenda item **cancels** its actions (never hard-deletes them).
Pre-work and outputs do not capture actions — they are checklists.
