# MeetingScheduler (`MeetingScheduler`)

A meeting-instance **selector** — not a document editor. It generates the
instances for a cadence (annually … shiftly, including crew roster patterns like
`2D-2N-5O`) inside the window `[finalDate − daysPrior, finalDate]`, matches them
against existing records supplied on `existingMeetingsJSON`, hides stale past
misses, and emits the tapped instance so `OnChange` can open or create its
record.

- **Schema id:** none · **Document:** ✖ · **Actions:** ✖ · **Snapshots:** none

## selectedMeetingJSON

`of-type Multiple`, emitted on every tap or field edit. It is the tapped
instance plus its custom-column values and a fresh timestamp:

```json
{
  "iso": "2026-07-14T06:00",
  "date": "2026-07-14",
  "day": "Mon",
  "time": "06:00",
  "crew": "A",
  "shift": "day",
  "recordId": "",
  "rescheduledTo": "",
  "status": "planned",
  "values": { "topic": "Line 2 changeover", "chair": "Sam" },
  "selectedAt": "2026-07-13T05:20:00.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `iso` | string | `yyyy-mm-ddTHH:MM`. |
| `date` | string | `yyyy-mm-dd`. |
| `day` | string | Weekday, e.g. `"Mon"`. |
| `time` | string | `HH:MM`. |
| `crew` | string | Roster crew; `""` when no roster applies. |
| `shift` | `"" \| "day" \| "night"` | |
| `topic` | string | The occurrence's **rotation topic** (shown on the row, italic): weekly = `weekTopics[week-of-month]` (1st–5th occurrence of the weekday in the month), daily/shiftly = `dayTopics[weekday]`. `""` when none configured. |
| `recordId` | string | The matched record's id; `""` when none exists yet. |
| `rescheduledTo` | string | Set when the record was moved. |
| `status` | enum | `"existing" \| "missing" \| "planned"`. |
| `values` | `Record<string, string>` | Custom-column values, keyed by the column `key` (from the `columns` setting). |
| `selectedAt` | string | ISO stamp, refreshed on **every** tap — so re-selecting the same row still fires `OnChange`. |

**Deep-linking:** the `selectIso` input (change-of-value) selects an
instance programmatically, exactly as a tap would — pass a full iso
(`yyyy-mm-ddTHH:MM`) or a bare date. The LeanHub calendar uses this to
land a user on the meeting they tapped; clear then re-set to reselect the
same instance.

## attendeesJSON — crew-linked attendees

Supply the meeting's roster on the **People (JSON)** input —
`[{whoId, who, crew?}]`, where `crew` (optional) names an entry in the crew
list. When an instance is selected, `attendeesJSON` emits the **expected
attendees**:

- people whose `crew` matches the instance's on-shift crew, **plus**
- everyone **without** a crew (staff who always attend);
- no roster / no crew on the instance = the whole people list;
- `""` until an instance is selected, or when no people are supplied.

```json
[{ "whoId": "u1", "who": "Sam Lee", "crew": "A" },
 { "whoId": "u4", "who": "Ben Super" }]
```

Bind it straight into the board cards' **People (JSON)** inputs so assignee
pickers offer that meeting's attendees — see the
[master leanboard design](../master-leanboard.md).

## Actions channel

Not used. MeetingScheduler emits no document and no actions.
