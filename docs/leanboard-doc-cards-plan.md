# Doc cards refresh — register-true board cards

Ben's ask (2026-08-08): the **Standard documents** card should look like
the register's document list; the **Document health** card should look
like the register's Document-tasks rows; both should be configurable
with an organisational filter, a library scope and any other filtering —
ideally by **copying a filtered view out of the main Documents interface
and pasting it into the card settings**. Same session: progress the two
surviving cookbook items — the content-approval trial (part D) and the
native upload relay (part C).

## What exists, and the gap

Both cards shipped in the docs area's Phase 3 and still run:
`DocsCard` and `DocHealth` in `controls/CardSettings/registry.ts`
(group "Reference", no policy, no standard content), mounted through
`app/src/docs/docsCards.ts` — reached by **dynamic import only**
(`cardRegistry.ts:178`; the import gate enforces it), painting after the
stored tile with 300–1500ms jitter so a shift-start wall of boards
cannot synchronise into a 429 storm. All of that architecture is right
and stays.

What aged is everything visible and configurable:

| | Today | The register today |
| --- | --- | --- |
| Docs rows | glyph · name · modified (`app-docscard-row`) | file-type chip · name stem · checkout lock · status chip (palette colour, quiet-when-approved) · owner avatar · humane dates, in dictionary order |
| Health rows | two stat boxes + plain name/date lines | R5 task anatomy: pill · name-over-meta · chevron, R6 due pills, group headers with counts |
| Status scope | every status shown | approved-only by default, "Include drafts & superseded" opt-in |
| Config | typed text: library **display name**, org **leaf label**, title words, counts | — |
| Feed | `searchPage` (DocsCard) — the pre-C3b road | RLDAS (`renderListPage` + `buildRenderViewXml`), filters in CAML |

