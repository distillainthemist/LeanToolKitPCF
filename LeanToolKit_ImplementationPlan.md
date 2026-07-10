# LeanToolKit PCF — Implementation Plan

*Prepared 2026-07-10, from `LeanToolKit_PCF.md`, using Fishbone PCF v1.2.1 and ProcessMapPCF as references.*

---

## 1. Vision digest

A family of standalone PCF controls for building electronic lean boards in Canvas
PowerApps, shipped as **one importable managed solution**. Every control:

- is driven by `inputJSON` / `resetTrigger` / `outputJSON` so makers can load from
  and save to Dataverse with a simple `Patch` in `OnChange`;
- shares **common JSON vocabulary** so data moves between tools (a cause captured
  in a fishbone is readable by a fault tree; an action raised anywhere lands in the
  action board);
- follows one **Flat 2.0 design system** — themable via input properties, mouse +
  touch + drag-and-drop, 1.77:1 default aspect, no borders/padding of its own;
- has a first-class **action capture** surface where it makes sense, using one
  canonical action schema with escalation for cascading boards.

---

## 2. Scope challenges and recommended changes

These are the places where I push back on or tighten the brief. Each has a
recommendation baked into the rest of the plan; all are reversible.

### 2.1 Section 2 (process mapping) is largely already built
`ProcessMapPCF` already ships Simple, SIPOC and VSM modes in one control with
palette drag-and-drop, pan/zoom, colour coding and PNG export. **Recommendation:**
do not rebuild — port it into the toolkit, restyle to the shared design system,
and add a **Swimlane** mode (2C) as a fourth map style plus action capture
(kaizen bursts → actions). This converts roughly a quarter of the original scope
into a port-and-extend job.

### 2.2 Merge the three action components into one Action Board
3A/3B/3C (list, kanban, Gantt) are three *views of the same data*. Shipping them
as separate controls triples the maintenance surface and invites schema drift —
the exact failure the common-JSON goal exists to prevent. **Recommendation:** one
`ActionBoard` control with a `view` input (`list | kanban | gantt`), same JSON in
all three. This mirrors the proven ProcessMap multi-mode pattern. Makers who want
a fixed view just set the property. Gantt lands a phase later than list/kanban
(it needs a time-axis engine that nothing else uses).

### 2.3 Merge Simple and Advanced Capture Cards
5A is exactly 5B with a default column configuration (one text column, no row
headers). **Recommendation:** one `CaptureCard` control whose `columnsJSON` config
defaults to the simple layout. Confirmed 5B spec: list columns support
**two-layer dependent picklists** (child options filter by the parent value),
**multi-select**, and **icons/images attached to picklist options** (small
data-URI or built-in glyph per option, rendered as icon + label chips).

### 2.4 Defer the Detailed Fault Tree (1D)
Logic gates, probability propagation and gate algebra is reliability-engineering
(FTA) territory, not daily lean-board use, and it is the single most complex item
in section 1. **Recommendation:** build the Simple Fault Tree (1C) now with a data
model that *reserves* `gate` and `probability` fields on nodes, and add the
detailed mode in a later release as an input-switched mode of the same control.
Nothing is lost; the hard 10 % is postponed until the toolkit is earning its keep.

### 2.5 The Overall Leanboard (6B) cannot be a PCF that hosts other PCFs
PCF controls cannot embed other PCF controls — the platform composes controls,
not the controls themselves. As literally scoped, 6B is infeasible.
**Recommendation, two-track:**
1. **Near term:** the *canvas app is the board*. Ship a **Leanboard app template**
   (screens, container layouts, save/load patterns per component) plus a small
   `BoardChrome` control (board title, meeting date/agenda strip, escalation
   summary count, edit/display toggle broadcast via a variable).
2. **Long term (feasibility spike, phase 4):** because all tools share one
   codebase, their render cores can be written as embeddable modules, so a single
   mega-control *could* internally compose them from one aggregated JSON. Design
   every component's renderer as `render(container, model, style, callbacks)` from
   day one to keep this door open — that costs nothing now.

### 2.6 Reframe the Retrieval Function (6C) as an Escalation Viewer
"Read another board's aggregated output and retrieve specific data" is mostly a
data question (Dataverse query / Power Fx), not a rendering one. The genuinely
reusable UI is: **show me the actions/issues escalated to this board, with their
source**. **Recommendation:** an `EscalationViewer` control taking one or more
board outputs (or a pre-filtered action array) and rendering grouped, sourced,
statused escalations — with acknowledge/comment capture written back to
`outputJSON`. Cross-board *plumbing* stays in the app/Flow layer where it belongs.

