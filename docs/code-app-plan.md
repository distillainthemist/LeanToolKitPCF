# The board app as a Power Apps code app — plan of record

Decision (2026-07-18): the master-leanboard app is built as a **Power Apps
code app** (TypeScript + vite, deployed via `pac code`), not a canvas app.
[board-app-build.md](board-app-build.md) remains as the canvas-era
alternative and the authoritative statement of the app's *behaviour* — its
recipes translate 1:1 into the typed data layer below.

**Core principle: nothing already built is rewritten.** The 24 platform-free
editor classes (`controls/*/editor.ts`), the shared schemas, the recurrence
engine and the SVG tile pipeline import as-is. The code app replaces only
the Power Fx glue that was never built. The PCF solution keeps shipping
unchanged for drop-in reuse in other canvas/model apps (dual-target).

## Why (recap)

- The canvas glue was the riskiest part of the plan — `JSON()`/`ParseJSON`
  string round-trips, echo loops, LoadGate machinery — and it exists *only*
  because canvas talks to controls through string channels. In the app,
  screens call editor setters with objects.
- The 23-card stacked editor screen disappears: mount one editor by type.
- The data-policy recipes (shared live rows, SVG archiving, carry chains)
  become **unit-testable TypeScript** instead of `ForAll`/`Patch` formulas.
- Trade-offs accepted: code-app platform maturity (verify in Phase 0 —
  especially **Safari/WebKit** for wallboards), dev-only app changes
  (configuration stays data-driven), premium licensing (unchanged — the
  app needed Dataverse either way).

## Decisions (Ben, 2026-07-18)

