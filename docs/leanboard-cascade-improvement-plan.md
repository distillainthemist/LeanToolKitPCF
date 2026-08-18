# Cascaded Priorities, Improvement & Problem Solving — plan of record

(2026-08-19. Source: "Cascaded Priorities, Improvement & Problem Solving
Brief.docx"; decisions Ben's, same date. **STATUS: decisions taken;
UI design pass next (see `leanboard-cascade-design-brief.md`); the
implementation phasing below is PROVISIONAL until the design pass
lands.**)

Two new pillars of the app: **cascaded priorities** (what we want to
achieve, at every org level, cascading down and across) and
**improvement / problem-solving initiatives** (how we deliver them),
tied together by a single-page priorities view, a value driver tree,
and reporting.

## What already exists and is reused (the shape of the build)

| Brief concept | LeanBoard today |
|---|---|
| Org hierarchy (company → site → department → team) | the DMS org dictionary (term-store synced; on people + boards). "Team" = area. |
| Initiative "leanboard format", templates | project boards (one living instance) + board templates, composer, card studio |
| Plan on a page / charter | the Canvas card (v0.45) — gains **bound fields** |
| Summary of underlying initiatives | Canvas rollup |
| Metrics tracking | KPI-trend renderer + `ben_ltkcardseries` |
| Flag / escalate | the actions escalation channel + EscalationViewer |
| Evidence files | the Dataverse file road (`uploadFileToRecord`) |
| Notify team (Teams/Outlook) | the notify road (docs-only today — opens to boards; DLP story updated) |
| Confidential initiatives | boards' `canViewBoard` / confidentiality settings |
| Roles/admins | ben_ltkpeoples role + site/department |

Genuinely new engines: **the priority cascade** (records, lineage,
per-org acceptance), the **value driver tree** with formulas and
simulation, a **Gantt** over actions, **stage/PDCA gates** on boards.

## Decisions of record (Ben, 2026-08-19)

1. **Org model = the org dictionary**, company root → site → department
   → area ("team"). Site is the minimum level for priorities.
   Individual objectives are OUT of v1.
2. **Cascade model = assignments + child priorities.** A priority is one
   record owned by its originating org. Cascading creates per-org
   ASSIGNMENTS (priority × org: proposed → accepted / rejected / on hold
   / completed, with reason). Customising creates a CHILD priority
   (own record, parent link). Lineage is preserved either way; the
   originator sees every assignment's status; peers cascade the same
   way.
3. **Initiative = header record + project board.** Header (title,
   linked priorities, method/template, roles, metrics, stage,
   confidentiality, flag, period) + a project board from the initiative
   template. Charter = a Canvas card **with bound fields** that display
   and edit header data live (title, roles, priorities, metrics…) — the
   charter is never a copy. Actions = the existing Actions card.
   "Single action" initiative = header + actions, no board.
4. **Metrics full + VDT with free-form formulas + simulation, this
   phase.** Initiative metrics: interval, definition, source link,
   units, tracking method (good/bad · value vs target/limits ·
   picklist), baseline; VDT metrics add plan/forecast/actual. VDT per
   site: nodes with a **formula per node** over children (a small pure,
   tested expression evaluator — no `eval`), roll-up on read, and
   simulation = apply initiative forecasts at leaves, recompute.
5. **Stages**: template-defined ordered stages, each mapped to Plan / Do /
   Check / Act (fixed four, app-wide colours); a stage gate can require
   approval by **one or more roles** (e.g. sponsor + improvement lead
   at completion; finance for valuation) — roles are template-
   extensible beyond sponsor/owner/lead/team/support. Template cards
   are tagged with a stage; the title bar shows the stage chip. Stage
   changes are logged (who/when/comment) = the initiative's audit trail.
6. **Actions**: start date + Gantt (default 4-week window);
   reschedule/cancel reasons + history; evidence files + owner
   endorsement of completions (initiative switch) + recently completed;
   bulk reassign + open-actions digest to team via Teams/Outlook.
