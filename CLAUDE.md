# LeanToolKit — how to work in this repo

LeanBoard is a Power Apps **code app** (`app/`) plus retired PCF controls
(`controls/`, kept for the shared model code) and a declarative Dataverse
schema (`data/`). Ben's Power Apps identity is partnership@pecheydistilling.com;
his chat identity is ben@pecheydistilling.com.

**Orientation**: read `docs/architecture.md` first — the maintained
overview of structure, connectors, SharePoint interfacing, deployment
and the security/DLP model. KEEP IT CURRENT: any change to
architecture, connector usage, tables, or the auth/DLP story updates
that page in the same commit.

## Toolchain

Node 22 via Homebrew — every shell needs:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

## Gates — run before any push or release

From `app/`:

```bash
npx tsc --noEmit
node tools/import-gate.mjs
node tools/native-dialog-gate.mjs
npx vitest run
npm run build
node tools/chunk-report.mjs
```

If the change touched `shared/` or `controls/`, ALSO run `npm run typecheck`
at the **repo root** — the app-only tsc once missed a red CI for two releases.
When chaining gates in one command, verify the vitest COUNT line — a
`grep` in the chain can match the failure line and still exit 0 (a
commit shipped with 5 red tests that way, 2026-08-14). Same trap with
pipes: `tsc | tail` reports TAIL's exit code, so a failed typecheck
lets the chain continue — `set -o pipefail` first (a red root
typecheck slid past that way, 2026-08-15; the errors were visible but
the chain ran on).

The chunk report's `cardRegistry` ceiling is a LEAK detector, not a
budget to re-baseline past: when a mounter needs a pure helper that
lives in a settings module, extract it to a UI-free module (the
`controls/CanvasCard/draft.ts` precedent, 2026-08-16 — importing
`canvasFields.ts` had dragged 26 kB of settings editors into the board
path). Legitimate growth (a new card editor) is the only reason to
re-baseline.

The import gate enforces: the board path (main.ts, cardRegistry.ts,
screens/board.ts, screens/hub.ts) must not statically reach `src/docs/`;
the docs-only connectors (`shared_sharepointonline`, `shared_teams`,
`shared_office365`) are only importable from `src/docs/`. Dynamic `import()`
is the sanctioned door.

## Deploying to the dev environment for testing

```bash
cd app && pac code push
```

This is the ONLY way changes reach the hosted dev app. Rules learned the
hard way:

- `git push` does NOT deploy anything. Never tell Ben a change is testable
  until `pac code push` has actually run and its output says
  "App pushed successfully" — report from the command output, not intention.
- The player caches the bundle: after every push, Ben must **close and
  reopen the player** before testing.
- `pac` is already authenticated as partnership@pecheydistilling.com. If
  auth has expired, do not attempt an interactive login yourself — tell Ben,
  he runs `pac auth create` and completes the sign-in.

## Things the browser will not tell you

- A cross-origin iframe's content state is invisible: its `load` event
  fires on a sign-in page too, and Power BI's secure embed posts nothing
  to its parent (probed 2026-08-18). Never build a "did it render"
  signal on those; say plainly when a hint is heuristic.
- The card walk mounts the NEXT card before tearing the previous down
  (hold-until-ready). A card's teardown must release only ITS OWN
  resources — never a global "park/close everything".
- Dialogs opened by app code need an `.app-dlghost` (toolkit CSS vars);
  inside `.app-editor-host` it must be `flex:0; height:0` or it takes
  half the card.
- Browser-platform behaviour that post-dates my knowledge (Chromium
  Local Network Access shipped 142, Oct 2025; the client is on 151):
  WEB-VERIFY before sending Ben down a diagnostic path. The 2026-08-17
  Power BI embed saga cost a day of DNS/VPN/proxy tests that Chrome's own
  design post ruled out in one paragraph; the real cause (Windows
  work-account SSO broker × LNA in a nested frame the player does not
  delegate to) is in the deployment cookbook.

## Verification split

- Everything pure (model, parsing, grouping, date math) is verified by the
  vitest suite — add tests there.
- Hosted behaviour (SharePoint writes, connector responses, Dataverse,
  moderation, permissions) is **Ben's check in the player**. Hand him a
  short, concrete check list; never claim hosted behaviour verified.
