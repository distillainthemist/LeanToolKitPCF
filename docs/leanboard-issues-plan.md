# Issues — in-app bug & idea reporting (plan, 2026-08-12)

Ben's ask: users report bugs/ideas from inside the app with pasted
screenshots; an Administration tab lists them for triage — prioritise,
complete, merge duplicates, and message the reporting users with
updates. Auto-categorise the app area and detect browser/platform.

## Critical review first — what best practice says, applied here

1. **Friction decides whether reports happen at all.** A reporter gets
   one dialog: describe, paste, send. Everything else — who, where,
   when, what device, what app version — is captured automatically.
   Reporters are never asked for severity or category taxonomies; a
   tester's job is to say what happened, triage is the admin's job.
2. **Close the loop or reports dry up.** The single biggest driver of
   sustained reporting is the reporter SEEING that their report moved.
   So the reporter-facing half (My reports: status + admin replies) is
   not a nice-to-have — it ships in the same phase as triage.
3. **Dedupe at the source beats merge at the desk.** Before filing, the
   dialog shows open issues matching the same area ("Is it one of
   these? +1 it instead"). A +1 attaches the user to the existing
   issue's update audience. Merge still exists for the ones that slip
   through.
4. **Screenshots carry data.** This is an internal ops tool, so pasted
   screenshots of real documents are acceptable — but they live in
   Dataverse (tenant-bound), never in SharePoint libraries where DMS
   readers might browse into them.
5. **Don't build**: a screenshot annotator (crop/arrows), reporter-set
   priorities, SLAs, or e-mail ingestion. Testing-phase scale doesn't
   justify them; the merge + message loop covers the real need.

## What we already have that this rides on

- **Schema road**: `data/schema.mjs` + `deploy-schema.mjs` (declarative,
  idempotent, role grants; `file` column kind PROVEN by U0 — bytes
  round-trip intact through `uploadFileToRecord`/`downloadFileFromRecord`).
- **Dataverse store helpers**: `app/src/store/dv.ts` (settle-not-empty,
  upserts) and generated services via `pac code add-data-source`.
- **Settings-tab anatomy** for the admin tab; dialog/section UI kit.
- **Notify module** (`src/docs/notify*`): Teams/Outlook messages with
  deep links — docs-gated, reachable by dynamic import (the sanctioned
  door, same as docsCards).
- **currentViewer()** for reporter identity (email-keyed, the app's
  standing identity rule).

## Schema (I0) — three tables, LeanToolKitData solution

**ben_ltkissue**
- `ben_name` (title, required — the one-liner)
- `ben_description` (memo)
- `ben_kind` (choice: bug / idea)
- `ben_area` (choice: boards / cards / documents / settings / other —
  prefilled from where the dialog was opened, editable by reporter)
- `ben_status` (choice: new / triaged / in-progress / done / declined /
  merged) — new is the only reporter-settable value
- `ben_priority` (int; admin-only, drives admin sort)
- `ben_reporteremail`, `ben_reportername` (text; identity by email)
- `ben_context` (memo, JSON: app version, platform, user agent,
  viewport, screen/route, board id, environment id, timestamp)
- `ben_duplicateof` (self lookup — merge target; merged issues close
  with status=merged and inherit updates from the parent)
- `ben_resolution` (memo — what shipped / why declined)

**ben_ltkissuefile** — one row per attachment
- `ben_issue` (lookup), `ben_file` (file, 8MB cap), `ben_caption` (text)

**ben_ltkissuemessage** — the update thread
- `ben_issue` (lookup), `ben_body` (memo), `ben_authoremail`/`name`,
- `ben_audience` (choice: reporter / internal) — internal notes never
  render in My reports
- `ben_watcher` variant for +1s: a message row with kind…

**ben_ltkissuewatch** — +1/subscribe (email + issue lookup); the update
fan-out audience = reporter + watchers + reporters of merged children.

Role grants (declarative, as U0 did): LeanBoard User gets create/read
on issue+file+message+watch, write on own rows; admin surface relies on
the existing admin gate in-app (Dataverse-side, LeanBoard User keeps
global read — an internal transparency choice that also powers
dedupe-at-source).

**Release note: the next release after I0 is SCHEMA-CARRYING** (managed
solution import in prod).

## I1 — the report dialog (reporter side)

- Entry points: "Report a problem or idea" in the main kebab (hub and
  board) and the docs-tab kebab. One component, area prefilled from the
  opening surface.
- Fields: title, description, kind toggle (bug/idea). Nothing else
  asked.
- **Screenshots**: a paste zone (document `paste` event →
  `clipboardData.items` → `getAsFile`), plus drag-drop and an
  `<input type=file accept=image/*>` picker (the road that matters on
  phones — camera roll). Client-side downscale via canvas (cap the long
  edge ~1600px, JPEG ~0.85) before `uploadFileToRecord`; thumbnails in
  the dialog with remove buttons. Multiple attachments = multiple
  ben_ltkissuefile rows.
- **Auto-context** (stored, also shown in a quiet "we'll include"
  line): app version (NEW: inject `__APP_VERSION__` at build from
  `git describe --tags` via Vite define — useful well beyond issues),
  navigator.userAgent + platform, viewport size, player vs browser
  (the Power Apps host is detectable from the embedding context),
  current screen/route + board id, environment id, ISO timestamp.
- **Dedupe-at-source**: on open, fetch open issues in the prefilled
  area; render titles as "+1" rows above the form.
- Submit = create issue row → upload files → done toast with the issue
  number. No connectors involved — Dataverse only, so the dialog is
  board-side clean (import gate untouched).

## I2 — the Administration tab (triage side)

New "Issues" tab in Administration (admin-gated, same anatomy as
Users):
- List: open by default; filters kind/area/status; sort by priority
  then age; row = pill (kind) · title · reporter · age · attachment
  count — the register/task-row anatomy reused.
- Detail pane (overlay or inline expand): description, context block
  (pretty-printed), attachment thumbnails (downloadFileFromRecord →
  object URLs), status + priority controls, resolution note.
- **Merge**: "Merge into…" picker (search open issues) → child gets
  status=merged + ben_duplicateof; its reporter joins the parent's
  audience; parent shows a "includes N merged reports" line.
- **Message the reporters**: compose box writing a ben_ltkissuemessage
  (audience=reporter). Optional send-a-copy via the notify module
  (Teams/Outlook deep link) behind the SAME dynamic-import door cards
  use — the import gate stays intact. Internal notes = audience=internal.
- Status changes append an automatic thread line ("Status → in
  progress"), so the reporter timeline is complete without admin
  effort.

## I3 — My reports (closing the loop)

- "My reports" surface reachable from the report dialog and the kebab:
  the user's issues (+watched ones), newest activity first — status
  chip, thread of reporter-visible messages, their own attachments.
- Poll-on-open only (no background polling); a hub badge counting
  unseen updates is a later nicety, not v1.

## Phasing & effort

- **I0** schema + deploy + `pac code add-data-source` (half day; next
  release schema-carrying)
- **I1** report dialog + paste/upload + context + `__APP_VERSION__`
  (1–1.5 days)
- **I2** admin tab: list, triage, merge, thread (1.5–2 days)
- **I3** My reports (half day)
- Later/optional: Teams copy of updates via notify door; hub badge;
  export to CSV for retro reviews.

## Open questions for Ben

1. Global read of issues for all users (powers dedupe/+1 and a "known
   issues" transparency culture) — acceptable? Alternative is
   own-rows-only + admin, losing dedupe-at-source.
2. Who is "admin" for the Issues tab — the existing board-admin gate,
   or the document-controllers group too?
3. Should DECLINED send an automatic courtesy message, or stay silent
   until an admin writes one? (Recommend: automatic line, admins can
   soften it.)
