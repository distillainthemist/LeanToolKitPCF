# BBA DMS requirements v1.4 — gap analysis vs LeanBoard DMS v0.42.0
(2026-08-12. Source: BBA_DMS_Requirements_and_HLD_v1_4.docx, 28 Apr 2026.)

Status legend: OUT = not built · PART = partially met · decision-flag =
conflicts with a decision already taken in this build.

## Broadly met already (not repeated below)
Templates-based creation (TM-001), metadata schema + dictionary +
term-store vocabularies + dropdowns (MD-001/002/006/008), Importance +
cadence-driven review dates (MD-007, VR-008 — the date model),
status differentiation in views (MD-003 in-app), metadata + directory
search with approved-only defaults (SE-001/002/004 core), review →
approval routing with multi-reviewer/approver (WF-001/002/005),
auto-publish + date stamping + supersede on approval (WF-006),
content-approval gate (AC-009), native versioning/archive
(VR-001/002/003/007), records as a distinct class (VR-010 core),
access model via groups (AC-001/002/003/006/008), QR-to-current
(DI-008 — a COULD, delivered), register/health drill-through +
whole-DMS view + live refresh (RP-004/005/007), Excel register export
(RP-008 part), Graph-native metadata (IN-001), linked-documents
metadata (IN-005).

## 1 — Reader experience & controlled PDF output (largest single gap)
- FR-DI-005 MUST · OUT — readers get an on-the-fly watermarked PDF
  (number, revision, effective date, tier), never the source format.
- FR-DI-006 MUST · PART — editable source only for named roles
  (permissions prevent editing today, but readers still OPEN source).
- FR-DI-007 MUST · OUT — no source download for readers; PDFs carry
  "Uncontrolled if printed" + extraction timestamp.
- FR-LC-003 MUST (raised in v1.4) · PART decision-flag — visible Draft
  marker; current approach is a template field bound to status (manual),
  after stored renditions were deliberately trimmed (2026-08-08).
- FR-VR-006 SHOULD · OUT — superseded-version watermark + successor.
- FR-SE-005/MD-003 tails · PART — status labelling "on the rendered
  PDF" awaits the PDF layer. (O4 pdf.js desk viewer is parked.)

## 2 — Document numbering & identity
- FR-LC-002 MUST · OUT — auto-generated document numbers on creation,
  persistent across majors, short prefix (today the ID is typed).
- FR-LC-006 SHOULD · OUT — administrator rename/renumber with visible
  history of prior names/numbers.

## 3 — Bulk administration & migration
- FR-LC-005 MUST · OUT — owner find-and-replace across a scope, audited.
- FR-VR-009 MUST · OUT — staggered initial review dates at migration.
- FR-IM-002/006 MUST · OUT — curated, spreadsheet-driven tranche
  ingestion with sign-off before promotion (staging library exists —
  the 5H handoff — but no tranche apparatus around it).
- FR-IM-004 SHOULD · OUT — source→target migration logging.

## 4 — Governed hashtag taxonomy
- FR-MD-009 MUST · OUT — propose-anywhere, DC-approved-before-visible
  tags added to the vocabulary; rejections recorded.
