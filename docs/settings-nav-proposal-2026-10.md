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

**E. A sticky section strip under the tabs (horizontal).** A second,
visibly smaller row of section pills — the register's filter-pill
language (`.app-docs-fpill`, 12px, 36px tall; `-on` = the accent TINT,
never the filled "you are here", which the tab above owns) — that
sticks to the top of the window scroll while the page moves. Scroll-spy
tints the section in view; click scrolls to its head. Wraps on a
desktop so every section is visible (eleven Documents pills take two
lines at 1280px); scrolls sideways under 600px exactly as the hub's tab
strip does since M1, so it needs no separate phone fallback. Costs no
width: Users keeps its register, Organisation its rail. It is the one
option that uses only grammar the app already has at the top of a page.

**D. Collapsible sections.** Shortens the page by hiding it; changes
muscle memory on every tab and hides the state the pages exist to
show. Rejected.

## Status — BUILT 2026-10-07 (on dev, unreleased)

`app/src/settingsSection.ts` (the one head; `sectionId` tested),
`app/src/settingsStrip.ts` (derived strip, scroll-spy
`currentSectionIndex` tested, MutationObserver repaint, live-height
click offset), the heading pass over settings.ts, docs/settingsTab.ts,
priorities/settingsTab.ts, vdt/settingsTab.ts, templateWizard.ts and
issues/adminTab.ts, CSS (`.app-settings-strip`, `.app-settings-pill`,
`.app-pr-section` as the one rhythm, the card `overflow: clip`), and
`app/settings-strip.html` as the screenshot road. Verified there: ten
pills over two rows, sticky at the top, the spy moving with the scroll,
a click landing the head under the strip. The hosted tabs are Ben's
check — Documents especially.

## Recommendation (revised 2026-10-07 — "it doesn't have to be a left column")

**E — a sticky section strip under the tabs — built on one heading
helper, with the rail (A) kept as the fallback if the strip proves too
quiet on Documents.**

Why E over A: the app navigates horizontally at the top of every page
(tabs, crumbs, chip rows, segmented controls); its two vertical panels
(the Organisation rail, the register's folders) are data trees, not
page navigation. A strip is subordinate to the tabs by size and tint
alone, costs no width on Users or Organisation, works on a phone as the
hub strip already does, and needs no second component for narrow
screens. A rail would have been the first vertical page-navigation in
the app and needed its own narrow form.

- **One section head everywhere.** A shared `settingsSection(title,
  note?)` returns `.app-pr-section > h3.app-pr-h3 (+ .app-settings-note)`
  with an `id` from the title; the four modules' `.app-section` /
  `sectionTitle` calls move to it. ui-standard §6 already names this
  idiom; the pass closes the drift.
- **The strip is derived.** After a tab renders, the settings shell
  reads its `h3.app-pr-h3` heads and builds the strip from them; a
  section added tomorrow is in the strip tomorrow. Nothing
  hand-maintained.
- **Only where it earns its row.** Three or more sections (Documents,
  Priorities, Site cadence, My profile). Users, Organisation and the
  two-heading tabs show no strip.
- **Place and look.** Between the unsaved-changes bar and the body:
  tabs (15.5px, the location) → save bar when dirty → section strip
  (12px pills, tinted current) → body. Sticky at the top of the window
  scroll with the card's white behind it and a hairline below, so it
  never floats over text. Desktop wraps; under 600px it scrolls with
  the current pill scrolled into view.
- **Behaviour.** Click = smooth scroll to the head with the strip's
  height as the offset; scroll-spy by IntersectionObserver marks the
  head nearest the top; the hash is NOT written (the unsaved guard and
  the hash router stay out of it).
- **The save bar** is untouched: same tab, same guard, same place.

Effort: under a day — the helper and the four-module heading pass, the
strip with spy, CSS, ui-standard §6, and a harness page with a stubbed
three-section tab for the screenshot (Settings itself needs the host).
