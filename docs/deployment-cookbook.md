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

## Recipe 1 — review-due reminder push

**What the app already does:** overdue and due-soon are computed from
columns at read time — My tasks, the Documents tab count, the health
reports and the register's review prompts all surface them, and the
daily meeting is the reminder. Nothing is stored, so nothing goes
stale. **What it cannot do:** push to an inbox on a clock. This flow
adds that for organisations that want it.

- **Trigger:** Recurrence — e.g. weekly, Monday morning. Resist daily;
  the app already nags in-app, and an inbox that cries wolf gets
  filtered.
- **Query:** for each standards library, Get items filtered on the
  next-review-date column `le` today-plus-horizon (30 days matches the
  app's due-soon window). Taxonomy columns are awkward in OData — filter
  on the date, then test the status field's text (it renders as
  `Label|GUID`) against the approved-stage labels in a condition.
  Skip anything not approved: a draft or a superseded document owes no
  periodic review (the app applies the same split).
- **Group by owner:** one digest per owner (the person column carries
  the email), not one message per document — mirror the health report's
  by-owner tally, not a mail-merge.
- **Send** via the Teams or Outlook connector, each document carrying a
  **work link** — the same link the app's own notifications carry, which
  opens LeanBoard on that document with the details pane expanded and
  the commands live:

  ```
  https://apps.powerapps.com/play/e/<environmentId>/app/<appId>?tenantId=<tenantId>&ltkdoc=<listId>:<itemId>&ltkmode=work#/
  ```

  `listId` is the library's GUID, `itemId` the item's numeric ID — both
  available in the flow. Copy the fixed part of the shape from any Share
  dialog or app notification in the target environment.
- **Variants on the same skeleton:** retention-due (filter the
  retain-until column; notify controllers, not owners), and overdue
  escalation (a second recurrence that notifies a manager once a review
  is N days past — keep the threshold generous).

## Recipe 2 — content-approval hardening

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

## Recipe 3 — stored watermarked renditions

The app's read path for approved documents is the **live PDF** — the
viewer converts on demand, so readers always see the current approved
content. Storing watermarked renditions from the client was measured
impossible (file bytes cannot cross the connector; the player CSP blocks
direct fetch), so a stored artefact — for regulator submissions,
external distribution, or a strict FR-DI-005/007 reading — is a
deployment flow:

- **Trigger:** *When an item is modified* on the standards library, with
  a condition that the status field's label is an approved-stage term
  (or a scheduled sweep comparing modified-since — cheaper under heavy
  editing, since property edits also fire the modified trigger).
- **Convert:** SharePoint's site-scoped conversion endpoint —
  `/_api/v2.0/drive/items/{id}/content?format=pdf` answers 302 to a
  presigned URL (measured 2026-07-27) — or the OneDrive connector's
  *Convert file* action against a temporary copy.
- **Stamp:** the watermark ("Uncontrolled if printed", document ID,
  version, effective date) needs a PDF-capable step — a small Azure
  Function with a PDF library, or an org-approved document service.
  This is the one piece with no out-of-the-box connector action.
- **Write** the result to the library's **PDF rendition folder**
  (Settings → Documents → the library's configuration) — the config
  slot reserved for exactly this. The app does not read that folder
  today; its viewer stays live. Name renditions
  `<DocumentID> v<major>.pdf` so a superseding approval overwrites its
  predecessor deterministically.

## Recipe 4 — native upload picker (relay)

Measured repeatedly (latest 2026-08-06): file bytes cannot cross the
connector from the code app — all four carriages re-encode — so in-app
upload is the **staging handoff** (the user uploads in SharePoint's own
UI; the app takes over once bytes exist server-side), and the Test
write access probe re-checks the carriages on every SDK bump. A
deployment that insists on a native in-app picker has one road: a
Dataverse **file column** the app could upload into, plus a **relay
flow** that copies the file on to SharePoint. Declined for Pechey
(2026-08-06) — the handoff is simpler and has no second engine — but
this is the documented road if a deployment's requirements differ.
