# SharePoint writes from LeanBoard — the measured cookbook

Everything here was **measured** on the Dev site (pecheydistilling
tenant, 2026-08-03/04) through six write-probe runs and ten
add-a-document builds — none of it is assumed from documentation. It is
the reference for every future write feature; Phase 5's approval engine
builds on the recipe below verbatim. Code: `app/src/docs/sp.ts`
(transport + calls), `model.ts` (pure parsing/formatting),
`writeProbe.ts` (the probe that measured it), `addDocument.ts` (the
recipe in production use).

## The recipe: create a document and set its properties

```
1. copyto                      — server-side; the ONLY content route
2. itemId via RLDAS            — newest-first page, exact name match
3. CheckOut()                  — mandatory before any metadata write
4. ValidateUpdateListItem      — bNewDocumentUpdate: FALSE
     text / choice             — display text
     person                    — JSON [{Key:"i:0#.f|membership|<email>"}]
     dates                     — the SITE's regional short format
5. connector PatchItem         — taxonomy: {Value, TermGuid, WssId:-1}
6. CheckIn(comment, minor)     — comment app-required
```

Verified end-to-end 2026-08-04 (4C build b10). Each numbered rule below
is a place a plausible alternative failed.

## Creating files

- **Bytes cannot cross the wire.** All four carriages re-encode: a
  string body arrives UTF-8-expanded (16 bytes → 21); the `$content`
  base64 envelope is dropped by the SDK ("Body parameters missing");
  the connector's own Create file re-encodes both base64 (→26) and raw
  (→29). Structural — the SDK serialises bodies as JSON strings, and a
  JSON string is text. Upload-from-device needs a server-side holder
  (flow/function); until then, **server-side copy is the only way
  content gets into a library from the app**.
- `Files/add` (text content) → the file arrives **checked out to its
  creator** on a require-check-out library.
- `copyto` → the copy arrives **checked in**. (These two differ! An
  auto-check-out you assume but don't have produces "not checked out"
  refusals; one you have but don't expect produces "already checked
  out".)
- `copyto` with `boverwrite=false`: name collision is a clean refusal.
  Sanitize names first (`sanitizeFileName`); read the itemId back via
  RLDAS (list door), matching the exact name on a newest-first page.

## The check-out rules

- On a require-check-out library, **every** metadata write — forms
  engine and connector tabular alike — is refused *"not checked out"*
  without a held check-out. There is no bypass.
- **`bNewDocumentUpdate: true` is not a bypass — it is a check-in.**
  Its documented role is the write-straight-after-upload, and it
  releases the file's check-out as part of the write. Both directions
  of that bit us: hardcoded `true` silently checked files in between
  probe steps (faking three runs of taxonomy failures); assumed as a
  bypass, it produced "not checked out" against copied files. Ordinary
  edits pass `false`, always.
- `CheckOut`/`CheckIn`/`UndoCheckOut` answer promptly. The 4C "hangs"
  were a client-side crash (see Lessons), never these calls.
- "Already checked out" and "not checked out" refusals are **states,
  not failures** — e.g. check-in's "not checked out" on a library
  without the rule means "nothing to release, done".

## Setting properties

**Forms engine** (`ValidateUpdateListItem`, `bNewDocumentUpdate:false`,
under a held check-out) takes:

- **text / choice** — display text.
- **person** — a JSON array of claims keys:
  `[{"Key":"i:0#.f|membership|<email>"}]`, emails lowercased; single
  and multi are the same shape. Resolved server-side.
- **dates** — the **site's regional short format only**. ISO is refused
  ("Enter a date like this: 2/23/2012"), and **one refused field aborts
  the entire call** — nothing else in it is written. Read
  `RegionalSettings.LocaleId` and format with `formatDateForLocale`.
- Field-level refusals come back per field (`validateItemErrors`);
  whole-call failures are also possible — handle both.

**Taxonomy** goes through the connector's typed item surface
(`PatchItem`, declared on demand like `HttpRequest`):

- The **one accepted shape**: `{Value: label, TermGuid: id, WssId: -1}`
  — multi-value columns take an **array** of that object.
- Measured failures, do not retry them: form values `Label|id`,
  `-1;#Label|id`, id alone, label alone (tagging-UI validator rejects
  or masks a check-out exception); the typed verbose
  `TaxonomyFieldValue` PATCH and POST+`X-HTTP-Method: MERGE`; the
  `SPListExpandedReference` payload; a Graph-style v2.0 `fields` PATCH.
- The hidden note field is a real fallback in principle, but its name
  must be resolved from the column's `SchemaXml` `TextField="{guid}"` —
  never guessed (`<internal>_0` is an ArgumentException), and this
  site's `DMSDocumentStatus` declares no TextField at all.
- Term ids come lowercase from the v2.1 term-store walk; use them as-is.

**Never offer system columns as editors**: `CheckoutUser`, `Author`,
`Editor`, `Created`, `Modified`, `FileLeafRef`, size. They are
legitimate *view* columns (the dictionary auto-appends them as
available), but only SharePoint writes them.

## Reading back

- Single-document truth comes from list REST / RLDAS — never the search
  index (it lags minutes).
- `CheckoutUser` must be requested as a field to know who holds a
  check-out; the person object's **email** is what identifies "me"
  (display names collide).
- Errors arrive as JSON nested in JSON (the connector envelope wraps
  SharePoint's `odata.error`; the gateway's own envelope says
  "BadGateway" at every level with the truth inside `innerError`).
  `spErrorText` digs the sentence out; never truncate before showing
  it — a 200-character cap hid the decisive evidence for three runs.

## Lessons that cost runs

- **Instrument before theorising.** Five "hangs" produced two wrong
  theories (a fresh-copy file lock; slow file endpoints) before a
  throw-guard exposed `JSON.parse("—")` — a placeholder `<option>`
  created without an explicit `value` returns its *text* as its value.
  An unhandled rejection freezes a dialog on its last painted status,
  indistinguishable from a hung call. The countermeasures are now
  standing practice: placeholder options always get `value=""`; async
  UI entry points catch everything into a visible failure; long
  operations tick elapsed seconds; dialogs carry a build marker
  (stale player bundles muddied two reports — close and reopen the app
  after every `pac code push`).
- **A probe must test one variable.** The write probe's own sequencing
  bugs (metadata before check-out; `bNewDocumentUpdate` checking files
  in mid-run; a guessed note-field name; a term the column never used)
  each faked a tenant limitation that wasn't there.
