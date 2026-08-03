# Phase 4 — Light document control

The first phase that **writes**. Everything shipped through v0.29.0 reads;
from here LeanBoard changes documents, so the design question stops being
"can we render this" and starts being "what happens when this fails
half-way, and who is allowed to do it at all".

Scope comes from the Standard Documents plan, Phase 4: check-out /
check-in, add a document, and a My tasks queue. Ben settled the four
open choices on 2026-08-03; they are recorded under each heading.

---

## What the code already gives us (checked, not assumed)

- **`spRequest` already writes.** It takes `POST` and `PATCH` with a
  string body and returns `{ok, status, data}` without throwing. The
  connector's HttpRequest operation carries the form digest itself, the
  way it does in Power Automate — so no digest plumbing.
- **Copying a template moves no bytes.**
  `/_api/web/GetFileByServerRelativeUrl('…')/copyto(strNewUrl='…')` runs
  server-side. A template-driven "add" therefore avoids the transport's
  one unproven path entirely.
- **`LIBRARY_TYPES` already separates** standard / record / working /
  revision / template, so the library's own type gates which commands
  exist. Nothing new to configure.
- **The site dictionary already describes the metadata form**: label,
  role, term set, date-ness, availability, per column, per site (C0–C5).
  `SpField` adds live type and choices.
- **No write has ever been made from this app.** Every failure mode
  below is new, and none of it is covered by the 333 existing tests.

## The one unproven path

Binary content through the connector's JSON transport. Everything else
in Phase 4 is text — CAML, OData, form values. A file's bytes are not,
and `executeAsync` serialises its body as a string. Two consequences:

- **Template copy is certain**; upload-from-device is not.
- So upload is **spiked before it is designed**, not promised now
  (Ben's decision). If the spike fails, Phase 4 still ships add-a-
  document via templates, and upload becomes a documented gap with a
  known cause rather than a mystery.

## Decisions (Ben, 2026-08-03)

| Question | Decision |
| --- | --- |
| Which libraries can be written to | **Working and revision only.** Standards and records stay read-only until Phase 5 gives them lifecycle commands — nothing gets edited outside a governed path in the meantime. |
| What "Add a document" starts from | **Template copy, plus upload only if the spike passes.** |
| What My tasks lists | **Checked out by me, and my documents due for review** — both computable today from `CheckoutUser` and the owner / next review date roles. Phase 5's approval items append to this queue rather than replacing it. |
| What check-in asks | **A comment (required) and a minor/major choice.** The comment is what an auditor reads; a check-in with nothing to say is a check-in that explains nothing, so the button stays disabled until there is text. |

## Sub-phases

Each is a commit, gated on Ben the way C0–C5 were.

### 4A — The write transport, and a probe that proves it

Write helpers in `sp.ts` (check-out, check-in, undo, copy, add file,
`ValidateUpdateListItem`, effective permissions) plus **Settings →
Documents → Test write access**: pick an exposed working library, and it
runs the whole write surface against a probe file it creates and then
recycles, printing a per-step verdict the way "Test search filtering"
already does.

Steps probed, in order, each reported pass/fail with the server's own
message: effective permissions → create a text file → set metadata via
`ValidateUpdateListItem` (including a taxonomy column, the awkward one)
→ check out → check in (comment, minor) → undo a second check-out →
`copyto` → **binary upload of a known byte sequence, verified by reading
`/Length` back** → recycle both files.

*Proof:* Ben runs it on the Dev site and reads the verdicts. The binary
step is the one that decides whether 4C includes upload. The panel earns
its keep afterwards as a deployment check — a tenant where writes are
blocked says so in one click.

### 4B — Check-out, check-in, discard

- Commands in the viewer's action row and the register kebab, present
  only for working/revision libraries and only when the user can write.
- The register shows checked-out state — by whom, and "by you" styled
  differently, because the only actionable case is your own.
- Check-in dialog: required comment, minor/major, both sent to
  `CheckIn(comment, checkintype)`.
- Discard confirms, because it destroys work SharePoint cannot recover.
- Every command refreshes the row from list REST afterwards, never from
  the index — single-document truth, per the plan's data paths.

*Proof:* check-out visible in SharePoint itself; version history shows
the comment; a second user's check-out blocks yours with SharePoint's
own message, not ours.

### 4C — Add a document

- Template picker: documents from libraries typed `template`, copied
  with `copyto` into the target folder.
- Metadata form driven by the site dictionary — label from the
  dictionary, editor from the live type (text, choice, date, person,
  term picker), required columns enforced before submit.
- Written with `ValidateUpdateListItem` so taxonomy, date and person all
  go through SharePoint's own coercion instead of ours.
- Upload from device **only if 4A's binary step passed**.

*Proof:* the file appears in SharePoint with the metadata the form
showed; a required column left empty cannot be submitted; the created
document opens in the viewer without a reload.

### 4D — My tasks

A query-backed queue: documents checked out by me (any exposed library)
and documents whose owner is me with a review date past or near. No new
state, no Dataverse row — it is a rendering of what the columns already
say, which is what makes it correct without a sweep.

*Proof:* checking a document out makes it appear; checking it in makes
it leave; the review-due list matches a manual filter of the register.

## What Phase 4 deliberately does not do

- **No lifecycle state.** No status transitions, no approvals, no
  renditions — those are Phase 5, and inventing a half-version here
  would be the thing Phase 5 then has to undo.
- **No LeanBoard-only state about a document.** Everything above lives
  in SharePoint columns and SharePoint's own check-out flags.
- **No prevention of direct SharePoint edits.** Unchanged from the
  plan's stated integrity caveat: trusted-but-audited editors.
