# Site default filters (proposal v2, 2026-08-14)

Ben's correction to v1: NOT visibility control — the organisational
filtering pane should simply PRE-FILTER to the right org branches
based on the user's site. Other sites' documents stay one click away
(clear the filter); SharePoint is untouched.

## The shape: a default org filter per site

- **The user's site is known**: `ben_ltkpeoples.ben_site` (already read
  for the site accent).
- **The org filter already takes multiple subtrees**: the register's
  term filters carry a label LIST per column — "Kwinana OR Corporate"
  is one filter today when picked by hand. This feature just picks it
  automatically.

### The mapping

Per site, a list of ORG TERMS that make up its default view — the
site's own branch plus the corporate/functional branches it should see
by default:

```
defaultOrgFilter: { "Kwinana": ["<term-id site>", "<term-id corp-fn>"], … }
```

- Stored by TERM ID (rename-proof, like every other term reference),
  labels resolved from the cached walk at apply time.
- Lives in the app docs config JSON (AppDocsConfig) — no schema.
- Edited in Settings → Documents, a small "Default filters" section:
  pick a site (the app's existing site list), tick org branches from
  the term tree. Superadmin, like the rest of the tab.
- A site with no mapping falls back to NAME-MATCHING the user's site
  against the org tree's terms — zero-config default for the common
  case where site names and org branch names align.

### The behaviour

On the documents register mount:

1. A SAVED VIEW, shared link, docview payload or kiosk launch keeps its
   own filters — the default applies ONLY to a plain open.
2. Otherwise: viewer's site → mapping (or name match) → apply as the
   NORMAL org filter, painted as the ordinary filter chips — visibly
   removable with one click, changeable like any hand-picked filter.
3. No site on the user record, or nothing matches → no default filter
   (today's behaviour).
4. Cards, health, pickers, search: UNTOUCHED — this is a register
   default, not a scope.

Nothing is hidden anywhere: it is exactly the filter the user would
have clicked, clicked for them.

## Template libraries (unchanged from v1, still in scope)

Template libraries leave the library nav for everyone except document
controllers and app admins — the add-document template picker keeps
working for all (it reads the template library server-side and never
needed the nav entry).

## Phases

- **T1 — template gate** (nav filter on libType): ~1 hour, app-only.
- **F1 — default filter** (name-match fallback + apply-on-plain-open):
  ~half day, app-only.
- **F2 — the mapping + settings section** (term-id lists per site,
  Default filters UI): ~half day, app-only.

## Open questions

1. Is the name-match fallback (site name = org term label) right for
   Pechey's tree, or should F1 wait for F2's explicit mapping?
2. Should the default also apply when a user CLEARS all filters and
   reloads later (proposed: yes — the default applies on every plain
   open, never mid-session)?