### 2.7 Meeting Scheduler (6A) — keep, but keep it honest
Occurrence generation is pure logic and could live in Power Fx/Flow, but the
roster patterns (weekday / 2-crew alternating days / 4-crew continuous) are
genuinely painful there, and a visual schedule editor with a generated-occurrences
preview is real UI value. **Recommendation:** keep as a control: recurrence + 
roster editor on the left, rolling occurrence calendar preview on the right,
occurrences emitted in `outputJSON`. Phase 3.

### 2.8 Scope-doc errata — resolved
- **2B SIPOC** truncated sentence: confirmed ignore — ProcessMapPCF's existing
  SIPOC behaviour is the spec.
- **5C is used twice** (SQDPC card and the image heat map). Renumbered here:
  heat map is **5E**.
- **5B** — confirmed as two-layer dependent picklists with multi-select and
  option icons/images (see 2.3).
- **Multi-assignee actions** — per-assignee done flags on one action confirmed
  (see §3.5).

### 2.9 Additions the lean expert in me wants (small, high leverage)
Boards get laid out in any sequence, so each addition is a self-contained card.
Sorted by how often they appear on real tier boards vs. build cost:

- **KPI trend card** — a run chart with target line and optional control limits,
  RAG-coloured vs target, daily/weekly/monthly buckets. After actions, this is
  the single most common element on tier-1/2 boards ("graph beats table"), and
  the SQDPC card's month of ratings drills naturally into it. Cheap on the
  shared SVG kit. Proposed, phase 2.
- **Pareto card** — the natural partner to fishbone/5-why vote counts; a fishbone's
  `outputJSON` should drop straight into a Pareto. Cheap (one bar-line chart) and
  it *demonstrates* the cross-component JSON story. Proposed, phase 2.
- **Status / andon tile** — one big RAG (or custom-state) tile with a reason and
  timestamp, tap-to-cycle in the huddle. This is the line-of-sight element of a
  cascade: a tier-2 board shows one tile per tier-1 board, driven by each board's
  escalation state. Trivial to build, disproportionate value. Proposed, phase 2.
- **Skills / cross-training matrix (ILUO)** — people × skills grid with
  quarter-circle ILUO glyphs and a trained-coverage count per skill. A fixture on
  team boards, and it reuses the grid renderer + `peopleJSON`. Proposed, phase 3.
- **Trend/run chart inside the SQDPC card** — a month of SQDPC ratings begs for a
  drill-down sparkline per letter. Built into 5C rather than a new control.
- **Covered by presets, not new controls:** attendance board (ConditionsCard with
  people as rows and present/absent/leave/training as ratings), recognition &
  wins card and waste-walk log (CaptureCard column presets), idea funnel
  (ActionBoard kanban split by pipeline status), safety cross (SqdpcCard's
  shaped-grid mode). Ship these as documented preset configs so makers get them
  free — see §5a.
- Deliberately *not* adding: A3 canvas, 5S audit, OEE — real tools, but each is a
  board of its own. Backlog, revisit after phase 3.

### 2.10 Self-describing cards: title and prompts (new requirement)
Because a leanboard may be laid out in any sequence, a card can't rely on its
neighbours for meaning. Every control therefore gets two standard inputs:

- **`cardTitle`** — optional; when set, renders a slim flat title bar in the
  toolkit type ramp (accent underline, sentence case). When empty, no chrome at
  all, preserving the "no borders/padding" rule.
