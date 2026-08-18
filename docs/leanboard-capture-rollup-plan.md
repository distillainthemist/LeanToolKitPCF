# Capture Rollup — plan of record

(2026-08-15. Decisions Ben's, same date.) **STATUS: R0–R4 BUILT and
released in v0.45.0 (2026-08-16).** Ben's hosted checks pending on the
released build; findings feed the backlog.

A new board card, **Capture rollup**, that merges rows from Capture cards
on other boards/rituals into one filtered, column-projected table — plus a
new **Flag** column type on the Capture card that feeds its headline
filter.

## Decisions of record (Ben, 2026-08-15)

1. **Flag = a new Capture column type**, alongside text/number/decimal/
   yes-no/picklist. Renders ⚑ in the grid, a toggle in the row dialog.
   The rollup finds flag columns **by type**, never by name.
2. **Occurrence window is a card-level setting** on the rollup:
   *Current content* (the LinkCard rule — live row for shared sources,
   newest non-empty meeting document for carry/clear) or *Last N
   occurrences* (merge the newest N non-empty instance documents per
   source, deduplicated by row id, newest occurrence wins).
3. **Write-back is allowed, governed by a card setting** with three
   levels: **Read-only** · **Un-flag only** · **Full edit**. Concurrent-
   edit risk accepted as low; mitigated by read-modify-write (re-read the
   source document at save time, apply the one-row mutation, write).
   No row creation or deletion from the rollup — those belong to the
   source board.
4. **Layout: one merged table** with a leading Source column (board
   name; occurrence date added when the window reaches past current).
5. **Flagged-only filter hides sources without a flag column** entirely;
   the settings UI warns "no Flag column" beside such a source.

## Column matching

Cells are stored by column **key**, but keys are auto-slugged from labels
and hand-editable, so independently built cards can share a label with
different keys. The rollup therefore matches **by label, case-insensitive
and trimmed**: the maker picks display columns by name; each source
resolves that name to its own column key (first match wins). A source
lacking the column shows — in that cell. The settings picker builds its
name list from the **union** of the selected sources' column labels and
marks names missing from any source ("not in all sources").

## Architecture

The rollup is a multi-source LinkCard, and it reuses that road:

- **Reads** go through the existing store primitives per source:
  `getBoard` → `parseManifest` (slot gives `columnsJSON` + policy),
  `rowsForBoard`, `listInstances`; document choice per window rule
  reuses `pickLinkContent`'s semantics (extended for last-N).
- **Its own document is a minimal envelope** (`ltk/capturerollup@1`,
  data `{}`) with a **fixed `shared` policy** — not because it stores
  content, but because that gives board tiles and close-meeting archive
  stamps through the standard save/snapshot road with zero special
  cases (the live row holds the freshest rendered tile; archiveSlots
  already stamps shared cards).
- **Write-back** patches the *specific* card-data row a merged row came
  from (each merged row carries its source doc's row GUID), via a narrow
  `updateOutputJson(rowGuid, json)` — never `saveCard`, which would
  clobber the source's tile svg.
- **No chains**: `CaptureRollup` joins `LINK_SOURCE_EXCLUDED`, and its
  own source picker offers only `CaptureCard`-type slots.
- **No actions channel** (like LinkCard/EscalationViewer surfaces).

## Phases

### R0 — Flag column type (shippable alone)

- `controls/CaptureCard/types.ts`: `ColumnType` gains `"flag"`;
  `parseColumns` accepts it. Value shape: boolean (same as yesno).
- `controls/CaptureCard/editor.ts`: grid cell renders ⚑ (accent) when
  true, — when not; row dialog gets a flag toggle (checkItem styled with
  the glyph). Flag columns count as "plain" for the simple-card font
  scaling.
- `controls/CardSettings/captureColumns.ts`: type dropdown gains "Flag".
- `controls/CardSettings/registry.ts`: help text mentions it.
- Tests: parseColumns round-trip incl. flag; builder emit.

### R1 — Rollup model (pure, unit-tested)

`controls/CaptureRollup/types.ts`:

- Config parsers: `sources` (`[{boardId, cardId}]`), `columns`
  (list of names), `flaggedOnly` (bool), `window`
  (`current` | `lastN` + n), `writeMode`
  (`readonly` | `unflag` | `full`).
- `projectRollup(resolvedSources, columnNames, flaggedOnly)` — pure:
  label→key resolution per source, flag-column detection by type,
  flagged-only filtering (flag-less source ⇒ no rows while on),
  last-N merge deduplicated by row id (newest wins), emits display rows
  `{source: {boardName, when}, ref: {docRowGuid, rowId}, cells}`.
- Minimal envelope `ltk/capturerollup@1`.

### R2 — Store road

`app/src/store/rollup.ts`:

- `loadRollupSources(sources, window)` — per source, resolve board name,
  slot (columns config + policy), and the window's documents
  (`{rowGuid, instanceWhen, envelope}[]`), reusing boards/cards/instances
  stores. Missing board/slot/non-capture → a per-source failure the card
  reports inline (mirrors LinkCard's notes).
- `updateOutputJson(rowGuid, json)` in `store/cards.ts` (outputJson only).
- Write-back helper: re-read the row by GUID, parse fresh, mutate the one
  row's cells (or flag), serialize, write. Row vanished → surface
  "changed on the source board — refresh".

### R3 — Card + settings

- `controls/CaptureRollup/editor.ts`: merged table (Source + selected
  columns, capture's cell renderers reused), flagged-only respected,
  loading state, per-source error notes, row dialog per write mode.
  **Full-edit reuses the Capture row dialog's field builders** —
  extracted from `CaptureEditor` into `controls/CaptureCard/fields.ts`
  (pure refactor, both editors consume it). Un-flag mode: view + one
  "Remove flag" button. Snapshot/tile via the standard scheduler.
- `app/src/cardRegistry.ts`: `CaptureRollup` mounter (load → render →
  write-back wiring, readOnly collapses writeMode to readonly).
- `controls/CardSettings/registry.ts`: card spec (group "Rituals",
  policies `["shared"]`), `LINK_SOURCE_EXCLUDED` + rollup.
- `controls/CardSettings/types.ts`: `BoardRef` cards gain
  `captureColumns?: string[]` (labels) + `hasFlag?: boolean`;
  `app/src/screens/composer.ts` fills them from each slot's settings
  while building boardRefs (no new queries).
- `controls/CardSettings/editor.ts`: a Sources section (add/remove rows
  of board+card selects, CaptureCard slots only), a column-name picker
  fed by the union of the chosen sources' labels with "not in all
  sources" and "no Flag column" warnings, plus the window / flagged-only
  / write-mode fields.

### R4 — Gates, tests, push

- New tests: R1 parsers + projection (windowing, dedupe, label
  matching, flag rules); registry/policy matrix tests extended for the
  new card type; fields extraction covered by existing capture tests.
- Full gate chain, then `pac code push`; Ben's hosted checks: build a
  rollup over two boards' capture cards (one with a flag column, one
  without), verify filter, window, un-flag and full-edit write-back,
  and that close-meeting archives a rollup tile.
