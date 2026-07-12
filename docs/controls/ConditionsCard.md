# ConditionsCard (`ConditionsCard`)

A set of "winning conditions" rated good/issue over a rolling window (7 columns)
ending on the as-of date — today by default, or a past date for retrospective
review. Granularity is day, weekday, week, or two shifts. Long-press a cell to
raise an action.

- **Schema id:** `ltk/conditions@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "ratings": {
    "5S standard maintained|2026-07-11": "good",
    "5S standard maintained|2026-07-12": "issue",
    "Line fully crewed|2026-07-12|N": "good"
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `ratings` | `Record<string, "good" \| "issue">` | Per-cell rating. Only `"good"` and `"issue"` survive parse; anything else is dropped. |

**Rating key** — `"<condition>|<periodKey>"`, where `periodKey` is the date
portion (`yyyy-mm-dd`, or the week's Monday for weekly granularity). At two-shift
granularity a `"|D"` / `"|N"` suffix names the half.

The conditions list, their prompts, the granularity and the as-of date are all
supplied by **inputs/settings** — the document holds only the ratings map.

## actionsOutputJSON

Emitted. Actions raised by long-pressing a cell carry:

- `context.source` = `"conditions"`
- `context.sourceId` = the rating key — `"<condition>|<periodKey>"`, or
  `"…|D"` / `"…|N"` for a shift half.
