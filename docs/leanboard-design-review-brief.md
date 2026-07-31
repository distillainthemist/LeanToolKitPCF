# LeanBoard — design review brief

*Prepared 2026-07-30 for an external design review (supplied with
screenshots). Current version: v0.23 + Phase 3a interface work, deployed
to the dev environment.*

## What the app is

LeanBoard is a **lean daily-management system** for Pechey Distilling,
built as a **Power Apps code app** (a single-page TypeScript app running
in the Power Apps player) backed by Dataverse, with a SharePoint
document-management surface. It digitises the tiered meeting cadence of
a lean operation: crews and leaders run recurring **rituals** (stand-ups,
reviews) on visual boards, actions roll up to the people who own them,
and controlled documents (SOPs, standards, records) are reachable from
the same place the work happens.

One codebase also ships 24 PCF controls (the same board cards embeddable
in classic Power Apps), but the code app is the product under review.

## The surfaces

### 1. Hub (home)

The landing screen. A tab row is the top edge of a single white card:

- **My day** — the viewer's day: today's meeting timeline (calendar
  strip with protected/blocked times shaded) and **My actions** grouped
  by urgency (LATE with count chips, flagged items, owners, due dates).
- **Cadence** — the recurring-meeting calendar across the site.
- **Actions** — the full action rollup for the viewer.
- **Documents** — the Standard Documents area (described below), loaded
  lazily on first open.
- A **Rituals** directory (every board the viewer may see, with
  category colour chips and shareable links).

First visit self-registers the viewer into the roster and prompts them
to place themselves in the organisation (site → department → area);
that placement drives which meetings, actions and protected times they
see. Returning to the hub paints instantly from a session cache while a
background refresh re-feeds the view (stale-while-revalidate).

### 2. Ritual boards

Each ritual is a **board of cards** laid out on a grid, opened at a
specific occurrence ("latest" links resolve to the most recent
meeting). Cards are picked from a registry of ~22 visible types in five
groups:

- **Rituals**: Agenda, Capture (notes/parking lot), Meeting scheduler
- **Performance**: Status tile, SQDPC letters, KPI trend, Pareto,
  Conditions, Heatmap, Embed (Power BI etc.)
- **Problem solving**: 5 Whys, Fishbone, Fault tree, Benefit/effort,
  Process map
- **Action management**: Action board, Escalation viewer
- **Project management**: Risk matrix, RACI, Skills matrix
- **Reference**: Link card, Standard documents card, Document health
  card

Every card type declares a **meeting-to-meeting data policy** — *clear*
(fresh each meeting, e.g. agenda), *carry* (rolls forward), or *shared*
(one live document, e.g. registers) — chosen when the card is placed.
Cards paint from a stored SVG tile instantly, then hydrate with live
data (jittered fetches so a board of 20 cards doesn't stampede).

### 3. Meeting wizard & composers

Admins create/edit rituals through a **wizard** (name, category, site,
recurrence, participants, confidentiality, board layout) and can adjust
a single occurrence via an instance composer. Ad-hoc meetings can be
spun off a scheduled ritual and are badged as such.

### 4. Settings (behind the header cog)

My profile / Users (role management: user, site admin, super admin —
UX-gating, not security) / Organisation (drag-reorderable org tree:
company → site → department → area; per-site accent, timezone, roster
patterns, protected times) / Branding (app name, logo, accent,
meeting categories with colours) / Boards & meetings admin /
**Documents** (the DMS configuration, below).

### 5. Standard Documents (the newest area)

A SharePoint DMS surface inside the hub's Documents tab. Read
experience is complete (document control workflows are the next
phases):

- **Layout**: left navigation (All documents / per-library / ★
  Favourites / saved Views / a **Browse-by tree**), right register
  list, search row on top.
- **Browse-by tree**: defaults to the Organisation term set (nested
  folders with disclosure carets, auto-selected to the viewer's own
  org unit); a select re-roots the tree on any managed-metadata column
  (Document type, Process, …). Selecting a node filters to it and its
  whole subtree.
- **Filters**: chips above the list; "＋ Filter" adds a filter on any
  taxonomy column (column → term picker). Filters combine (AND across
  columns, subtree OR within one). Non-taxonomy columns are honestly
  not filterable (a tenant search-schema limitation) rather than faked.
- **Search**: name/title matching by default; a "Search everything"
  toggle switches to full-text over contents and all fields. Scope
  select: this library / all exposed libraries — never the whole
  tenant.
- **Register list**: document name + glyph, then per-library configured
  columns (status renders as a coloured chip mapped from the status
  term set), Modified date, row kebab. Infinite scroll, skeleton rows
  on first load. **Choose columns…** offers tick + drag-to-reorder;
  the choice rides the view state.
- **Views & sharing**: any current state (library, query, toggles,
  filters, columns, tree grouping) can be saved as a named per-user
  view or copied as a link that opens the app exactly there — links
  carry the state itself, so they work for any recipient.
- **Document viewer**: click a row → overlay with an embedded PDF
  rendering of the document (never the editable source; conversions
  are served cookie-free so the frame renders in any browser). Two
  actions: **Open PDF** and **Copy PDF link** (the PDF toolbar itself
  handles print/save). Working documents first ask "Work on it / Just
  view". Row kebab: favourite, properties & history (configured
  columns only + SharePoint version list), open/copy PDF link.
