# Phase 5 — The approval engine, flow-free

Everything here rides the measured ground of
[sharepoint-writes.md](sharepoint-writes.md): status transitions are
term writes under a check-out bracket (connector term object), comments
ride check-ins, and nothing needs a byte to cross the wire. My tasks
(4D) is the delivery channel — a command's effect IS its notification.

## Decisions (Ben, 2026-08-04)

| Question | Decision |
| --- | --- |
| Lifecycle vocabulary | **Explicit mapping in settings**: each term in the status set is assigned a stage — draft / **in review** / **awaiting approval** / approved / superseded / obsolete. Review and approval are distinct circulations (Ben, 2026-08-04): review is content work by reviewers, approval is sign-off by the named approver(s) or, when none are named, the owner. Name-based suggestions prefill the mapping; the stored mapping is the law. Keyed by term id, so a rename cannot detach it. |
| Who may approve | **The document's approver column, admins as fallback** — plus one Entra group ("document controllers") that governs who can BE an owner/approver: the owner/approver pickers select from its members, and the group carries the SharePoint permissions. Configured like the Users access-control group. |
| Renditions | **Live PDF only.** The viewer's on-demand conversion is the read path for approved documents. Stored watermarked renditions are impossible client-side (byte transport + CSP, both measured) and become the documented optional deployment flow in the Phase 6 cookbook. |
| Notification | **My tasks only.** Submit-for-review puts the document in each approver's queue ("Awaiting your approval"); no Teams/Outlook connector, no new connection reference. Push can be its own sub-phase later. |
| Review-due standards | Inherited from Phase 4: view-only until this phase's **Mark reviewed** command lands (5C). |

## The settled revision workflow (Ben, 2026-08-04, after 5B/5C review)

Grounded in the visibility constraint: **a checked-out document's
changes — content and properties — are visible only to the holder**, so
circulation requires a check-in, and solo drafting benefits from the
opposite.

1. **Start revision** (approved → draft): checks OUT to the reviser and
   STAYS checked out — the draft status and every edit live inside the
   check-out, everyone else keeps seeing the approved version, and
   **Discard check-out reverts the entire revision**. "Edit source ↗"
   in the overlay opens the Office editor (the source, not the PDF).
2. **Submit for review** — MANDATORY before approval when the document
   names reviewers. The dialog can add reviewers via people search
   (written to the reviewers column first). Checks in as a MINOR draft:
   the review circle now sees content + status; reviewers edit via
   their own check-out/check-in.
3. **Submit for approval** — lands at the approvers' stage when any are
   named, else directly at the owner's stage.
4. **Approval is two steps**: named approvers ENDORSE (minor check-in,
   status → "Awaiting Owner Approval" — a real term the site adds, so
   the step is queryable); then the OWNER's Approve is the one MAJOR
   check-in → approved. Admins stand in at either step.
5. **Cancel revision** (owner/admin, any mid-cycle stage): restores the
   last approved MAJOR via version restore — content and status
   together, abandoned drafts left in history. Pre-circulation, plain
   Discard check-out already reverts everything.
6. Queues follow the stages exactly: reviewers see in-review documents,
   approvers see the endorsement stage, the owner sees the final stage.