- The in-app browser pane has no Power Apps session. Never enter or handle
  credentials there — or anywhere. Ben performs ALL sign-ins himself
  (browser sign-ins, device-code completions, MFA).

## Dataverse auth (device code) and schema deploys

Tokens come from `data/get-token.mjs` — a device-code flow using the Azure
CLI public client (04b07795-8ddb-461a-bbee-02f9e1bf7b46). Operating rules:

- Start the flow, give Ben the code/URL, and **Ben signs in** — never
  handle his credentials or MFA.
- Tokens live only in the session scratchpad (mode 0600, umask 077) —
  never in the repo, never printed to the transcript. The same applies to
  presigned URLs: probe output reports status/host/parameter names only.

After a schema deploy, wire new tables into the app with
`pac code add-data-source -a dataverse -t <logical name>` (LOGICAL
names — entity-set names fail) — it regenerates `src/generated/`.
`data/exchange-token.mjs <resource> <in> <out>` re-scopes a device-code
refresh token to a sibling resource (e.g. Graph) without a second
sign-in; direct SPO REST rejects this client in this tenant, so Graph
is the admin-scripting road.

Schema changes go through the repo's own apparatus — do NOT hand-write
ad-hoc Web API scripts (the established tools are also what the safety
tooling permits):

- `data/schema.mjs` — the declarative schema (tables, columns incl. `file`
  kind, role grants like `role: {delete: true}`).
- `data/deploy-schema.mjs` — idempotent deploy via the Dataverse Web API,
  stamping MSCRM.SolutionUniqueName=LeanToolKitData.

Use table **logical names** (`ben_ltkupload`) with pac commands, not
entity-set names. A schema change makes the next release SCHEMA-CARRYING:
prod then needs the managed LeanToolKitData solution imported, plus any
SharePoint site steps repeated (see docs/deploy-to-new-org.md).

## Releases

Only on Ben's explicit "cut the release":

```bash
./release.sh <x.y.z>
git push origin main --tags
```

The tag triggers the GitHub Actions Release workflow (builds the code-app
package, exports the managed LeanToolKitData solution, attaches both to a
GitHub Release). Watch it with `gh run list` / `gh run watch <id>`.
Version lives in the tag alone — nothing is stamped into files.

## Lessons ledger (September 2026)

- **Never truncate a deploy log with `head`/`tail` in a pipe** — SIGPIPE
  can cut `deploy-schema.mjs` off BEFORE the role grants. Write to a
  file in the scratchpad, then grep it (2026-09-02).
- **No browser-native dialogs** — `prompt` / `confirm` / `alert` show
  unstyled with the hosting domain as their title. Ask through
  `app/src/prompts.ts` (or `shared/ui/dialog.ts` in a control);
  `tools/native-dialog-gate.mjs` scans the source and runs in CI. Prompts open on the
  topmost layer, so one asked from the card picker is never hidden
  behind it (2026-09-29).
- **Links that leave the app use `boardUrl`** (`app/src/links.ts`),
  never `window.location`: hosted, the page is a frame on
  `powerplatformusercontent.com` and its URL opens nothing for the
  person who receives it. Three notification links had this wrong
  (2026-09-29).
- **`main.ts` imports nothing heavy statically.** `./runtime` carries
  the host SDK and is loaded by a dynamic import at boot; a static
  `import { currentViewer } from "./runtime"` moved 7 kB into the
  shell chunk (2026-09-30). Read the chunk report's `index` line after
  touching `main.ts`, not only its OK.
- **A store write goes through `writing(topic, promise)`**
  (`app/src/store/changes.ts`), never a bare `bumpChange` before the
  write: the cache must be dropped as the write LANDS too, and no
  read kept while it travels — a linked charter field was served a
  minute-old initiative from an entry cached mid-write (2026-10-01).
- **A screen that reads what the last screen wrote waits for the
  write** (`app/src/store/inflight.ts`: writers `track`, readers
  `whenSettled`). Debounced saves are flushed when their screen is
  left. Never `whenSettled` inside a function a tracked write calls —
  it would wait for itself (2026-10-01).
