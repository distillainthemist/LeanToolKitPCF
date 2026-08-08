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
  major, walled by the platform rather than by convention. **The cost,
  stated up front:** publishing now requires the *Approve Items*
  permission. Full Control (Document Controllers) has it; Edit and
  Contribute do not — so an owner's final major check-in sits *Pending*
  until someone with Approve Items approves it in SharePoint, an extra
  step outside the app on every approval, unless the deployment grants
  approvers a custom permission level that adds Approve Items.
  **Unmeasured against the app's write bracket** — trial on a test
  library first: run a full revision cycle and confirm the app's
  check-out → property writes → major check-in sequence behaves, and
  that the overlay's live reads show what you expect while a version is
  pending.
- **What not to do:** per-document unique permissions. That is the
  item-level sprawl the group model exists to avoid, and it breaks the
  set-once permission table.

## Recipe 2 — native upload picker (relay)

Measured repeatedly (latest 2026-08-06): file bytes cannot cross the
connector from the code app — all four carriages re-encode — so in-app
upload is the **staging handoff** (the user uploads in SharePoint's own
UI; the app takes over once bytes exist server-side), and the Test
write access probe re-checks the carriages on every SDK bump. A
deployment that insists on a native in-app picker has one road: a
Dataverse **file column** the app could upload into, plus a **relay
flow** that copies the file on to SharePoint. Originally declined for
Pechey (2026-08-06); **taken up 2026-08-08** — the design and probe
plan live in
[leanboard-doc-cards-plan.md](leanboard-doc-cards-plan.md) (part C).
