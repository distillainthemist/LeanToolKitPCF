# Deployment cookbook — optional add-on flows

LeanBoard's document engine runs **flow-free**: every lifecycle act is a
native write by the acting user, due-ness is derived from columns at read
time, and notifications go out at-action from the person who acted. The
one thing a client app can never do is run when nobody is present — and
the product's answer to that is the daily ritual, not a scheduler
([leanboard-standard-documents-plan.md](leanboard-standard-documents-plan.md),
"Eliminating Power Automate").

This page is the escape hatch that analysis promised: the add-ons an
organisation can bolt on **without any app change**. Each one is a Power
Automate flow (or equivalent) that reads the same SharePoint columns the
app reads. LeanBoard neither invokes nor knows about them — zero
dependency, and nothing can diverge, because **the columns are the only
contract**.

Companion install runbook: [deploy-to-new-org.md](deploy-to-new-org.md).

> **Trimmed by decision (Ben, 2026-08-08).** Two recipes were removed
> outright rather than left as options. *Review-due reminder push*:
> reviews are driven by rituals and reporting (My tasks, Document
> Control Health, the board cards) — no inbox push, period, so the
> recipe would only invite a second reminder mechanism. *Stored
> watermarked renditions*: the status travels **in the document
> template itself** — a field in the template bound to the status
> column, alongside the template's own "uncontrolled if printed"
> wording — so the live document self-identifies and no stored
> artefact is needed.

## The contract every add-on honours

**What to read.** Settings → Documents → Document columns maps each
library's SharePoint columns to roles (Owner, Approvers, Approval
status, Effective date, Next review date, Review cadence, Retain until,
Acknowledgement required, …). A flow reads the **internal column names**
this deployment mapped — note them from that screen when authoring; the
mapping is the deployment's, not a fixed schema. Approval status is
**managed metadata**: Settings → Documents → Lifecycle assigns each term
a stage (draft / in review / awaiting approval / awaiting owner approval
/ approved / superseded / obsolete). A flow that means "approved
documents" filters on the labels (or term GUIDs) the site mapped to the
**approved** stage — never on hard-coded strings like "Current".

**The rules** (what keeps an add-on an add-on):

1. **Never write the status column.** Lifecycle transitions belong to
   the app's commands — each is a check-out bracket with a versioned,
   commented check-in. A flow-written status skips the bracket, the
   comment trail and the gates; the drift shows up in Document Control
   Health as an unrecognised state, which is the system working.
2. **Never hold or break a check-out.** A checked-out document's changes
   are private to the holder by design; the revision workflow depends
   on it.
3. **Never touch the upload staging library.** Files there are
   mid-handoff; the app recycles them itself.
4. **Run as an honest identity.** A message "from Karen" that Karen
   never wrote is exactly what the flow-free analysis rejected. Give
   scheduled flows a named service account ("DMS Reminders") so senders
   and version history tell the truth.
5. **Notify, don't duplicate.** At-action notifications, My tasks, the
   health reports and access grants are the app's; a flow re-sending
   them makes two senders and two truths. Add-ons cover only what needs
   to fire with nobody present.

---

## Recipe 1 — content-approval hardening

**The gap it closes**, stated plainly in the plan: with no server-side
engine, readers cannot write at all — the permission wall holds for the
overwhelming majority — but a document's own **editors** could set
Status = approved directly in SharePoint, bypassing the app's command.
That act is auditable (version history records actor and timestamp),
not preventable. Two hardening levels:

- **First, exhaust the access model** (usually enough): under the 5G
  model, standing write access on standards is only Document
  Controllers plus whoever currently holds a revision grant — the
  "editors could bypass" population is already small, temporary and
  audited. Verify the deployment actually matches the permission table
  in [deploy-to-new-org.md](deploy-to-new-org.md); Settings → Documents
  → Health reports seat/grant drift.
