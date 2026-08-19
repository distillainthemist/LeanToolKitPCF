# LeanBoard — architecture & functionality overview

**The maintained summary.** This page is the orientation document for
the whole application: what it is, how it is structured, how it talks
to Microsoft 365, how it is developed and deployed, and how security,
authentication and data-loss prevention work. Detailed designs live in
the per-feature plans (linked throughout); when this page and a plan
disagree, fix this page — it is meant to be current, the plans are
meant to be history.

Last reviewed: 2026-08-18 (v0.46.0).

---

## 1. What the application is

LeanBoard is a **Power Apps code app** (code-first, `pac code push`,
running in the Power Apps player) with two halves sharing one shell:

- **Lean boards** — a board engine for meeting boards and
  problem-solving/project boards, built from a catalog of ~24 card
  types (agenda, actions, KPI trend, Pareto, SQDPC, …).
- **Standard Documents** — a SharePoint-backed document management
  system (register, lifecycle, approvals, links, tags, audit) for
  controlled standards.

Plus cross-cutting features: Teams/Outlook notifications, an in-app
issue/idea reporting system with triage, and diagnostics probes.

Environments: **dev** (`pecheydistillingdev.crm6.dynamics.com`, SP site
`…/sites/Dev`) and **prod**. Code reaches dev via `pac code push`;
prod only via tagged releases (§6).

## 2. Repository structure

```
app/            the code app (vanilla TypeScript, Vite, no framework)
  src/main.ts        shell: hash router, top bar, dynamic screen imports
  src/screens/       hub, board, composer, card editor, settings, …
  src/docs/          the ENTIRE document management system
  src/issues/        report dialog + admin triage tab
  src/store/         Dataverse data layer (typed helpers over services)
  src/generated/     pac-generated connector/table services (do not edit)
  tools/             import-gate, chunk-report (build-time checks)
shared/         UI kit + tokens shared with the (retired) PCF controls
controls/       retired PCF controls — kept for shared model code
data/           declarative Dataverse schema + admin scripting tools
docs/           plans (history), runbooks, this page
```

**The import gate** (`app/tools/import-gate.mjs`, runs in CI and
locally) enforces two boundaries: the board startup path (main,
cardRegistry, board, hub screens) must never statically reach
`src/docs/`, and the docs-only connectors (SharePoint, Teams, Outlook)
are only importable from `src/docs/`. Dynamic `import()` is the
sanctioned door — settings reaches the docs tab that way, cards reach
the docs card module that way. This keeps board startup lean and the
connector surface contained.

## 3. How boards and cards work

Design of record: [master-leanboard.md](master-leanboard.md) (data
model section) — the canvas/PCF sections there are historical.

- **The pattern is snapshot tiles + one editor.** A board is a grid of
  **tile snapshots** (SVG images stored with the card data); tapping a
  tile opens the full card editor for that card type. This exists
  because a grid of N live components was unbuildable and unaffordable;
  the snapshot repaints when the card saves.
- **Data model (Dataverse):** `ben_ltkboard` (board manifest JSON,
  people, occurrence settings) → `ben_ltkboardinstance` (one per
  meeting occurrence; problem boards have one living instance) →
  `ben_ltkcarddata` (per card per instance: output JSON + tile SVG).
  `ben_ltkcardcatalog` holds the card-type catalog and default tiles;
  `ben_ltkcardseries` supports series data; `ben_ltkaction` is the
  actions register; `ben_ltkpeoples` is the app's user record (role:
  user/siteadmin/superadmin, site, department — the site drives the
  DMS default filter); `ben_ltksitesettings` and `ben_ltkuserprefs`
  hold settings — the site row also carries `ben_hubtabs` (per-site
  enablement of the hub's main tabs; `shared/schema/hubTabs.ts` is the
  one list, default order My day · Cadence · Priorities · Actions ·
  Documents) and `ben_isarchived` (an archived site keeps its row and
  data but leaves `orgJson()` and so every picker; Organisation settings
  lists it under "Archived sites" with Restore) and `ben_siteorder` (drag
  a site card onto another in the same company to reorder; `orgJson()`
  sorts by it, unset last) — all 2026-08-19, solution-carrying. **Cascaded priorities (P0, 2026-08-19):**
  `ben_ltkpillar` (company pillars, two levels via a self lookup),
  `ben_ltkpriority` (one row per priority, owned by its originating org
  by NAME — company/site/department/area columns — with pillar and
  parent-priority lookups), `ben_ltkpriorityassignment` (priority ×
  receiving org: proposed/accepted/rejected/onhold/completed + reason;
  `childpriorityid` when customised), `ben_ltkpriorityevent` (the
  history tab), `ben_ltkactionfile` (evidence files on actions); actions
  gained `verify` status, verification stamps, reschedule/cancel history
  and an initiative id; site settings gained per-org visions and the
  app-level priorities settings (period definition, RAG ratio). The
  initiative-side tables arrive with P5 once the templates builder is
  designed. Pure model + tests: `app/src/priorities/model.ts`; IO:
  `store/priorities.ts`; the org's OWNERS (site + department, plural)
  and visions ride the existing site-settings JSON (`store/config.ts`).
  Plan of record: [leanboard-cascade-improvement-plan.md](leanboard-cascade-improvement-plan.md).