- FR-MD-005 MUST · PART — HSE grouping is to ride hashtags (group-by
  tree exists on taxonomy columns; the hashtag layer doesn't).
- FR-MD-004 SHOULD / FR-MD-010 SHOULD · OUT — free tagging + usage and
  pending-proposal reporting.

## 5 — Workflow depth
- FR-WF-011 MUST · OUT — Regulator-approved attribute: approver must
  confirm regulator sign-off; regulator-returned PDF attached as a
  record; audit captures both.
- FR-WF-003 MUST · OUT — per-document expected approval timeframe.
- FR-WF-007 MUST · OUT — approver delegation + DC re-assignment of a
  stalled step with comments.
- FR-WF-009 MUST · PART — approve-on-behalf exists in effect via
  controller rights; the mandatory-comment "on behalf of" record isn't
  explicit.
- FR-WF-004 MUST · PART — "simple revision" without the full cycle:
  quick PROPERTY edits publish without ceremony; cosmetic CONTENT
  changes still take the full cycle.
- FR-WF-010 SHOULD · OUT — request-for-change by any user, owner triage.
- FR-WF-008 SHOULD + FR-IN-004 SHOULD · OUT — DocuSign/Nitro signature
  with signed PDF stored.
- FR-LC-004 tail · PART — reviewer/approver nomination exists; the
  suggest-candidates assist doesn't.
- FR-TM-002 MUST · PART — template library exists; templates don't yet
  carry their own approval lifecycle.
- FR-TM-003 MUST · OUT decision-flag — named co-authors with CONCURRENT
  editing (the check-out model is deliberately single-editor; grants
  exist, co-authoring doesn't).

## 6 — Notifications, reminders, escalations (push)
All of these are decision-flagged: the build deliberately runs reviews
on rituals + pull surfaces (hub card, health report), and the reminder
flow was trimmed from the cookbook (2026-08-08). The requirement set
now says push is MUST — needs an explicit decision (the cookbook's
recipe-2-style Power Automate relay is the likely road, since the app
holds no scheduler).
- FR-NT-001 MUST · PART — routing notifications exist but are
  admin-CLICKED (notify panel), not automatic on routing.
- FR-NT-002/003 MUST · OUT — scheduled reminders (actions + review
  lead-time).
- FR-NT-004 MUST · OUT — escalation to owner's manager/DC, tighter for
  Importance=High.
- FR-NT-006 MUST · PART — publication notification exists manually;
  "affected personnel by metadata" audiences don't.
- FR-NT-005 SHOULD / FR-NT-007 COULD · OUT.

## 7 — Acknowledgement & distribution
- FR-DI-002 MUST · OUT — acknowledgement tracking + dashboards (note
  the doc keeps this MUST even though DI-001 softened to SHOULD).
- FR-DI-001 SHOULD · OUT — per-document acknowledgement prompts (5E
  sign-off card is DESIGNED, ben_ltkdocack schema pending; the schema
  road is proven).
- FR-DI-003 SHOULD · OUT — controlled hardcopy register (DC-visible).
- FR-DI-004 MUST · MET-adjacent — per-area point-of-use surface exists
  as LeanBoard doc cards/kiosk rather than a SharePoint page.

## 8 — Retention & disposal
- FR-VR-004 MUST · OUT decision-flag — retention labels from retention
  class → Purview (retainUntil is deliberately inert today).
- FR-VR-005 MUST · OUT — end-of-retention disposal review routed to the
  owner; never auto-delete.
- FR-VR-011 MUST · PART — records metadata minimums exist as columns;
  enforcement + suggested retention class don't.

## 9 — Corporate ↔ site two-tier linkage (entire family absent)
- FR-CL-001..004, 006, 009 + FR-AC-004 MUST · OUT — tier badges,
  structured parent linkage, store-once/lookup pattern, change
  propagation raising review tasks on dependent site documents,
  tier-separated controller sets.
- FR-CL-005/007/008 SHOULD · OUT — linkage-health reporting, click-
  through navigation both ways, lift-and-shift replication.
  (The dictionary's multi-site scaffolding is a start, not the feature.)

## 10 — Reporting completeness
- FR-RP-001/002 MUST · PART — health report covers overdue/due-soon and
  status; % on-time review compliance and acknowledgement completion
  KPIs don't exist yet (ack awaits 5E).
- FR-RP-003 MUST · PART — overdue is pull-only today (push with NT).
- FR-RP-008 MUST · PART — register export is spreadsheet-only; PDF
  export missing; "every controlled document AND record" cohort check.

## 11 — Audit trail consolidation
- FR-AT-001..005 MUST · PART — version history + check-in comments +
  moderation cover much, and M365 Purview audit exists platform-side;
  a consolidated, exportable, human-readable per-document audit trail
  (incl. metadata changes, tag decisions, ownership re-assignment,
  restricted visibility) is not a built feature.

## 12 — AI assistant (entire family absent)
- FR-AI-001..007, 010 MUST · OUT — Copilot-style assistant grounded on
  Current documents only, permission-trimmed, cited, declining when
  unsupported, query-logged. (Backlog holds "chatbot link-out" as
  future.) FR-AI-008/009 SHOULD, FR-AI-011 COULD.
- Platform note: the HLD assumes M365 Copilot scoped to the site — an
  agent + site-scoping exercise more than an app build.

## 13 — Integrations & access niceties
- FR-IN-002 MUST · OUT — training-package flags prompting L&D review.
- FR-AC-005 MUST · PART — library-level restriction is configurable;
  a per-document Confidentiality flag driving visibility isn't built.
- FR-AC-007 SHOULD · OUT — guest/extranet access for auditors etc.
- FR-IN-003 COULD · OUT — change-management integration.

## Cross-cutting observations
1. Three pillars dominate the MUST gaps: the PDF reader layer (§1),
   push notifications/escalations (§6), and the two-tier corporate
   linkage (§9). Everything else is incremental on existing roads.
2. Four gaps conflict with decisions already taken in this build and
   need re-decision, not just build: draft watermark approach (LC-003),
   scheduled reminders vs rituals (NT-002/003), retention inertness
   (VR-004), single-editor check-out vs co-authoring (TM-003).
3. NFR-DR-003 (avoid dependencies beyond the M365 baseline the central
   RTA team supports) is a governance conversation about LeanBoard
   itself as the delivery vehicle vs the doc's OOTB-SharePoint HLD.
4. Quick wins on proven roads: document numbering (LC-002), owner
   find-and-replace (LC-005 — VULI batch + audit line), acknowledgement
   (5E design + proven schema road), regulator attribute (WF-011 —
   column + approve-dialog gate + record attachment), staggered review
   dates (VR-009 — a migration-time variant of addMonthsYmd).
