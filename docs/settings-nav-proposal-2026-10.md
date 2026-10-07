# Settings — in-page navigation (proposal, 2026-10-07)

Ben: "Each settings page is getting quite extensive. Can we add a left
column bar with a quick nav to each of the sub-headings within the
settings tab? Critically review and propose an appropriate approach
consistent with our UI design."

## What is there now

Settings is one row of tabs (up to eleven for a super admin) over one
scrolling body per tab. The body scrolls with the window; the
unsaved-changes bar sits between the tabs and the body and guards tab
switches. Sub-headings per tab, counted from the code:

| Tab | Sections | Heading idiom |
|---|---|---|
| Documents | 11 — SharePoint connection · Document columns · Term sets & colours · Libraries · Term store · Lifecycle · Review cadence · Health · Tags · Default filters · Write access | `.app-section` |
| Priorities | 4 (pillars, period & RAG, owners, vision — each with a note) | `h3.app-pr-h3` + note |
| Site cadence | 3 — Site settings · Shift roster patterns · Protected times | `.app-section` |
| My profile | 3 — the profile fields · Access diagnostics · Notification probe | `.app-section` |
| Rituals | 2 — Ritual categories · Rituals | `.app-section` |
| Branding | 2 named + the name / logo / accent block above | `.app-section` |
| Access control | 2 — app access group · Document control groups | `.app-section` |
| Improvement, Value drivers, Issues | 1 each | `h3.app-pr-h3` / `.app-section` |
| Organisation | none — its own company → site rail and an editor pane | `.app-org-split` |
| Users | none — the register | grid |

Two findings before any navigation is added:

1. **The length problem is concentrated.** Documents is the page that
   needs wayfinding; Priorities and Site cadence benefit; the rest have
   one to three headings. A rail on a two-heading page is noise, and a
   rail beside the Users register costs the width its grid needs.
2. **Headings are not one idiom.** Four settings modules use two
   different section heads (`.app-section` small-caps divider;
   `h3.app-pr-h3` with an intro note). ui-standard §6 names the second.
   Any quick-nav must be DERIVED from the headings or it will drift the
   first week someone adds a section; deriving needs one idiom.

## Options considered

**A. A left rail (the ask).** A `200px + 1fr` split inside the settings
card, the rail listing the tab's sections, scroll-spy marking the one in
view, click scrolling the window to it. Consistent with two idioms the
app already has: the Organisation tab's rail (`.app-org-rail`:
`#faf9f7` panel, small-caps group label, 36px rows) and the Documents
register's nav cards. Costs: a second navigation layer (tabs say WHICH
page, the rail says WHERE on it — fine if the rail is visibly
subordinate); width on wide pages; nothing under 900px.

**B. Sub-tabs.** A second tab row under the main tabs. Eleven sub-tabs
for Documents is a third of the screen; it also breaks the one habit
the pages have (scroll to see everything) and multiplies the
unsaved-changes guard. Rejected.

**C. An "On this page ▾" menu.** One button in the body's head opening
the app's menu (`.app-cp-menu`) with the sections. No layout cost,
works at every width, the weakest wayfinding (no standing position).
Right as the NARROW fallback, not the desktop answer.

**D. Collapsible sections.** Shortens the page by hiding it; changes
muscle memory on every tab and hides the state the pages exist to
show. Rejected.

## Recommendation

**A, scoped, with C as its narrow form, built on one heading helper.**

- **One section head everywhere.** A shared `settingsSection(title,
  note?)` returns `.app-pr-section > h3.app-pr-h3 (+ .app-settings-note)`
  with an `id` from the title; the four modules' `.app-section` /
  `sectionTitle` calls move to it. ui-standard §6 already names this
  idiom; the pass closes the drift.
- **The rail is derived.** After a tab renders, the settings shell reads
  its `h3.app-pr-h3` heads and builds the rail from them; a section
  added tomorrow is in the rail tomorrow. Nothing hand-maintained.
- **Only where it earns its width.** The rail shows when a tab has
  three or more sections (Documents, Priorities, Site cadence, My
  profile). Users keeps its full-width register; Organisation keeps its
  own rail; two-heading tabs stay as they are.
- **Look.** The Organisation rail's language: a `#faf9f7` panel with
  hairline border, 36px rows, the current section in the accent tint
  (the register's "ticked" look, not the filled "you are here" — the
  tab above is the location). Sticky at the top of the window scroll
  so it stays while the page moves. Optional small-caps group labels
  for Documents (Connection & columns · Libraries & lifecycle · Access &
  defaults) using the rail's company-label idiom.
- **Behaviour.** Click = smooth scroll to the head with a 12px offset
  under the sticky tabs; scroll-spy by IntersectionObserver marks the
  head nearest the top; the hash is NOT written (the unsaved guard and
  the hash router stay out of it).
- **Under 900px** the rail folds into "On this page ▾" at the top of
  the body (option C); on a phone only My profile and Users matter and
  neither needs it.
- **The save bar** is untouched: same tab, same guard, same place.

Effort: about a day — the helper and the four-module pass, the rail with
spy and the menu fallback, CSS, ui-standard §6, and a demo-mode check of
the rail on My profile (the one settings tab that renders without the
host… it does not; Settings needs the host — a harness page with a
stubbed three-section tab is the screenshot road).