| Decision | Choice |
| --- | --- |
| Repo shape | **Same repo**, new `app/` folder (vite + TS) importing `../shared` and `../controls/*/editor` directly |
| Framework | **Vanilla TS** — tiny hash-router + the toolkit's `el()` helpers; one paradigm end to end (React only if `pac code` tooling forces it) |
| Roster | **LTK People table** (curated roster — the project's original people decision), fed by **searching Microsoft Entra ID** via the Office 365 Users connector and *adding* people. Entra is the search source; LTK People is the operative roster carrying crew / site / department enrichment |
| Org tree | A **config row** (Site Settings-style table) holds the `orgJSON` site → department → area tree, feeding MeetingWizard and LeanHub identically |

## Phases

### Phase 0 — de-risk (cheap, first)

1. Fix `pac` on the Mac (v2.8.1 dotnet tool crashes in its auth store on
   .NET 10) — update/reinstall the tool or clear its state; fallback is
   running pac in CI or a container.
2. `pac auth create` (device-code; Ben signs in), pick the environment,
   confirm **code apps are enabled** there and the `pac code` command
   surface exists.
3. Hello-world spike: `pac code init` + vite, one Dataverse read through a
   generated typed client, `pac code push`, open in Power Apps — proves
   the auth → data → deploy loop end to end.
4. Verify the support matrix that matters here: **Safari/WebKit**
   (wallboard TVs — the foreignObject scars), mobile player if phones
   matter. Any blocker → the canvas build kit is the documented fallback.

### Phase 1 — `app/` scaffold

- vite + TS in `app/`, tsconfig paths into `../shared` and
  `../controls/*/editor`; hash-router; screen registry.
- **CardHost adapter**: what the PCF wrappers do, minus the string
  channels — instantiate the editor class into a div, call setters with
  parsed objects, wire callbacks straight to the data layer. No LoadGate,
  no resetTrigger, no settingsJSON precedence dance (stored blobs are
  still parsed with the same shared functions).
- Prove it by mounting LeanHub + one card locally with fake data.

### Phase 2 — "LeanToolKit Data" solution (schema, deployed separately)

Eight tables per [master-leanboard.md](master-leanboard.md) plus the new
roster:

- LTK Board · LTK Board Instance · LTK Card Data (incl. `ben_boardid`,
  blank-instance live rows) · LTK Card Catalog · LTK Actions additions
  (`ben_boardid`) · LTK Site Settings (protected times, org tree config) ·
  LTK User Prefs
- **LTK People** (new): whoId (Entra object id, alternate key), name,
  email, crew, site, department, active. Powers `peopleJSON` everywhere,
  crew linkage, and viewer identity (signed-in user → whoId).

Environments receive schema by solution import **before** the app deploys.
Card Catalog seeding becomes an app first-run **self-heal** from
`catalogJSON` / tile-defaults, keyed to the installed solution version.

### Phase 3 — typed data layer (`app/store/`)

`pac code add-data-source` per table (+ the Office 365 Users connector for
Entra search) generates typed models; `store/` translates every build-kit
recipe into tested TS:

- instance creation with all four policies (clear / carry-latest-by-
  datetime / **shared** live rows / link)
- SVG archive stamping at meeting close; tilesJSON join with the
  live-row and catalog fallbacks
- actions upsert by `(instanceId, id)` (+ `ben_boardid` stamping)
- prefs / protected-times persistence; board creation from the wizard
  blob (`ben_occurrencesettings`, roster from participants)
- people admin: Entra search → add to LTK People
- **vitest** over the store and the recurrence engine (finally testable).

### Phase 4 — screens

1. **Home = LeanHub** (Cadence / Actions / Settings) — chip tap →
   board screen with the scheduler's `selectIso` deep-link handshake.
2. **Board screen** — BoardGrid + left-pane MeetingScheduler (meeting
   boards), instance creation, close-meeting archive.
3. **Card editor** — registry map type → editor class, save loop
   (`outputJSON` + `svgExport` → Card Data), actions channel, nav-order
   next/previous.
4. **Composer** (CardSettings) and **Meeting wizard** (MeetingWizard).
5. **People admin** — Entra search, add/enrich roster (crew, site,
   department), deactivate.
6. Boards list / admin odds and ends.

### Phase 5 — ALM & rollout

- GitHub Actions: data-solution import → `pac code push`, matching the
  existing release rhythm.
- Pilot the bottling standup end to end (wizard → board → meeting →
  actions → hub), then broaden.
- Docs: this file + a code-app build doc as source of truth;
  board-app-build.md marked canvas-era.

## Phase 0 results (2026-07-18) — loop proven

- `pac` fixed by updating the dotnet tool 2.8.1 → **2.9.3** (2.8.1 crashed
  constructing the Windows-only MSAL broker on macOS).
- `pac code` requires **Node 22+** — installed as a Homebrew keg
  (`/opt/homebrew/opt/node@22/bin`, PATH-prefixed for pac commands only).
- Auth: device-code flow as partnership@pecheydistilling.com; target
  environment **Pechey Distilling Development**
  (`https://pecheydistillingdev.crm6.dynamics.com/`).
- The **Enable code apps** environment toggle (PPAC → environment →
  Settings → Product → Features → "Power Apps Code Apps") took
  **~20–25 minutes to propagate** — pushes 403
  (`CodeAppOperationNotAllowedInEnvironment`) until then. Patience, not
  misconfiguration.
- **vite must build with `base: "./"`** — the appruntime host serves the
  bundle from a deep path, so absolute `/assets` URLs 404 and the app
  renders blank inside Power Apps. This is baked into `app/vite.config.ts`.
- Spike app "LTK Hello" deployed and verified running IN Power Apps with a
  **typed Dataverse read** (147 systemusers) under user-context auth.
- Outstanding: open the play URL once in **Safari** (wallboard check).

## Phase 1 results (2026-07-18) — shell proven

`app/` scaffold (vite + vanilla TS, hash router, CardHost) mounts the
unmodified editor classes: LeanHub as the home screen, MeetingScheduler on
a board screen **landing pre-selected via `selectByIso`** (the deep-link
handshake works in-process), Fishbone as the card-mount demonstrator.
Type-checks clean with the editors compiled straight from `../controls`.
Dev server: `ltk-app` on :5180.

## Phase 2 results (2026-07-18) — schema deployed

The eight tables live in **Pechey Distilling Development**, created by
`data/deploy-schema.mjs` (idempotent Web API deployer; declarative source
of truth in `data/schema.mjs`; read-back check in `data/verify-schema.mjs`;
device-code token via `data/get-token.mjs`). Everything sits inside the
**LeanToolKitData 0.1.0** solution under the `ben` publisher, so managed
export for Production is a `pac solution export --managed` away.

- ben_ltkboard (key ben_boardid) · ben_ltkboardinstance (lookup ben_board)
  · ben_ltkcarddata (nullable lookup ben_instance + ben_boardid — the
  shared-policy live rows) · ben_ltkcardcatalog (key ben_cardtype) ·
  ben_ltkaction (column-for-column per actions-dataverse.md, key
  ben_actionid) · ben_ltksitesettings (key ben_site; org subtree +
  protected times per site) · ben_ltkuserprefs (key ben_userid) ·
  ben_ltkpeople (key ben_whoid = Entra object id)
- CRUD smoke passed using the store's exact pattern: **upsert by
  alternate key** (`PATCH ben_ltkboards(ben_boardid='…')`), read, delete.
- Entity set names for the store: ben_ltkboards, ben_ltkboardinstances,
  ben_ltkcarddatas, ben_ltkcardcatalogs, ben_ltkactions,
  ben_ltksitesettingses, ben_ltkuserprefses, ben_ltkpeoples.

## Phase 3 results (2026-07-18) — typed store + tests

- `pac code init` ran in `app/` ("LeanToolKit") and
  `pac code add-data-source --apiId dataverse` generated typed
  models/services for all eight tables (`app/src/generated/`).
- `app/src/store/` translates the build-kit recipes into TypeScript with
  pure logic split from IO: `mappers` (manifest parse/serialize, action
  row ↔ LtkAction, people/org conversions), `policies` (seed plans for
  clear/carry/shared/link, close-meeting archive set), `tiles` (the
  tilesJSON join with instance → live → catalog fallback), and IO modules
  `boards` / `instances` (create with policies incl. shared live rows;
  close stamps the SVG archive) / `cards` (save loop with the 190k svg
  guard) / `actions` (rollups + upsert by action id) / `people` /
  `config` (org tree + prefs) / `catalog` (version-keyed self-heal from
  catalogJSON + tile defaults).
- **vitest: 16 tests green** — the recurrence engine's first-ever unit
  tests (weekly week-of-month topics, fortnight parity, monthly nth
  weekday, shiftly crew stagger + night offset, staleness, attendees)
  plus manifest round-trip, policy plans, tiles fallbacks, action row
  round-trip. `npm test` / `npm run typecheck` in `app/`.
- Entra search seam: `people.searchEntra` throws with instructions until
  the Office 365 Users **connection** exists (maker portal, one click)
  and `pac code add-data-source -a shared_office365users -c <id>` has
  generated its client. People admin degrades to manual entry meanwhile.

## Phase 4 results (2026-07-18) — screens live in Power Apps

Deployed as code app **LeanToolKit** in Dev and verified running hosted:
the viewer self-registers into LTK People from `getContext().user`
(person picker showed "Ben Pechey"), catalog self-heal runs on first
visit, and the hub renders store-backed with a truthful empty state
until boards exist.

- Screens: **My day** (LeanHub — store-wired meetings join, viewer
  action rollup, prefs, protected times), **Boards** list, **Board**
  (left-pane scheduler with record matching + deep-link, instance
  creation with the four policies on first open, BoardGrid tile wall
  from the store join, Close meeting with the shared-card SVG archive),
  **Card editor** (registry: KpiTrendCard, SqdpcCard, ConditionsCard,
  FiveWhys — save loop patches document + freshest tile svg; other
  types get an honest banner, each is a ~25-line adapter), **New
  meeting** (wizard → saveMeetingBoard → open board), **People** admin
  (manual entry until the Entra connection exists).
- Dev server = demo mode (banner, writes logged); hosted = Dataverse.
- **Screens lazy-load**: the shell paints before any SDK/store module
  evaluates, screen-load failures render their error instead of a white
  app, and the bundle code-splits per screen.
- Host gotcha: after each `pac code push`, an open session shows
  "You're using an old version — Refresh"; new sessions get the latest.

## Risks / open items

- Code-app platform maturity (mobile, offline = none, ALM depth) —
  Phase 0 verifies; canvas kit is the fallback.
- `pac` on macOS — Phase 0, item 1.
- Entra search needs the Office 365 Users connector consented in the
  environment; if blocked, People admin degrades to manual entry
  (the table design is unchanged).
- Viewer identity mapping: signed-in user → LTK People row (match on
  Entra object id / email at app start; prompt to self-register if
  missing).
