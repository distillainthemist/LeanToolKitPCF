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

## Phase 0 — confirm nothing consumes the PCF solution  *(gate; ~15 min)*

1. In Dev (and any other environment), check for canvas/model apps using
   the controls: query `customcontrols` for `ben_LTK*` usage /
   `canvasapps` referencing them (or simply confirm in the maker portal
   that no app other than LeanBoard exists that embeds LTK controls).
2. Confirm the latest release (v0.12.x) has the LeanToolKit
   managed/unmanaged zips attached — that tag is the permanent archive;
   rollback is `git checkout <tag>` + those assets.
3. **STOP if anything consumes the solution** — revert to selective parity
   instead (out of scope here).

## Phase 1 — stop building & shipping PCFs  *(small; no source deletions)*

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

## Phase 2 — delete the PCF-only surface  *(mechanical; big diff, low risk)*

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

## Phase 3 — svg-only snapshots  *(the editing-perf win; small)*

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

## Phase 4 — single-owner simplifications  *(per-card, opportunistic)*

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
