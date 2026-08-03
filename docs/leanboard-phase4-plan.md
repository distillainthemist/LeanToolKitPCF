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

## Upload from device — closed, 2026-08-03

Four carriages measured on the Dev site, all re-encoding the same 16
bytes:

| Carriage | Result |
| --- | --- |
| REST `Files/add`, string body | 21 bytes for 16 — UTF-8 expansion, exactly the four values above 0x7F doubling |
| REST `Files/add`, `$content` envelope | 400, "Body parameters missing" — the SDK does not forward a nested object as a body |
| Connector **Create file**, base64 | 26 bytes for 16 |
| Connector **Create file**, raw | 29 bytes for 16 |

The cause is structural, not a tenant setting: every door this SDK
offers serialises the body as a JSON **string**, and a JSON string is
UTF-16 text. Text survives; bytes do not.

So **4C ships template copy only**, and upload-from-device is a
documented gap with a known cause rather than an open question. If it is
ever wanted, the route is a server-side one — a flow or an Azure
function holding the bytes — not a different call from here.

## Taxonomy writes — analysis after three runs (2026-08-03)

The question: can LeanBoard set a managed metadata column? Ben ruled out
Power Automate and converting status to Choice — the answer has to be a
native write from the app.

**What three probe runs establish.** The transport is innocent: Title
writes land through the identical call. The tagging-UI validator
rejects three magic-string forms outright (`-1;#Label|id`, id alone,
label alone). The two documented-correct routes — `Label|id` as a form
value, and a typed TaxonomyFieldValue MERGE — both die as 502
BadGateway, meaning they validated and failed later, either server-side
or at the gateway. And two findings were self-inflicted probe defects:
the guessed note-field name (`<internal>_0`) was an ArgumentException
because that column does not exist, and every error was clipped at 200
characters — exactly before `innerError`, where the connector nests
SharePoint's actual sentence.

**Was the connector used correctly?** Mostly. `HttpRequest` +
`ValidateUpdateListItem` is the canonical flow technique and should
work. But three real gaps: (1) the connector's own typed item surface —
`PatchItem`, what the flow "Update item" action calls, where a term is
an object `{Value, TermGuid, WssId}` and Microsoft maintains the
serialisation — was never used; (2) the typed MERGE rode on an
`X-HTTP-Method` override header the gateway may strip, turning it into
a malformed CREATE (a true PATCH verb avoids the header entirely);
(3) the hidden note field's real name lives in the taxonomy column's
SchemaXml (`TextField="{guid}"`) and must be resolved, not guessed.

**Probe v4** therefore tries, in order of likelihood: connector
PatchItem (two payload shapes) → resolved note field with
`-1;#Label|guid` → `Label|id` re-measured with full errors → typed
value with a true PATCH verb → the old POST+MERGE for comparison →
Graph-style fields PATCH on the v2.0 drive surface. Every attempt reads
the column back afterwards, so a write that lands behind a bad reply
still counts, and errors surface up to 500 characters through
spErrorText.

**Run four's breakthrough (2026-08-03).** The connector's typed
PatchItem did not reject the term object — SharePoint answered *"The
file is not checked out. You must first check out this document before
making changes."* The library requires check-out for edits; the probe
wrote metadata before its check-out step. This explains the 502s too:
a bare text write slips through because `bNewDocumentUpdate` bypasses
the check-out rule, but the taxonomy path performs an extra full item
update that does not, and the unhandled SPFileCheckOutException is a
500 the gateway relays as 502. Probe v5 brackets all metadata writes in
check-out / check-in — the sequence 4C will use anyway. Consequence for
4C: on require-check-out libraries, add-a-document is copy → check out
→ write metadata → check in, and metadata edits always ride a
check-out. The "expanded reference" payload shape IS rejected by the
validator (measured), so the term-object shape `{Value, TermGuid,
WssId: -1}` is the one the connector's surface takes.

**Run five closed the case (2026-08-03): the saboteur was
`bNewDocumentUpdate: true`.** Run five's contradictions — check-out
failing "already checked out by us" while every taxonomy write failed
"not checked out", and run four's check-out succeeding AFTER the
metadata attempts — admit exactly one reading: (a) a require-check-out
library hands a REST-created file back already checked out to its
creator, and (b) `bNewDocumentUpdate: true`, which our
validateUpdateListItem hardcoded, is the "write straight after upload"
mode and CHECKS THE FILE IN as part of the write. So the probe's own
Title write released the check-out every run, and the taxonomy writes
that followed were refused truthfully. Probe v6: take the check-out
however it arrives (pre-held or explicit), pass
bNewDocumentUpdate=false everywhere, check in explicitly at the end.
Consequence for 4B/4C: metadata writes always ride a held check-out
with newDocument=false; the flag is opt-in only for a deliberate
write-and-release straight after an upload.

**Reserve, if all seven fail:** CSOM through
`/_vti_bin/client.svc/ProcessQuery` — the XML protocol the SharePoint
UI itself uses for taxonomy. Heavier to build, but it does not share a
code path with any of the above, and it rides the same connector
transport. Phase 5's approval engine depends on this answer; nothing
shipped is affected either way.

## The five "hangs" — post-mortem (2026-08-04)

Five consecutive add-a-document runs appeared to hang mid-flow, and two
theories were built and torn down (a fresh-copy file lock; slow-but-
alive file-door calls) before the b7 build's throw-guard surfaced the
actual cause in one run:

**`JSON.parse("—")`.** The taxonomy select's placeholder option was
created without an explicit `value`, and an `<option>` with no value
attribute returns its TEXT as its value — so with any term select left
at "—" (the default), reading the editors threw synchronously between
two awaits. An unhandled rejection freezes the dialog on whatever
status line was last painted, which varied by build — every "hang",
including the one where the document ended up checked out (the
`CheckOut()` had answered; the crash came after it), is fully explained
by this. **No evidence of a slow or locked file door survives.** The
supporting bug: choice selects had the same valueless "—", which would
have WRITTEN "—" as the chosen value.

Lessons, encoded in the code: placeholder options always carry
`value=""` (helper in addDocument.ts); the create flow's entry catches
every throw into a visible "Unexpected failure: …"; the dialog carries
a build marker (stale player bundles muddied two reports) and a ticking
elapsed counter (a counter that stops is a frozen runtime, a counter
that climbs is a slow call — the reports could not tell these apart).
Instrument before theorising.

**4C's final shape** (Ben's critical-review push, which is what forced
the find): copy → itemId via RLDAS (list door, newest first, exact
name) → ONE forms-engine call — `ValidateUpdateListItem` with
`bNewDocumentUpdate: true`, SharePoint's own document-information-panel
path, which bypasses the require-check-out rule (probe run four proved
it on this tenant) and completes the document with no separate
check-in — carrying every field, taxonomy included as the
flow-standard `Label|guid`. Only if the tagging validator refuses the
term columns does the fallback engage for those columns alone: one
patient narrated `CheckOut()`, the connector term object (probe run
six's route), one patient check-in whose "not checked out" reads as
"nothing to release". **Phase 5 should also complete new files through
the forms engine.**

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
