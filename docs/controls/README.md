# LeanToolKit controls — reference

What each control does, and the exact schema of the JSON it emits. Two output
channels recur across the suite, so they are documented once here; each
control page then covers only its own specifics.

- **`outputJSON`** — the card's *document* (its content and layout), wrapped in
  the shared [envelope](#the-envelope-outputjson).
- **`actionsOutputJSON`** — the card's *actions*, on a separate channel using
  the canonical [action schema](#the-actions-channel-actionsoutputjson).

Not every control uses both. Some are document-only (no actions), a couple are
actions-only (no document), and three emit neither in the usual shape
(MeetingScheduler, CardSettings, and — for the document channel — ActionBoard).
The [index](#index) below says which is which.

---

## The envelope (`outputJSON`)

Every control that has a document emits it as a **LeanToolKit envelope**:

```json
{
  "schema": "ltk/<component>@1",
  "meta": { "title": "", "updated": "2026-07-13T05:20:00.000Z" },
  "data": { }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | string | Version tag, e.g. `ltk/sqdpc@1`. Each control always emits its own current schema id. |
| `meta.title` | string | Optional document title (distinct from the `cardTitle` chrome input). |
| `meta.updated` | string | ISO timestamp, stamped by the editor on each edit. Deterministic — loaded state can be string-compared against emitted state, which is how the echo-loop guard works. |
| `data` | object | The component-specific payload. **This is the only part that differs between controls** — each page below documents its `data` shape. |

Parsing is defensive and lossless: a document may arrive bare (just the `data`
object, no wrapper) and it is still accepted, and a legacy embedded `actions`
array is read off and moved onto the actions channel. `serializeEnvelope`
never emits an embedded `actions` array.

Source: [`shared/schema/envelope.ts`](../../shared/schema/envelope.ts).

---

## The actions channel (`actionsOutputJSON`)

Actions travel on their own channel — `actionsInputJSON` in, `actionsOutputJSON`
out — so they can feed one central Dataverse actions table keyed by
`(instanceId, action id)`, independent of the card document. A control emits the
**full current action set** as a JSON array; the app upserts by `id`. Actions
are never hard-deleted — deleting the element they hang off sets their status to
`cancelled`.

Each element is a canonical **`LtkAction`**:

```json
{
  "id": "a_9f3c",
  "instanceId": "b-bottling",
  "issue": "Filler head 3 dripping",
  "description": "Strip and reseat the nozzle O-ring",
  "assignees": [{ "whoId": "u-123", "who": "Sam Lee", "done": false }],
  "start": "2026-07-10",
  "due": "2026-07-14",
  "status": "open",
  "comments": [{ "whoId": "u-123", "who": "Sam Lee", "when": "2026-07-11", "text": "Parts on order" }],
  "escalated": false,
  "acknowledged": { "whoId": "u-9", "who": "Jo Poole", "when": "2026-07-12T08:00:00.000Z" },
  "context": { "source": "sqdpc", "sourceId": "S|2026-07-11", "hint": "root-cause" }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable action id; the upsert key. |
| `instanceId` | string | The owning card instance. Every action is stamped with the host card's `instanceId` on output (see the per-control exception for EscalationViewer). |
| `issue` | string | Short title / the problem being actioned. |
| `description` | string | Longer detail. |
| `assignees` | `{ whoId, who, done }[]` | Multi-assignee: **per-assignee** `done` flags on one action (views render a row per assignee). |
| `start` | string | `yyyy-mm-dd`, or `""`. Optional; used by the Gantt view. |
| `due` | string | `yyyy-mm-dd`, or `""`. Overdue is *derived* (`due` in the past and still open) — never stored. |
| `status` | enum | `"open" \| "in-progress" \| "done" \| "cancelled"`. |
| `comments` | `{ whoId, who?, when, text }[]` | `when` is `yyyy-mm-dd`. |
| `escalated` | boolean | Flags the action up to an EscalationViewer board. |
| `acknowledged` | `{ whoId, who, when }?` | Present once a receiving board signs off an escalation; `when` is an ISO timestamp. Omitted otherwise. |
| `context.source` | string | Which control raised it, e.g. `"fishbone"`. Listed per control below. |
| `context.sourceId` | string | The id of the element it hangs off (a cause id, a pin id, a row id…). Listed per control below. |
| `context.hint` | string? | Free placement/visualisation hint, e.g. `"root-cause"` or `"kaizen"`. Omitted when unused. |

Source: [`shared/schema/actions.ts`](../../shared/schema/actions.ts).

For persisting this channel in a central Dataverse table — table spec plus the
Power Fx to convert actions to/from collections — see
[Actions in Dataverse](../actions-dataverse.md).

### Disabling capture

Every action-capable card takes a **`disableActions`** input (also settable via
`settingsJSON` as `config.disableActions`). When true, the add / raise-action
affordances are hidden so **no new actions can be captured** on that card;
existing actions stay visible and can still be completed, commented and edited.
It applies to all capture cards — not to [ActionBoard](ActionBoard.md) or
[EscalationViewer](EscalationViewer.md), which are the action surfaces
themselves.

---

## Snapshot outputs (`pngExport` / `svgExport`)

Most controls also expose two read-only snapshot outputs, refreshed after every
change:

- **`pngExport`** — the rendered card as a PNG **data URI**.
- **`svgExport`** — the rendered card as **SVG markup**.

Bind either to an Image control to show a card read-only, or to compose several
cards onto one board. Both are present on every control **except** MeetingScheduler
and CardSettings (which are a selector and a form, not display tiles).

---

## Index

| Control | Schema id | Document (`outputJSON`) | Actions (`actionsOutputJSON`) | `context.source` |
| --- | --- | --- | --- | --- |
| [FiveWhys](FiveWhys.md) | `ltk/fivewhys@1` | ✅ | ✅ | `fivewhys` |
| [Fishbone](Fishbone.md) | `ltk/fishbone@1` | ✅ | ✅ | `fishbone` |
| [FaultTree](FaultTree.md) | `ltk/faulttree@1` | ✅ | ✅ | `faulttree` |
| [ActionBoard](ActionBoard.md) | — | ✖ (actions-only) | ✅ | `actionboard` |
| [SqdpcCard](SqdpcCard.md) | `ltk/sqdpc@1` | ✅ | ✅ | `sqdpc` |
| [ConditionsCard](ConditionsCard.md) | `ltk/conditions@1` | ✅ | ✅ | `conditions` |
| [AgendaCard](AgendaCard.md) | `ltk/agenda@1` | ✅ | ✅ | `agenda` |
| [EmbedCard](EmbedCard.md) | — | ✖ (display-only) | ✖ | — |
| [BoardGrid](BoardGrid.md) | — | ✖ (board tile wall) | ✖ | — |
| [StatusTile](StatusTile.md) | `ltk/statustile@1` | ✅ | ✖ | — |
| [KpiTrendCard](KpiTrendCard.md) | `ltk/kpitrend@1` | ✅ | ✖ | — |
| [ParetoCard](ParetoCard.md) | `ltk/pareto@1` | ✅ | ✖ | — |
| [BenefitEffort](BenefitEffort.md) | `ltk/benefiteffort@1` | ✅ | ✅ | `benefiteffort` |
| [RiskMatrix](RiskMatrix.md) | `ltk/riskmatrix@1` | ✅ | ✅ | `riskmatrix` |
| [Raci](Raci.md) | `ltk/raci@1` | ✅ | ✅ | `raci` |
| [SkillsMatrix](SkillsMatrix.md) | `ltk/skills@1` | ✅ | ✅ | `skills` |
| [ProcessMap](ProcessMap.md) | `ltk/processmap@1` | ✅ | ✅ | `processmap` |
| [CaptureCard](CaptureCard.md) | `ltk/capture@1` | ✅ | ✖ | — |
| [HeatmapCard](HeatmapCard.md) | `ltk/heatmap@1` | ✅ | ✅ | `heatmap` |
| [MeetingScheduler](MeetingScheduler.md) | — | ✖ (selection-only) | ✖ | — |
| [EscalationViewer](EscalationViewer.md) | — | ✖ (actions-only) | ✅ | (passthrough) |
| [CardSettings](CardSettings.md) | — | composes other cards' settings | ✖ | — |
| [MeetingWizard](MeetingWizard.md) | — | composes a MeetingScheduler settings blob | ✖ | — |
