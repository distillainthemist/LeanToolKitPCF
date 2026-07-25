# PCF retirement — optimisation plan

*Drafted 2026-07-25 for execution in phases (each phase is one sitting,
independently shippable, with its own verification). Context: the code app
is the sole product; the PCF/canvas target is a paid-off hedge
([code-app-plan.md](code-app-plan.md) called the canvas kit "the documented
fallback"). Measured today: the PCF bundle is 99s of every 102s build, and
8,800 lines / 72 files (wrappers, manifests, generated types) exist only
for it — while four cards' newest features (actions on KPI/Pareto/Status
tile, Embed commentary) cannot work in PCF at all because their manifests
lack the channels.*

## What retirement unlocks

**Performance**
- Build: ~102s → ~3s per iteration (drop `pcf-scripts`/webpack); CI and
  release pipelines lose the msbuild + controls-build jobs entirely.
- Editing: every debounced card save currently rasterises a 2× PNG
  (`htmlToPng` → canvas → `toDataURL`) whose data URI **nothing in the app
  reads** — the saver keeps only the SVG markup. Splitting capture into
  svg-only removes a full DOM clone + serialize + raster per edit on all
  16 snapshotting cards (biggest on SQDPC month grids and large diagrams).
- Install/tooling: root devDeps shrink to eslint + typescript; no
  pcf-scripts, no @types/powerapps-component-framework, no .NET solution
  build.

**Functionality**
- One data model everywhere: the series cards' "PCF keeps the old blob
  behaviour" caveat dies; rows are simply the truth.
- One settings home: no more conditional ownership like KPI's
  `setSpec(null)` PCF branch; card settings are authoritative, in-card
  config dialogs retire.
