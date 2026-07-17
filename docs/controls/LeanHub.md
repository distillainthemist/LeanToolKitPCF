# LeanHub (`LeanHub`)

The **person's home** — a tabbed shell (Cadence / Actions / Settings)
that fronts the whole meeting system. Like CardSettings and MeetingWizard
it is a **shell, not a board card**: no document, no snapshots, everything
in and out is JSON.

- **Schema id:** none · **Document:** ✖ · **Actions:** standard channel ·
  **Snapshots:** ✖

## Cadence tab

Every supplied meeting's cadence is projected onto a day/week grid by the
**shared recurrence engine** (`shared/schema/recurrence.ts` — the same
maths as MeetingScheduler, so the calendar and the scheduler can never
disagree). Occurrence chips carry the meeting's title-strip colour, time,
shift, crew and rotation topic.

**Scope selector** — Person, or a **cascading Organisation** scope:

| Scope | An occurrence shows when |
| --- | --- |
| Person | they are the **owner** (attends everything) or a **participant** — crew-linked participants only when their crew is on shift. A roster **type-ahead** (org-scale): exact name scopes, empty = everyone, a **Me** button jumps back to the viewer. Defaults to the viewer. |
| Organisation (site → department → area) | each chosen level narrows the meetings' `meeting.org`: a site alone shows the whole site (department- and area-level meetings included); adding a department narrows to it; adding an area narrows further. The cascade tree comes from `orgJSON` (the same tree MeetingWizard uses) or is derived from the meetings when absent. |

Switching scope kind lands on the saved defaults: **Person → me**,
**Organisation → the viewer's default site / department / area** from
Settings.

**Protected time zones** render as coloured background bands behind the
chips — field leadership time, 1:1s, problem solving — from
`protectedTimesJSON` (site-level config).

**Tapping an occurrence** emits `selectedMeetingJSON`:

```json
{ "boardId": "board-standup", "title": "Bottling standup",
  "iso": "2026-07-16T07:00", "date": "2026-07-16", "time": "07:00",
  "crew": "B", "shift": "day", "topic": "Safety walk",
  "selectedAt": "2026-07-16T05:00:00.000Z" }
```

Navigate to the board and pass `iso` into its MeetingScheduler's
**`selectIso`** input — the scheduler lands with that instance selected
and its `selectedMeetingJSON`/`attendeesJSON` already emitted.

## Actions tab

The viewer's actions from **every source**, on the standard actions
channel: `actionsInputJSON` is the app's assignee-filtered rollup, rows
group by source (`actionSourcesJSON` supplies `[{instanceId, label}]`
friendly names), ordered overdue-first then by due date. The viewer can
tick **their part** done; the full set emits on `actionsOutputJSON` for
the usual `(instanceId, id)` upsert.

## Settings tab

- **Cadence preferences** — default scope (person, or the viewer's own
  **default site / department / area** via the same cascade — department
  and area optional), day/week view, week start, visible hours — emitted
  on `preferencesOutputJSON` as `{scopeKind: person|org, person,
  org:{site, department, area}, view, weekStart, dayStart, dayEnd}`;
  persist per user and feed back into `preferencesJSON`. Old flat
  `{scopeKind: site|department|area, scopeValue}` blobs migrate on parse.
- **Protected time editor** (shown when `canEditSite` is true) — label,
  colour, weekday toggles, start/end — emitted on
  `protectedTimesOutputJSON`; persist at site level and feed back into
  `protectedTimesJSON`.

## Inputs

| Input | Notes |
| --- | --- |
| `meetingsJSON` | `[{boardId, settingsJSON}]` — each board's MeetingScheduler settings blob (string or object). Cadence, topics, crews and identity all come from the blob; nothing else is needed. |
| `protectedTimesJSON` | `[{label, color, days, start, end}]` — days as names or indices. |
| `actionsInputJSON` / `actionSourcesJSON` | The viewer's action rollup + optional source labels. |
| `orgJSON` | The site / department / area tree for the cascade — bind the same value as MeetingWizard's `orgJSON`. Optional: derived from the meetings when empty. |
| `peopleJSON` / `viewerId` | The roster for the person scope; the signed-in person's `whoId`. |
| `preferencesJSON` | The viewer's stored prefs (echo-guarded — a write of our own coming home is ignored). |
| `canEditSite` | Shows the protected-time editor. |

Plus the standard chrome/styling surface. All three fed-back channels
(actions, preferences, protected times) carry echo guards, so the
persist-and-rebind loop never clobbers newer local state.

## App wiring sketch

```powerfx
LeanHub.meetingsJSON =
  JSON(ForAll(Filter('LTK Boards', ben_boardkind = "meeting") As B,
      { boardId: Text(B.ben_boardid), settingsJSON: B.ben_occurrencesettings }),
    JSONFormat.Compact)

LeanHub.OnChange =
  With({ sel: ParseJSON(Self.selectedMeetingJSON) },
    If(Text(sel.selectedAt) <> varLastHubSel,
       Set(varLastHubSel, Text(sel.selectedAt));
       Set(varBoard, LookUp('LTK Boards', ben_boardid = Text(sel.boardId)));
       Set(varSelectIso, Text(sel.iso));       // bound to the scheduler's selectIso
       Navigate(BoardScreen)))
```

Full recipes (actions rollup, preference and protected-time persistence):
[board-app-build.md](../board-app-build.md).