Two of those are latent bugs, not just style drift: a **renamed
library or org term silently kills the card** (label matching — the
exact fragility 5F's GUID-keyed renames were built to avoid), and
DocsCard's search feed **can disagree with the register behind it**
(the disease C3b cured for the health card and the export; DocsCard is
the last module on the old road).

## Part A — view-driven configuration (the paste-in: adopted)

Ben's copy/paste idea is the right mechanism, and the plumbing already
exists end to end: the register's **Copy link** encodes the entire view
state — library (or all), org term **by id**, taxonomy filters by id,
search words, drafts toggle, date windows, modified window, column set —
as the `docview` payload (`views.ts`, pure, tolerant parser, unit-tested,
and already contracted to keep decoding old payloads forever). A card
that stores the pasted link inherits all of that: every filter the
screen can express, rename-proof term ids, and one source of truth for
what a filter *means*. No new filter UI is built, in the studio or
anywhere.

- **`docsView` config field** (multiline text, both cards): accepts the
  full pasted player URL, a bare `docview=` payload, or the raw JSON.
  New pure helper `viewFromPaste(raw)` in `views.ts` (extract the query
  param if it looks like a URL, URL-decode, `decodeDocView`) + tests
  covering all three shapes and garbage.
- **What the card honours** from the view: `listId` ("" = all exposed
  libraries), `orgTermId` + `filters` (subtree-expanded from the cached
  term walk, same as the screen), `query` (name words), `nonCurrent`
  (default false = **approved-only**, matching the register's default at
  last — via the lifecycle mapping's approved-stage labels),
  `modifiedDays`, `dates`, `columns` (DocsCard's column set, width
  permitting). `groupBy` and saved-view `name` are ignored —
  meaningless on a card.
- **Honest limit, stated in the config help:** `contents` (search
  inside documents) is ignored — the id-resolution round is a search
  query per reload, too heavy for a card that repaints on every board
  open. The row cap keeps every feed one page.
- **Library subsets**: a view carries one library or all. The existing
  `docsLibrary` key generalises to a comma-separated list of display
  names that *narrows* an all-documents view; a name matching nothing
  renders a visible note on the card (today's behaviour), never a
  silent shrink.
- **Legacy configs keep working**: when `docsView` is blank the old
  keys (`docsLibrary`/`docsOrg`/`docsMatch`) apply exactly as today —
  a stored board never shifts behaviour (the runtime-default rule).
- **Design-time validation**: the card preview in the studio IS the
  validator — at design-time mount the card decodes the paste and
  renders a summary line above the rows ("Standards · Bell Bay ›
  Casting · 'SOP' · approved only"), or the decode failure. No
  CardSettings change needed; the config stays plain text fields, which
  keeps the studio free of docs imports (gate rule A).

## Part B — register-true rendering

**B1 — extract the register cells.** New `app/src/docs/registerCells.ts`
holding what `docsScreen.ts` builds inline today (~lines 2441–2597):
`makeStatusChip(ctx)` (palette entry, glyph, quiet-when-approved),
`ownerCell` (initials avatar + name), `makeNameCell(ctx)` (file-type
chip, stem ellipsis, checkout lock with the *mine* variant), the
ISO-date humanisation, and `buildRegisterColumns(ctx, wanted, bucket)`
honouring dictionary order. `docsScreen` refactors onto the module with
**zero behaviour change** (the D6 pass just settled this rendering;
nothing about it is redesigned here). The `app-docs-*` styles live in
`style.css`, which is app-global — the board needs no CSS plumbing.

**B2 — DocsCard on the register road.** Replace the `searchPage` feed
with the register's own: per selected library,
`buildRenderViewXml({ nameWords, termFilters, dateRanges,
modifiedAfterIso, fields, rowLimit })` → `renderListPage`, term filters
as CAML label sets resolved from the same cached term walk the screen
uses, approved-only via the status column's approved-stage labels —
**awaited before the first feed** (the 13-vs-9 lesson: a sweep that
runs before the status vocabulary resolves is unscoped). Multi-library
scopes merge pages by modified descending and cut at the row cap
(default 8, max 20). Rows render through `buildRegisterColumns` in
`mountDocList` — the same virtualised list, with a card-width bucket:
narrow tiles show name + modified, wider add the status chip, full
width shows the view's column set. Row click opens the overlay exactly
as today; the row kebab is deliberately absent (the card is a window;
actions live in the register and the overlay).

**B3 — DocHealth on task anatomy.** Extract the R5 task row
(`pill · name-over-meta · chevron` + the group header with count) from
`docsScreen`'s tasks panel into `app/src/docs/taskRows.ts`, shared by
the screen and the card. The card then renders: the two stat chips
(overdue / due in N days — kept, they read well on a TV), then overdue
rows as task rows — R6-style due pill, name over `owner · due date`,
chevron, click opens the overlay with `details: true` (a task open
arrives with work to do). Scope comes from the same decoded view as
DocsCard; the sweep stays RLDAS on the review-date column, capped per
library **with the cap stated on the card**, and applies the
approved-stage split (a draft owes no review — the health report's
rule, now consistent everywhere).

**B4 — tile snapshots.** `snapshotSvg` keeps its shape (pure text
lines, capped) but gains the anatomy: a status dot per docs row
(palette colour), strong count lines for health. Still self-contained
SVG, no foreignObject.

**Order and proof.** B1 → A + B2 → B3 → B4, one release. Gates: the
full ritual (app tsc, import gate — proving both cards are still
dynamic-only — vitest, build, chunk report: board chunk unchanged,
docs chunk may grow modestly) plus root typecheck if `shared/` is
touched (it should not be). New tests: `viewFromPaste` shapes,
subtree expansion, approved-label scoping, and DOM tests for the
extracted cells. **Hosted checks (Ben):** filter the register to a
real ritual's scope → Copy link → paste into a card → the card shows
the same documents with the same chips; rename an org term → the card
still answers; a narrow tile degrades to name + modified; the studio
preview shows the summary line; a wall-TV account sees only what
SharePoint grants it (the card runs as the signed-in viewer — a
kiosk/TV account needs read on the libraries, worth one line in
deploy-to-new-org.md).

## Part C — native upload relay (cookbook recipe 2, taken up)

The measured ground stands: bytes cannot cross the connector (all four
carriages, re-checked per SDK bump). The relay road goes through
Dataverse instead — **unmeasured**, so it starts with a probe, per
standing practice.

- **U0 — schema + probe.** New table `ben_ltkupload` (file column +
  original name + target library + status), added in DEV with the
  LeanBoard User role updated **in DEV beside it** (the 2026-08-05
  stale-role trap). Probe added to Test write access: native file
  input → SDK write to the file column → read back → delete. The
  question U0 answers: can the code-app SDK carry file bytes into a
  Dataverse file column at all? (A different door than the connector
  carriages 4A measured — Dataverse operations ride the SDK's own data
  layer.) **If refused, the road is dead and is recorded as such.**
- **U1 — the relay flow** (deployment-side, Ben authors in the portal;
  the cookbook stays its doc of record): trigger on upload-row
  created → get the file content from Dataverse → create the file in
  the **staging library** → mark/delete the row. LeanBoard's only
  knowledge of the flow is that a file appears in staging — which the
  shipped H2/H3 handoff already consumes. No second engine inside the
  app.
- **U2 — the app UI.** The add/replace dialogs gain a native file
  picker beside "Open the staging library": pick → upload to Dataverse
  → the dialog watches staging for the arrival (bounded poll; on
  timeout it says "still processing — use Refresh in a moment", never
  hangs) → the existing pick-from-staging flow continues automatically.
  The staging-library road remains, unchanged, as the fallback — a
  tenant without the flow loses nothing.
- **Honest costs, stated up front:** the upload path gains an
  unattended dependency (a paused/failed flow = a file stuck in
  Dataverse — visible in the dialog's timeout message and sweepable),
  and file bytes transit Dataverse capacity. Decision gate after U0's
  verdict.
- **Alternatives to a flow, considered and settled (Ben's question,
  2026-08-08):** every road that moves the bytes unattended is
  server-side automation of the same class — a C# Dataverse plugin
  (pro-code + an app-only SharePoint certificate to manage forever),
  an Azure Function on a webhook (that plus Azure), or a low-code
  Power Fx plugin (a flow by another name, in preview). The
  Dataverse↔SharePoint document-management integration does not carry
  file-column content, SharePoint cannot pull from Dataverse, and the
  app relaying it itself is dead by measurement (reading back works —
  U0 — writing to SharePoint still cannot). The flow is the lightest
  member of the class: no code, no secrets, visible runs. The one
  no-automation alternative is not building U2 and keeping the
  staging handoff as the only road. The relay keeps the flow-free
  thesis: LeanBoard never depends on it — no flow means the staging
  handoff, not a broken app.

## Part D — content-approval hardening trial (cookbook recipe 1)

Progressing this one is **measurement, not code** — the recipe is
marked unmeasured against the app's write bracket, and the trial closes
that.

- **CA0 (Ben, hosted, on a TEST library):** enable content approval
  (draft visibility: approvers and authors), then run one full revision
  cycle through the app as owner/approver and once as a controller.
  Record: do the VULI/PatchItem property writes land on a pending item;
  does the final `checkin(1)` produce a *pending* major; what do
  mid-cycle readers see; does approving in SharePoint publish cleanly;
  does Cancel revision's version-restore behave. The app is not
  changed for the trial.
- **CA1 (only if adopted):** Settings → Documents → Health learns to
  read the library's moderation flag and states the operational
  consequence ("content approval is ON — final approval also needs
  Approve Items; Full Control holds it"); the cookbook recipe gets the
  measured verdict either way.
- **Decision gate after CA0** — adopt on the standards library, or
  record the measured reason not to.

## Recommended order

Part A/B is the build and ships first (pure app work, one release).
CA0 is Ben-side and can run any time in parallel. U0's schema change
rides the release after the cards (schema releases get their own tag —
first schema change since v0.25.0), with U2 following its verdict.
