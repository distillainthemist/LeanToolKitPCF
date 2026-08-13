# The relationships tranche — linking, hashtags, systems, audit (plan, 2026-08-13)

Ben's next tranche from the BBA disposition (`bba-dms-gap-analysis.md`):
§4 governed hashtags, §9 generic document linking + management-system
filters (the corporate↔site two-tier requirement rides on it), §11
audit trail. Planned together deliberately: hashtags and links are both
*governed relationships on documents* with near-identical settings
surfaces, and the audit trail should record tag and link acts from the
day they exist — designed apart, one of them retrofits the other.

## Critical review — the load-bearing choices

### 1. Where do document links live?

| Option | Verdict |
|---|---|
| SharePoint lookup column | Dead end — lookups are per-list; cross-library is the whole point, cross-site (corporate↔site) doubly so. |
| Text column of references (today's `linkedDocuments` role) | Works one-way and renders, but no reverse question ("what links HERE?"), no types, no health, breaks silently on rename. |
| **Dataverse link table** ✓ | Cross-library and cross-site by construction, reverse lookups are a filter, typed, auditable, health-checkable, and the schema road is proven. |

The honest trade-off of the Dataverse choice: links are invisible to
anyone browsing bare SharePoint. Accepted — the register is the
interface; bare-SP browsing already lacks the lifecycle, the org tree
and the health picture.

Anchoring: links key on the document's **uniqueId** (GUID — survives
renames and moves within a site), with the site URL + display name +
document id CACHED on the link row for painting and for surviving the
linked document's temporary absence (permissions, deletion). A cached
name going stale is a repaint problem; a broken anchor is a HEALTH
finding ("dangling link"), never a silent drop.

Link types — a small closed set, not user-extensible (a taxonomy of
relationship types is how link features die): `relatesTo` (symmetric),
`implements` (directed: site doc → corporate doc; the two-tier answer),
`supersedes` (directed; complements the lifecycle's superseded stage
for cross-document succession). Each renders with its inverse reading
("implements" / "implemented by") in the overlay.

### 2. How are hashtags governed?

The requirement is propose-anywhere, DC-approved-before-visible, with
usage and pending reporting. The term store alone cannot do this (no
approval concept). The composition that fits the app:

- **The vocabulary lives in a closed term set** ("Hashtags"), mapped to
  a multi-value taxonomy column with a new dictionary role `hashtags` —
  tagging then uses the EXISTING taxonomy editors, filters, and
  browse-by machinery unchanged.
- **Proposals live in Dataverse** (`ben_ltktagproposal`), filed from
  the tagging editor itself ("Propose a new tag…" when no term
  matches). Document controllers approve in a settings section — an
  approval CREATES the term via the 5F `createTerm` road, a decline
  messages the proposer (the issues feature's decline pattern).
- **The ampersand guard applies** (the U+FF06 lesson): proposals are
  validated against `suspiciousCodePoints` + the `&`-conversion rule
  before they can be approved — a phone-hostile tag must not be
  mintable.
- Pending report = the proposals queue itself. Usage report = term
  counts over the register feed (v1: counts on demand in the settings
  section, not live everywhere).

### 3. Management-system filters

Mostly already true: any mapped taxonomy column is filterable and
group-able today. The gap is *meaning*: a `managementSystem` dictionary
role so the app knows which column IS the management system — that
unlocks: a dedicated filter chip row on the register, browse-by
default, the role showing in the overlay identity area, and cross-tier
questions later ("all ISO 14001 documents, corporate and site"). Small,
because the rails exist; the work is the role + defaults, not new
machinery.

### 4. What is the audit trail, exactly?

Two sources of truth exist and neither is complete alone:
- **SharePoint version history** knows every content and property
  change (and moderation) — but not grants, releases, notifications,
  link/tag acts, or WHY (the lifecycle act behind a check-in).
- **The app's acts** flow through one funnel (`runLifecycle` +
  the command dialogs) — but writing nothing durable beyond check-in
  comments.

