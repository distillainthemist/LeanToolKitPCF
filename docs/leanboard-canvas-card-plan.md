# Canvas card — plan of record

(2026-08-15; scope expanded same day. Decisions Ben's.) **STATUS: C0–C5
BUILT (v0.45.0); design-mode revision D0–D3 BUILT (v0.45.0); D4 =
Ben's hosted pass. Post-review tweaks shipped: CANVAS_STEP 44→60 (a
one-row field must hold label + a chip), body top/bottom padding, the
kebab "Actions…" removed in favour of the focused editor's universal
＋ Action (v0.45.1). Chunk-ceiling lesson: the pure draft model was
extracted to `CanvasCard/draft.ts` so the mounter's reverse channel
stays out of the settings editors' weight.**

A new board card, **Canvas** (`CanvasCard`), for charter-style one-pagers:
a maker lays out typed, titled fields in a 1–3 column grid (drag to
reorder, per-field width and height), and users fill them in on the card.
Project charters, plans-on-a-page, quad charts. Plus a **Canvas rollup**
(`CanvasRollup`) — the portfolio view: one row per linked canvas card.

## Decisions of record (Ben, 2026-08-15)

1. **Fill-in is HYBRID**: typing types edit inline on the card (text,
   long text, rich text, number, decimal, date, date range, percent,
   URL); tap-set types act inline (yes/no toggle, rating, checklist
   ticks); picker types open a dialog (choice, multi-choice, person,
   people, status); mini-table rows edit through the capture row dialog;
   image via pick/paste dialog.
2. **The layout designer lives in a settings "Layout" tab** (the capture
   columns builder's pattern) — drag-to-reorder field list with type /
   title / width / height / required controls; the card studio's live
   pane previews as you build. No in-card design mode.
3. **v1 ships TWENTY types** (expanded from fifteen): heading/section,
   text, long text, **rich text**, number, decimal, date, date range,
   choice, multi-choice, yes/no, person, people, status/RAG,
   percent/progress, URL, **checklist**, **rating**, **mini-table**,
   **image**. Plus a **required** flag per field.
4. **Person/people fields pick board people first + an "anyone" search**
   over the whole app roster behind it.
5. **Name: Canvas** (type id `CanvasCard`, permanent).
6. **Actions are CARD-LEVEL only** (standard channel via the action
   manager — no per-field raising; explicitly rejected).
7. **A dedicated Canvas rollup card**, equivalent to the Capture rollup.
8. **Capture cards KEEP their row dialog** — hybrid entry is not
   retrofitted. A capture row is a record entered in one burst; the
   dialog groups its cells and stays touch-safe, and the rollup
   write-back reuses it. Consistency lives in the shared vocabulary
   (same picker dialogs, chips and cell renderers via
   CaptureCard/fields.ts), not the same entry mode.

## Design principles

- **Layout is design, values are content.** The grid (columns count +
  field list) lives in the slot's settings config (`canvasJSON`);
  filled-in values live in the document envelope keyed by **field id**.
  Restructuring a layout never loses content; templates, policies and
  the card studio work unchanged. Deleting a field orphans its value
  harmlessly (kept in the doc, not rendered).
- **Flow grid with spans, not free x/y.** Fields carry `w` (1..cols)
  and `h` (height STEPS, ~60px) and flow in list order. A quad chart is
  2 columns × 4 tall fields. Deterministic snapshots; stacks to one
  column on phones.
- **Display-first rendering.** Every field renders its value as styled
  DISPLAY content; interacting swaps in the inline editor or opens the
  picker. This keeps tile snapshots true (htmlToSvg can't see live
  input state) and makes read-only free.
- **Status/RAG rides the app state palette** (stored as palette KEY).
  Choice options reuse the capture option shape (value/label/icon).
- **People stored as `{id, name}` snapshots** so a charter still renders
  when someone leaves the roster.
- **Mini-table IS the capture machinery**: its per-field config is a
  `CaptureColumn[]`, its value is capture rows, its cells render via
  `renderCaptureCellInto`, its row dialog is `buildCaptureField` +
  `readFields`. The R3 extraction makes this a composition, not a build.
- **Rich text is a narrow allowlist, sanitised by REBUILDING**: a pure
  tokenizer keeps only b/strong, i/em, u, p, br, ul/ol/li and
  a[href http/https] — attributes rebuilt from scratch, everything else
  escaped. Pure = unit-testable in the node vitest environment (no DOM
  dependency, no new dev deps); the contenteditable editor's output is
  passed through it on every write AND on render, so stored HTML is
  never trusted either.
- **Images are shrunk on ingest** (the issues dialog's canvas-shrink
  road, extracted to `shared/` so both consumers use one implementation;
  max ~800px JPEG, data URI). Oversized tile SVGs already fall back to
  the default tile (existing 190KB guard) — an image-heavy canvas may
  cost its tile fidelity, never its data.
- **Required is a marker, not a gate.** A charter is a living document
  with no submit moment: empty required fields show a subtle "needed"
  mark and the card shows "N to complete"; nothing blocks saving.
- **A Canvas card is a valid LinkCard source** (a charter mirrored
  read-only on a tier-2 board). The ROLLUPS are excluded from link
  sources, as ever.

## Field model

```
CanvasField {
  id: string             // stable key for values
  type: one of the 20
  label: string
  w: 1..cols             // column span
  h: 1..8                // height steps; heading auto-heights
  hint: string           // placeholder/prompt when empty
  required: boolean
  options: ListOption[]  // choice/multi-choice (capture shape)
  columns: CaptureColumn[]  // mini-table only
}
CanvasConfig { cols: 1|2|3, fields: CanvasField[] }
```

Envelope `ltk/canvas@1`, data `{ values: Record<fieldId, CanvasValue> }`.
Value shapes: string (text/longtext/url/date/choice/status-key), string
(sanitised HTML for richtext), number (number/decimal/percent/rating),
boolean (yesno), string[] (multichoice), {start,end} (daterange),
{id,name}[] (person = length 1, people), {text,done}[] (checklist),
CaptureRow[] (minitable), string data-URI (image). All parsing
defensive per type.

## Canvas rollup (`CanvasRollup`)

The portfolio view, equivalent to the Capture rollup but TRANSPOSED:
**one row per linked canvas card** (a charter is the record), columns
picked from the union of the sources' field LABELS (same
case-insensitive matching rule — each source resolves a label to its
own field id). Cells render with the canvas display renderers (status
chips, percent bars, people initials…).

