# Overlay polish — structure, details, version history

Ben's design slate (2026-08-10, three mockups), critically reviewed.
Constraints held throughout: the DECISION ZONE (R1/R2 — the one solid
accent, the lifecycle commands) is untouched, and the Part II GROUPING
keeps sectioning the properties (the mockup's "three clusters" are what
a site configures its groups to be — the manager delivers them, the
pane follows).

## Accepted as drawn

- Filename promoted to the overlay header (type chip · name ·
  `library · modified` line); the pane's duplicate line deleted —
  completes R3.
- "Open in new tab ↗" lives in the HEADER, always: the pane's primary
  slot is for decisions alone (R1, applied more strictly than today —
  Open PDF no longer becomes the primary when nothing is pending).
  The 4-up utility row stays (D4 action parity).
- Preview failure = a centred placeholder (type chip + "Preview
  unavailable" + Open button), never seed text in a white void.
- Backdrop scrim one step darker.
- Version history: "No comment" in grey when SharePoint has no publish
  note — it teaches authors the field exists.

## Amended, with reasons

- **The desk without the chip.** The neutral grey stage, centred
  white page with shadow, adopted — AROUND the existing same-origin
  blob iframe. The custom zoom/page chip is not: it implies page-at-a-
  time canvas rendering (pdf.js, a heavy lazy chunk) and would trade
  away continuous scroll, text selection, search and the measured
  Print road (`contentWindow.print()`) for chrome the browser viewer
  already provides. If the hosted look still disappoints, pdf.js
  becomes its own parked phase (O4).
- **Clusters = groups.** "Group headings disappear" is rejected (Ben's
  own constraint): the manager's groups ARE the clusters. Adopted from
  the mockup instead: the identity roles (docType · documentId ·
  status) leave the grid for a header line; labels go quiet, values
  carry emphasis; same-value Owner/Approver collapse to one row
  (compared by EMAIL — the like-with-like rule); dates take the
  app-wide format with a relative hint on Review due; boolean roles
  (ackRequired, regulatorApproved) render as statement chips at the
  tail — quiet when satisfied, amber when demanding. Honest limit: the
  "12 of 18" acknowledgement count needs the 5E ledger; until then the
  chip is loud but uncounted.
- **The rail reversal is a decision, not drift.** D6 asked for the
  accent strip; this retires it for a 1px neutral divider with a
  labelled "Hide »" at the pane's top edge and "« Details" on the
  collapsed rail — the labelled affordance resolves R4's hide-vs-✕
  ambiguity better than colour did.
- **Restore, routed — not raw.** A version-history Restore as drawn is
  a lifecycle bypass: raw restore reverts content AND status with no
  bracket, no comment, no moderation publish. History rows get
  Open ↗ (a NEW TAB — old versions are not presignable, but the tab
  carries the user's own session); "Restore" appears as a pointer to
  the commands that legitimately restore (Cancel revision, Reinstate).
  True per-version restore, if ever wanted, is a gated command with
  the full bracket.

## The grouping rule (pure, tested)

Minors `x.y` are the draft trail TOWARD major `x+1.0` and nest under
its card; drafts newer than the newest major sit under an "In
progress" top card; the newest major wears the one "current" pill,
older majors read "Superseded" with a one-line summary ("5 drafts")
collapsed. Current major starts expanded; "Show n more drafts…" past
the first two.

## Phases

- **O1 — structure.** Header promotion, desk stage + failure
  placeholder, Open-in-new-tab to the header, neutral divider +
  labelled Hide »/« Details, darker scrim. viewer.ts + CSS only.
- **O2 — details pane.** Identity line from roles (those roles drop
  out of the grid), quiet-label/strong-value grid, owner/approver
  same-value collapse, date format + relative hint (pure helper),
  boolean statement chips. Groups keep sectioning the rest, "Other"
  tail included.
- **O3 — version history.** `groupVersionsByMajor` in model.ts (pure,
  tested), major cards + draft trails + disclosure, Open ↗ per
  version, Restore as lifecycle pointers.
- **O4 (parked).** pdf.js canvas desk with own zoom/page chip — only
  if O1's stage disappoints hosted.

Gates per phase (full ritual); hosted checks: kiosk unchanged (solo
mode keeps the name up top — it has no details pane), Print still
prints, a failing conversion shows the placeholder, decision card
unchanged through a full lifecycle, groups still section the pane.