- **Then, SharePoint content approval** on the standards library
  (Versioning settings → Require content approval; draft visibility =
  approvers and authors). Readers then see only the last **approved**
  major, walled by the platform rather than by convention.
  **MEASURED AND ADOPTED at Pechey (CA0 trial, 2026-08-08/09):** the
  app's full write bracket behaved under moderation, drafts were
  correctly invisible to readers mid-cycle, and since CA1 the app
  itself **publishes at every reader-facing transition** (approve,
  supersede, obsolete, reinstate — `_ModerationStatus = 0`, the same
  call SharePoint's own Approve makes). Two deployment requirements
  make it one-step: grant the **Document Owners & Approvers** group a
  custom permission level adding *Approve Items* (plain Edit cannot
  publish — without the grant the app warns honestly and a controller
  publishes in SharePoint). Property quick-edits on reader-facing
  documents publish as part of the save (2026-08-09); a
  mid-circulation draft's edit pends — its moderation wall holds —
  and a plain Check in… of content deliberately stays unpublished:
  content changes on a moderated standards library belong to the
  revision workflow, which publishes at approve.
- **What not to do:** per-document unique permissions. That is the
  item-level sprawl the group model exists to avoid, and it breaks the
  set-once permission table.

## Recipe 2 — native upload picker (relay)

File bytes cannot cross the *connector* from the code app (all four
carriages re-encode — re-measured per SDK bump by the Test write
access probe), but they DO cross the SDK's own Dataverse file door:
**measured green 2026-08-08** — 64KB and 4MB round-tripped
byte-identical through `ben_ltkupload.ben_file` (upload ≈0.4 MB/s,
download ≈4 MB/s). So the native picker rides a relay: the app writes
the picked file into the **LeanBoard Upload** table; this flow carries
it to the SharePoint **staging library**, where the app's shipped
handoff (copyto, metadata form, check-in) takes over. The probe stays
in Settings → Documents → Test write access → *Test Dataverse upload*.

The flow (one per environment, a named service identity with write on
the staging library ONLY):

1. **Trigger:** Dataverse — *When a row is added* to LeanBoard Uploads
   (`ben_ltkupload`).
2. **Get the bytes:** Dataverse — *Download a file or an image*, table
   LeanBoard Uploads, row identifier from the trigger, column `ben_file`.
3. **Write to staging:** SharePoint — *Create file* in the staging
   library (the same one named in Settings → Documents), file name =
   the row's **Name** (the app stamps it unique), content = step 2's
   body.
4. **Clear the row:** Dataverse — *Delete a row* (the row is transient;
   the staging file is now the artefact). On any failure branch,
   instead set `ben_status` = `failed` and leave the row — the app's
   dialog times out visibly, and stalled rows are findable.

What the app promises the flow: the row's Name is the exact staging
filename it will watch for; `ben_targetlibrary` says where the user was
headed (informational — the app's own handoff performs the move to the
target). What the flow must never do: write anywhere but staging, or
touch rows whose status it did not set.

## Prerequisite — Power BI embeds on boards (browser policy)

Diagnosed 2026-08-17 (Ben, prod). Embed cards load Power BI's **secure
embed** URL (`app.powerbi.com/reportEmbed…&autoAuth=true`) in a persistent
iframe. Two browser-side conditions must hold, and neither is in the
app's gift:

1. **Third-party cookies / storage access for `powerbi.com`.** The frame
   is third-party under the Power Apps player; Power BI's autoAuth needs
   its sign-in cookie there. Blocked → "Sign in to view this report",
   and the Sign in popup loops. The app delegates `storage-access` on
   its frame (v0.45.2) so the browser can prompt where it is allowed to.
2. **Chromium Local Network Access × Windows work-account SSO
   (Chrome/Edge 142+, RESOLVED 2026-08-18).** On Windows, Edge ("Allow
   single sign-on for work or school sites", policy
   `AADWebSiteSSOUsingThisProfileEnabled`) and Chrome (`CloudAPAuthEnabled`)
   hand sign-ins to `login.microsoftonline.com` to the Windows account
   broker instead of the wire. Chromium's Local Network Access treats
   that hand-off as a local-endpoint request; a NESTED cross-origin frame
   only has the permission when every parent delegates it, and the Power
   Apps PLAYER's frame does not (Microsoft's; Teams has the same open
   issue, microsoft-teams-library-js #2919). So Power BI's in-frame MSAL
   token POST is blocked before it is sent: *"blocked by CORS policy:
   Permission was denied for this request to access the 'local' address
   space"*, DevTools shows "Provisional headers", the report never
   renders. Proof: Edge with the SSO setting OFF works; Chrome fails with the
   setting it has no toggle for — the `CloudAPAuthEnabled` route is
   INFERRED from the pattern, NOT verified (could not be tested,
   2026-08-18): confirm on one machine (registry
   `HKLM\SOFTWARE\Policies\Google\Chrome\CloudAPAuthEnabled=0`, restart,
   `chrome://policy`, load the board) before rolling it to a device group; `chrome://flags/#local-network-access-check` = Disabled
   works. NOT DNS/VPN/proxy. Our frame delegates `storage-access` and
   `local-network-access` (v0.45.2) — necessary, not sufficient.

**Levers:** (a) report to Microsoft/Chromium — the real fix (player
delegation, or the broker path not being LNA-gated); (b) meeting-room /
shared devices: policy `AADWebSiteSSOUsingThisProfileEnabled=Disabled`
(Edge) and `CloudAPAuthEnabled=0` (Chrome) for that device group — SSO
matters least there; (c) laptops: the same policy costs M365 seamless
SSO — instead `LocalNetworkAccessRestrictionsEnabled=false` (org-wide
off-switch) or an in-app "Present in window" mode (top-level window, no
frame chain — not built). `LocalNetworkAccessAllowedForUrls` does NOT
reach nested frames. Do NOT roll out the flag per user. Embed tokens
(custom API relay) would sidestep it but is ON HOLD (Ben, 2026-08-18).

The card's "Open in a tab" link always works (a tab is first-party) and
is the in-meeting fallback while policy lands.
