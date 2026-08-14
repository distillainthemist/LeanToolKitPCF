# Site-scoped document visibility (proposal, 2026-08-14)

Ben's ask: a member of a specific site sees their OWN site's documents
plus selected corporate libraries (functional teams), and not other
sites'. Also: template libraries selectable by document controllers
only.

## The shape: an AUDIENCE per library

Every piece already exists to say this cleanly:

- **The user's site is already known.** `ben_ltkpeoples.ben_site` is
  the LeanBoard user record's site — the app reads it today to pick
  the site accent. It becomes the visibility key.
- **Libraries are already the unit of exposure.** The register, cards,
  pickers and scans all flow from `docsConfig()`'s library list — one
  choke point.

So: each library's config gains an **audience**:

```
audience: { all: true } | { all: false, sites: ["Kwinana", "Corporate"] }
```

- Absent = `all: true` — today's behaviour, so nothing changes at
  migration and a new library is visible everywhere until scoped.
- A SITE library lists its own site. A CORPORATE/functional library
  lists the sites that should see it — or stays `all`. This covers
  "selected corporate sites per site" without a second mapping table:
  the library says who sees it, rather than every site listing what it
  sees. (One list per library beats N-per-site lists to maintain.)

### Who sees what

```
visibleLibraries(viewer) =
  document controllers & app admins → every library
  user with a site               → audience.all OR audience.sites ∋ their site
  user with NO site set          → audience.all only
  + template libraries           → controllers & admins ONLY, always
```

The template rule folds in as a fixed audience: `libType === "template"`
never reaches non-controllers regardless of its audience — but the
ADD-DOCUMENT flow keeps working for everyone, because the template
picker reads the template library server-side; it was never a
navigable register and now visibly isn't one.

## What this IS and IS NOT (stated up front)

This is **UI scoping, not security**. The hard gate remains SharePoint:
a user with SP permissions on another site's library could still reach
it via SharePoint itself. For real enforcement the SP sites' own
permission groups must align (site members per site) — the app's
audience keeps the REGISTER honest and uncluttered, and prevents the
app from even attempting reads that would be refused. Deep links and
kiosk QRs deliberately stay SharePoint-gated: a shared link to a
document the user can read in SP still opens (a share is an act of
inclusion; the audience governs browsing, not sharing).

## Where it bites (the enforcement points)

All downstream of one filter applied where `docsConfig()` is consumed:

1. **The register** — nav library cards, scope dropdown, feeds, count
   sweep: filtered list in, everything else follows.
2. **Board cards** (Standard documents / Document health) — the card
   scope resolver filters the same way; a pasted view naming an
   out-of-audience library reports "not visible to you" rather than
   silently broadening (the resolver's existing convention).
3. **Link picker + reverse index + search scope** — filtered, so links
   to out-of-audience documents can't be minted by non-controllers,
   the derived view doesn't leak names, and search stays in-audience.
4. **Add-document targets** — already permission-gated; the audience
   filter narrows the candidate list first.
5. **Admin surfaces** (health report, settings, org sync) — controllers
   see everything; no change.

## Settings UI

Settings → Documents → Libraries: each library row gains an audience
control — "Everyone" (default) or "These sites…" with a multi-pick of
the site names the app already knows (the same site list the Users tab
and site cadence use). Template libraries show a fixed "Document
controllers" chip instead of a control.

## Honest limits

- A user's `ben_site` must be maintained (Users tab) — an unset site
  quietly narrows that user to Everyone-audience libraries; the Users
  tab already surfaces site, and Access diagnostics can add a line.
- Site RENAMES: audiences store site names (the app's site key today).
  A rename would orphan audiences — the settings save can offer a
  sweep, or we accept "rename = re-pick" for v1 (sites rarely rename).
- Cross-site LINKS (corporate↔site) keep working for controllers who
  mint them; a non-controller clicking a link to an out-of-audience
  document falls back to the SharePoint open — SP decides, as with
  kiosk shares.

## Phases

- **V1 — model + filter + template rule** (audience parse/serialize +
  `visibleLibraries` + the choke-point filter through register, cards,
  pickers, index, search; template libraries controllers-only):
  ~1 day, app-only.
- **V2 — settings audience control** (the Libraries-row UI + site
  multi-pick): ~0.5 day, app-only.
- Ship together; nothing schema-carrying (audience rides the existing
  library config JSON).

## Open questions

1. Confirm `ben_ltkpeoples.ben_site` as the authoritative site key
   (vs deriving from the org tree).
2. Should a user with NO site see nothing but Everyone-audience
   libraries (proposed), or be treated as corporate?
3. Do OWNERS of a document outside their audience need visibility
   (e.g. a corporate owner of a site-specific document)? Proposed v1:
   no special case — being named owner without SP/audience access is a
   configuration smell the health report can flag instead.