- **Register export**: CSV of the current scope with its configured
  columns.
- **Board cards**: "Standard documents" (a live filtered list on any
  ritual board) and "Document health" (overdue / due-soon review
  counts derived at read time).
- **Settings → Documents**: connect a site, pick libraries, per-library
  column configuration (display names, availability, defaults, DMS
  roles — auto-suggested from column names; register defaults seeded
  per library type), status→colour mapping from the actual term set,
  term-store group/set selection, org-alignment drift report, and a
  live "Test search filtering" diagnostic.

## UI design approach

**Intent: Flat 2.0.** Flat surfaces with deliberate, minimal depth —
not skeuomorphism, not pure flat. The concrete system:

- **Layout**: white cards on a warm light-grey page; one card per
  surface; the hub's tab row is the card's top edge. Generous
  whitespace; 8–12px paddings; rounded corners (8–10px).
- **One accent**: a single accent colour (`--app-accent`, default
  #2563eb blue) does all the selection/primary work. Branding can
  re-theme it app-wide; a site's own accent overrides for its people.
  The **filled accent state means "where you are"** (selected tab,
  selected library, primary button); **filters and secondary selection
  are a tinted accent** (12% mix background, accent text) so the strong
  state has exactly one meaning.
- **Depth**: shadows only on genuinely floating things — menus,
  dialogs/overlays, drag ghosts. Nothing else casts.
- **Typography as hierarchy**: sentence case everywhere; section labels
  are small uppercase grey; values carry the weight, labels stay
  light. No icon fonts — a small set of unicode glyphs (⋮ ⠿ ★ ▸▾ ✕)
  used consistently.
- **Kebab convention**: primary action is the row/tile itself; ALL
  secondary actions live behind ⋮ kebabs (rows, saved views, the
  area-level kebab holding Copy link / Export / Choose columns). No
  button rows on list items.
- **Chips**: status values (coloured from a configurable state
  palette), active filters (tinted, with × to clear), count badges.
- **State honesty**: skeleton shimmer rows while lists load; empty
  states name the next action ("No documents match — clear filters or
  change the search"); errors say what refused; capped operations say
  they were capped.
- **Progressive disclosure**: trees collapse with carets; dialogs are
  overlays with focus trapping and Escape; drag-to-reorder uses a ⠿
  handle (same interaction in the org editor and the column chooser).
- **Deep-linkability**: every meaningful place (a ritual's latest
  occurrence, a documents view) has a copyable player link; shared
  links restore state, not ids.

## Known constraints the reviewer should know

- Runs inside the Power Apps player iframe (no address bar; deep links
  travel as launch parameters; the app renders in the player's chrome).
- Desktop-first: used on shop-floor screens, laptops and boardroom
  displays. No dedicated mobile layout yet (flex-wrap only).
- Data lives in Dataverse + SharePoint via the user's own permissions;
  latency to those services is 300–800ms per call, which drives the
  caching/skeleton/jitter patterns above.
- Accessibility: focus-trapped dialogs, aria-labels on icon buttons and
  carets; not yet audited end-to-end.

## Questions we'd value the review focusing on

1. The Documents area just gained group-by trees, filter chips and a
   column chooser (Phase 3a) — does the left-nav information
   architecture (scope list + views + favourites + tree in one column)
   still read clearly, or is it becoming a junk drawer?
2. Is the filled-vs-tinted accent distinction (location vs filter)
   learnable, or does it need a stronger cue?
3. The register list at real-world density (6–8 columns) — typography
   and spacing guidance welcome.
4. Empty/loading/error state copy and treatment consistency across the
   hub, boards and documents.
5. Anything that breaks the Flat 2.0 discipline (accidental depth,
   competing accents, novel one-off controls).