- **The hub** is the landing screen: My day agenda, boards, actions,
  a Documents tab count. **Doc cards** (Standard documents, Document
  health) render register-true rows inside boards, configured by
  pasting a register view link; they load via the dynamic-import door
  and fetch after paint with jitter so a wall of boards can't
  synchronise into a 429 storm.
- **The Canvas card** is the charter/plan-on-a-page: a maker lays out
  typed, titled fields (20 types — text through rich text, people,
  status/RAG on the app palette, checklists, mini capture tables,
  images) in a 1–3 column grid in the settings Layout builder; users
  fill them in on the card (inline for typing types, dialogs for
  pickers). Layout lives in config, values in the envelope keyed by
  field id — restructuring never loses content. Actions are card-level
  via the standard channel. Design of record:
  [leanboard-canvas-card-plan.md](leanboard-canvas-card-plan.md).
- **On-canvas design mode (the studio's reverse channel).** The card
  studio was one-way — settings drove the card, nothing flowed back —
  so layout editing lived in dropdowns. Cards with `CardSpec.designable`
  (Canvas today) are mounted in the studio (board mode) as THE layout
  editor: `CardMount.designLayout` + `onConfigPatch(key, value)` push
  the card's own config changes into the studio draft, which repaints
  the settings pane WITHOUT remounting the card; a selection bridge runs
  both ways (`onSelectField` / `registerSelectField` ↔
  `CardSettingsEditor.setSelection`); the studio holds a session
  undo/redo stack of config snapshots. On the canvas: a toolbar
  (columns, grid, preview), gridlines and empty cells from a pure
  `placeFields` simulation of CSS sparse auto-placement (design and run
  use the same explicit placement, so they agree by construction),
  type-true skeletons, ⋮⋮ pointer-drag to reorder, edge/corner resize
  snapping to columns/steps; the inspector becomes the selected field's
  property panel with title/id validation (duplicate titles break rollup
  matching). Design mode is studio-only — meetings never enter it. The
  pure draft model (`CanvasCard/draft.ts`) is UI-free so the mounter's
  reverse channel does not drag settings editors into the board path.
- **Title-bar contract & the universal ＋ Action.** When a card has a
  title, `renderTitleBar` gives the bar a right-hand action slot and
  `renderKebab` appends there (no longer overlaying the body); app code
  registers extras with `setTitleBarExtras(mountHost, builder)` — a
  builder, because editors rebuild their root on every render. The
  focused card editor registers **＋ Action** on every card (not action
  surfaces, not the template's live row, not when the card disables
  actions): a card-LEVEL linked action through the standard action
  manager on the card's channel, in addition to whatever a card raises
  from its own elements. Dialogs opened from app code need an
  `.app-dlghost` for the toolkit CSS variables — and inside the editor
  host it must take no space (`flex: 0; height: 0`), or it splits the
  card's height.
- **The card walk swap.** Hopping between cards in the focused view
  mounts the NEXT card before tearing the previous one down
  (hold-until-ready). Consequence: a card's teardown must release only
  ITS OWN resources — an embed card parks only its own persistent frame
  key (a global `parkAllFrames()` there hid the incoming card's frame).
- **The Embed card** (Power BI, SharePoint pages, any framing-friendly
  https page). One long-lived `<iframe>` per card lives in a
  `position:fixed` host on `<body>` (`app/src/embedFrames.ts`), OUTSIDE
  the routed DOM — re-parenting an iframe reloads it, so screens never
  take the frame, they only PARK it over a slot (scaled over a board
  tile, full-size in the card editor); the same document survives
  screen changes and Power BI's autoAuth handshake happens once. Frames
  delegate `fullscreen; storage-access; local-network-access`. Power BI
  links are normalised (`buildEmbedUrl`: pane toggles, page name);
  SharePoint doc links become `action=embedview`. Two escape hatches
  from the frame chain: the ↗ open-in-tab link, and **Present in a
  window** (`presentWindow.ts` — a card setting that holds NO frame and
  opens the page in its own top-level window, one per card, reused and
  focused; plus a ⧉ chip on every embed card to present on demand). A
  cross-origin frame cannot tell us whether its content rendered (its
  load event fires on a sign-in page too, and the Power BI secure embed
  posts nothing to its parent), so the "Not showing?" hint is a
  RISK-PROFILE hint (Windows + Chromium ≥ 142 + Power BI, focused view,
  20 s, dismissible per browser) — never a failure detector.
- **Cross-board windows:** a **LinkCard** renders another board's card
  read-only (its source's policy decides which document — live row for
  shared, newest meeting otherwise). A **Capture rollup** generalises
  this to many sources: it merges rows from Capture cards on other
  boards into one table (columns matched by NAME across sources, the
  ⚑ Flag column found by TYPE), filters to flagged items, and can
  write back — un-flag or full row edits — via a read-modify-write
  straight onto the source card's document (`store/rollup.ts`). Its
  own document is content-free with a fixed shared policy, existing so
  tiles and close-meeting archives ride the standard save road. Design
  of record: [leanboard-capture-rollup-plan.md](leanboard-capture-rollup-plan.md).
  The **Canvas rollup** is the same idea transposed for charters: one
  row per linked Canvas card (current content only), columns matched by
  field label, cells painted by the canvas display module, and full-mode
  per-cell edits through the canvas's own field dialogs writing back to
  the source document (mini-tables edit on their source card). Both
  rollups share the store road's source-resolution skeleton
  (`store/rollup.ts`).

## 4. The document management system

The DMS treats **SharePoint as the source of truth** — documents,
metadata, versions, permissions all live in SP document libraries; the
app is a register and workflow surface over them. Dataverse holds only
configuration (`ben_ltkdoclibraries`: the library list + one JSON
config blob per library + one app-level blob carrying the site
dictionary, lifecycle mapping, cadence and default filters).

Key concepts (details: [leanboard-standard-documents-plan.md](leanboard-standard-documents-plan.md),
[leanboard-phase5-plan.md](leanboard-phase5-plan.md)):

- **Library types**: standard (controlled), record, working, revision,
  template. Templates are visible to document controllers only.
- **The site dictionary**: one column model per site — internal name,
  label, group, per-library-type cells (hidden/available/default), and
  **roles** (status, owner, approvers, reviewers, documentId, docType,
  organisation, importance, effectiveDate, nextReviewDate,
  reviewCadence, linkedDocuments, tags, regulatorApproved,
  ackRequired…). Every behaviour keys off roles, never hardcoded
  column names.
- **Lifecycle**: draft → in review → in approval → in owner approval →
  approved → superseded/obsolete, driven by a status **term set**
  mapped to stages. Review is mandatory only when reviewers are named;
  a two-step approval only when approvers outside the owner exist.
  Commands run a strict write bracket (§5) and write recognisable
  check-in comments — the **audit view** derives who/step/comment from
  version history alone (no separate event store).
- **The date model**: effective date stamps itself at Approve and Mark
  reviewed; cadence follows the Importance term (a mapping); review
  date is always effective + cadence. None are typed by hand.
- **Content approval (moderation)**: libraries run SharePoint content
  approval; readers see only published versions. Every reader-facing
  act (approve, retire, quick property edit, mark reviewed) publishes
  as part of the act; mid-circulation drafts stay walled.
- **Links**: JSON in the document's own `DMSLinkedDocuments` column,
  uid-anchored, rels parent/peer/child/regulatorCopy. Declaring writes
  only the declaring document; "what links here" is derived (session
  index under 2,000 docs, per-document search above). The regulator
  gate is evidence-based: a flagged document warns at Approve until
  its stamped copy is linked.
- **Tags**: a closed term set; anyone proposes (guarded against
  phone-hostile characters, §7), controllers mint or decline
  (`ben_ltktagproposal` ledger).
- **Access model** (5G): four groups — document controllers (Entra),
  owners & approvers pool (Entra), a SharePoint **site group** for
  temporary edit grants (instant; the Entra editors group is retired),
  wall-TV/kiosk accounts. Requests → grant → revision-end release.
  In-app gates hide affordances; SharePoint stays the hard gate.
- **Health**: Document Control Health scans the corpus (capped,
  stated) for control gaps — unmapped roles are reported as skipped,
  never silently passed.
- **Issues**: the ⚐ Report button files bugs/ideas with pasted
  screenshots (Dataverse file columns); superadmins triage, merge,
  and message reporters via Teams ([leanboard-issues-plan.md](leanboard-issues-plan.md)).

## 5. SharePoint interfacing (the connector roads)

Cookbook of record: [sharepoint-writes.md](sharepoint-writes.md).

Everything SharePoint rides the **SharePoint connector's `HttpRequest`
passthrough** (`src/docs/sp.ts → spRequest`) — REST calls executed as
the signed-in user through the connector, so consent, DLP and
conditional access all apply. The important roads:

- **Reads**: `RenderListDataAsStream` (RLDAS) is the register's feed —
  display-ready values, server-side CAML for search/filters/sort,
  cursor paging. REST item reads (`fetchListItem`) give full field
  values (RLDAS clips multiline columns — never mutate from a feed
  value). SharePoint **search** (`postquery`) covers
  inside-the-document matching and the over-cap links road. Term
  store v2.1 endpoints walk/create/rename terms (walks are
  localStorage-cached for screens; syncs always walk live).
- **Writes**: `ValidateUpdateListItem` (VULI) for text/choice/person
  (claims)/moderation/dates-in-site-locale; the connector's typed item
  PATCH for taxonomy and ISO dates; file operations (add, check-out,
  check-in, recycle) via REST. Every lifecycle write runs the
  **bracket**: check-out → writes → check-in (with a meaningful
  comment) → moderation publish when reader-facing → grant release.
  A refused step aborts before the check-in; nothing half-lands.
- **Previews**: presigned, cookie-free drive URLs (an iframe to SP is
  a third-party-cookie context that renders a blocked sign-in frame).
- **Measured platform limits** the code respects: ≤12 lookup-type
  columns per query (throttle), Note columns not CAML-filterable and
  clipped in feeds, RLDAS responses shrink-retried on mobile (§7),
  taxonomy labels store `&` as U+FF06 (§7).

### The five connectors

| Connector | Service | Used for |
|---|---|---|
| SharePoint (`shared_sharepointonline`) | `DocumentsService` + `spRequest` passthrough | everything in §5 |
| Microsoft Teams (`shared_teams`) | `MicrosoftTeamsService` | notifications: CreateChat + adaptive card (plain-message fallback); sender = the acting user (self-chats refused by the connector) |
| Office 365 Outlook (`shared_office365`) | `Office365OutlookService` | e-mail alternative for notifications (SendEmailV2) |
| Office 365 Groups (`shared_office365groups`) | `Office365GroupsService` | Graph passthrough (`HttpRequestV2`) for Entra group membership: pool checks, controller checks, member/owner add/remove |
| Office 365 Users (`shared_office365users`) | `Office365UsersService` | people search for pickers, profiles |

Teams/Outlook are **docs-only by the import gate** and load by dynamic
import at the moment of sending — the board bundle never carries them.
Group-membership gates **fail closed for elevation** (an unreadable
group never makes someone a controller) and **fail open for
convenience affordances** (a Graph hiccup must not hide the Add button
from a legitimate author — SharePoint still refuses unauthorised
writes).

## 6. Development & deployment

Operating instructions of record: [../CLAUDE.md](../CLAUDE.md) (agent),
[deploy-to-new-org.md](deploy-to-new-org.md) (new-environment runbook),
[deployment-cookbook.md](deployment-cookbook.md) (operational recipes).

- **Gates before any push**: `tsc --noEmit`, the import gate, vitest
  (~500 tests), `npm run build`, chunk report — plus repo-root
  typecheck when `shared/`/`controls/` change. Check the test COUNT
  line, not just exit codes, when chaining, and `set -o pipefail`
  (`tsc | tail` reports tail's exit). The chunk report's ceiling on
  `cardRegistry` is a LEAK detector: a mounter that needs a pure helper
  from a settings module must import a UI-free module (the
  `CanvasCard/draft.ts` precedent), never the settings editors.
- **Dev deploys**: `pac code push` from `app/` (authenticated as the
  maker; the player caches bundles — close/reopen after every push).
  `pac code add-data-source -a dataverse -t <logical name>` wires new
  tables and regenerates services (use logical names, not entity-set
  names).
- **Schema**: declarative in `data/schema.mjs`, applied by
  `data/deploy-schema.mjs` (idempotent Dataverse Web API; creates
  tables/columns/relationships inside the **LeanToolKitData** solution
  and grants LeanBoard User role privileges in the same run). A schema
  change makes the next release **schema-carrying**: prod needs the
  managed solution imported before the app package.
- **Admin auth (device codes)**: `data/get-token.mjs` runs a
  device-code sign-in against any resource URL using the first-party
  Azure CLI public client; `data/exchange-token.mjs` re-scopes the
  refresh token to a sibling resource (e.g. Graph) without a second
  sign-in. The human performs every sign-in; tokens are written 0600
  to a temp directory outside the repo, never printed, and deleted
  after use. Direct SPO REST rejects this client in this tenant —
  Graph is the admin-scripting road.
- **Releases**: `./release.sh <x.y.z>` + `git push origin main --tags`.
  The tag triggers GitHub Actions: build the app package, export the
  managed LeanToolKitData solution from dev, attach both to a GitHub
  Release. Version lives in the tag alone; the build stamps
  `__APP_VERSION__` from `git describe` (issue reports carry it).

## 7. Security, authentication & data-loss prevention

**Authentication.** Users sign into Power Apps with their **Entra ID**
account — MFA and conditional access policies apply exactly as for any
M365 app. The code app runs inside the Power Apps player; the Power
Apps SDK **brokers an access token per data source** at call time. The
application code never sees, stores, or handles credentials or tokens:
there are no client secrets, no app registrations of our own, no
custom auth. Kiosk/wall-TV surfaces use ordinary (least-privileged)
signed-in accounts.

**Execution identity.** Every connector call — SharePoint reads and
writes, Teams messages, Graph group operations — executes **as the
signed-in user** through their own per-user connector connections
(consented on first run). There is no service account and no
elevation: a Teams notification is sent by the person who clicked
send; an approval is written by the approver. This is a deliberate
design principle ("honest provenance") and also the security model —
the app can never do what its user cannot.

**Authorization is layered, SharePoint last and decisive:**
1. SharePoint permissions (site groups, library permissions, content
   approval) — the hard gate; the app cannot grant anything SP denies.
2. Dataverse security roles — the **LeanBoard User** role carries
   explicit per-table privileges (granted declaratively at schema
   deploy). Issue/proposal tables are org-readable by decision
   (internal transparency powers dedupe and known-issues culture).
3. In-app gates (superadmin/siteadmin roles in `ben_ltkpeoples`,
   controller/pool Entra groups) — these only *hide affordances* and
   route workflows; they are UX, not security. Elevation checks fail
   closed; convenience checks fail open (documented per gate).

**Data-loss prevention.** The app uses **five standard Microsoft
connectors only** (SharePoint, Teams, Outlook, O365 Groups, O365
Users) plus Dataverse — no custom connectors, no third-party
endpoints, no direct `fetch` to anything outside the connector
surface. Environment **DLP policies** therefore govern it completely:
all five connectors must sit in the same (business) group in the
environment's policy, and any DLP change that splits them breaks the
app loudly rather than leaking quietly. All data at rest stays in the
tenant: documents in SharePoint, configuration/issues in Dataverse.
Screenshots pasted into issue reports are stored in Dataverse file
columns (tenant-bound), never in SharePoint libraries where DMS
readers might browse them.

**Client-side state.** localStorage on the user's own profile holds
only UX state: term-set walks, UI preferences (collapse state, view
selections), a task-badge count, and the register's cached first page
(document names/metadata for instant paint — same data the user just
saw; cleared by cache-key mismatch). No tokens, credentials, or
document content are ever cached.

**Frames & popups**: the only iframes the app creates are the Embed
card's (user-configured https URLs, `safeEmbedUrl`-validated, no
`javascript:`/`data:`), delegated `fullscreen; storage-access;
local-network-access` and nothing more; the only popups are user-gesture
"Present in window" / open-in-tab of that same URL. Rich text (canvas
fields, embed commentary) is sanitised by allowlist REBUILDERS on write
and render — stored HTML is never trusted.

**Admin scripting hygiene** (§6): human-performed device-code
sign-ins, short-lived tokens in 0600 temp files outside the repo,
deleted after use; the deploy tooling is committed and reviewable —
no ad-hoc credential handling.

**Known platform boundaries** (documented, monitored):
- The Power Apps *mobile* player truncates connector responses
  containing U+FF06 (fullwidth ampersand — what the term store turns
  `&` into). Mitigations: the org-sync warns on `&` in unit names, the
  tag guard blocks it in proposals, feeds shrink-retry, and in-app
  probes (Test document feed / character classes) diagnose on-device.
  Reported to Microsoft.
- The mobile player's CSP blocks `blob:` images — screenshots render
  as `data:` URLs.
- Entra group membership propagates slowly to SP tokens — which is why
  temporary edit grants seat a SharePoint **site group** (instant)
  instead.
- **Chromium Local Network Access × Windows work-account SSO** (Edge/
  Chrome ≥ 142): the browser hands the Power BI frame's Entra token POST
  to the Windows account broker, Chromium gates that as a local-network
  request, and a NESTED cross-origin frame only holds the permission if
  every parent delegates it — the Power Apps player's frame does not
  (Microsoft's; Teams has the same open issue). Result: the embedded
  Power BI sign-in loops on Windows. Not DNS/VPN/proxy. Levers are
  outside the app (device-group SSO policies, the LNA off-switch
  policy, a Microsoft fix) plus the in-app Present-in-window mode and
  hint. Full diagnosis + policy names:
  [deployment-cookbook.md](deployment-cookbook.md) → Power BI embed
  prerequisites. The embed-token relay road (Custom API + service
  principal, needs Power BI capacity) is specified there and ON HOLD.

## 8. Living documents map

| Question | Document |
|---|---|
| Data model & board engine | [master-leanboard.md](master-leanboard.md) |
| DMS design (register, vault UI) | [leanboard-standard-documents-plan.md](leanboard-standard-documents-plan.md), [leanboard-vault-design-plan.md](leanboard-vault-design-plan.md) |
| Lifecycle, access model, dates | [leanboard-phase5-plan.md](leanboard-phase5-plan.md), [leanboard-access-group-plan.md](leanboard-access-group-plan.md) |
| SharePoint write mechanics | [sharepoint-writes.md](sharepoint-writes.md) |
| Links, audit view, tags | [leanboard-relationships-plan.md](leanboard-relationships-plan.md) |
| Issues/reporting | [leanboard-issues-plan.md](leanboard-issues-plan.md) |
| Capture rollup (Flag column, cross-board capture rows) | [leanboard-capture-rollup-plan.md](leanboard-capture-rollup-plan.md) |
| Canvas card, design mode, Canvas rollup | [leanboard-canvas-card-plan.md](leanboard-canvas-card-plan.md) |
| Power BI embed prerequisites (browser policy) | [deployment-cookbook.md](deployment-cookbook.md) |
| Backlog & decisions of record | [backlog.md](backlog.md) |
| Notifications | [leanboard-notifications-plan.md](leanboard-notifications-plan.md) |
| New environment setup | [deploy-to-new-org.md](deploy-to-new-org.md) |
| Operational recipes (flows etc.) | [deployment-cookbook.md](deployment-cookbook.md) |
| Requirements disposition | [bba-dms-gap-analysis.md](bba-dms-gap-analysis.md) |
| Decisions & queue | [backlog.md](backlog.md) |
| Dev-environment operating rules | [../CLAUDE.md](../CLAUDE.md) |
