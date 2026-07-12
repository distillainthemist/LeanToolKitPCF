# MeetingScheduler (`MeetingScheduler`)

A meeting-instance **selector** — not a document editor. It generates the
instances for a cadence (annually … shiftly, including crew roster patterns like
`2D-2N-5O`) inside the window `[finalDate − daysPrior, finalDate]`, matches them
against existing records supplied on `existingMeetingsJSON`, hides stale past
misses, and emits the tapped instance so `OnChange` can open or create its
record.

- **Schema id:** none · **Document:** ✖ · **Actions:** ✖ · **Snapshots:** none

## selectedMeetingJSON — the only output

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
| `recordId` | string | The matched record's id; `""` when none exists yet. |
| `rescheduledTo` | string | Set when the record was moved. |
| `status` | enum | `"existing" \| "missing" \| "planned"`. |
| `values` | `Record<string, string>` | Custom-column values, keyed by the column `key` (from the `columns` setting). |
| `selectedAt` | string | ISO stamp, refreshed on **every** tap — so re-selecting the same row still fires `OnChange`. |

## Actions channel

Not used. MeetingScheduler emits no document and no actions — only
`selectedMeetingJSON`.