- New card capabilities stop needing manifest work (a new input used to
  mean manifest property + generated types + solution version + 99s build;
  now it's a settings key).
- Board/interface evolution is unconstrained by canvas string channels —
  editors may grow typed callbacks, live previews, cross-card interactions
  without keeping a string-serialisable twin. (The platform-free editor
  classes stay — that separation is good architecture regardless of PCF.)

## Phase 0 — confirm nothing consumes the PCF solution  *(gate)* — ✅ **CLEARED 2026-07-25**

Checked with `pac env fetch` against **all three** tenant environments —
Pechey Distilling Development, Pechey Distilling Production and
PecheyDistillingOperations:

- **Zero `BenOBrien.*` custom controls exist in any environment.** The
  `LeanToolKit` solution was never imported anywhere — the release zips
  were only ever GitHub assets.
- Solutions present in Dev: `LeanToolKitData` (0.12.0, the app's tables),
  `ProofPunk`, `FishbonePCF`, plus Microsoft's. Canvas-app rows: LeanBoard
  (the code app) and ProofPunk only.
- `FishbonePCF` holds `pech_PecheyDistilling.Fishbone` 1.0.2 — a *different*
  publisher prefix and namespace. `git log --all -S PecheyDistilling` over
  `controls/` and `Solution/` returns nothing, so it was never built from
  this repo and retirement cannot affect it. No `dependency` rows point at
  it either.
- v0.12.0 carries `LeanToolKit_v0.12.0.zip` + `_managed.zip` (408 KB each) —
  the permanent archive. Rollback is `git checkout v0.12.0` + those assets.

The gate was therefore cleared more strongly than assumed: the PCF target
was not merely unused, it was never deployed.

## Phase 1 — stop building & shipping PCFs  *(small; no source deletions)* — ✅ **DONE 2026-07-25**

- `.github/workflows/ci.yml`: drop the controls build (keep lint/tsc if
  retained elsewhere); `release.yml`: delete the *solution* job (dotnet +
  `npm run build` + LeanToolKit zip staging); keep the app job and the
  LeanToolKitData export job untouched.
- `release.sh`: stop stamping 24 control manifests + Solution.xml; version
  becomes tag-only (keep the tag/commit flow identical).
- Docs: mark [board-app-build.md](board-app-build.md) and the PCF sections
  of README as retired; note in the runbook that releases no longer carry
  LeanToolKit zips (the data solution + app zips are unaffected — the app
  never imported the controls solution).
- Verify: push a throwaway tag on a branch or dry-run the workflows;
  release asset list = App zip + LeanBoard managed zip only.

## Phase 2 — delete the PCF-only surface — ✅ **DONE 2026-07-25**

Deleted as planned, plus three items the plan hadn't listed: `eslint.config.mjs`
(a no-op stub that existed only to satisfy pcf-scripts' build-time lint — it
ignored every file type it could parse, and eslint was only a transitive dep of
pcf-scripts), the PCF-era `.gitignore` rules, and the root `npm ci` step in
release.yml's board-app job (the app builds without root deps once the tsconfig
is standalone — verified by stashing `node_modules`).

Reality differed from two assumptions: `controls/*/generated/` was gitignored,
so it needed `rm` rather than `git rm`, and the ~30 `ltk-*` entries live in the
**parent** `CodingProjects/.claude/launch.json` (the file the tooling reads),
not the repo's own — 32 dead entries trimmed there, keeping `ltk-app`.

Two CI corrections belong to this phase. Phase 1's root-typecheck step went
red on a clean checkout: `controls/*/generated/ManifestTypes.d.ts` is
gitignored, and the old `pcf-scripts build` *generated* it before compiling,
so a bare `tsc` could never have passed while the wrappers existed — deleting
them here fixed it. And that step duplicated the pre-existing `app-ci.yml`, so
`ci.yml` is now root-typecheck-only (it catches breaks in cards and shared
modules the registry doesn't currently mount, which App CI cannot see), with
the redundant root installs dropped from both `app-ci.yml` and `release.yml`.

**Results:** root install 3 packages / 0.8s (was the full webpack toolchain);
root tsc, app tsc, 125/125 tests and app build all pass; the app bundle hashes
are **byte-identical** to the pre-deletion build, which is the strongest form
of the "no behaviour change" contract.

**Follow-up this exposed — the tile-defaults generator.** ✅ **PORTED
2026-07-25**: `app/tile-defaults.html` + `app/src/tools/tileDefaults.ts` mount
the editor classes directly and harvest `onSnapshot`; a dev-only vite endpoint
writes `tools/tile-defaults.json` in place. Defaults regenerated (they dated
from 2026-07-15, before the settings audit and the SQDPC/kebab fixes) and
`APP_VERSION` bumped so the heal actually runs. The original problem
statement follows.

`tools/tile-defaults.js` + `.html` served their page over `out/controls/*/
bundle.js` and so no longer run, while their output `tools/tile-defaults.json`
is still imported by `app/src/store/catalog.ts` to seed each card type's
empty-state tile in the Card Catalog. The JSON is committed and unaffected, but
it cannot be regenerated, so shipped defaults drift as empty states change
(the recent title-bar removal and SQDPC centring already changed some). Both
files carry ⚠️ banners and are kept as the reference for the port. To port:
replace `loadBundle`/`ctorFor`/`emptyContext`/`getOutputs()` polling with direct
ESM imports of the editor classes plus their snapshot hook — the wrinkle is
per-card construction, which `app/src/cardRegistry.ts` encodes but couples to
Dataverse reads the generator must not make. Worth its own sitting.

Original scope, for reference:

Delete:
- `controls/*/index.ts`, `controls/*/generated/`,
  `controls/*/ControlManifest.Input.xml`
- `Solution/`, `pcfconfig.json`, `LeanToolKit.pcfproj`, `shared/pcf/`,
  `tools/pcf-serve.js`, `dev/` harness, the ~30 `ltk-*` pcf-serve entries
  in `.claude/launch.json` (keep `ltk-app`)
- Root `package.json`: pcf-scripts, cross-env, powerapps types; scripts
  reduce to lint/typecheck helpers.

Replace root `tsconfig.json` (currently *extends pcf-scripts' base*) with a
standalone config preserving effective options (strict, ES2017+ libs, DOM)
— run `npx tsc --showConfig` first and match it, so `controls/*/editor.ts`
and `shared/` keep compiling identically.

**Do NOT delete** (the product): `controls/*/{editor,types,styles,model,
registry,captureColumns}.ts`, all of `shared/{schema,ui,export,interact,
tokens}.ts`, everything under `app/`.

Verify: root tsc, app tsc, vitest (125), app build, dev-harness smoke of
2–3 cards, `pac code push`, hosted spot-check. The wiring-guard test
(`mounterWiring.test.ts`) reads `controls/*/editor.ts` via glob — it must
still pass untouched.

## Phase 3 — svg-only snapshots — ✅ **DONE 2026-07-25**

**Measured on a real SQDPC card (20 iterations, dev machine):**

| path | median | mean |
|---|---|---|
| old `htmlToPng` (serialize + Image decode + canvas raster) | 50.30 ms | 49.28 ms |
| new `htmlToSvg` (serialize only) | 0.30 ms | 0.35 ms |

**~50 ms saved per snapshot, ~167× faster** — and a snapshot fires on every
debounced edit of every card. The win is larger on slower tablets, where the
raster dominates.

The honest-rename option was taken: `onPngReady(uri, svg)` → `onSnapshot(svg)`,
plus `generatePng`/`schedulePng`/`pngTimer`/`this.png` →
`generateSnapshot`/`scheduleSnapshot`/`snapshotTimer`/`this.snapshots`, and the
saver's `onPng` → `onSnapshot`. Nothing consumed the data URI: the only two
handlers were `saver.onPng` (which ignored `_uri`) and card.ts's
`() => undefined`.

Scope grew slightly beyond the plan's 16 cards, all in the same spirit:
- **`downloadSvg()`** on 15 cards also called `htmlToPng` and discarded the
  URI — it rasterised on every "Download SVG" too. Now `htmlToSvg`.
- **Fishbone and ProcessMap** hand-roll their snapshots and were not in the
  plan's count, but both rasterised on every edit purely to feed a URI nobody
  read. Fishbone's raster block is deleted outright (it has no PNG download);
  ProcessMap keeps `renderPngDataUri` for its `exportPng()` only.
- **`svgToPng`** was dead (zero call sites) and is gone; `htmlToPng` and
  `htmlToSvg` now share a `snapshot()` serialiser.

**Verified:** root tsc, app tsc, 125/125, app build; "Download PNG" still
rasterises correctly (1280×840 @2×, 132 KB — vs 47.8 KB of markup, which is
why tiles are stored as SVG); and live in the dev harness, a real click on an
SQDPC day tile produced a fresh, different 47.8 KB SVG through the full
debounce → `htmlToSvg` → `onSnapshot` chain.

Original scope, for reference:

In `shared/export/png.ts` add `htmlToSvg(root, css, background,
onReady(svgMarkup))` — the existing `htmlToPng` minus `rasterize()`. Switch
every editor's `generatePng()` (the SnapshotScheduler path, 16 cards) to
it; keep `htmlToPng` solely for the kebab "Download PNG". Rename the
callback plumbing honestly (`onPngReady` → `onSnapshot(svgMarkup)`) since
the uri argument was already ignored by the app saver — or keep the
signature and pass `""` for the uri if churn must stay minimal (decide once,
apply uniformly). Composer's `regenerateTile` and the saver's
`onPng`/`onTile` hooks need no behaviour change.

Verify: tile SVGs still land on save (board + composer Save-card path),
Download PNG still rasterises, and a quick before/after timing on an SQDPC
edit (performance.now around the snapshot) to confirm the win.

## Phase 4 — single-owner simplifications — ✅ **DONE 2026-07-25**

- **KPI trend**: `editSettings()` and the `spec === null` kebab branch are
  gone; `spec` is now a plain `KpiSpec` (all-empty by default) and `setSpec`
  takes a non-null spec. The blank-field → document fallback stays, as legacy
  data. Verified in the harness: with a settings spec the target line, spec
  bands, unit and red out-of-spec reading all render and the kebab shows only
  Raise action / Download PNG / Download SVG; with **no** `setSpec` call at
  all, a document-only card still renders its unit and USL/LSL.
- **Series editors**: nothing to remove — their comments already described the
  document as tile-carrier + migration source, with no dual-ownership left.
- **Stale host references** fixed rather than left to mislead: `cardHost.ts`
  and `cardRegistry.ts` both described the PCF wrappers, and the latter
  claimed the model-based editors' "action affordances live in the PCF
  wrappers and arrive later" — wrong twice over, since Fishbone and ProcessMap
  now wire `onManageActions`/`getActionBadge`. The CSS-bundling rationale in
  Fishbone and `baseCss.ts` cited canvas apps failing to load a PCF's CSS
  resource; bundling still earns its keep (snapshots inline the same string),
  so the behaviour stands and only the reason is restated.
- **Card docs**: every page advertised `**Snapshots:** pngExport, svgExport`,
  which were manifest outputs — now "SVG tile", with the shared section in
  `docs/controls/README.md` rewritten around tiles + on-demand Download PNG.
  Two pages were **factually wrong**: KpiTrendCard and ParetoCard both said
  "Actions ✖ … no actions channel" despite having gained card-level *and*
  per-point/per-bar actions; both pages and the index table are corrected,
  with `context.source` values (`kpitrend`, `pareto`, `embed`) checked against
  the editors rather than assumed. EmbedCard's index row also still said
  document-/action-free.
- **master-leanboard.md**: header now points readers at the data model and
  board manifest as current, and the *Power Fx recipes* and *PCF enhancements*
  sections are marked historical.

Deliberately not done: the reference docs still use the channel names
`outputJSON` / `actionsOutputJSON`. Those began as manifest properties but
remain the names of the JSON contracts actually stored, so renaming them
would cost accuracy rather than buy it.

Original scope, for reference:

- KPI trend: delete `editSettings()` and the `spec === null` kebab branch;
  `setSpec` becomes mandatory (keep the blank-field → document fallback —
  that's legacy data, not dual-host).
- Series editors: remove any remaining "document owns the data" comments/
  paths that existed only for PCF hosting (rows are the only truth; the
  tiny doc remains as tile-carrier + definitions).
- EmbedCard: `refreshTrigger` plumbing in the editor stays (harmless), but
  the manifest-driven notes in [controls/EmbedCard.md](controls/EmbedCard.md)
  and other card docs drop their PCF columns ("Actions: ✔ (code app)" →
  "Actions: ✔").
- Sweep docs: master-leanboard's PCF/canvas wiring appendices → marked
  historical.

## Phase 5 — later, as touched  *(do not do speculatively)*

- Editor APIs: replace JSON.stringify-equality setter guards with cheap
  dirty flags; accept objects rather than raw JSON strings where a card is
  being modified anyway.
- Board-open perf (adjacent, not PCF): `cardEditor` fetches every card row
  (all tile SVG memos) to open ONE card — select needed columns / single
  row instead.
- Composer live preview: with snapshots cheap (Phase 3), consider
  higher-frequency tile refresh in the board editor.

## Execution notes for the implementing session

- Standard verification chain per phase: root `npx tsc --noEmit -p
  tsconfig.json`, same in `app/`, `npx vitest run` in `app/`, `npm run
  build` in `app/` (root build ceases to exist after Phase 2), dev-harness
  visual proof via the `ltk-app` server, `pac code push` from `app/`,
  commit + push. Hosted behaviour is Ben's check.
- Phases 1–2 change no card behaviour: any hosted diff after them is a
  bug.
- Cut a release before Phase 1 (archive tag) and after Phase 3 (the first
  all-app release). `release.sh` keeps working between phases.
- Rollback: everything deleted lives at the archive tag; the release
  assets keep the last importable solution zips indefinitely.