7. **Permissions**: org OWNERS named per node — at **site and
   department** only (areas are managed by their department's owners)
   — create/edit their org's priorities, accept/reject/hold cascades,
   set the vision, and see confidential initiatives in their org;
   siteadmins across their site; superadmins everything; **pillars
   superadmin-only**. Everyone reads (except confidential).
8. **Embedded card + week**: live data; the meeting's week sets the
   time window of metric points, Gantt/due-soon and "what changed". No
   record snapshots; the tile image archives on close as always.
9. **Priority status**: derived, shown as **counts of red / amber /
   green initiatives**; roll-up rule is a VIEW toggle — **strict** (any
   red → red) or **ratio** (red > X% → red, X an admin setting). No
   manual override. Primary-initiative metrics headline the priority.
10. **Period**: every priority carries a period (FY / calendar / custom
    label per company); views default to the current period; year-end
    review per priority: carry forward (same record, lineage intact) /
    complete-archive with reason / retire.
11. **Confidential** initiatives: visible to role-holders + org owners +
    admins only; hidden elsewhere and counted as "n confidential" where
    a total would otherwise lie.
12. **Health checks**: periodic evaluations against a **company-level
    question set** (admin-defined), captured at any point from the
    initiative board; per-initiative trend/history; org-level trend
    across initiatives in reporting.
13. **Sequencing: cascade first, then initiatives, then VDT/reporting**
    (statuses read "No data" until initiatives exist — accepted).

## Data model (provisional — solution-carrying; all `ben_ltk*`)

- `pillar` (company-level; two levels via parent; label, colour, active,
  order) — superadmin.
- `orgowner` (org term id ↔ person; site/department only) + `orgvision`
  (org term id → vision text) — or both on one `orgprofile` row.
- `priority` (statement, pillar, originating org, owner person, period,
  status: active / completed / archived / retired + reason, parent
  priority, primary initiative, order, created/updated).
- `priorityassignment` (priority × org, status proposed / accepted /
  rejected / on hold / completed, reason, decided by/when).
- `initiative` (title, template, org, stage, status, confidential,
  flag level none/flag/escalated + note, endorsement switch, period,
  board id nullable, created/updated) + `initiativepriority` (junction,
  primary flag) + `initiativerole` (initiative × person × role key ×
  optional time commitment) + `initiativemetric` (per-metric definition
  or VDT node link; series in `ben_ltkcardseries` keyed by metric id) +
  `initiativestagelog` + `initiativehealth` (dated evaluation, answers
  JSON, score) + `initiativecomment` (dated highs/lows/next steps).
- `initiativetemplate` (name, method, stages JSON incl. PDCA map +
  approver roles, roles JSON, custom fields JSON, board template ref,
  mandatory/optional card map) — superadmin.
- `vdtnode` (site, parent, name, definition, source link, units,
  tracking, formula, is leaf) + `vdtvalue` (node × period: baseline /
  plan / forecast / actual).
- `healthquestion` (company-level checklist) — superadmin.
- Actions table extensions: start date, evidence files, verification
  state, reschedule/cancel history (child rows or JSON), initiative
  link.
- Admin settings: RAG ratio threshold X; period definition.

## Provisional phasing (to be revised after the design pass)

- **P0 Foundations**: schema + roles; org owners & vision in settings;
  pillars (superadmin); period settings; action extensions (start date,
  reasons/history, evidence, verification, bulk reassign); notify road
  opened to boards (DLP story updated).
- **P1 Cascade**: priorities CRUD per org; cascade assignments (send /
  accept / reject / hold / complete with reasons; child priorities);
  lineage; orphan/revision prompts; the cascaded-priorities screen
  (simple + dynamic views, pillar filter, org filter, up/down
  navigation, R/A/G counts + strict/ratio toggle, "Other"); priority
  detail drill-down; the embedded card; actions Gantt overview.
- **P2 Initiatives**: templates (stages/PDCA/gates/roles/custom fields/
  mandatory + optional cards); Improvement tab (mine-first); create flow
  from both tabs; header + project board; Canvas bound fields; metrics;
  commentary; flag/escalate (+ Teams/email prompt); confidentiality;
  health checks; endorsement; digest.
- **P3 VDT**: tree editor per site; formulas; values; initiative→VDT
  metric linking; roll-up + simulation view.
- **P4 Reporting**: counts, overdue/completed/due-soon, stopped/
  cancelled/rescheduled, flags, value delivered (hard via VDT, trend
  for specific metrics), health trend, site value delivery; period
  comparison; org filters.

## Open items for the design pass

See `leanboard-cascade-design-brief.md` — the brief handed to the UI
design pass; its answers update this plan before implementation.
