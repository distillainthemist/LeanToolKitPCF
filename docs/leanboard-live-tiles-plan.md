# Live tiles — hybrid plan

*Drafted 2026-07-25. Status: proposed, not started. Each phase is one sitting,
independently shippable, with its own verification.*

## Why this is on the table

Snapshot tiles were never a rendering preference — they were a workaround.
[master-leanboard.md](master-leanboard.md) states the constraint plainly:
*"PCF controls cannot nest other PCF controls, and canvas apps do not allow
code components inside galleries — so a config-driven grid of **live** cards
is not buildable."* The board therefore stores a rendered SVG per card and
paints those.

That platform limit is gone. The code app mounts editor classes directly, so
a grid of live cards is now just a grid of live cards.

## The shape: live present, snapshot past

> **Render the current instance live. Keep the stored snapshot as the
> archive.**

- Opening the **current** board → cards mount live from their documents (plus
  series rows). Always matches current code and styling.
- Opening a **past** instance → renders that instance's stamped tile SVG,
  exactly as today. History stays a record, not a reconstruction.

This is the split that keeps the audit property while killing drift where it
actually bites.

## What it removes

- `tools/tile-defaults.json`, the generator page + `app/src/tools/
  tileDefaults.ts`, the dev-server write endpoint, `selfHealCatalog()`,
  `ben_defaultsvg`, and `catalogSvgByType()` — **an unopened card renders its
  own empty state**, so there is nothing to pre-generate, ship or heal. The
  whole defaults pipeline stops existing.
- Per-board tile payload. `rowsForBoard()` fetches every column, so a board
  open currently pulls `ben_outputjson` **and** `ben_tilesvg` (capped at
  190,000 chars each; a real SQDPC tile measured 47.8 KB). Documents are
  already being fetched — the tile bytes are pure addition.

## What it keeps

- **The snapshot pipeline stays**, but becomes archive-only: the debounced
  `htmlToSvg` → `onSnapshot` → `saveCard` path keeps each live row's tile
  current so `stampArchiveSvg()` has something to stamp at meeting close.
  Post-phase-3 that costs ~0.3 ms per edit, so it is no longer worth
  optimising away.
- **EmbedCard's placeholder** — a cross-origin iframe can never be captured
  or live-rendered in a tile.

## The real cost: series cards

Five cards deliberately do **not** keep their data in the document. The
card-series work moved SQDPC, Winning Conditions, KPI trend, Pareto and
StatusTile into `ben_LTKCardSeries`; the SQDPC mounter literally saves
`{...env2.data, ratings: {}}`. Their documents are tile-carriers and
definition-holders.

So live tiles for those five need series rows windowed to the instance date.
This is the single largest cost in the change and must be **one batched query
per board**, not one per card.

## Phases

### Phase 0 — baseline  *(half a sitting)*

Measure before changing anything, so the trade is evidenced rather than
argued: board-open wall time and transferred bytes for a representative board
(and a deliberately large one), today. Record in this file.

Also decide the tile budget: at what card count does live mounting stop being
acceptable on the target tablet? That number drives whether phase 3 needs
virtualisation.

### Phase 1 — tile mode  *(the enabling change)*

Add `tile: true` to `CardMount`. In tile mode a card renders **display only**:
no kebab, no dialogs, no action affordances, no pan/zoom controls,
`pointer-events: none` on the card body, and pan/zoom cards (Fishbone,
ProcessMap, FiveWhys, FaultTree) fit-to-content on mount.

Verify in the dev harness against a checklist per card — this is where fidelity
is won or lost, and it is worth being fussy.

### Phase 2 — live tiles for the current instance  *(the visible change)*

BoardGrid gains a live mode: instead of `renderSnapshot()` staging serialised
`foreignObject` children, each slot gets a real host div at logical size
(640×420) with the existing `transform: scale()` fit. The board screen mounts
tile-mode cards into them.

Feature-flag it (board setting or app config) so it can ship dark and be
compared side by side with stored tiles.

Verify: a board renders identically live vs from its stored tiles, card for
card, at several grid sizes.

### Phase 3 — series windowing  *(the cost)*

One batched `listSeries` for every series card on the board, windowed to the
instance date, fanned out to the five card types. Measure against phase 0;
if it regresses the budget, mount only visible tiles and hydrate on scroll.

### Phase 4 — archive split  *(the correctness guarantee)*

Current instance → live. Past instance → stored tile. `stampArchiveSvg()` and
the per-save snapshot are untouched. A past board must render byte-identically
to today's behaviour — that is the acceptance test.

### Phase 5 — retire the defaults pipeline  *(the payoff)*

Delete `tools/tile-defaults.json`, the generator, the write endpoint,
`selfHealCatalog()`, `catalogSvgByType()` and `ben_defaultsvg` usage, and mount
live empty cards in the composer's picker too. The Card Catalog table keeps its
type/label/description columns; only the art goes.

Do this **last**, and only once phases 2–4 are proven hosted — until then the
defaults are the fallback.

## Risks

- **Mount cost scales with card count.** Fine at 6, questionable at 20.
  Phase 0 sets the budget; virtualisation is the escape hatch.
- **Fidelity drift between tile mode and the real card** — a tile that hides
  affordances can hide a layout bug too. Mitigate with the phase 1 checklist
  and side-by-side comparison in phase 2.
- **A rendering change retroactively alters live tiles but not archived ones.**
  That is the intended asymmetry, but it means a board and its own history can
  look different. Worth stating in the UI ("archived view") rather than leaving
  users to notice.
- **Editors assume they own their host.** Tile mode must not let a card grab
  focus, open a dialog, or install window-level listeners — several install
  pointer handlers on `window` in their constructors.

## Cheap alternative, for the record

If this is judged not worth it, the status quo is already sound: the generator
is ported and runnable, so defaults can be refreshed per release, and phase 3
of the retirement made snapshots ~167× cheaper. Live tiles are an improvement,
not a rescue.
