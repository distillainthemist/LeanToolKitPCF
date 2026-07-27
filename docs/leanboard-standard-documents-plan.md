# LeanBoard — Standard Documents: evaluation and draft plan

Written 2026-07-27, from Ben's `Leanboard - Standard Documents.md` overview and
the `BBA DMS Requirements & HLD v1.4` it references. Revised the same day after
an independent review pass, and re-shaped around Ben's challenge: can the
feature eliminate its reliance on Power Automate completely?

## What Ben asked for

1. Evaluate the draft overview against the requirements document.
2. Propose a draft plan for a new **Standard Documents** area in LeanBoard —
   a new region of the main interface plus its settings.
3. Suggest improvements.
4. **Do not compromise the performance of the board experience.** Treated as a
   hard constraint with an enforced budget, not as advice.
5. Fold the review findings back in — all of them except re-cutting the phases
   around a vertical slice: the configuration-first phase order stays.
6. Challenge whether Power Automate flows can be eliminated entirely.

---

## Headline judgement

Three structural decisions, made here so the rest of the plan can be concrete:

**1. SharePoint columns are the system of record.** Not Dataverse, and not
LeanBoard state. The requirements document's audit posture (FR-AT-001,
tamper-evident) is satisfied by SharePoint version history — every column
change carries actor and timestamp natively — and by nothing LeanBoard could
build itself: a client-writable Dataverse table is not a tamper-evident trail.
The Dataverse history table in Ben's draft survives only as a **projection**
for fast presentation, explicitly labelled as such in its schema comment.

**2. LeanBoard is the whole engine for acts; the ritual is the scheduler;
flows are an optional deployment add-on the app never depends on.** This is
the flow-free answer, analysed in full in the next section. The one thing a
client can never do is run when nobody is present — and the lean answer to
that is not a scheduler, it is the daily meeting.

**3. Search runs server-side, in SharePoint, as the signed-in user.** At
~2,300 procedures + ~250 HSEC + 500+ records the corpus can never be pulled
into the client, and it must never be mirrored into Dataverse for querying —
mirroring means re-implementing permission trimming, and FR-AC-005 /
NFR-SE-003 make the cost of getting that wrong a confidential document
leaking to the whole site.

---

## Eliminating Power Automate — the analysis

Split every job the DMS "engine" performs by one question: **is a user present
when the job runs?**

### At-action jobs — a user is doing something. All go flow-free.

| Job | Flow-free mechanism |
| --- | --- |
| Status transitions, date stamping, version archive | One **command** per act, executed as the acting user via list REST: approve = set Status, stamp EffectiveDate + NextReviewDate, check in a major version. One function, one contract |
| Check-out / check-in | Native SharePoint REST `checkout()` / `checkin()` |
| Document addition | Connector file upload + metadata write, driven by the Phase 1 column configuration |
| Route-to-review / route-to-approve notifications | Sent **at-action by the actor** via the Teams (or Outlook) connector. The sender is honest: "Ben submitted X for your review" genuinely comes from Ben |
| Regulator confirmation (FR-WF-011) | A gate inside the approve command's UI; the confirmation lands in columns |
| Watermarked PDF rendition (FR-DI-005/007) | Generated **at approve time**: Graph `format=pdf` conversion of the source, watermark stamped client-side (pdf-lib, lazy-chunked into the docs area), uploaded as the rendition. The bytes pass through the approver's browser once, at an explicit action — acceptable; bulk conversion is never done client-side |
| Acknowledgement (FR-DI-001/002) | A self-attesting, append-only ledger row written by the acknowledging user; the compliance report is a query |
| Owner find-and-replace (FR-LC-005) | An admin-run batched command with progress UI — bounded work, hundreds of writes |

### Unattended jobs — nobody is present. The irreducible carve-out.

Review-due reminders, overdue escalations, retention-due prompts, and
corporate-change review tasks *pushed to inboxes* all fire on a clock or an
event with no user in the app. A client cannot do this. Three honest options:

1. **Derive-at-read (adopted).** Overdue, due-soon, retention-due and
   parent-changed-since-my-review are all *computable from columns at read
   time* — nothing needs to fire, because nothing needs to be stored. This is
   already the repo's stated principle
   (`LeanToolKit_ImplementationPlan.md:276`: *"due < today and not done, never
   stored — stored 'overdue' goes stale"*). The **Document health card in the
   daily meeting is the reminder**: the ritual is the scheduler. This is not a
   workaround — it is the product's actual thesis, and it is a better
   compliance behaviour than inbox nagging.
2. **Lazy sweep (rejected).** First app-open after a due date sends whatever a
   scheduler would have sent. Rejected: the sender is whoever happened to open
   the app (a DM "from Karen" that Karen never wrote), duplicate-send races
   need a claim protocol, and if nobody opens the app nothing sends.
3. **Deployment add-on flows (the escape hatch).** An organisation that wants
   inbox push adds flows that read the same columns. LeanBoard neither invokes
   nor knows about them — zero dependency, and nothing can diverge, because
   the columns are the only contract.

### What this changes

- The command pattern simplifies from "invoke a flow, with a native fallback"
  to **"native always."** There is no second engine, so the
  two-systems-divergence risk from the first draft of this plan disappears.
- Phase 5 becomes *the approval engine*, not a flow-integration layer.
- The BBA FR-NT reminder MUSTs are consciously mapped: in-app and on-board
  surfacing is LeanBoard's; push is the deployment's, via option 3. That
  mapping should be stated to stakeholders, not discovered.

### The integrity caveat, stated plainly

With no server-side engine, the lifecycle state machine is enforced by
LeanBoard's UI plus SharePoint permissions. Readers cannot write at all — the
permission wall holds for the overwhelming majority of users. But a document's
own editors *could* set Status = Current directly in SharePoint, bypassing the
command. That act is **auditable, not preventable**: version history records
it with actor and timestamp. Flows would not fix this either — they cannot
block a direct edit; real prevention needs SharePoint content approval or
item-level lockdown, which is listed as optional hardening a deployment can
add. Trusted-but-audited editors is the honest position for the generic
product.

### The rendition dependency — resolved

`format=pdf` turns out to live on SharePoint's **site-scoped**
`/_api/v2.0` drive surface, not only on Graph — probed on the Dev site
2026-07-27: HTTP 302 to a presigned conversion URL. So rendition generation
rides the same site-scoped REST the rest of the plan uses, with no Graph
dependency at all. The graceful degradation (native read-only preview,
deployment flow for strict FR-DI-005) remains documented as the fallback if a
tenant's conversion service misbehaves.

---

## What the code already gives us (checked, not assumed)

- **Route-level lazy loading already exists.** `app/src/main.ts:135` imports
  each screen inside the route function; the shell paints before any store or
  SDK module evaluates. A `#/docs` area is a new chunk, loaded only on
  navigation.
- **The chunk layout is already split the right way.** Today's build:
  `cardRegistry` 341 KB, `tile-defaults` 326 KB (dynamic, rare), `mappers`
  85 KB, `composer` 55 KB, `settings` 46 KB, `hub` 38 KB.
- **Card mounters live in `cardRegistry.ts`** — `app/src/screens/board.ts:45`
  imports `mountTile` from it. So a documents *card* cannot keep SharePoint
  code out of the board path by module placement alone; its mounter must reach
  the SharePoint module by **dynamic import only**. The CI rule below is
  written with that carve-out.
- **A persistent-iframe pattern exists** (`app/src/embedFrames.ts`) — but it
  exists for *persistence across routes*, which the transient per-document
  viewer does not need. The viewer overlay uses a plain iframe; embedFrames is
  reused only if the board-card → viewer journey needs continuity.
- **Connector precedent, including a Graph passthrough.**
  `app/src/store/accessGroup.ts:90` drives Entra group membership through the
  Office 365 Groups connector's `HttpRequestV2` under the signed-in user's
  delegated permissions. It proves the shape works in this codebase — but that
  passthrough is **scoped to `/groups` endpoints and cannot substitute** for
  SharePoint search or sites access.
- **Connections are declared in `app/power.config.json`** as
  `connectionReferences` and regenerated by `pac code add-data-source`. Adding
  SharePoint is that command plus a connection Ben creates in the maker
  portal. A new connection reference is an **ALM event**: it changes what
  `docs/deploy-to-new-org.md` must cover.
- **CI already exists** (`.github/workflows/app-ci.yml`, on push). The
  guardrails below are additions to it, not a new CI system.
- **The org tree is 3 levels + companies** (`shared/schema/meeting.ts`
  `OrgSite`, `companies()` in `app/src/store/config.ts`), mapping onto the DMS
  four-level Organisation term set as company → site → department →
  area ≡ team. Agree the naming once.
- **People already carry `site` / `department` / `area`** (`RosterPerson`), so
  defaulting the navigation to the viewer's own organisation is a read of data
  the app already has.
- **Settings is already a tabbed screen** (`app/src/screens/settings.ts:240`);
  a Documents tab is additive. The palette control from the branding work is
  reusable for status colours.
- **Shared links have a mechanism** (`app/src/links.ts` launch params) for the
  bookmark-and-share-a-view requirement.
- **The derive-don't-store precedent** quoted above anchors the unattended-jobs
  answer in an existing repo principle.

---

## The performance contract

| Guarantee | How it is enforced |
| --- | --- |
| Zero bytes added to the board critical path | CI gate in `app-ci.yml`: **no static import edge** between the docs modules and `cardRegistry.ts` / board screens, in either direction. The docs card's mounter reaches its data module by dynamic import only |
| Chunk growth visible, not policed by ratchet | Chunk sizes recorded as a trend report with generous absolute ceilings. A percentage ratchet is deliberately **not** used: 2% of cardRegistry is ~7 KB, legitimate board work (the kanban feature) would have tripped it, and a perpetually re-baselined check protects nothing |
| No new work at app start | The shell's branding path and `selfHealCatalog()` are untouched; documents config is read on entering `#/docs`, never before. The area is inert until routed to |
| SharePoint calls outside `#/docs` happen only when a documents card is on the opened board | The grid paints the docs card from its **stored tile SVG** first, like every card; the mounter dynamic-imports its data module, refreshes after paint or on tap with jitter, and never blocks the grid. A per-user session cache bounds the shift-start fan-out — thirty tablets opening area boards at 06:00 must not synchronise into a 429 storm |
| Document list stays responsive at corpus scale | Server-side paging (50 rows), virtualized list, no client-side full-corpus fetch, ever |
| Repeat navigation feels instant | Session-scoped cache for library config and term sets; stale-while-revalidate for list results |

The import gate is the load-bearing check: it turns the performance promise
into a build failure rather than a code-review opinion. Baseline in Phase 0.

---

## Data paths

Three stores, three jobs.

**1. SharePoint Search API — browse, search, facets.**
`POST /_api/search/postquery` via the connector's HTTP action. Primary because
it is **permission-trimmed by the service** (FR-AC-001/005/006, NFR-SE-003
satisfied by construction), and one call spans every library.

**The navigation tree is work, not a freebie.** Three real costs, so the tree
gets its own design obligations rather than a sentence:

- Taxonomy refiners return flat tokens (`L0|#guid|label`, with `GTSet`/`GPP`
  ancestor tokens), not a tree — they need parsing, and a four-level
  Organisation hierarchy from one column must be **reconstructed**: the cached
  term-set tree provides the structure, refiner counts scoped by term path
  provide the numbers.
- Custom columns are searchable/refinable only after crawled → managed
  property mapping (`RefinableStringNN` aliases) **plus a full recrawl** —
  tenant-admin work with lead time, so it is raised in week 1, not discovered
  in Phase 2.
- The index lags reality by minutes, which is why single-document truth never
  comes from it.

**2. SharePoint list REST — single-document truth and writes.**
`/_api/web/lists/…/items(<id>)` for the properties pane and for every command
write (status transitions, check-out/in, metadata updates). Used wherever
index staleness would be wrong: the moment a user opens one document, we read
its live row.

**3. Dataverse — LeanBoard's own state only.**
One table per concern, built through the existing schema pipeline
(`data/schema.mjs` → `deploy-schema.mjs` → `pac code add-data-source`):

- `ben_ltkdoclibrary` — one row per selected library: type, display names,
  column roles, view defaults, status palettes, **PDF rendition location**.
- `ben_ltkdocprefs` — per-user favourites and saved views.
- `ben_ltkdocack` — the acknowledgement ledger (append-only, self-attesting).
- `ben_ltkdochistory` — the history **projection**, schema-commented as a
  projection and not the audit trail.

Nothing in Dataverse is authoritative about a document; a stale row can never
hide or expose one.

**Explicitly rejected:** mirroring the corpus into Dataverse for querying
(permission trimming becomes ours to re-implement; the failure mode is a
leak); the lazy notification sweep (sender identity, races); embedFrames for
the transient viewer (wrong tool — it solves persistence).

---

## Improvements to the draft

**1. Split settings into "connection" and "per-library", stored as rows, not
one blob.** `ben_ltkdoclibrary` gives each library a stable id to hang saved
views and favourites off, and keeps the app row small.

**2. Make the SharePoint connection per-user, and verify it.** If the
connection is shared, every user sees what the connection's account can see
and the confidentiality model collapses silently. Expected answer: standard
connectors in code apps are consented **per user** on first run — so the spike
verifies rather than explores. The acceptance test is two accounts with
different library access, same query, different result counts. Prerequisite
flagged honestly: this needs a **second licensed account in the dev tenant**;
if none exists, provisioning one is itself a Phase 0 action.

**3. Build the tree from the term store plus refiner counts, and cache it.**
Per the data-paths section — structure from the cached term-set tree, numbers
from path-scoped refiners. A user reordering the hierarchy is a different
query, not a different data model.

**4. Design the viewer for new-tab first; the overlay is an enhancement.**
The code app is itself an iframe on `apps.powerapps.com`, and SharePoint's
WOPI/preview endpoints commonly send `frame-ancestors` that exclude foreign
hosts — so in-host embedding is *expected* to fail for Office formats, and
opening in a new tab is designed as the primary path, not a degraded one. The
overlay, where it works, uses a plain iframe (PDF renditions are the most
likely to embed cleanly) with a thumbnail strategy (Graph thumbnails /
`getpreview.ashx`) for the popup; print/share are deep links (mailto:, Teams
deep link), not in-frame commands. Two consequences carried into the phases:
**where the PDF rendition lives is per-library configuration** (Phase 1), and
the "Uncontrolled if printed" watermark is baked into the rendition at
approve-time generation — a viewer cannot honestly add it, because anything
the client draws the client can omit.

**5. Keep the Revision library for controlled standards; native check-out for
working documents.** (Flipped from this plan's first draft, which had it
backwards.) FR-DI-006/007 — both MUST — deny general readers *any*
editable-source entitlement; the provisioned-copy library exists precisely to
let a reviser edit without ever being granted source access, and item-level
temporary grants at corpus scale are a SharePoint anti-pattern. Working
documents are the opposite case: their users legitimately hold edit rights, so
native check-out is correct there. Keep the copies strictly ephemeral
(provision → edit → submit → delete) so the revision library never becomes a
shadow corpus.

**6. Notifications, flow-free.** The in-app task list is a query ("documents
where I am reviewer or approver and status is In review") — zero new state,
always correct. At-action sends go out as the actor via the Teams/Outlook
connector. Reminders follow the carve-out: the ritual first, deployment
add-on flows for organisations that want inbox push.

**7. Sync the org one-way, match on GUID, never delete.** LeanBoard's org tree
is the master; pushing creates and renames into the Organisation term set is
safe because terms have stable GUIDs. Deleting a term orphans every document
tagged with it, so removals become a drift report for a human. Match on term
GUID, never label — the first rename otherwise breaks the join. (Scheduled:
drift report in Phase 1, push sync in Phase 5.)

**8. Put documents on the board — the part only LeanBoard can do.** Two
cards, both honouring the resolved contract (stored-SVG paint, dynamic-import
data module, tap/jittered refresh, session cache):

- **Standard documents card** — pinned documents for this area, one tap to the
  viewer. The team's actual standards on the board they run the shift from
  (FR-DI-004).
- **Document health card** — overdue reviews, retention-due records, and
  approvals waiting on people in this area (FR-RP-002). Under the flow-free
  model this card *is* the reminder mechanism, which makes it a first-class
  deliverable, not a nice-to-have.

**9. Defer the chatbot to a link-out.** FR-AI-* is Microsoft 365 Copilot in
the requirements document (§10.13). A button that opens it is honest and costs
nothing.

**10. Requirement dispositions.** Decided here so nothing is dropped silently:

| Requirement | Disposition |
| --- | --- |
| FR-SE-005 opt-in drafts/superseded toggle | LeanBoard, Phase 2 (presentation, cheap) |
| FR-CL-001 tier badge | LeanBoard, Phase 2 |
| FR-RP-008 register export | LeanBoard, Phase 3 — search query + CSV (Excel-compatible). The PDF half of FR-RP-008 is **explicitly descoped** |
| FR-DI-001/002 acknowledgement | LeanBoard, Phase 5 — in-app ledger + query reporting |
| FR-WF-011 regulator confirmation | LeanBoard, Phase 5 — a gate in the approve command |
| Records retention prompt (Ben's draft; FR-VR-005) | LeanBoard — derived "retention due" state in the records view and health card; disposal is a user action. No unattended push (carve-out applies) |
| FR-NT push reminders/escalations | Deployment add-on flows, by conscious mapping — stated to stakeholders |

**11. The genericism principle.** LeanBoard is a generic product; the BBA
document is the informing reference deployment, and its MUSTs are inputs, not
LeanBoard MUSTs. Everything BBA-specific — regulator approval, tier badging,
column roles, palettes — arrives via configuration and column-role mapping,
never hard-code. This is what keeps the feature sellable beyond one site.

---

## Open questions and Phase 0 spikes

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | **Does the SharePoint connector expose its HTTP action from a code app?** | **Closed 2026-07-27: YES — plan A.** pac generates no wrapper, but `executeAsync` resolves operations from the client-side `apis` map; the `HttpRequest` operation, declared locally, executed against the gateway (hosted spike, blocks 3–4) |
| 2 | Is the connection delegated (per-user)? | Expected: yes, per-user consent on first run; definitive proof is the two-account test in Phase 2 (needs spike 8). See improvement 2 |
| 3 | Are the DMS custom columns crawled and mapped to managed properties, with the recrawl done? | Gates search *and the navigation tree*. Tenant-admin lead time — raise in week 1 |
| 4 | Term store readable via `/_api/v2.1/termStore` through the connector, or Graph only? | **Closed 2026-07-27: site-scoped, 200 — no Graph needed** |
| 5 | Which preview surfaces render inside the Power Apps host iframe? | **Answered 2026-07-27, probing the real file after Ben hit a blocked-file glyph on a PDF.** The raw file URL is served as an attachment, so no browser will frame it — that was the bug. `Doc.aspx?action=embedview` answers an **error page for a PDF** (the Office branch was wrong there too). **`embed.aspx?UniqueId=` returns a real page for both .pdf and .docx, with no `X-Frame-Options` and no `frame-ancestors`** — one endpoint, every type. Fallback: `getpreview.ashx?path=<absolute url>` (NOT `guidFile=`, which 400s) returns PNG bytes for both. Whether the frame paints inside the *player* is Ben's confirmation |
| 6 | Is `format=pdf` reachable for rendition generation? | **Closed 2026-07-27: yes, and site-scoped** — `/_api/v2.0/drive/items/{id}/content?format=pdf` → 302 presigned URL |
| 7 | One SharePoint site, confirmed? | **Closed: `https://pecheydistillingcom.sharepoint.com/sites/Dev`** (dev target; §10.3 confirms the single-site model for deployments) |
| 8 | Is a second licensed account available in the dev tenant? | Without it the permission-trimming proof is unrunnable as written |

**Plan B — NOT NEEDED: spike 1 passed in the hosted app (see Phase 0
status); kept for the record.** The sketch was: a solution-aware
**custom connector** wrapping
the specific REST + Graph endpoints the plan needs (search postquery, list
items, checkout/checkin, upload, `format=pdf`, term store). Costs: connector
authoring, per-organisation consent, ALM packaging; the licence floor is
unchanged (code apps already require premium). Plan C — a flow-backed query
layer — is listed only for completeness: it contradicts the flow-free stance,
so adopting it would be a deliberate, Ben-made reversal, never a silent
fallback. **Phase 0 ends with a decision gate: no Phase 1+ code until the data
path is proven on plan A or plan B.**

---

## Phases

Configuration-first order retained by Ben's decision. Each phase is
independently shippable. Phases 0–2 deliver the read experience — where nearly
all the lean value is, because the thing people cannot do today is *find the
current standard in seconds*.

### Phase 0 — Guardrails and spikes

No user-visible change.

- Spike 1 **first**; then spikes 2–8 in a dev harness page
  (`app/docs-spike.html`, following the harness convention so nothing reaches
  `dist/`).
- CI additions to `app-ci.yml`: the import-graph gate and the chunk-size trend
  report with ceilings; record the baseline.
- Create the SharePoint connection (Ben, maker portal); run
  `pac code add-data-source`.
- Write the spike answers back into this document.
- **Decision gate** on plan A vs plan B.

*Proof:* harness green per spike; the CI gate fails on a deliberate board-path
import; baseline recorded.

#### Phase 0 status — 2026-07-27

**Done:**

- **Import gate** (`app/tools/import-gate.mjs`, CI step "Import gate"): three
  rules — board path must not reach `src/docs/` (A), docs must not reach the
  board path (B), generated SharePoint services statically importable only
  from `src/docs/` (C). Static edges only; dynamic `import()` and
  `import type` are exempt by design. Proven: all three rules fired with
  readable chains on planted violations, clean run after revert
  (181 files, board closure 128).
- **Chunk report** (`app/tools/chunk-report.mjs`, CI step "Chunk sizes"):
  baseline recorded (28 chunks), generous ceilings (baseline × 1.25 + 10 KB)
  on the 8 board-path chunks — index 22, cardRegistry 426, mappers 113,
  composer 77, hub 56, settings 66, board 42, cardEditor 17 (kB). Chunk names
  folded by slicing vite's fixed 8-char hash — hashes can contain hyphens, so
  last-hyphen splitting mislabels.
- `npm run gate` / `npm run chunks` for local runs.

**Spike findings so far:**

- **Spike 1 (partial):** `pac code add-data-source -a shared_sharepointonline`
  **requires a dataset + table binding** (`-d <site> -t <list>`) — there is no
  action-only add, so SharePoint is enumerated as a tabular connector. Whether
  the generated service *also* carries the connector's actions (the HTTP
  passthrough) is still open — answerable only once a real site binds.
- **Blocked on the tenant:** `pecheydistilling.sharepoint.com` does not
  resolve (NXDOMAIN — DNS is a valid existence check, no wildcard), DKIM
  CNAMEs reveal no onmicrosoft tenant name, and plausible hostname guesses
  all miss. Either the SharePoint host has a different name or SharePoint has
  never been initialised in the tenant. A SharePoint connection *does* exist
  in the environment (`94da8178…`), and the bind attempt against the guessed
  host 502'd at the API hub — consistent with a nonexistent dataset.
- **Endpoint probes ready:** `sp-probe.mjs` (session scratchpad) covers
  spikes 3–6 — `/_api/web`, search postquery + refiners, `/_api/v2.1/termStore`,
  the v2.0 drive surface, `format=pdf`, and WOPI `frame-ancestors` headers.
  Token via the existing device-code flow
  (`node data/get-token.mjs https://<host>.sharepoint.com <file>`, Ben signs
  in).

**Endpoint probes — 2026-07-27, `/sites/Dev`, 6/6 passed** (`sp-probe.mjs`,
device-code token via the **Microsoft Office first-party client** —
SharePoint's security hardening rejects Azure CLI-client tokens outright,
`"App is not allowed to call SPO with user tokens"`):

- `/_api/web` 200 — plain REST reachable.
- **search postquery 200, refiner returned** — search + refiner mechanics
  work at the site scope (FileType refiner; DMS-column refinability still
  awaits real columns + crawl).
- **`/_api/v2.1/termStore` 200** — term store readable site-scoped, **no
  Graph needed** (spike 4 closed).
- `/_api/v2.0/drive` 200 — the modern drive surface works site-scoped.
- **`format=pdf` 302 → presigned conversion URL** — the flow-free rendition
  mechanism is real, and site-scoped (spike 6 closed, better than hoped).
- Doc.aspx returned **no `frame-ancestors` and no `X-Frame-Options`** —
  promising for the overlay viewer, but only an in-browser test with a real
  document settles spike 5.

**Design fact from the failed first probe:** SPO rejects user tokens minted
through the Azure CLI public client. There is **no raw-token plan C** —
runtime access rides the connector (plan A) or a custom connector (plan B),
full stop.

**Decision gate closed — 2026-07-27: PLAN A.** Ben ran the hosted spike
(`?screen=docs-spike`, the player drops fragments so the spike rides the
ritual-link launch-param door): all four blocks succeeded —

1. tabular `getAll` — 2 rows;
2. `executeAsync` on a declared control op (`GetEditor`) — success;
3. **`HttpRequest` GET `_api/web` — success**, site JSON returned: the
   gateway accepts an operation declared only client-side;
4. **search postquery through the same door — success**, full result JSON.

**The mechanism is now an architectural fact:** the docs data layer is a
small module under `src/docs/` wrapping
`executeAsync({connectorOperation: {tableName, operationName: "HttpRequest",
parameters}})` with the operation declared in the local `apis` map —
`spRequest(method, uri, headers?, body?)` — through which search, list REST,
term store, the v2.0 drive surface and `format=pdf` all travel (endpoint
behaviour proven by the token probes, transport proven by the spike). The
spike screen grows into that module in Phase 1 rather than being removed.

**Rolled into later phases:** spike 2's definitive proof is the two-account
permission-trimming test (Phase 2, needs the spike 8 account); spike 5's
in-browser embed check lands with the Phase 2 viewer; spike 3's DMS-column
refinability awaits real columns + crawl (Phase 1/2 lead-time). Spike 8
(second licensed account) — still with Ben.

**Phase 0 is otherwise COMPLETE.**

### Phase 1 — Configuration

Settings → **Documents** tab (super admin only).

- Site URL; discover libraries; select which are exposed.
- Per library: type (standard / record / working / revision / template),
  display name, column display names, available and default view columns,
  column roles for document management, status colour palettes (reusing the
  branding palette control), and **PDF rendition location**.
- Term-set group selection.
- Org ↔ Organisation term set **drift report** (read-only; push sync is
  Phase 5).
- Schema work, named: `ben_ltkdoclibrary` through the schema pipeline, then
  `pac code add-data-source` regeneration.
- ALM: document the SharePoint connection reference in
  `docs/deploy-to-new-org.md`.

*Proof:* config round-trips; a library added and removed leaves no orphan
rows; unit tests on the mapping model; board chunks unchanged.

#### Phase 1 status — 2026-07-27: built, hosted verification with Ben

- **Schema:** `ben_ltkdoclibrary` deployed through the pipeline (table +
  4 columns + alternate key on `ben_listid`); the reserved `__app__` row
  carries app-level docs config — no new column on sitesettings needed.
  `Ben_ltkdoclibrariesService` generated.
- **`src/docs/` grew from the spike into the real layer:** `sp.ts` (the
  plan-A transport — `spRequest` with per-call dataset override, so
  configured sites need no rebinding — plus the Phase 1 fetchers:
  libraries, fields, term groups/sets, capped term-path walk), `model.ts`
  (pure mapping model: library/app config parse+serialize sparse and
  tolerant, column roles from the DMS column table, `mergeColumns`,
  `orgDrift` with term-offset), `store.ts` (Dataverse IO; unexpose
  deletes the row — no orphans), `settingsTab.ts` (the tab UI).
- **Settings → Documents** (super admin): site URL + library discovery
  and exposure; per library display name, type, rendition folder,
  column table (display/available/default/role), status→state-palette
  colours with prefill-from-choices; term group + Organisation set
  pickers; read-only drift report with company-level offset toggle.
  Everything buffered, saved through the settings save bar.
- **Guardrails held and tightened:** rule C is now full static closure —
  proven by planting the exact forbidden import (settings → docs
  statically) and watching it fail; docs settings renamed `settingsTab.ts`
  after the chunk report exposed a basename collision folding it into the
  ceilinged settings chunk; baseline re-cut post-docs (32 chunks,
  8 ceilings). 232 tests (10 new on the model).
- **ALM:** deploy-to-new-org.md now covers the SharePoint connection
  reference (bind always; inert until configured).

**Hosted checks (Ben):** Settings → Documents renders; Load libraries
lists the Dev site's libraries; expose + configure + Save; reload
round-trips; untick + Save deletes the row; drift report runs.

### Phase 2 — The read experience

The `#/docs` area: title bar, left navigation, right list.

- Term-store-structured, refiner-counted hierarchy, defaulting to the
  viewer's own site / department / area.
- Virtualized, paged list with configurable columns; tier badge on every row.
- Free-text search with "within current filter" / "all documents", and the
  FR-SE-005 opt-in for drafts and superseded, clearly labelled.
- Viewer per improvement 4: new-tab primary, overlay enhancement where
  embedding works, thumbnails in the popup; working documents ask "work on
  this?" first.
- Kebab: properties and history (live list REST), favourite, request
  check-out (stubbed until Phase 4).

*Proof:* list interaction measured at ≥1,000 documents; the navigation tree
built from real crawled data; permission trimming demonstrated with two
accounts (spike 8 prerequisite); board chunks unchanged.

#### Phase 2 status — 2026-07-27: built, hosted verification with Ben

- **`#/docs` is live** (app-bar "Documents" link — a static anchor, zero
  reads at shell load): left nav (All documents / per-library with type
  hints / the Organisation tree from the term store), search bar with
  This-library / All-documents scope, the FR-SE-005 "Include drafts &
  superseded" toggle, and the document list.
- **Two data modes, both through pure tested parsers** (`rows.ts`, 9 tests):
  browse = list REST pages (`FieldValuesAsText` projects every column as
  text — one call, no per-type handling; server paging via nextLink),
  search = permission-trimmed `postquery` (verbose table shape; empty query
  sorts newest-first, so "All documents" is a recent-documents view).
- **Status chips** resolve value → state-palette key → colour through the
  branding palette. Default-view columns come from the Phase 1 config.
- **Viewer** (`viewer.ts`): new-tab primary (Open in SharePoint, Download,
  Copy link, Email link), embed preview as progressive enhancement with the
  fallback note visible; working-type libraries ask "Work on it / Just
  view" first. **Properties & history**: full field text via
  `GetFileById` (works for search rows with no item id) + the SharePoint
  version list.
  **Revised 2026-07-27** after Ben hit a blocked-file glyph on a PDF: the
  preview now goes through `embed.aspx?UniqueId=` for **every** file type
  (see spike 5 — the raw-file and Doc.aspx routes are both wrong), and
  because a cross-origin frame cannot be asked whether it painted, the
  note under it offers a **page image** (`getpreview.ashx?path=`) as a
  guaranteed-render path rather than a dead end.
- **Scope notes (honest):** org-tree nodes are selection-disabled until a
  deployment maps crawled → managed properties (tooltip says so); the
  drafts/superseded toggle applies in browse mode via a documented text
  heuristic and is disabled where no status column is mapped; favourite
  moved to Phase 3 where its prefs table lands; tier badge = the Library
  column/name chip (corporate-tier badging arrives with linkage work).
- **Perf proof** (`app/docs-list.html`, driving the real `listView.ts`):
  1,000 rows appended in 51 ms (worst page 6 ms), initial full layout
  164 ms one-time, mid-list scroll + forced layout 10.8 ms — 8/8 checks.
  Board chunks ±0; the area rides in lazy chunks (docsScreen 15.4 kB,
  docsStore 6.2 kB shared with the settings tab).
- **Incidentals:** SDK calls HANG without a host (they don't reject), so
  the dev server short-circuits via `detectHost` to a friendly note;
  vite now honours an assigned `PORT` (parallel sessions were fighting
  over 5180); generic chunk basenames renamed (`docsScreen`/`docsStore`).

**Hosted checks (Ben):** app bar shows Documents → All documents lists the
Dev site's files via search; the library node browses with configured
columns and status chips; search narrows live; the viewer opens (note
whether the embed renders inside the host — that answer closes spike 5),
Open in SharePoint / Download / Copy link work; properties & history shows
fields and versions; a working-type library asks before opening to edit.

### Phase 3 — Views, sharing, and the board cards

- Saved and bookmarked views; share via link through `app/src/links.ts`.
- Full properties pane with revision history; favourites view.
- The **Standard documents** and **Document health** cards, under the resolved
  card contract.
- Register export (FR-RP-008) as a search query + CSV.

*Proof:* a shared view link opens on the same filter for another user; docs
card tile paint time is indistinguishable from a comparable existing card;
board opens make no SharePoint calls until a docs card is present.

### Phase 4 — Light document control

- Check-out / check-in for working documents (native REST).
- Add a document: template picker, metadata form driven by Phase 1 column
  configuration, upload, submit.
- My tasks: the reviewer/approver queue, rendered as a query.

*Proof:* check-out visible in SharePoint; metadata written matches the form;
no LeanBoard-only lifecycle state introduced.

### Phase 5 — The approval engine, flow-free

- Commands: request-to-revise, submit-for-review, approve, obsolete /
  supersede, periodic review-without-change — each a native write sequence as
  the acting user, with the regulator gate on approve.
- Approve-time rendition: Graph `format=pdf` + client-side watermark stamp
  (pdf-lib, lazy-chunked) + upload to the configured rendition location.
- At-action notifications via the Teams/Outlook connector (new connection
  reference — same ALM note as Phase 1).
- Acknowledgement ledger (`ben_ltkdocack`) and its report query.
- Org → term set **push sync** (GUID-matched, create/rename only, never
  delete; removals stay a drift report).
- History projection (`ben_ltkdochistory`), schema-commented as a projection,
  reconciled against SharePoint version history for a sample.

*Proof:* every command's column writes verified in SharePoint; a rendition
generated and watermarked end-to-end; ack report matches ledger rows; sync
run twice is idempotent.

### Phase 6 — Extras

Chatbot link-out, QR codes, corpus-quality reports — plus a short
**deployment-flow cookbook**: the optional add-on flows an organisation can
bolt on (reminder push, content-approval hardening), reading the same columns,
with LeanBoard none the wiser.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| The connector HTTP action is absent from code apps | Spike 1 runs before any feature code; plan B (custom connector) pre-designed; Phase 0 decision gate |
| In-host embedding blocked by frame-ancestors | New-tab designed as the primary path, not a fallback; overlay is progressive enhancement |
| Managed-property mapping / recrawl lead time | Raised with the tenant admin in week 1; the tree spike runs on real crawled data |
| The unattended-push gap | Accepted deliberately: ritual-as-scheduler + the health card, with deployment add-on flows as the escape hatch — and the FR-NT mapping stated to stakeholders up front |
| Out-of-band status edits by document editors | Auditable via version history (actor + timestamp); readers walled by permissions; content approval listed as optional deployment hardening |
| Shift-start fan-out throttling (429s) | Stored-SVG-first tiles, jittered refresh, per-user session cache |
| Search index latency shows stale status | Single-document reads go to the list API; the properties pane is always live |
| The documents chunk grows until it slows the app open | The area is inert until routed to; the import gate protects the board path specifically |
| Scope creep from the requirements document | The disposition table in improvement 10 and the genericism principle in improvement 11 |
