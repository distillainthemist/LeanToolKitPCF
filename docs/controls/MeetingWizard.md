# MeetingWizard (`MeetingWizard`)

A **guided meeting setup** stepper — the friendly alternative to configuring
a MeetingScheduler through the generic composer. It walks a maker through
the meeting's identity and cadence, then emits **one complete
MeetingScheduler `settingsJSON`** for the app to save. Like CardSettings,
it is a **setup screen, not a board card** — it has no document, no
snapshots, and does not appear in the card catalog.

**Steps:** Basics (title, purpose, owner) → Organisation (site / department
/ area) → Cadence → Crews & roster (rostered cadences only) → Participants
→ Meeting records → Review (with the **Create meeting** button).

- **Schema id:** none · **Document:** ✖ · **Actions:** ✖ · **Snapshots:** ✖

## Inputs

| Input | Notes |
| --- | --- |
| `inputJSON` | An existing MeetingScheduler settings blob to edit; empty = new meeting. **Lossless:** keys the wizard does not manage (`theme`, `board`, `prompts`, unknown config keys) ride through verbatim, so wizard-editing a composed meeting never strips composer settings. |
| `peopleJSON` | The roster to pick the owner and participants from: `[{whoId, who, crew?}]`. Participants outside the roster can be added by name. |
| `orgJSON` | The hierarchical picklist tree: `[{site, departments:[{department, areas:[…]}]}]`. Site filters departments, department filters areas; a department with no areas skips the area field ("Whole department"). Empty input falls back to free-text organisation fields. |
| `resetTrigger` | Reloads `inputJSON` on change of value: `Set(varReset, Text(Now()))`. |

Plus the standard chrome/styling surface (`cardTitle`, `prompts`, colours
including `titleBarColor`, font, `readOnly`).

## Outputs

### `outputJSON`

The composed blob, emitted live as the maker edits (debounced):

```json
{ "cardType": "MeetingScheduler",
  "title": "Bottling line standup",
  "config": { "category": "shiftly", "daysOfWeek": "Mon,Tue,Wed,Thu,Fri",
              "timeOfDay": "07:00", "daysPrior": 5,
              "crewList": "A,B,C,D", "rosterPattern": "2D-2N-4O",
              "baseStartDate": "2026-07-13", "columns": "Topic,Chair" },
  "meeting": { "purpose": "Review the last shift…",
               "owner": { "whoId": "p1", "who": "Ben OBrien" },
               "org": { "site": "Pechey Downs", "department": "Bottling",
                        "area": "Line 1" },
               "participants": [ { "whoId": "p2", "who": "Sam Patel",
                                   "crew": "A" } ] } }
```

The `meeting` section renders as MeetingScheduler's identity strip (owner ·
site / department / area, with purpose and participants behind the About
toggle). Roster config keys are dropped automatically when the cadence is
not rostered.

### `submittedAt`

Timestamp stamped when **Create meeting** is pressed — changes on every
press, so `OnChange` can create the board exactly once per submit:

```powerfx
MeetingWizard.OnChange =
If(Self.submittedAt <> varLastSubmit && Self.submittedAt <> "",
   Set(varLastSubmit, Self.submittedAt);
   CreateMeetingBoard(Self.outputJSON))   // see board-app-build.md
```

## Notes

- Participants tick on/off from the supplied roster; each ticked person
  gets a **crew** select (options from the Crews step) — "Every meeting"
  = always attends. `meeting.participants` can therefore feed the board's
  `peopleJSON` directly.
- The only hard gate is a **title** — everything else can be filled later
  by re-opening the wizard (`inputJSON`) or the composer.
- Data policies are **not** set here: they belong to each card on the
  board and are set per card in the composer's "New meeting instance"
  section. The wizard stays scoped to the meeting itself.
