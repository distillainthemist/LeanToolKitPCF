# LeanBoard v2 — settings, roles & admin (plan)

Source: Ben's "Review of LeanBoard Code App" (2026-07-19). This doc
turns it into build slices, with design challenges resolved or flagged.
Design of record for the app remains code-app-plan.md; this extends it.

## Schema changes (all additive — one deploy-schema run, managed
upgrade for other orgs)

| Table | New columns |
|---|---|
| LTK People | `ben_role` ("user" \| "siteadmin" \| "superadmin"; empty = user), `ben_area` |
| LTK Board | `ben_category` |
| Board Instance | `ben_isadhoc` (bool), `ben_manifestjson` (per-instance board override — data hook now, UI later) |
| LTK Site Settings | `ben_timezone`, `ben_accent`, `ben_rosterpatterns` (memo: named pattern library), `ben_appname`, `ben_logo` (memo, data-URI), — app-level branding lives on a reserved row `ben_site = "__app__"` |

## Design decisions & challenges

1. **Admin-request code** (agreed with Ben 2026-07-19: one-time
   bootstrap): as written it would be a permanent backdoor — the repo is public and the code ships in the
   client bundle, so anyone with app access could self-promote
   forever. **Decision: the code only works while the org has zero
   super admins** (first-run bootstrap). After that, promotion happens
   in user management only. Keeps the Ohno homage and the setup flow,
   closes the hole. (A client-side code can never be a real secret —
   this confines the exposure to the empty-org window.)
2. **Removing Boards from the nav** (resolved with Ben 2026-07-19):
   users still need a non-buried path to their board. **Decision:
   Boards becomes a list view INSIDE My day** — its tabs become
   Cadence / Actions / Boards (the Settings tab moves out to the cog).
   The header trims to brand + Settings cog only. Board *management*
   (create/replicate/edit) lives in Settings.
3. **Accent colour is specified twice** (branding app-wide, site
   settings per-site). **Decision: precedence = site accent overrides
   app accent overrides default blue.** Site accent ships in the same
   slice as site settings; costs little once the theme is plumbed.
4. **Roles are UX gating, not security.** All app users share the same
   Dataverse table privileges, so a determined user could bypass the
   app. Acceptable for an internal trust boundary; if that changes,
   the upgrade path is Dataverse security roles per table. Stated so
   nobody mistakes the gate for a lock.
5. **Site timezone**: full TZ-correct scheduling is a deep well
   (occurrence generation, `ben_when` storage, DST). **Decision:
   store it now, apply it narrowly** — occurrence generation for a
   board uses its site's TZ instead of browser TZ. Display stays
   viewer-local. Deeper correctness deferred until a multi-TZ site
   actually exists.
6. **Per-instance board adjustment**: this is the composer pointed at
   an instance. **Decision: ship the data hook + wizard toggle now**
   (instance manifest column; joinTiles prefers it when present);
   the instance-composer UI is its own later slice.
7. **"My Settings" naming**: the pane is both personal and admin.
   Cog icon labelled "Settings"; first tab = **My profile**
   (site/department/area), admin tabs appear per role.
8. **Confirm-before-create + ad-hoc records** double as a bug fix:
   the pilot's stray instances came from accidental row taps. Confirm
   dialog kills that class of error.

## Slices

### Slice 1 — Quick wins (S) — DONE 2026-07-19
- LeanHub: empty meetings → render the empty calendar (drop the
  "bind meetingsJSON" maker hint from the user path).
- Default theme: white header, blue accent (branding fallback values).
- Board screen: tapping a recordless occurrence asks "Create the
  meeting record for <when>?" before createInstance.

### Slice 2 — Roles + Settings shell (M)
- Schema: `ben_role`, `ben_area`.
- Settings cog (header right) → tabbed screen; role-gated tabs.
- My profile tab: site/department/area pickers; first-access prompt
  after viewer self-registration.
- User management tab (super: roles + site assignment; site admin:
  view). Bootstrap code path per challenge #1.
- Nav trim: header = brand + Settings cog; My day tabs = Cadence /
  Actions / Boards (list view, challenge #2).

### Slice 3 — Organisation + branding (M/L)
- Org hierarchy editor: sites → departments → areas as a navigable
  tree (super: sites; site admin: their site's tree).
- Site settings: timezone, protected times (relocated), site accent,
  roster-pattern library (named patterns; wizard gains a pattern
  picker with custom fallback).
- Branding tab (super): logo upload (small PNG/SVG data-URI), app
  name override, app accent. `appTheme()` + shell read the `__app__`
  row; precedence per challenge #3.

### Slice 4 — Meetings admin (M)
- Meeting categories: admin-managed list; wizard field; `ben_category`.
- Creation gated to super/site admins; wizard entry moves to Settings
  → Boards & meetings.
- Replicate board: copy manifest + occurrence settings under a new
  boardId (cheap, high value).
- Wizard edit mode: owner reopens their meeting's draft
  (parseWizardDraft of the stored blob) and saves back.
- "Instances adjustable by participants" toggle in the wizard →
  stored in the blob; board screen honours it once the
  instance-composer exists (challenge #6).

### Slice 5 — Scheduler: ad-hoc records (M)
- `ben_isadhoc`; MeetingScheduler gains "add ad-hoc meeting"
  (date/time picker) and an adhoc badge on rows; app creates the
  instance flagged adhoc. Adhoc instances excluded from the carry
  chain's "previous" pick? — **default yes** (carry follows the
  scheduled cadence), revisit if wrong in use.

Order: 1 → 2 → 3 → 4 → 5. Slice 1 is independent; 3–5 depend on 2's
settings shell and role model.