Also settled: **standards can be added from a template** like working
documents (the add form's targets include standards libraries).

## Sub-phases

### 5A — Lifecycle model + settings
- `SiteDictionary.lifecycle`: term id → stage, sparse-serialized like
  everything else on the `__app__` row.
- Settings → Documents → **Lifecycle**: the status set's terms each get
  a stage select, prefilled from name suggestions when empty; the
  **document controllers group** picker (reuse the access-group
  plumbing) stores id + name on the app config.
- Health: status terms with no stage; a lifecycle with no approved
  stage; a missing controllers group when commands are in use.
*Proof:* mapping round-trips; suggestions match the approval filter's
existing vocabulary; unit tests on the model.

### 5B — The commands
- Two circulations, each with a NAMED column (Ben, 2026-08-04:
  reviewers are the `reviewers`-role column, already in the
  dictionary — `DMSReviewers` auto-maps): **Submit for review** (draft
  → in review, to the document's named reviewers for content work),
  **Submit for approval** (in review → awaiting approval — draft may
  skip straight here when no review round is wanted), **Approve**
  (awaiting approval → approved, MAJOR check-in), **Request revision**
  (in review or awaiting approval → draft, with the reason in the
  comment) — each: check-out → connector term write of the target
  stage's term → check-in with the command's comment (approve's names
  the approver). Standards libraries only.
- Gates (Ben, 2026-08-04, second reading confirmed): **the owner always
  retains sign-off over their own document; named approver(s) EXTEND
  that authority rather than replace it**; app admins are the
  deadlock-breaker. Owner/approver pickers in the add form source from
  the controllers group; the reviewers picker stays general people
  search (the group governs owners/approvers, not reviewers).
- Overlay + kebab actions driven by the document's current stage.
*Proof:* each command's column writes verified in SharePoint version
history with the comment; a non-approver sees no Approve.

### 5C — Mark reviewed + queue groups
- **Mark reviewed** on review-due standards (the 4D queue's waiting
  consumer): check-out → next-review-date write (locale format) →
  check-in "Periodic review — no changes".
- My tasks gains BOTH circulation queues, symmetric and server-side:
  **Awaiting your review** (reviewers column is me + status in the
  in-review stage) and **Awaiting your approval** (approvers column is
  me — or owner is me when no approvers are named + status in the
  awaiting-approval stage), all CAML `<UserID/>`.
*Proof:* marking reviewed clears the task; submitting for review puts
the document in each named reviewer's queue and nowhere else;
submitting for approval moves it to the approvers' queues.

### 5D — Obsolete / supersede (BUILT 2026-08-04)
- **Mark superseded** and **Mark obsolete** on approved standards —
  owner or admin only (approvers endorse content; they don't decide a
  document's end of life). Both demand a reason: the superseded reason
  NAMES the successor, which is v1's whole audit trail (no
  linked-documents column yet). Minor check-ins — the approved major is
  never disturbed.
- **Reinstate** from either retired stage (owner/admin, reason
  required) — a status write back to approved, no re-approval, because
  the approved major sat untouched underneath.
- Retired stages generate no tasks; the review-due queue is scoped to
  the APPROVED stage where the site maps one (a retired or mid-revision
  standard has no periodic review to chase).
- Health: unmapped Superseded/Obsolete report as **info** (visible, not
  nagging) — the approval road's five stages stay warnings.
- Same session: **sole-owner-approver fix** — `hasApprovers` now means
  an approver OUTSIDE the owner list. An owner named as their own
  (sole) approver goes straight to Awaiting owner approval; the
  endorse round only exists when someone else must sign first (Ben,
  2026-08-04).

### 5G — The access model (settled with Ben, 2026-08-05)

Four groups, permissions set ONCE per group in the tenant (cookbook),
never per document — no item-level permission sprawl:

| Group | SharePoint level | Role |
|---|---|---|
| **Document controllers** | Full Control | Full admin. Merges with the Dataverse super/site-admin role (the fallback that survives a mis-scoped group). |
| **Document owners/approvers** | Edit on standards | The ELIGIBILITY POOL: pickers for owner/approver/reviewer columns restrict to members. Being in the pool does NOT grant revise rights — those come from being NAMED on the document. |
| **Temporary document editors** | Contribute on standards | People are TEMPORARILY added when an edit-access request is approved, removed when the revision ends. SharePoint enforcement of the grant. |
| **General users** | Read on standards, templates AND records; write on working | The main app access group. Working libraries stay writable — Phase 4's flows depend on it. |

**The locked principle:** the grant COLUMN on the document (new
dictionary role, "Revision editors", person multi) is the
AUTHORIZATION; editors-group membership is only the physical ability.
App gates key off the column, never off membership — so a lingering
membership is detectable drift, not phantom authority.

**Group mechanics (settled with Ben, 2026-08-05):** all three are plain
SECURITY groups — the access group's own machinery (store/accessGroup:
Graph passthrough via the Office 365 Groups connector, group OWNERS
manage membership under delegated permissions, already-there/not-there
tolerance, last-owner guard) is reused verbatim, and it is measured: it
runs the app's access group today. Names as Ben will create them:
**"Document Controllers"**, **"Document Owners & Approvers"**,
**"Temporary Document Editors"**.

**The ownership hierarchy** (who may trigger adds/removals, Ben
2026-08-05) — seeded by the app whenever it manages membership, exactly
like the roster's admin→owner sync today:
- added to Document Controllers → also made an Entra OWNER of
  "Document Owners & Approvers" AND "Temporary Document Editors";
- added to Document Owners & Approvers → also made an Entra OWNER of
  "Temporary Document Editors" (so any document owner can execute a
  grant single-handed);
- removals mirror it (ownership first, last-owner guard throughout).
Bootstrap: whoever creates the groups (Ben) starts as owner of all
three — the acting admin must already be an owner of a group to seed
owners into it.

**Request edit access** (label chosen to not collide with "Request
revision"): a general user on an approved standard requests with a
required reason → the request lives in an app-side ledger on the shared
`__app__` row (a read-only requester can write NOTHING in SharePoint,
so the ledger is mandatory — its writability by ordinary users needs a
probe first) → the request surfaces in the OWNER's My tasks ("Access
requests") → the owner approves in ONE step: grant column written
(check-out → VULI claims → minor check-in "Revision access granted to
X — reason") AND requester added to the editors group. The ownership
hierarchy above makes this possible single-handed (group owners must be
individuals — a group cannot own a group), with a drift health check
behind it. Decline records and removes the request.

**The grantee gets**, on THAT document only: Start revision, check-out,
Edit source, submit for review/approval. Never Approve, never
retirement.

**Removal rides every exit** — the owner's Approve (after the major),
Cancel revision, decline/withdraw, and a manual revoke in the overlay.
The Approve write also CLEARS the grant column (access is for one
revision cycle). Health check: editors-group members with no live
grant anywhere ("orphaned editors").

**Known edges, stated plainly:**
- Group membership → SharePoint authorization can take MINUTES to
  propagate: the approval confirmation and the grantee's first refusal
  both say so.
- During a grant the editor physically holds Contribute on the WHOLE
  standards library; only the app narrows it to one document.
  Time-boxed, auditable, strictly better than everyone-writable.
- Adding a controlled standard from a template becomes physically
  pool-members-only: the add-form hides the standards target for
  everyone else rather than letting SharePoint refuse late.

Build order:
- **5G0 (spike):** the Graph membership half is already measured — it
  is the access group's own machinery. Remaining probes: can an
  ordinary user update the shared `__app__` row's ledger (else: per-user
  request rows in the prefs table, swept by the owner's queue)? And one
  run confirming a NON-admin pool member, as editors-group owner, can
  add/remove a member there.
- **5G1:** settings maps the three groups; membership plumbing
  (transitive, cached per session, admin fails CLOSED to the Dataverse
  role, pool fails to an explanatory hint); pickers restrict to the
  pool; add-form standards target gated.
- **5G2:** "Revision editors" dictionary role; Request edit access +
  ledger + owner's Access requests queue + decline.
- **5G3:** approve = column write + group add (+ propagation notice);
  removal on Approve/Cancel/decline + manual revoke; grant-column gates
  (grantee = revise/check-out/submit on that document).
- **5G4:** health checks (owner-seeding drift, orphaned editors) +
  the cookbook permission table.

### 5E — Acknowledgement ledger (SCHEMA release) — PARKED (Ben, 2026-08-05)
- `ben_ltkdocack` through the schema pipeline — the first schema change
  since v0.25.0. Append-only rows (person, document, version, when).
- "Acknowledge" for approved documents whose ack-required column says
  so; per-document report against the roster.

### 5F — Org → term set push sync
- The drift report's write half: GUID-matched create/rename only, never
  delete; idempotent by construction.

**Deferred:** `ben_ltkdochistory` projection (version history + check-in
comments already carry the trail); Teams/Outlook push notifications.