- **`prompts`** — optional coaching text (plain string or JSON array). Rendered
  three ways, consistently everywhere: as the **empty-state ghost text** ("What
  stopped the line yesterday?"), as an **ⓘ popover** on the title bar once the
  card has content, and as **per-field placeholder hints** where the JSON form
  is `[{field, hint}]`. This turns a board into a facilitation aid — the card
  itself asks the huddle questions a coach would.

---

## 3. Architecture

### 3.1 Repository: one monorepo, one solution

```
LeanToolKitPCF/
  package.json / tsconfig.json / pcfconfig.json / eslint.config.mjs
  LeanToolKit.pcfproj              # msbuild — builds all controls
  shared/                          # the toolkit library (bundled into every control)
    tokens.ts                      # design tokens, colour derivation, type ramp
    schema/                        # JSON contracts + parse/sanitise (never throws)
      envelope.ts  actions.ts  causes.ts  people.ts  grid.ts
    ui/                            # dialog, toolbar, chips, badges, empty states
    interact/                      # unified pointer/drag-drop/touch, long-press
    export/                        # SVG→PNG snapshot (from Fishbone, generalised)
    pcf/                           # base class: inputJSON/reset/outputJSON plumbing
  controls/
    Fishbone/        FiveWhys/     FaultTree/     ProcessMap/
    ActionBoard/     Raci/         BenefitEffort/ RiskMatrix/
    CaptureCard/     SqdpcCard/    ConditionsCard/ HeatmapCard/
    MeetingScheduler/ EscalationViewer/ BoardChrome/
      (each: ControlManifest.Input.xml, index.ts, editor.ts, styles.ts, types.ts)
  Solution/                        # one wrapper → LeanToolKit_managed.zip
  release.sh / .github/workflows/  # CI + tagged releases, per Fishbone pattern
```

- **Vanilla TypeScript + SVG/DOM, zero runtime dependencies** — the Fishbone
  approach, kept. It is proven in canvas apps, keeps bundles small, avoids
  React-version roulette in PCF, and gives total control over the design system.
  `shared/` is imported relatively, so each control's bundle carries only what it
  uses.
- pcf-scripts builds every `ControlManifest.Input.xml` under the project; one
  `dotnet build` in `Solution/` produces the single managed + unmanaged zips.
  (Caveat: one version number for the whole solution — fine, ship as a suite.)
- CI mirrors the Fishbone repo: build on push, tag → GitHub Release with zips.

### 3.2 Standard property surface (every control)

| Property | Type | Usage | Notes |
| --- | --- | --- | --- |
| `inputJSON` | Multiple | input | Preload card document (the envelope, §3.3) — **no actions**. |
| `outputJSON` | Multiple | output | Edited card document; debounced ~300 ms; drives `OnChange`. |
| `actionsInputJSON` | Multiple | input | This instance's actions from the central table: `JSON(Filter(Actions, InstanceId = ...))`. |
| `actionsOutputJSON` | Multiple | output | Full current action set, each stamped with `instanceId` — upsert by action id. |
| `instanceId` | SingleLine.Text | input | Card instance identity (typically its Dataverse row GUID); stamped on every emitted action. |
| `resetTrigger` | SingleLine.Text | input | **Reset on change of value**, not on `true` — a boolean can't fire twice. Maker does `Set(varReset, Text(Now()))`. Reloads both inputs. |
| `peopleJSON` | Multiple | input | `[{whoId, who, initials?, colour?}]` — required only by action-capable controls. |
| `cardTitle` | SingleLine.Text | input | Optional slim title bar; no chrome when empty (§2.10). |
| `prompts` | Multiple | input | Optional coaching prompts — string or `[{field, hint}]` (§2.10). |
| `readOnly` | TwoOptions | input | Display mode. |
| `backgroundColor` / `foregroundColor` / `accentColor` | Text | input | Defaults: white / rich black `#141414` / toolkit red-amber. |
| `legendColors` | Text | input | JSON array or CSV; semantic slots per control (status colours, lanes, ratings). |
| `fontFamily` | Text | input | Default `Segoe UI, system-ui, sans-serif`. |
| `pngExport` | Multiple | output | Data-URI snapshot (kept from Fishbone — it's loved). |

Two-way *bound* properties (the old Fishbone pattern) are dropped in favour of
this uniform input/output pair — one mental model everywhere. Fishbone keeps a
legacy parser so existing data migrates (it already has one).

### 3.3 The JSON envelope

Every document, every control:

```json
{
  "schema": "ltk/fishbone@1",
  "meta": { "title": "Filler line stoppages", "updated": "2026-07-10T09:30:00Z" },
  "data": { /* component-specific */ }
}
```

- `schema` gates version migration; parsers are defensive and never throw
  (Fishbone's `sanitize*` style, promoted to `shared/schema`).
- **Actions are NOT in the envelope** — they travel on their own channel
  (`actionsInputJSON`/`actionsOutputJSON`, §3.5) so they can live in one
  central Dataverse actions table. The parser still *accepts* a legacy
  embedded `actions` array and migrates it onto the channel; controls never
  emit one.
- Serialization is deterministic (`meta.updated` stamped on edit, not on
  serialize) so loaded state can be string-compared against emitted state —
  the echo-loop guard (§3.5) depends on this.

### 3.4 One cause model across all RCA tools

The insight that makes "JSON translates across elements" real: **a cause is a
node; the tools differ only in how nodes are arranged.**

```json
{ "id": "c1", "text": "Capper torque drift", "status": "Confirmed",
  "votes": 5, "isRoot": false, "category": "Machines", "parentId": null }
```

- **Fishbone** = depth-1 nodes grouped by `category`.
- **5 Whys** = linear chains via `parentId` (one chain per starting cause);
  `isRoot` marks the selected root cause at chain end.
- **Fault tree** = arbitrary tree via `parentId`; (`gate`, `probability` reserved
  for the future detailed mode).

Paste a fishbone's causes into a fault tree: categories become first-level
branches. Paste a 5-why chain into a fishbone: the chain's causes land on one
bone. This is the demo that sells the toolkit.

### 3.5 The canonical action

```json
{
  "id": "a1",
  "instanceId": "card-row-guid",
  "issue": "Capper torque drift",
  "description": "Recalibrate capper heads and add torque check to CIL",
  "assignees": [ { "whoId": "guid-1", "who": "Sam P", "done": false } ],
  "start": "2026-07-14",
  "due": "2026-07-17",
  "status": "open",          
  "comments": [ { "whoId": "guid-2", "when": "2026-07-10", "text": "Parts ordered" } ],
  "escalated": false,
  "context": { "source": "fishbone", "sourceId": "c1", "hint": "Machines" }
}
```

- `status`: `open | in-progress | done | cancelled`. **Overdue is derived**
  (due < today and not done), never stored — stored "overdue" goes stale.
- **Multi-assignee splitting (3A):** keep *one* action with per-assignee `done`
  flags rather than cloning rows — the list view renders one row per assignee so
  each person ticks their own, but edits to the action stay in one place and the
  Kanban/Gantt views don't show duplicates. (Challenging the "split out into
  discrete actions" wording: splitting at the data level makes later edits
  diverge. If true row-splitting is wanted, it's a one-tap "split" affordance
  that genuinely clones — available, not default.)
- `context.source` + `sourceId` give the Escalation Viewer and Action Board full
  provenance; `escalated: true` is the flag a higher board filters on.
- Any action-capable control (fishbone cause menu, fault-tree node, kaizen burst,
  risk cell, heat-map pin…) uses one shared "raise action" dialog from
  `shared/ui` — same fields, same look, everywhere.

**Central-table sync (decided 2026-07-10).** Actions feed in/out of one
Dataverse actions table, keyed by `instanceId` (which card) + `context.source`
/ `context.sourceId` (which element within it):

- Controls emit the **full current set** in `actionsOutputJSON`; the app
  upserts by action `id` (alternate key). No delta protocol.
- Controls **never hard-delete** an action — deleting its host element (e.g. a
  cause) flips it to `cancelled`. Commitments in a shared register must not
  silently vanish from one board.
- **Echo-loop guard** (in the shared `LoadGate`): an input change that exactly
  matches what the control last emitted is the app's own Patch coming home and
  must not reload — and a reload only notifies when the loaded state actually
  differs. Without both halves, Patch → reload → OnChange → Patch loops.
- Suggested table columns (`ben_` prefix): ActionId (alternate key),
  InstanceId, Source, SourceId, Issue, Description, Start (optional, for
  Gantt), Due, Status, Escalated, AssigneesJSON, CommentsJSON, Hint.
- Knock-ons: ActionBoard binds the actions channel as its primary data (no
  envelope), and EscalationViewer/6C largely becomes
  `Filter(Actions, Escalated = true)` — the central table is the cascade
  backbone.

---

## 4. Design system — the "next level" part

Flat 2.0: flat surfaces, bold flat colour, **subtle** depth cues only where they
signal affordance (a 1px hairline + 2px soft shadow on draggable cards, none on
static ones). Codified in `shared/tokens.ts`, consumed by every control:

- **Grid & shape:** 4px spacing grid; 6px corner radius on cards/chips, 999px on
  pills; hairlines at 8 % foreground, never pure grey borders.
- **Type ramp:** 20/16/14/12 with a single weight pair (600/400); component
  titles sentence case; labels never uppercase except fishbone bone names (a
  deliberate carry-over signature).
- **Colour engine:** from the four theme inputs, derive tints programmatically
  (Fishbone already derives chip tints from status colours — generalise it):
  10 % tint fills, AA-contrast text shades, 40 % hover states. Semantic status
  set shared toolkit-wide: open `#f2c811`, in-progress `#2b88d8`, done `#107c10`,
  blocked/rejected `#d13438` — overridable via `legendColors`.
- **Component chrome:** no outer border/padding (the app owns layout), but every
  control gets the same top-right **kebab menu** for secondary actions (export
  PNG, reset to loaded, settings) so primary canvas stays clean.
- **Interaction, unified in `shared/interact`:** pointer events only (one code
  path for mouse/touch/pen); ≥44px touch targets; drag ghost at 60 % opacity with
  drop-target highlight (Fishbone's pattern, extracted); long-press = context
  menu on touch; wheel/pinch zoom on the map/tree controls; full keyboard
  operability (tab/arrows/enter) and visible focus rings; 150 ms ease transitions,
  none longer.
- **Empty states:** every control renders an instructive ghost state ("Tap a bone
  to add a cause"), not a blank rectangle — boards are stood up live in meetings.
- **Canvas & scaling:** SVG controls use `viewBox` and scale to any size;
  1.77:1 is the *designed-for* proportion, not a hard constraint.

---

## 5. Component specs (post-challenge, 19 controls — all confirmed 2026-07-10)

| # | Control | Origin item | Essence | Size |
| --- | --- | --- | --- | --- |
| 1 | **Fishbone** | 1A | Port + restyle to tokens; add action capture on causes; new envelope with legacy migration | M |
| 2 | **FiveWhys** | 1B | 1–n why-chains as connected cards; drag to reorder/re-chain; root-cause flag reveals inline action capture; single-assignee actions with tap-to-complete circle (open ↔ done; full status set stays in the schema for ActionBoard) | M |
| 3 | **FaultTree** | 1C (+1D gates) | Top-down gated tree diagram: top event → AND/OR gate pills on connectors → branches; add-below on every node; re-parent by drag (subtree moves); collapse; probability calcs remain the deferred 1D detailed mode | M–L |
| 4 | **ProcessMap** | 2A–2D | Port ProcessMapPCF; restyle; **add Swimlane mode**; kaizen burst → action; envelope migration | L |
| 5 | **ActionBoard** | 3A–3C | One control, `view: list/kanban/gantt` (all shipped); kanban split by status *or* issue with drag between columns; gantt plots start→due bars with today line, undated actions listed beneath | L |
| 6 | **Raci** | 4A | People × deliverables grid; tap-cycle R/A/C/I; per-row single-A validation warning | M |
| 7 | **BenefitEffort** | 4B | 2×2 drag canvas; items as chips; quadrant labels; import actions/causes; priority order out | S–M |
| 8 | **RiskMatrix** | 4C | 5×5 likelihood × consequence; risk register list + plotted cells; pre/post-control ratings; treatment → action | M |
| 9 | **CaptureCard** | 5A+5B | Config-driven grid: typed columns (text, int, decimal, y/n, list, **two-layer dependent list**), multi-select lists, icons/images on options, optional row headers; simple = default config | M–L |
| 10 | **SqdpcCard** | 5C | Month grid, shift/day/weekday granularity, tap-cycle rating, letter dimensions configurable, mini trend row, miss → action | M |
| 11 | **ConditionsCard** | 5D | Rolling 7 days × custom conditions + current-shift forecast column; shares grid renderer with 10 | S–M |
| 12 | **HeatmapCard** | 5E (was "5C") | Image (data-URI input) + tap-to-pin issues; pin density colouring; pin → action | M |
| 13 | **MeetingScheduler** | 6A | Frequency/day/time + crew roster patterns (weekday, 2-crew, 4-crew continuous) → occurrence list + calendar preview | M |
| 14 | **EscalationViewer** | 6C reframed | Renders escalated actions/issues from one or more board outputs, grouped by source, acknowledge + comment | M |
| 15 | **BoardChrome** | part of 6B | Title/agenda strip, escalation count, edit/display toggle; partner of the app template | S |
| 16 | **KpiTrendCard** | §2.9 (confirmed) | Run chart with target line, optional limits, RAG vs target; daily/weekly/monthly buckets | S–M |
| 17 | **ParetoCard** | §2.9 (confirmed) | Bars + cumulative line straight from cause votes or any labelled counts | S |
| 18 | **StatusTile** | §2.9 (confirmed) | Big tap-to-cycle RAG/custom-state tile with reason + timestamp; cascade line-of-sight | S |
| 19 | **SkillsMatrix** | §2.9 (confirmed) | People × skills ILUO grid, quarter-circle glyphs, coverage counts | M |
| — | Leanboard mega-control | 6B | Feasibility spike only, after phase 3 (see §2.5) | XL |

All controls carry the standard surface of §3.2, including `cardTitle` and
`prompts` — every card is self-describing wherever it lands on a board.

### 5a. Preset configs (documentation, not code)

Shipped as copy-paste `inputJSON`/config snippets in the README so common board
elements cost nothing extra:

- **Attendance board** → ConditionsCard: rows = `peopleJSON`, ratings =
  present / absent / leave / training.
- **Recognition & wins card** and **waste-walk log** → CaptureCard column presets.
- **Idea funnel** → ActionBoard kanban split by pipeline status
  (submitted / reviewing / implementing / done).
- **Safety cross** → SqdpcCard shaped-grid mode.

---

## 6. Phased roadmap

**Phase 0 — Foundation (the multiplier).**
Repo + CI + solution wrapper; `shared/` library: tokens/colour engine, envelope +
action + cause + people schemas, dialog/toolbar/chip kit, pointer-drag module,
PNG export, PCF base class. Prove it end-to-end with the **pilot control:
FiveWhys** — small, new, and exercises causes *and* actions *and* the envelope.
Exit test: FiveWhys built, imported into a canvas app, load/edit/reset/save round-trip.

**Phase 1 — RCA suite + actions core.** ✅ *Done 2026-07-10.*
Fishbone port (with legacy-blob migration), FaultTree, **ActionBoard (list +
kanban)**, and the action UI (form / row / dialog) extracted to `shared/ui/`
so every control's action interaction is one implementation.
Exit test passed: action raised on a Fishbone cause flows through the actions
channel ActionBoard binds to; a FiveWhys document loads straight into
FaultTree (chains render as branches). Legend colours are now validated —
unparseable entries fall back per slot instead of poisoning derived tints.

**Phase 2 — Board cards + prioritisation.** ✅ *Done 2026-07-11.*
CaptureCard (typed columns, multi-select + two-layer dependent picklists with
icons, fixed/free rows), SqdpcCard (day/weekday/two-shift, hold-to-raise-
action), ConditionsCard (rolling week + forecast), HeatmapCard (image pins
with severity + pin-time action capture), BenefitEffort, RiskMatrix (banded
5×5, post-control movement, treatment actions), KpiTrendCard, ParetoCard
(accepts cause/vote exports), StatusTile. All 13 controls pack into the one
solution. Live harness verification pending browser-pane reconnect.

**Phase 3 — Maps, cadence, cascade.**
ProcessMap port + Swimlane mode, Raci, SkillsMatrix, MeetingScheduler,
EscalationViewer, BoardChrome + the **Leanboard canvas-app template**.
(ActionBoard's Gantt view was pulled forward and shipped with Phase 1 —
actions carry an optional `start` date for it.) Exit test: two cascaded
boards; escalation raised on board A visible on board B (and surfacing as a
StatusTile state).

**Phase 4 — Stretch.**
Detailed fault tree mode (gates/probability), Leanboard mega-control spike,
backlog items (A3, 5S…) as demand proves out.

Each phase ends with a tagged release of the single LeanToolKit solution —
partial toolkits are usable from phase 1.

---

## 7. Risks & open questions

1. **6B intent** — is the canvas-template + BoardChrome answer acceptable, or is
   the single-control board a hard requirement? (Changes phase-4 priority; the
   embeddable-renderer discipline keeps both options open.)
2. **Picklist images (5B)** — user-supplied images arrive as data URIs inside the
   column config; a built-in glyph set covers the common cases (tick, wrench,
   truck, flag…) without bloating documents. Confirm both routes are wanted.
4. **JSON size in Dataverse** — envelopes live in Multiple-Lines-of-Text columns;
   a heavy VSM or a month of SQDPC stays well under limits, but the *aggregated*
   6B output could grow. Mitigation: boards persist per-component documents, and
   aggregation stays a read-time concern.
5. **One solution version for all controls** — a fix to one control ships a new
   suite version. Acceptable for a managed suite; noted.
6. **ProcessMapPCF data migration** — existing maps use `{mode,nodes,edges}`;
   the port wraps this in the envelope with a legacy parser (same trick Fishbone
   already uses).

*Resolved 2026-07-10:* 5B = two-layer dependent picklists + multi-select +
option icons/images; SIPOC truncated requirement ignored; multi-assignee actions
use per-assignee done flags (no cloning); every card gets `cardTitle` + `prompts`
because boards are laid out in any sequence (§2.10).