- **A launched view must survive a second mount.** The landing-route
  hub can front a tab from the last-tab preference and read a launch
  payload before the launch re-routes and mounts the hub again; a
  one-shot read left the second mount with nothing (Priorities view
  link, 2026-10-07). `takePendingPrioritiesView` reads inside a 20 s
  grace window instead.
- **Layout by the pane's width, not the window's.** The register's
  phone layout (Tranche D, 2026-10-07) reads its own wrap through a
  ResizeObserver — the hub can split the screen — and the observer
  watches both the wrap and the list pane, because hiding the folders
  pane changes the pane's width and a pane the B5 pref already hid
  would never re-fire by itself.
- **Sticky inside a card needs `overflow: clip`, not `hidden`.**
  `overflow: hidden` makes the ancestor a scroll container, so a
  `position: sticky` child sticks to the card and scrolls away with
  the window (the settings section strip, 2026-10-07). `clip` clips the
  corners without creating a scroll container.
- **A derived layout pass must survive content that arrives in
  stages.** Site cadence puts its site picker on the page, then fills
  its pane after an await; the settings strip's first pass lifted the
  picker and carded the empty pane, and its second pass cleared the
  lifted picker because the headings had changed — the picker was
  destroyed (2026-10-08). Lifted elements are only dropped when the
  tab leaves (`reset()` before `clear(body)`), and a leading card that
  turns out to hold sections is taken apart and re-grouped.
- **PDF text state persists across text objects.** `Tc` character
  spacing set for one `BT … ET` run stays in the graphics state for
  every later run on the page (the poster's rail label leaked spacing
  into all body text, 2026-10-08) — wrap a styled run in `q … Q`.
  And nothing here renders a PDF: `sips -s format png` on macOS is
  the eye for a generated page.
- **A cell that writes a new point must remember it.** The values
  grid minted a fresh reading key on every entry into an empty cell
  and learned of the first write only after the flush and reload, so a
  quick second edit made a second reading in the same week — which
  folded the week and locked the cell (2026-10-08). `enter` now sets
  `cell.actual.existing` on the first write, and a folded cell is
  editable: the typed value keeps the bucket's last point and the
  others are deleted with it. The grid stays the one entry road.
- **A OneDrive / SharePoint "/:f:/g/" sharing link carries no path.**
  Only Microsoft Graph `/shares` resolves it; SharePoint REST has no
  supported road (Microsoft's own guidance), the Office 365 Groups
  connector's HTTP action reaches `/groups` only and the Office 365
  Users connector's `/me` and `/users/…` only — so the app cannot list
  such a folder (2026-10-08, web-verified). Path-carrying links
  (`/sites/…/Shared Documents/…`, `?id=…`, `/:f:/r/…`) list fine through
  the SharePoint connector. Say so; do not promise a listing.
- **A settings delete that writes at once asks first.** Methods,
  standard roles, standard fields, health-check questions and ritual
  categories persist on the click; each × now runs `confirmRemoval`
  (`app/src/prompts.ts`) naming the item and what losing it means
  (Ben, 2026-10-08: a standard role went with one click). Draft lists
  that save from the bar keep a plain × — Discard is their undo.
- **A form never closes on a click outside it.** Edit details, Create
  initiative, the priority dialogs, prompts, escalation, the column
  chooser — buttons or Escape only (Ben, 2026-10-07: an edit lost to
  a click off the box). Pickers and viewers may still dismiss.
- **A finding that needs the directory is appended, never awaited.**
  The health report paints the pure `controlHealth` result at once
  and the pool / directory checks (`peopleIssues`) arrive after it,
  with "Not checked" lines when a lookup fails (2026-10-06).
- **A multi-value taxonomy column needs a multi-value editor.** The
  tags editor was a single select for a `TaxonomyFieldTypeMulti`
  column: it replaced every tag and prefilled only the first, which
  read to a controller as "couldn't add a tag" (feedback round 1,
  2026-10-06). `PrefillValue.terms` / `AddFieldValue.terms` carry the
  list; `taxonomyTermsOf` is the one reader.
- **A chosen column order is the person's.** `buildRegisterColumns`
  sorts by the dictionary only for DEFAULT sets; a view's own set
  (`keepOrder`) keeps the chooser's drag order (2026-10-06 — the
  chooser had promised it since 2026-07-30).
