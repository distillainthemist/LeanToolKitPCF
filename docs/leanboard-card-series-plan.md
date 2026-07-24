# Card series data — plan

*Drafted 2026-07-25 for review. Moves time-keyed card data out of per-card
JSON blobs into a rolling Dataverse table, windowed by the meeting instance's
date. Covers Conditions, SQDPC, KPI trend, Pareto and Status tile.*

## Principle

**Definitions stay in the card document; time-keyed data becomes rows.**
A card's small, bounded configuration (KPI target/spec lines, Pareto
category list) remains in `outputJSON`. The unbounded part — ratings,
readings, counts, states — moves to one shared table and is read back
through a date window derived from the meeting instance. True documents
(Fishbone, Risk matrix, Agenda…) are untouched; their blob model is right.

What this buys: no 1MB document ceiling ever again; data written once
instead of copied into every meeting instance (`carry` duplication was the
real storage cost); closed meetings replay their own window from the same
truth; cell-level upserts instead of whole-blob last-write-wins between
crews; and the data becomes directly reportable (Power BI over one table:
S/Q/D/P/C compliance, condition trends, KPI history across sites).

## The table — `ben_LTKCardSeries`

One row per datum, upserted by alternate key.

| Column | Type | Notes |
| --- | --- | --- |
| `ben_boardid` | text 80 | the board |
| `ben_cardid` | text 80 | the slot |
| `ben_serieskey` | text 120 | datum key within the card (see per-card keys) |
| `ben_date` | dateonly | temporal index — every read is a date-range filter |
| `ben_value` | text 400 | the datum (status code, rating, number, state) |
| `ben_valuejson` | memo 4000 | optional richer payload (future-proofing) |
| `ben_who` | text 80 | who wrote it (Entra objectId) — audit + reporting |

Alternate key: `(ben_boardid, ben_cardid, ben_serieskey, ben_date)` —
within the 900-byte key limit at these sizes. Primary name is a readable
`<cardid> <serieskey> <date>`.

**Security role**: "LeanBoard User" gains Create/Read/Write/Append/AppendTo
(org) + **Delete** on this table only (unsetting a rating deletes its row,
same rationale as Card Data's delete for meeting reset). One provisioning
run in Dev (Ben), then the role travels in the managed solution.

## Windowing

The board screen already knows the selected instance. Its scheduled date
drives every read; a live/tile context uses today.

| Card | Window shown | Series key | Value |
| --- | --- | --- | --- |
| SQDPC | the instance's calendar month | `<dimension>` or `<dimension>\|D` / `\|N` | status code |
| Conditions | 7 periods ending on the instance date (existing grain config) | `<condition>` (+ `\|D`/`\|N` at shift grain) | `good` / `issue` |
| KPI trend | trailing N days ending on the instance date (new config `kpiWindowDays`, default 91) | the reading's point id | the number |
| Pareto | trailing N days (new config `paretoWindowDays`, default 30) | `count\|<categoryId>` | that **day's** count for the category |
| Status tile | n/a — log only (see below) | `state` | the day's end state |

Notes on the choices:

- **SQDPC's month comes from the meeting, not a stored field** — this
  structurally fixes the month-never-rolls-over defect (the pending task
  chip is superseded when phase 1 lands).
- **KPI keeps point ids as keys** so existing per-reading actions
  (`context.sourceId` = point id) stay linked with no action rewrites.
  "One reading per date" is enforced in app logic as today.
- **Pareto stores day-counts, not individual events**: ＋1 upserts today's
  row for that category (`value + 1`); the bar shows the sum over the
  window. This keeps the tally UX, gives rolling windows/trends, and avoids
  event-reconciliation when a count is edited (an explicit count edit sets
  *today's* row so the window total matches — the dialog will say so).
  Category definitions (id, label, unit) stay in the document.
- **Status tile is additive logging only.** The card keeps its current
  document behaviour (state + reason, tiny); on every state change it also
  upserts today's log row. Day-grain: intraday flips collapse to the day's
  end state, which is what status-over-time reporting wants. No UI change.

## Semantics that change (deciding points)

1. **Closed meetings show the corrected truth.** Cards read the table
   windowed to the meeting's date, so a later correction to a past rating
   shows corrected in the closed meeting. The tile SVG stamped at close
   remains the frozen visual record. (Accepted in review discussion.)
2. **The data policy setting stops applying to these cards' data** — they
   behave as `shared` + window regardless of the slot's policy. Close-time
   SVG stamping is unchanged. CardSettings will say so on these card types.
3. **PCF-hosted (canvas) usage keeps the blob behaviour** — the series
   store is code-app plumbing, same precedent as the actions wiring.

## Migration (self-heal, per card, on first open)

When a board's card mounts and the table has **no rows** for
`(boardId, cardId)` but the live/latest document holds data: decompose the
document into rows once, then proceed from rows. The blob is left in place
(dormant backup); per-instance snapshot rows are untouched. No offline
migration step, no downtime, per-environment automatic.

- Conditions/SQDPC: ratings map → one row per key/date.
- KPI: points → rows keyed by point id; target/usl/lsl/unit stay in doc.
- Pareto: current counts → a single day-count row each, dated the
  migration day (history before that never existed as dates).

## Phases

| Phase | Scope | Size |
| --- | --- | --- |
| 1 | Table in schema + Dev deploy + datasource regen; `store/series.ts` (windowed read, upsert, delete, decompose); **Conditions + SQDPC** mounters; self-heal; role provisioning (Ben) + runbook; tests | ~1 session |
| 2 | **KPI trend** (points → rows, window config, action-key continuity) | ~½ session |
| 3 | **Pareto** (day-counts, count-edit semantics, definitions-only doc) | ~½–1 session |
| 4 | **Status tile** change-logging (write-only) | tiny |

Every phase lands with the standard verification chain (root+app tsc,
vitest, PCF+app builds, dev-harness proof), a `pac code push`, and a commit;
releases cut on request. Docs updated as we go: the master data-policy
section gains a "series cards" subsection, and each card's doc page states
its window.

## Risks / limits checked

- Alternate-key byte budget fits (≤ 560 bytes of text + date).
- Reads are one filtered query per series card per board open — indexed by
  the alternate key's leading columns; volumes are small (a window is
  ≤ ~250 rows for the largest case, SQDPC shift-grain month).
- Actions, tiles, and the no-re-render Embed architecture are unaffected.
- Table + role changes ride the existing release pipeline (managed
  solution export already includes the whole LeanToolKitData solution).
