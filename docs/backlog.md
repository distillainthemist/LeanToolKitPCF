# LeanBoard backlog

The decisions of record for everything not yet built. Each item carries
its decision date and enough context to pick it up cold. The phase plans
(`leanboard-phase5-plan.md`, `leanboard-standard-documents-plan.md`)
stay the design detail; this is the queue.

## Near-term (ordered — Ben, 2026-08-07)

1. **Document-control notifications (NEXT).** The option to send a
   notification for a document-control task — a Teams message or an
   email via the Microsoft Teams / Office 365 Outlook connector — with
   a direct link to the document. New connector = new connection
   references (the Phase 1 ALM note applies: connections are created
   per environment and consented per user). Transport is UNMEASURED:
   both connectors ride the same executeAsync door as SharePoint, so a
   probe (N0) runs before feature code, per standing practice.
2. **Full UI design review** (Ben) + resulting tweaks.
3. **Document Control Health report.** The corpus report card, named
   *Document Control Health*: missing required metadata, overdue
   reviews by owner, untagged documents. Lives in the documents-tab
   kebab (audience = document controllers, who cannot open Settings).
4. **Hub board card: documents needing review.** A dashboard card
   surfacing documents whose next review date is due/near — design to
   be reviewed with Ben before build.
5. **Favourites left-nav entry.** A "Favourites" row above the library
   list showing the starred set across libraries — closes the
   star-but-no-view gap.
6. **Phase 6 deployment cookbook** + stale-docs cleanup
   (`master-leanboard.md` still lists phases 3–5 as pending). The
   optional add-on flows an org can bolt on without app changes:
   reminder push, content-approval hardening, watermarked renditions —
   assembled from the phase-plan sections and `deploy-to-new-org.md`.

## Future (formally logged, no date)

- **SOP review & sign-off card (was 5E).** Redesigned 2026-08-07: not a
  DMS command but a **LeanBoard card** where crews review and sign off
  SOP updates as part of their board ritual. Would still need the
  acknowledgement schema (`ben_ltkdocack` — the first schema release
  since v0.25.0) but the surface is the board, not the register.
  Replaces the parked "5E acknowledgement ledger" design.
- **Chatbot link-out.** Parked until Pechey chooses a chatbot — build
  the button when there is something real to link to. (Original Phase 6
  deferral, re-affirmed 2026-08-07.)
- **Native file upload.** STANDING RULE (Ben, 2026-08-07): any commit
  that bumps @microsoft/power-apps re-runs the write-access probe's
  byte carriages as part of that change. If bytes ever cross the
  connector wire, native upload replaces the staging handoff. The
  Dataverse-file+relay-flow road stays the documented alternative
  (declined 2026-08-06).
- **Live-tiles cost bounding.** Watch item (re-affirmed 2026-08-07) —
  act only if refresh cost shows up in practice.

## Done / no longer tracked

- Folder counts REMOVED (Ben, 2026-08-08, UI design review): they cost
  one id-and-org query per library after every register reload, and
  same-named departments merged their numbers. The tree is pure
  navigation; the walk now also serves from a localStorage cache
  (screen trees only — drift/sync always walk live). This DISSOLVED the
  "duplicate-label term counts" investigation.

- Table display-name renames ("LTK …" → "LeanBoard …") — done by hand
  in the portal (Ben, 2026-08-07).
- "Effective Dae" column label, marketing@'s leftover Entra ownership,
  Dev-role check (`ben_ltkdoclibrary` + Delete privilege) — all fixed
  by Ben in the portals (2026-08-07).