So: **hybrid**. A Dataverse event log (`ben_ltkdocevent`) appended by
every app act — approve, submit, review, retire, reinstate, grant,
release, publish, property edit, link add/remove, tag change — plus a
derive-on-read merge with SP version rows in the viewer's new Audit
view, chronological, human-readable, CSV-exportable. Events are
append-only (no update/delete privileges beyond create) — tamper-
evident enough for a management system audit without inventing
cryptography. Actor identity is email (the standing rule).

Decisive detail: event WRITES ship in the first phase, even before the
viewer exists — every week without them is a week the trail cannot
cover retroactively.

### Deliberately not building
Per-link permissions, link graphs/visualisations, transitive rollups,
user-defined link types, free-tag mode, event-log signing. The health
report and the closed type set carry the governance.

## Schema (R0 — one deploy, SCHEMA-CARRYING release after)

**ben_ltkdoclink** — `ben_fromuid`, `ben_touid` (GUIDs), `ben_fromsite`,
`ben_tosite`, `ben_linktype` (relatesTo|implements|supersedes),
`ben_fromname`, `ben_toname`, `ben_fromdocid`, `ben_todocid` (cached
display), `ben_createdbyemail`. role: delete true (unlink).
Alternate-ish key by (fromuid,touid,linktype) enforced in app code.

**ben_ltktagproposal** — `ben_label`, `ben_note`, `ben_status`
(pending|approved|declined), `ben_proposeremail/name`, `ben_decision`
(text), `ben_termid` (filled on approve). role: delete false.

**ben_ltkdocevent** — `ben_docuid`, `ben_site`, `ben_docname` (cached),
`ben_act` (short key), `ben_detail` (human sentence), `ben_actoremail`,
`ben_actorname`, `ben_when` (datetime). role: delete false; no Write
grant beyond create (append-only posture).

## Phases

- **R0 — schema + event writes** (1 day). Tables deployed via
  deploy-schema; `appendDocEvent()` wired into runLifecycle,
  check-in/out, property edits, grants/releases, Mark reviewed,
  moderation publishes. Silent-failure tolerant (an event write must
  never block the act it records — warn, not fatal).
- **R1 — linking** (1.5 days). Overlay "Linked documents" section:
  outbound + inbound with inverse readings; add-link picker (search
  across registers, the share-dialog's search road); unlink; link acts
  → events. `implements` becomes the corporate↔site road. Register
  filter "implements X" deferred to R3 unless trivial.
- **R2 — governed hashtags** (1.5 days). Hashtags role + closed term
  set mapping; "Propose a new tag…" in the taxonomy editor; controllers'
  approval queue in Settings → Documents (approve = createTerm + term
  cache invalidation, decline = message via the issues pattern);
  ampersand/invisible-character validation; pending + usage counts in
  the settings section.
- **R3 — management-system role + filter polish** (0.5 day). The role,
  the register chip row, browse-by default, overlay identity line.
- **R4 — the Audit view** (1 day). Overlay pane view merging events +
  SP versions chronologically; filter by act class; CSV export. The
  document controller's answer to "show me everything that happened to
  this document".
- **R5 — health + hardening** (0.5 day). Health checks: dangling links
  (anchor gone), one-way `supersedes` conflicts, stale pending
  proposals, phone-hostile term labels (the FF06 sweep, generalised).

## Open questions for Ben

1. **Link types** — is the closed set (relates to / implements /
   supersedes) right, and is "implements" the word your auditors would
   use for site→corporate (alternatives: "gives effect to",
   "localises")?
2. **Who may link?** Anyone with edit rights on the FROM document, or
   controllers only? (Recommend: content-stage editors + controllers —
   linking is metadata, not content.)
3. **Hashtag approval seat** — document controllers (recommended, it's
   vocabulary governance) or superadmins?
4. **Audit visibility** — controllers only, or every reader sees a
   document's audit view? (Recommend: controllers + owners; readers
   have version history already.)
