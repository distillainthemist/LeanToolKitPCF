# LeanToolKit PCF

A suite of lean-board PowerApps Component Framework controls with a shared
Flat 2.0 design system and common JSON contracts, shipped as **one importable
solution**. See [LeanToolKit_ImplementationPlan.md](LeanToolKit_ImplementationPlan.md)
for the full architecture, component specs and roadmap, and
[docs/controls](docs/controls/README.md) for per-control reference — what each
control does and the exact schema of its `outputJSON` and `actionsOutputJSON`.

## Controls

| Control | Status |
| --- | --- |
| **FiveWhys** — problem → why-chains → root causes, drag reorder/re-chain, inline action capture | ✅ Phase 0 |
| **Fishbone** — Ishikawa diagram (votes, statuses, drag between bones), action capture on causes | ✅ Phase 1 |
| **FaultTree** — top-down gated tree (AND/OR pills on connectors), drag to re-parent, collapse, root causes + actions | ✅ Phase 1 |
| **ActionBoard** — the central action register as a list, kanban (status/issue columns) or gantt (start→due bars) | ✅ Phase 1 |
| **StatusTile** — tap-to-cycle state tile with reason; the cascade's line-of-sight element | ✅ Phase 2 |
| **ParetoCard** — descending bars + cumulative % line; accepts cause/vote exports directly | ✅ Phase 2 |
| **KpiTrendCard** — run chart with target line and RAG readout of the latest value | ✅ Phase 2 |
| **BenefitEffort** — 2×2 drag canvas (benefit ↑, effort →) for prioritising solutions | ✅ Phase 2 |
| **RiskMatrix** — 5×5 likelihood × consequence, post-control movement, treatment actions | ✅ Phase 2 |
| **SqdpcCard** — month grid of good/issue ratings per dimension, day/weekday/two-shift | ✅ Phase 2 |
| **ConditionsCard** — rolling 7 days × conditions + next-shift forecast column | ✅ Phase 2 |
| **CaptureCard** — config-driven grid: typed columns, multi-select and two-layer picklists with icons, free or fixed rows | ✅ Phase 2 |
| **HeatmapCard** — pin issues onto a fixed image, severity-coloured, actions at pin time | ✅ Phase 2 |
| ProcessMap (+ swimlanes), Raci, SkillsMatrix, MeetingScheduler, EscalationViewer, BoardChrome | Phase 3 |

## The standard surface

Every control exposes the same properties:

- `inputJSON` (input) — preload card document, a LeanToolKit envelope:
  `{ "schema": "ltk/<component>@1", "meta": {...}, "data": {...} }`
- `outputJSON` (output) — the edited card document; read in `OnChange` and
  `Patch` to Dataverse
- `actionsInputJSON` (input) — this card's actions from the central actions
  table: `JSON(Filter(Actions, InstanceId = ...))`
- `actionsOutputJSON` (output) — the full current action set, each stamped
  with `instanceId`; upsert by action `id`. Actions are never hard-deleted —
  deleting their host element cancels them.
- `instanceId` (input) — the card instance identity (e.g. its Dataverse row
  GUID), stamped on every emitted action
- `resetTrigger` (input) — reloads both inputs whenever the **value
  changes**: `Set(varReset, Text(Now()))`
- `peopleJSON` (input) — `[{whoId, who}]` for action assignment
- `cardTitle` / `prompts` (inputs) — optional self-describing chrome and
  coaching prompts (plain text or `[{field, hint}]`)
- `backgroundColor` / `foregroundColor` / `accentColor` / `titleBarColor` /
  `legendColors` / `fontFamily` — theming (`titleBarColor` fills just the
  title strip — one colour across related cards associates them on a board)
- `readOnly` — display mode
- `pngExport` (output) — PNG snapshot as a data URI

Actions share one canonical schema across all controls (id, instanceId,
issue, description, assignees with per-person done flags, optional start
date, due, status, comments, escalated, context with source provenance) and sync with a central
Dataverse actions table keyed by `(instanceId, id)`. Causes share one node
model across all RCA tools (fishbone categories, five-whys chains, fault-tree
parents). A legacy combined document with embedded actions is accepted on
input and migrated onto the actions channel.

## Layout

```
shared/          design tokens, JSON schemas, UI kit, pointer/drag, PNG export
controls/<Name>/ one folder per control (manifest, index, editor, styles, types)
Solution/        wrapper -> LeanToolKit .zip (managed + unmanaged)
```

## Build & test

```bash
npm install
npm run build        # builds every control under controls/
npm start            # PCF test harness on :8181
```

## Package for Dataverse

```bash
cd Solution && dotnet build -c Release
# -> Solution/bin/Release/net462/Solution.zip + Solution_managed.zip
```

## Release

`./release.sh 0.1.0` bumps every control manifest + the solution version,
commits and tags; pushing the tag makes the GitHub Release workflow attach
the solution zips.

Canvas apps: enable **Settings → General → Code components**, then
**Insert → Get more components → Code**.