- **A part done is not the action done — until every part is.**
  `settleFromParts` (shared/schema/actions.ts) is the one rule: the
  hub's "my part" tick applies it both ways, the store's write
  applies the closing half. Before 2026-10-06 the hub only marked the
  part and the action stayed open everywhere else.
- **Clearing a Dataverse lookup on update sends `null`** for the
  `@odata.bind` property; `undefined` is stripped by the SDK and the
  old reference stays (`savePriority` never un-parented a priority
  until 2026-10-02).
- **`BoardGrid.setTiles` is a no-op on unchanged input.** A tile
  mounted before its data existed (the charter binding loads after
  the first paint) keeps its first picture until
  `gridView.refreshLive()` re-mounts it — `renderTiles()` alone does
  nothing there (2026-10-01, the third layer of the stale charter).
- **Store reads are cached** (`app/src/store/changes.ts`, 60 s, by
  topic): every new reader of initiatives / boards / drivers /
  palettes / people goes through the cached function; every writer
  goes through `writing()` (above). Action saves also fire the DOM
  event `ltk-actions-changed`; boards, the hub and the initiative
  band refresh on it.
- **One write path, one read path.** Anything that must hold for EVERY
  action (initiative id, confidentiality, board id) lives in
  `store/actions.ts` — `upsertActions` and the `visible()` filter on
  every read — never in a surface (2026-09-16/23: three surfaces
  disagreed because a stamp lived in one creation flow).
- **The Users register's grid template is shared by header and rows**
  (`app/src/style.css` `.app-user-head` / `.app-user-row`): adding a
  control means widening both (2026-09-17).
- **Every `<button>` wears `.app-btn` / `.app-btn-primary` /
  `.app-link`** — a browser-default grey button is a defect Ben spots
  at once (twice, 2026-08-29 and 2026-09-08). `button.app-link` is
  reset globally.
- **Harness pages** (`app/harness/`, launch config `pdca-harness`) are
  the screenshot road for controls; the series store is aliased to an
  in-memory stub. Anything reading live tables is Ben's hosted check —
  confidentiality checks need TWO accounts.
- **Confidentiality is app-level** (initiatives, meetings, actions):
  say so plainly when asked; the rows stay readable via Dataverse.
- **A template's board layout is sacred**: seeding, reset and
  add-card keep each card's `pos`/`nav`; never renumber
  (`improvement/boardLayout.ts`, 2026-09-17).
- **Solution-carrying releases** since v0.50: v0.51 (value drivers,
  scenarios, sourceurl, tracking, pdca), v0.53 (confidential action
  columns), v0.54 (alsoorgs). Everything from v0.55.0 to v0.61.0 was
  app-only; v0.62 (2026-10-02) carries the priority / pillar /
  initiative span columns; v0.63, v0.64 (2026-10-06), v0.65,
  v0.65.1 and v0.66.0 (2026-10-07: the phone register, mobile M1–M5,
  the settings strip) and v0.67.0 (2026-10-08: settings section cards
  and strip tools, the Users add flow, Cascade customisation under
  Organisation, the priorities A3 poster) are app-only. Prod imports the managed solution FIRST.
- **One rule, applied everywhere it matters.** A rule that must hold
  for every action or every card lives in ONE pure function and is
  applied at the screen for an honest picture AND at the store's
  write as the backstop (`actionEndorsement.ts`, `actionLinks.ts`,
  `tileActions.ts`, `splitWho`); surfaces never carry their own copy
  (2026-09-30: the present view's metric cell, the actions tile and
  three who-pickers had each drifted from the main rule).

## Key docs

- docs/sharepoint-writes.md — the SP write cookbook (VULI vs connector
  patch, moderation, dates-in-locale vs ISO).
- docs/deployment-cookbook.md — adopted operational recipes.
- docs/deploy-to-new-org.md — full new-org/prod setup incl. permission
  levels and content-approval site steps.
- docs/leanboard-phase5-plan.md — the DMS lifecycle + date model record.
- docs/ui-standard.md — the visual UI standard (tokens, page anatomy,
  overlays, wizards, settings lists). Read BEFORE styling any new
  surface; state colours ALWAYS resolve through the site state palette.
