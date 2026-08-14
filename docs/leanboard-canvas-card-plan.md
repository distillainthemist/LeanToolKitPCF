# Canvas card — plan of record

(2026-08-15. Decisions Ben's, same date.)

A new board card, **Canvas** (`CanvasCard`), for charter-style one-pagers:
a maker lays out typed, titled fields in a 1–3 column grid (drag to
reorder, per-field width and height), and users fill them in on the card.
Project charters, plans-on-a-page, quad charts.

## Decisions of record (Ben, 2026-08-15)

1. **Fill-in is HYBRID**: typing types edit inline on the card (text,
   long text, number, decimal, date, date range, percent, URL; yes/no is
   a click toggle); picker types open a dialog (choice, multi-choice,
   person, people, status).
2. **The layout designer lives in a settings "Layout" tab** (the capture
   columns builder's pattern) — drag-to-reorder field list with type /
   title / width / height controls; the card studio's live pane previews
   as you build. No in-card design mode.
3. **v1 ships all fifteen types**: heading/section, text, long text,
   number, decimal, date, **date range**, choice, multi-choice, yes/no,
   person, people, status/RAG, **percent/progress**, **URL**.
4. **Person/people fields pick board people first + an "anyone" search**
   over the whole app roster behind it.
5. **Name: Canvas** (type id `CanvasCard`, permanent).

## Design principles

- **Layout is design, values are content.** The grid (columns count +
  field list) lives in the slot's settings config (`canvasJSON`);
  filled-in values live in the document envelope keyed by **field id**.
  Restructuring a layout never loses content; templates, policies and
  the card studio work unchanged. Deleting a field orphans its value
  harmlessly (kept in the doc, not rendered).
- **Flow grid with spans, not free x/y.** Fields carry `w` (1..cols)
  and `h` (height STEPS, not pixels) and flow in list order. A quad
  chart is 2 columns × 4 tall fields; a title block is a full-width
  field. Deterministic snapshots; stacks to one column on phones.
- **Display-first rendering.** Every field renders its value as styled
  DISPLAY content; clicking swaps in the inline editor (or opens the
  picker dialog), blur/save swaps back. This is what makes tile
  snapshots true (htmlToSvg can't see live input state) and read-only
  free.
- **Status/RAG rides the app state palette** (stored as palette KEY,
  resolved at mount like every palette consumer). Choice options reuse
  the capture card's option shape (value/label/icon).
- **People stored as `{id, name}` snapshots** so a charter still renders
  when someone leaves the roster.
- **A Canvas card is a valid LinkCard source** — a charter surfaced
  read-only on a tier-2 board is exactly what LinkCard is for. (Not
  excluded; works automatically.)

## Field model

```
CanvasField {
  id: string          // stable key for values ("f-<slug/nanoid>")
  type: one of the 15
  label: string       // the field's title, shown above the value
  w: 1..cols          // column span
  h: 1..8             // height steps (~44px each); heading auto-heights
  hint: string        // placeholder/prompt shown when empty
  options: ListOption[]  // choice/multi-choice only (capture shape)
}
CanvasConfig { cols: 1|2|3, fields: CanvasField[] }
```

Envelope `ltk/canvas@1`, data `{ values: Record<fieldId, CanvasValue> }`
with per-type defensive value parsing (string / number / boolean /
string[] / {start,end} / {id,name}[]).

## Phases

### C0 — pure model (`controls/CanvasCard/types.ts`)

Config parser (defensive, id-generating for missing ids, w/h clamped to
the grid), value parsers/serializers per type, envelope, display
formatting helpers (percent, date range, person initials via
`initialsFor`). Unit tests for parsing, clamping, value round-trips,
orphaned values.

### C1 — settings Layout builder (`controls/CardSettings/canvasFields.ts`)

A dedicated `canvasFields` FieldKind (the `captureColumns` precedent):
columns-count select, then one row per field — drag handle
(`shared/ui/dragList.ts` `draggableRow`), label (auto-hint), type
select, width select, height stepper, ✕ — with an options table for
choice types (label + icon, capture-style). Emits the sparse
`canvasJSON` config. Registered in the CanvasCard spec.

### C2 — the card (`controls/CanvasCard/editor.ts` + `styles.ts`)

- CSS grid (`repeat(cols, 1fr)`, `grid-auto-rows` = step), spans from
  `w`/`h`, single-column stack under ~480px.
- Display renderers per type (value → styled content; muted hint when
  empty); inline editors swapped in on click for typing types; dialogs
  for pickers — choice/multi-choice as option-chip checklists, status as
  palette chips, person/people as board-people chips + a search input
  over the full roster ("anyone" search).
- `setPeople(boardPeople, roster)`, `setTheme`, `setChrome`,
  `setReadOnly` (display-only), `setPalette` for status colours.
- Debounced envelope commits through the standard saver; snapshot
  scheduler; PNG/SVG downloads in the kebab.

### C3 — mounter + registry wiring

- `cardRegistry.ts`: CanvasCard mounter — config from
  `cfgRaw("canvasJSON")`, palette via `pal(opts)`, people from
  `opts.people` + a new optional `CardMount.roster` (full app roster —
  cardEditor already holds `memo("roster")`; the studio passes what it
  loads; absent roster degrades to board people only).
- CardSettings spec: group "Project management", standardContent
  "edit" (the live row is the authored template — a pre-structured
  charter), policies clear/carry/shared, default **carry**.
- No actions channel in v1 (raise-an-action-from-a-field is a later
  candidate).

### C4 — gates, tests, push

Full gate chain + `pac code push`. Ben's hosted checks: build a quad
chart and a charter template in the studio, fill one in a meeting
(inline + every picker), phone stacking, snapshot tile fidelity,
LinkCard onto another board, carry across a new meeting instance.

## Deferred (logged, on evidence)

Checklist field, rating field, embedded mini-table, image field, rich
text (plain multiline with line breaks stands), computed fields,
required-field validation states, per-field action raising, Canvas
fields as Capture-rollup sources.