- **Window: current content only** (the LinkCard rule — live row for
  shared, newest meeting document otherwise). No last-N: a portfolio of
  historical charter states is noise; the plan-of-record is current by
  definition.
- **Write modes: read-only / full** (a card setting, as before). Full
  edit opens the SAME field editors/pickers the canvas uses, per cell,
  writing back read-modify-write to the specific source document
  (`writeBackRow`'s road, generalised). No un-flag analogue — canvas
  has no flag; a status/choice-value FILTER is logged as a fast-follow
  if portfolios grow.
- Source row click-through shows the full charter read-only (all
  fields, the rollup's dialog), with board/card named.
- Sources tab mirrors the capture rollup's (CanvasCard slots only,
  stale warnings, column picker over the label union with not-in-all
  marks); BoardRef cards gain `canvasFields?: string[]` the same way.
- `LINK_SOURCE_EXCLUDED` gains CanvasRollup; a rollup can never source
  a rollup.
- Store road: extract the shared source-resolution skeleton from
  `store/rollup.ts` (board → slot → window docs) so capture and canvas
  rollups share it; the projection differs per kind.

## Phases

### C0 — pure model (`controls/CanvasCard/types.ts` + sanitiser)

Config parser (defensive, id-generating, w/h clamped), all twenty value
parsers/serializers, envelope, display formatting helpers, the
`sanitizeRichText` rebuilder, required-completeness counter
(`missingRequired(config, values)`). Unit tests: parsing, clamping,
round-trips, orphaned values, sanitiser policy table (script/style/
event-handler/javascript-href stripping, nested list survival).

### C1 — settings Layout builder (`controls/CardSettings/canvasFields.ts`)

A dedicated `canvasFields` FieldKind: columns-count select, then one
row per field — drag handle (`draggableRow`), label, type select, width
select, height stepper, required toggle, ✕ — with sub-editors for
choice options (capture-style) and mini-table columns (the
captureColumns builder's core, extracted for reuse). Emits sparse
`canvasJSON`.

### C2 — the card, display + inline layer (`controls/CanvasCard/editor.ts`)

CSS grid + spans + phone stacking; display renderers for all twenty
types (muted hint when empty, required marks, "N to complete" chip);
inline editors for the typing types; tap-set for yes/no, rating,
checklist ticks. Debounced envelope commits, snapshots, PNG/SVG kebab.

### C3 — the card, dialogs + heavy types

Picker dialogs (choice/multi as option-chip checklists, status as
palette chips, person/people as board chips + roster search); the rich
text editor (contenteditable, minimal toolbar: bold/italic/bullets/
link, sanitise on every write); image field (shared shrink extraction
from the issues dialog; pick + paste); mini-table (capture row dialog
per row, add/delete); **card-level actions** — an Actions entry via the
action manager on the standard channel (stamped instanceKey,
disableActions honoured, off at design time).

### C4 — mounter + registry wiring + ship

CardRegistry mounter (config, palette, `opts.people` + new optional
`CardMount.roster` from cardEditor's `memo("roster")`; studio passes
what it has; absent roster degrades to board people). CardSettings
spec: group "Project management", standardContent "edit" (the live row
is the authored template), policies clear/carry/shared, default
**carry**. Full gates + `pac code push`. Hosted checks: build a quad
chart + a charter template in the studio, fill every type in a
meeting, phone stacking, snapshot fidelity, LinkCard mirror, carry
across a new instance, image-heavy tile fallback.

### C5 — Canvas rollup

Pure model (label matching, transposed projection, current-window
pick) + shared store-road extraction + the card (portfolio table, row
click-through, per-cell full-edit write-back) + Sources tab + BoardRef
`canvasFields` enrichment + tests + gates + push. Hosted checks: two
charters on two boards rolled up, cell edit writes back, read-only
mode, stale source warning.

## Design-mode revision — "canvas is the editor" (Ben, 2026-08-15)

The C1 Layout tab shipped, and a design review found what a one-way
studio must produce: no direct manipulation, no grid affordance, no
drop target, no selection link, no design-time preview (a mini table
rendered as an empty box), inconsistent empty states, invisible
required, no label validation. Root cause: the studio flows settings →
card only; nothing flows back. Decision 2 ("no in-card design mode") is
REVISED: the canvas card gets a **design mode, studio-only** (the
runtime card never enters it), and the settings pane becomes the
property panel of the *selected* field — the keyboard-accessible
equivalent, not the only route.

**Decisions of record:**
- **Flow grid with spans stays** — drag = reorder, resize = spans,
  zero migration. Free x/y placement rejected (anchor coordinates,
  empty-cell semantics, mobile reflow, no gain for charters).
- **Design mode is studio-only, board mode, CanvasCard only.**
- Undo/redo = studio-session stack of canvasJSON snapshots.
- One empty-state rule: at DESIGN time a field advertises its TYPE
  (type-true skeleton, `Long text · "hint"`); at RUN time it shows its
  hint, else an em dash. Required renders ✱ at both times.

### D0 — reverse channel + selection bridge (studio plumbing, generic)
`CardMount.designLayout?: boolean` (this mount is THE layout editor)
and `CardMount.onConfigPatch?: (key, value) => void`; the studio applies
patches to `draft.config`, marks dirty and repaints the settings pane
WITHOUT remounting the card (the card already reflects itself).
Selection bridge both ways: `CardMount.onSelectField?(id)` →
`CardSettingsEditor.setSelection(id)`; inspector block focus →
`CanvasEditor.selectField(id)` via a studio-held handle. Undo/redo
stack in the studio (`canvasJSON` snapshots; undo re-applies and
repaints both panes). Nothing canvas-specific — any card can take the
door.

### D1 — design-mode rendering (`CanvasEditor.setDesignMode`)
Canvas toolbar replacing the kebab: Columns 1/2/3, Grid toggle,
Undo/Redo, Preview (design mode off = today's studio pane, now the
check). Gridlines + gutters + faint empty trailing cells when Grid is
on. Per field: type glyph, required ✱, type-true skeleton (mini table
= configured headers with — cells; long text = honest height; person =
picker look). Selection outline with live "2 × 3" readout; ⋮⋮ handle
and resize handles on the selected field only. Permanent last row:
"Drop a field here · + Add field".

### D2 — direct manipulation (pointer events)
Drag ⋮⋮ to move (insertion marker; release = reorder), right edge =
width snapping to column boundaries, bottom edge = height snapping to
60px steps, corner = both, readout live. Add field from the drop zone
→ text field, selected, label focused in the inspector.

### D3 — inspector as property panel + validation
Layout tab = compact field list (drag handles kept as the keyboard
route) with the SELECTED field's block expanded: label (spellcheck on,
empty-label and DUPLICATE-label warnings — duplicates break the Canvas
rollup's label matching), type, id, hint, required, w/h selects,
options / mini-table columns. Canvas click ↔ inspector block selection
both ways.

### D4 — gates, push, hosted pass on a rebuilt charter.

## Deferred (logged, on evidence)

Computed/derived fields (dependency graph — needs a concrete recurring
case), status/choice-value filter on the Canvas rollup, inline add-row
affordance on Capture cards (only if testers ask), canvas fields as
CAPTURE-rollup sources (superseded by the dedicated Canvas rollup).
Rejected: per-field action raising (card-level only, Ben 2026-08-15).
