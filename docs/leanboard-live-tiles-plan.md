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
- **EmbedCard's placeholder** — a cross-origin iframe can never be *captured*.
  Once tiles are live it can be *rendered*, which is what phase 6 exploits;
  the placeholder remains the fallback for cards that do not opt into
  preloading.

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

### Phase 0 — baseline — ✅ **DONE 2026-07-25**

`app/bench-tiles.html` times both paths as **main-thread blocking time**
(stored-SVG staging vs mounting live editors, four card types round-robin,
best of three after a warm-up). Measured on the dev Mac:

| cards | stored | live | ratio |
|---|---|---|---|
| 4 | 4.4 ms | 8.6 ms | 2.0× |
| 8 | 9.4 ms | 17.8 ms | 1.9× |
| 12 | 17.7 ms | 28.4 ms | 1.6× |
| 20 | 33.9 ms | 67.3 ms | 2.0× |

**Live mounting costs ~2× the main thread, but the absolute cost is small and
linear** — 20 cards is 67 ms, against the ~50 ms that phase 3 saved on a
*single* card edit. The feared blocker is not there.

Where the real cost sits: stored tiles average **24.5 KB per card**, so a
20-card board fetches roughly **490 KB of tile memo** it would no longer need.
On a tablet over site wifi that dominates the 33 ms of painting it saves.
Conclusion: **the network, not the CPU, is the thing live tiles improve** —
and the series queries in phase 3 are therefore the number that decides this,
not mounting cost.

Caveats, stated so the number is not over-read: a dev Mac is 4–8× faster than
the target tablet (20 cards ≈ 270–540 ms there — acceptable, but *measure it*,
which is why the bench is committed rather than thrown away); these are
empty-state cards, so populated ones build more DOM; and it excludes both
series fetches and iframe loads.

**Budget:** 20 cards live is fine on desktop. Re-run `bench-tiles.html` on the
meeting-room tablet before phase 2 ships; if 20 cards exceeds ~500 ms there,
mount only on-screen tiles (the phase 3 escape hatch) rather than abandoning
the approach.

### Phase 1 — tile mode — ✅ **DONE 2026-07-25**

`mountTile(cardType, opts)` in `app/src/cardRegistry.ts`. The contract lives in
one wrapper rather than in 24 editors, and is deliberately belt-and-braces —
a tile that can be typed into, or that can write, is a data-loss bug on a
shared meeting screen:

- `readOnly: true` — the editors' own switch, which drops most affordances;
- an `ltk-tile` class on the host — `pointer-events: none` plus rules hiding
  the chrome that survives readOnly (kebab, info button, zoom clusters,
  ProcessMap's palette, Fishbone's ⊕ adds and read-only badges, EmbedCard's
  rich-text toolbar, Agenda's disclosure carets);
- **no writes** — `onSave`, `onTile` and `onActions` are no-ops, so a tile can
  never overwrite the document or the snapshot it was rendered from.

It also hides `.ltk-titlebar`: BoardGrid draws a title chip per slot, so a
tile rendering its own bar would duplicate the title — the same defect that
had to be stripped out of stored snapshots.

**Verification: `app/tile-mode.html`** mounts all 19 types through
`mountTile` and audits each for surviving kebabs, buttons, inputs, focusable
elements, live pointer events and blank output. **19/19 clean.** Agenda's
three section headings are declared in an `ALLOWED_BUTTONS` map with a
reason — they are content that happens to be a `<button>` — so the audit
fails if that count ever moves, rather than the exception being hidden.

Two things the audit taught, both worth keeping:
- Its first version checked `getComputedStyle(el).display`, which still
  reports the element's own value inside a `display:none` parent — so it
  missed everything hidden by a container rule and reported false failures.
  It now uses `checkVisibility()`, which walks ancestors.
- Results computed at page-load can predate an HMR stylesheet update; a card
  looked broken that had already been fixed. Re-load before believing a row.

Not needed after all: fit-to-content on mount. Fishbone already fits its
viewBox to content, and ProcessMap's `setModel(data, true)` requests a fit.

### Phase 2 — live tiles for the current instance — ✅ **DONE 2026-07-25**

`BoardGridEditor.setLiveRenderer(fn | null)`. When set, each slot stages a
host at `LIVE_TILE_W × LIVE_TILE_H` (640×420) and the host mounts a card into
it; the existing `transform: scale()` fit is reused unchanged, so live and
stored tiles are laid out by the same code. `null` restores stored rendering,
which is what makes them directly comparable.

The renderer is **supplied by the app, not imported** — BoardGrid is a
platform-free card like any other and must not depend on the app's registry.
`app/src/screens/board.ts` provides it, deriving each card's data from what
the board already holds (manifest slot → settings/title, joined card row →
document). Board actions are the one extra read, and only when live is on.

`clearLive()` runs before every re-render and on destroy. Without it each
re-render would leak an editor per tile; verified stable at 8 stages / 8 card
roots across six consecutive re-renders.

**Flag:** a status-light button in the board toolbar — **Live board** (green
dot) / **Stored board** (grey) / **Archived board** (grey, a closed meeting) —
remembered in `localStorage` under `ltk.liveTiles`.

**Live became the DEFAULT on 2026-07-25**, after hosted confirmation. Only an
explicit opt-out (`"0"`) turns it off. The toggle stays rather than being
removed: a stored wall is one click away if a card ever misbehaves in front of
a meeting, and a closed meeting uses the same control to show that it is
rendering its archive.

**Verification: `app/board-live.html`** renders the same eight-card board both
ways, side by side. At 2, 3 and 4 columns: 8/8 live stages filled, slot
geometry byte-identical between the two grids, and zero visible titlebars
inside live tiles (the duplication phase 1 guarded against).

**Live is FASTER than stored** — 10.8 ms vs 21.4 ms for eight cards, and phase
0's 2× penalty does not survive contact with the real stored path. Phase 0
compared mounting against a simplified staging routine; BoardGrid's actual
`renderSnapshot` also runs `DOMParser`, `sanitizeSvg` and `importNode` per
tile, and that costs more than constructing the editors. Combined with the
24.5 KB per card that no longer has to be fetched, the CPU argument against
live tiles is now gone in both directions.

One expected difference in the harness: ProcessMap's stored default tile is
seeded with a three-node flow, while its live tile has no document and shows
the empty state. That is the seed doing its job, not a rendering fault.

### Phase 3 — series windowing — ✅ **DONE 2026-07-25**

Batched in `store/series.ts`, **not** at the call sites: `listSeries` requests
landing in the same microtask are merged into one query over the union of
their windows, restricted to the cards asked for, then split back up. Every
caller sees exactly the rows it would have seen alone. A full board's five
series cards therefore cost **one query instead of five**, and the card editor
gets the same benefit without a line changing in any mounter.

A microtask (not a timer) is the right window because every card on a board
mounts in a single synchronous render pass, so they are all queued by the time
it fires.

The partition is pure and lives in `seriesMap.ts` (`unionWindow`,
`partitionSeries`), which is what makes it testable without the SDK. **138
tests, 13 new**, covering the two ways this fails silently rather than loudly:
a card seeing another card's rows, and a card seeing rows from *outside its
own window* because the union that was fetched was wider. Plus the coalescing
itself — concurrent reads produce one query, separate boards do not merge,
a flushed batch starts a fresh one, and a failed query rejects every caller
rather than hanging them.

**Deliberately not batched: `hasAnySeries`.** It is a top-1 existence probe
that only fires when a card's window came back empty, and batching it would
trade N tiny bounded reads for one potentially unbounded one (every row for
every card, to derive which cards have any). Revisit only if a fresh board's
first open actually shows the cost.

Phase 0's escape hatch (mount only on-screen tiles) was **not needed**: the
CPU comparison inverted in phase 2, and the network cost is now one query for
the whole board.

### Phase 4 — archive split — ✅ **DONE 2026-07-25**

The rule is `liveTilesEnabled(flagOn, instanceStatus)` in `store/tiles.ts` —
pure, so the correctness guarantee is pinned by tests rather than buried in a
render condition:

> **open meeting → live (if the flag is on); closed → the archive. Always.**

`closeInstance()` stamps each card's snapshot onto the instance row precisely
so a past meeting shows what it showed then. Rendering a closed meeting live
would replace that record with today's data — and worse, a later styling
change would retroactively alter what past meetings appear to have said. The
flag cannot override this: `liveTilesEnabled(true, "closed")` is `false`.

`renderTiles()` re-evaluates on every instance change, so selecting a past
meeting drops to the archive and returning to the open one restores live.
`stampArchiveSvg()` and the per-save snapshot are untouched.

**Acceptance test — proven, not argued.** `app/board-live.html` gained a
live/archive switch. With the right pane in archive mode its markup is
**character-identical** to the stored pane (136,246 chars each); in live mode
they differ, as they must. Passing `null` puts BoardGrid back on the untouched
`renderSnapshot` path, so "renders exactly as today" is true by construction
*and* by measurement.

The button says so too: a closed meeting reads **"Tiles: archived"** with a
tooltip explaining why, rather than silently ignoring the toggle.

One ordering bug found and fixed while wiring this: the live renderer reads
`boardActions` as it mounts, and `setLiveRenderer` is a no-op when the
renderer is unchanged — so actions fetched *after* the first render would
never reach the tiles, and every live tile would sit there showing none. The
fetch now completes before the first tile is drawn.

### Phase 5 — retire the defaults pipeline  *(the payoff)*

Delete `tools/tile-defaults.json`, the generator, the write endpoint,
`selfHealCatalog()`, `catalogSvgByType()` and `ben_defaultsvg` usage, and mount
live empty cards in the composer's picker too. The Card Catalog table keeps its
type/label/description columns; only the art goes.

Do this **last**, and only once phases 2–4 are proven hosted — until then the
defaults are the fallback.

> **Revised 2026-07-25 — phase 5 can no longer be a full retirement.** The
> archive split (phase 4) means the stored path is permanent, not
> transitional: closed meetings always render stamped snapshots, and the
> toggle can drop any board back to stored. A never-opened card on an
> archived meeting therefore still needs its catalog default. What phase 5
> *can* do is narrow the pipeline's job — defaults stop being what most
> people see, so staleness stops mattering much — but `tile-defaults.json`,
> `selfHealCatalog()` and `ben_defaultsvg` all survive. Re-scope before
> starting it.

### Phase 6 — preloaded embeds  *(the capability live tiles unlock)*

Requested 2026-07-25: embed tiles should load their content on the board, so
opening one is instant rather than a cold cross-origin fetch mid-meeting.

This is only possible once tiles are live — a stored SVG can never hold a live
iframe (which is exactly why EmbedCard's tile is a hand-authored placeholder).

**The constraint that dictates the design:** re-parenting an `<iframe>` reloads
it. Every browser does this. So a preloaded board embed is thrown away the
moment the focused view mounts its own copy — the preload buys nothing unless
**focus promotes the very same element**. EmbedCard already works this way
internally: its editor deliberately never re-creates the frame on change
("an iframe reloads whenever it is recreated"), and this extends that rule
across the tile→focus boundary.

Two viable shapes, to be chosen in this phase:

1. **Promote in place** — the tile's container expands (CSS/transform, or the
   FLIP technique) to fill the focused area, with no DOM move. Keeps the load,
   and animates nicely. Constrains the focused view's DOM structure.
2. **Persistent off-board host** — one long-lived container per embed card,
   positioned over the tile and re-positioned over the focus area. No
   re-parenting, but it must track scroll/resize and stack correctly.

Prefer (1) unless the focused layout makes it impossible.

**Costs to bound, because this is not free:**
- N embeds = N cross-origin page loads on board open. Make it **opt-in per
  card** (a `preload` setting), default off, and preload only tiles that are
  actually on screen.
- Power BI and SharePoint embeds may trigger auth on load; N of those at once
  on a shared meeting screen is worse than one on demand.
- The environment CSP `frame-src` must already allow each origin — the
  Admin-centre entry added 2026-07-23. Nothing new, but a preloaded board
  fails N times instead of once when an origin is missing.

**Verify:** open a board with two preloaded embeds, confirm both render; focus
one and confirm — via a network trace — that **no second document load
occurs**. That absence is the whole feature.

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
