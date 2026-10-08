# Initiative "Edit details" — a simpler form (proposal, 2026-10-08)

Ben: "tidy up the initiative edit details form — remove the period
(not needed any more); do some grouping / collapsing of elements to
make it a simpler form to navigate. Critically review and propose
improvements aligned to our UI design principles."

## 1. What is there today

`app/src/improvement/editDetails.ts` opens a wide centred modal
(`.app-modal-wide`, min(92vw, 1080px)) whose body is ONE column of
blocks, every block open, every control full width:

| # | Block | Control | Hint shown |
|---|---|---|---|
| 1 | Title | input | |
| 2 | Description | textarea | |
| 3 | Period | short input | |
| 4 | Organisation | site · department · area selects | |
| 5 | Also shown in | adder row (site · department · ＋ Add) | yes |
| 6 | Linked priorities | chips + "＋ Link a priority" | yes |
| 7 | Roles | one row per role, people chips, ＋ | |
| 8… | Standard fields | Working folder (url) · Context · Problem / opportunity statement · … one block each, in settings order | per field |
| … | Template fields | one block each | |
| n-2 | Metrics | the metrics list (not for single actions) | yes |
| n-1 | Confidential | checkbox | |
| n | Endorsement | checkbox | yes |

Then an error line and the footer (Cancel · Save details). The create
flow's second step (`improvementTab.ts`) is the same form written a
second time, with two small differences (locked priority chips, a
roles hint) that the edit form does not have.

## 2. Findings

1. **Length is flatness, not count.** Thirteen or more blocks with
   nothing between them: no heads, no rhythm, one label size. The eye
   cannot skip. Grouping, not hiding, is the first fix — the same
   finding as the settings pages (settings-nav-proposal-2026-10.md),
   where section cards on a tinted ground solved it.
2. **Period is not a detail.** It is the initiative's START period,
   stamped at creation from the register's period filter and used by
   that filter (`liveIn`) to decide which period an initiative shows
   in. Editing it later is a way to make an initiative vanish from the
   current period by accident; nothing else reads it as an editable
   fact. Remove it from the form. It stays on the record (the pane
   still shows it under Period; History carries creation). If a move
   is ever needed it is an admin act for the ⋮ menu, not a field.
3. **Two blocks are rules, not details.** Confidential and Endorsement
   change who sees and what waits; they sit last, as checkboxes with
   a 12px note, after the metrics list. They want their own named
   group so a reader knows the form has finished with facts.
4. **Width is arbitrary.** At 1080px every input is a thousand pixels
   wide; the three org selects take a third each; the period box is
   220px. Nothing here needs that width — the wizards use a 620px
   column for the same kinds of fields. Short fields (a date, a rating,
   a select) alone on a thousand-pixel row look lost.
5. **Hints everywhere.** Four blocks carry a sentence beneath them,
   always, whether or not anyone needs it. The section note idiom
   (one muted line under a head) says the same once.
6. **The form exists twice.** Create and edit drift (they already
   have). One module should build both, with a `mode`.
7. Not in scope but noted: the modal is not phone-ready (a 92vw box
   with three selects in a row). Initiative editing is a desk task;
   the phone register (M-series) deliberately left it out.

## 3. Options considered

**A. Section heads in one scrolling column** — the settings idiom:
`settingsSection(title, note?)` heads, each group a white card on the
tinted ground, one section note instead of per-field hints. Shortens
nothing, but gives the eye a structure to skip by, and it is the one
idiom the app already uses for "a long page of related controls".
Cost: nil beyond CSS — the modal body becomes the ground.

**B. Tabs inside the modal** — the detail-overlay pattern (left tab
strip + body) or the card walk's top tabs: About · Organisation ·
People · Details · Metrics · Rules. Each tab is short. Costs: a
required field on a hidden tab fails validation out of sight; a user
hunting for "where is the working folder" clicks through six tabs; Save
covers tabs the user never saw. Tabs suit a RECORD being read (the
Documents overlay) more than a FORM being filled. Rejected.

**C. Collapsible groups (the ask).** Disclosures with a summary line
("Organisation — Whole site · also 2 departments ▸"). Rejected for
settings because it hides the state the page exists to show; in a form
the objection is weaker, but every fold hides a field someone may need
and a summary line is one more thing to keep true. Right for the ONE
block that is rarely touched and has a true one-line summary (Also
shown in), wrong as the organising principle.

**D. A 760px column with paired short fields.** Narrower than the
wide modal, wider than the wizard column (the org row and the roles
rows need it). Short field kinds (date, rating, number, select, person)
pair two to a row; text, url and textarea stay full width. The form
gets shorter without hiding anything.

## 4. Recommendation — A + D, with C for one block

**Six named groups in a 760px column, section cards on the tinted
ground, one shared form module for create and edit.**

| Group | Contents | Note under the head |
|---|---|---|
| **About** | Title · Description | — |
| **Organisation** | Site · Department · Area on one row; **Also shown in** folded beneath as a disclosure whose summary reads "Only its own organisation" or "Also in Packaging, Warehouse" | "Where it is owned. Other departments it belongs to list it too." |
| **Priorities & people** | Linked priorities chips (★ primary); Roles rows | "One priority is the primary — its charter and metric headline it. Standard roles pre-fill from the site's people." |
| **Details** | standard fields then template fields, in settings order; short kinds paired two to a row, text / url / textarea full width; required marked ✱ as on the charter | the template's own hint, if any |
| **Metrics** | the metrics list (hidden for single actions) | "★ = the primary. Own metrics can be linked or promoted into the value driver tree." |
| **Rules** | Confidential · Endorsement as two labelled switches, each with its one-line consequence | — |

- **Period leaves the form.** Create keeps stamping it; the pane keeps
  showing it; nothing else changes.
- **One head idiom.** `settingsSection` builds the heads (ui-standard
  §6 names it; the template wizard already uses it inside a dialog),
  and the modal body takes the settings ground so the cards read as
  cards. No strip: six groups in a 760px column fit a laptop screen
  with one scroll; if Documents-length forms ever appear, the strip is
  the next step and already exists.
- **Validation names the group** ("Details: Problem / opportunity
  statement is needed") and scrolls the first failing field into view
  and focuses it — possible precisely because nothing is behind a tab.
- **The fold is honest.** "Also shown in" opens to the adder row; with
  entries it opens by default so nothing set is ever hidden.
- **One module** (`improvement/initiativeForm.ts`) renders the groups
  for both flows; create's second step mounts it with `mode: "create"`
  (locked chips, the roles pre-fill) and edit with `mode: "edit"`. The
  duplicate goes.
- **Unchanged:** the modal never closes on a click outside; Cancel ·
  Save details footer; every save path (board rename, metric cards,
  endorsement closing, the History event).

Effort: about a day — the shared module with the two modes, the
grouping CSS (modal body as ground, 760px column, paired short kinds),
the one fold, validation focus, a harness page for the screenshot, and
tests for the pure parts (field pairing by kind, the fold's summary).
No schema change, app-only release.
