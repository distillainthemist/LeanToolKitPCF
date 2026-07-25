# LeanBoard card-settings model — phased plan

Written 2026-07-25, from the critical review of the board/card setup interface.
Decisions taken by Ben on top of that review:

- **The model**: anything defining a card's format/configuration is set in the
  board/card setup interface (composer + CardSettings). Only data/content that
  changes during a meeting or problem-solving session is edited from the board.
  Default/prefill content stays a setup concern (standard content).
- **State colours move to SITE level** — a named palette per site; each card
  *selects* from the palette rather than picking freeform colours.
- **Theme cleanup approved** — the dead per-card theme fields go. The one
  customisation that stays at card level is the **title strip (titlebar)**
  colour, used to associate related cards on a board.
- **Pareto**: `unit` moves to config; **categories stay in the card** (edited
  in-card, as today).
- **Link is removed as a data policy.** In its place: a new **LinkCard** card
  type that references any card on any board — an explicit, traceable object
  wherever one meeting's board shows another's card.
- SkillsMatrix / Raci structure (categories, skills, targets, roles,
  deliverables) stays in-card: documented as *structural content*, a
  deliberate exception — these matrices are built in workshops.

Not in this plan: the ActionBoard kanban group-by validation bug (spun off as
its own task), board-level theming (not requested; can revisit), a
"referenced by" reverse-linkage view (noted under Later).

---

## Current state (what the review established)

- Settings blob per slot: `title / prompts / readOnly / theme / config /
  board(policy+source)` — edited only in the composer (`CardSettings`).
- **Theme is mostly dead**: of the six theme fields offered, the app applies
  only `titlebar` (board.ts:221, cardEditor.ts:266, composer.ts:461).
  `theme.legend` is consumed by nearly every control but never populated —
  StatusTile state colours cannot actually be set anywhere.
- **Series cards** (SqdpcCard, ConditionsCard, KpiTrendCard, ParetoCard) keep
  data in Card Series keyed by `boardId+cardId` — instance-independent — so
  clear/carry/link are illusory or broken for them (link copies a document
  that holds no data).
- **Link policy** reads only the source's *live row* (instances.ts:124), i.e.
  its standard-content template — not "the latest saved content" the help
  text promises.
- The policy picker offers all four policies to every non-action-surface card;
  runtime default for an unset policy is **carry** (mappers.ts:130).

---

## Phase 0 — Audit & baseline

Goal: know what production data the changes touch before touching it.

1. FetchXML via `pac env fetch` over `ben_ltkboards.ben_manifestjson` and
   `ben_ltkboardinstances.ben_manifestjson`: count slots per `board.policy`
   value, and list every slot with `policy:"link"` (board, cardId, source).
2. Same sweep for stored `theme` keys other than `titlebar` (how much dead
   theme data exists — expected: none or near-none that matters).
3. Record counts in this doc. They decide whether Phase 4's link migration is
   a script or a hand edit.

Proof: the counts, pasted below when run.

- [x] Audit run 2026-07-25 (`pac env fetch`, Pechey Distilling Development):
  **5 boards, 38 slots, 0 instance override manifests.**
  Policies: 33 unset (→carry) · 2 shared · 1 clear · **2 link, both
  incompletely configured and therefore no-ops** —
  `board-bottling-line-standup-6a73/capture-4f0g` (source board, no card) and
  `board-daily-department-meeting-6q17/statustile-dgcr` (no source).
  Phase 4 migration = hand edit; nothing to preserve.
  Non-titlebar theme keys: one (`legend` on
  `board-daily-department-meeting-3g7o/statustile-ks6r`) — dead, never
  rendered by the code app.

---

## Phase 1 — Registry-driven policy matrix

Goal: each card type offers only the policies that mean something for it, with
a sensible per-type default; series cards stop pretending.

1. `CardSpec` gains `policies: ("clear"|"carry"|"shared")[]` and
   `defaultPolicy` (registry.ts). Link is no longer offered anywhere
   (LinkCard replaces it in Phase 4).

   | Card | offered | default |
   |---|---|---|
   | FiveWhys / Fishbone / FaultTree / BenefitEffort | clear · carry · shared | carry |
   | ProcessMap | carry · shared | shared |
   | RiskMatrix / Raci / SkillsMatrix | carry · shared | shared |
   | AgendaCard | clear · carry · shared | clear |
   | CaptureCard / HeatmapCard | clear · carry · shared | carry |
   | StatusTile | carry · shared | carry |
   | EmbedCard | clear · carry · shared | clear |
   | SqdpcCard / ConditionsCard / KpiTrendCard / ParetoCard | *(none — see 3)* | — |
   | ActionBoard / EscalationViewer | *(source picker, unchanged)* | — |

2. The editor's "New meeting instance" section renders only the offered
   policies. A stored policy that is no longer offered still shows, flagged
   "(no longer offered for this card)" — never silently changed.
3. **Series cards render no policy picker.** In its place a short note:
   "This card's data is a dated series — every meeting shows its window of
   the same data, and the meeting archives the card's image at close."
   Runtime: `slotPolicy()` returns `shared` for series card types regardless
   of the stored value, so tiles come from the live row and close-meeting
   stamps the archive svg (closed meetings keep rendering their stored
   record, exactly as the live-tiles split guarantees).
4. **Defaults apply to NEW slots only**: the composer stamps the type's
   `defaultPolicy` explicitly into `board.policy` when a slot is created.
   The runtime default for existing slots with no stored policy stays
   **carry** — no behaviour change on production boards.
5. Rationale notes shown in the picker (one line each), e.g. registers:
   "Shared — there is one register; meetings review it and archive an image."

Tests: policy matrix unit tests (offered/default per type; series override);
composer stamps defaults; legacy stored values survive round-trip.

- [x] DONE 2026-07-25. `CardSpec` gained `policies`/`defaultPolicy`/
  `seriesBacked` + the `policyOnPick` stamp helper; the editor renders only
  the offered set (series note for series cards, "(no longer offered)" flag
  for legacy values, link source pickers still visible on legacy link
  slots); `slotPolicy` returns shared for series-backed types. The "clear"
  option label now tells the truth ("start each instance from the standard
  content" — it never started empty). Proof: 166 vitest tests green
  (12 new in policyMatrix.test.ts + store.test.ts series-override cases);
  dev page `app/policy-matrix.html` audits the mounted editor per card —
  ALL PASS (offered options, stamped defaults, series notes, legacy-link
  flagging).

## Phase 2 — Theme cleanup

Goal: the Theme section tells the truth.

1. `THEME_FIELDS` shrinks to **titlebar only**; section renamed
   "Appearance". background / foreground / accent / legend / font are
   removed from the editor. Parsing stays lossless (`extraTheme` already
   preserves unknown keys), so existing blobs are untouched.
2. `ThemeDraft` keeps its shape internally (serializer still emits stored
   extras verbatim); only the UI stops offering the dead fields.
3. Remove the StatusTile help text claiming colours come from "theme legend
   colours" (replaced properly in Phase 3).
4. Stale-comment sweep while in the area: KpiTrendCard/editor.ts:4 (kebab no
   longer holds spec settings); instances.ts:124 comment (promises a fallback
   that Phase 4 removes along with link seeding).

Tests: draft round-trip with legacy theme keys (still preserved); editor
renders only titlebar.

- [x] DONE 2026-07-25. THEME_FIELDS → titlebar only; section renamed
  "Appearance"; StatusTile help stops claiming legend colours work; stale
  comments fixed (KpiTrendCard kebab, instances.ts link fallback). Legacy
  theme keys proven to round-trip verbatim (cardConfig.test.ts). Proof:
  167 vitest green, builds clean, policy-matrix.html dev page shows
  APPEARANCE with Title strip alone and the policy audit still ALL PASS.

## Phase 3 — Site state palette

Goal: state colours defined once per site; cards select from them.

1. **Dataverse**: new column `ben_statepalette` (JSON text) on
   `ben_ltksitesettingses`. *Ben step*: add the column, then refresh the
   generated model (same workflow as when the table was added).
2. **Store** (`store/config.ts`): `SiteSettings` gains
   `statePalette: [{key, label, color}]`. Default when unset:
   `good #107c10 · issue #d13438 · atrisk #f2c811 · info #2b88d8 ·
   neutral #808080` (from the toolkit STATUS_PALETTE family). Keys are
   stable slugs; labels editable.
3. **Settings UI**: site tab (site admins) gets a palette editor — rename,
   recolour, add; deleting an entry is allowed and resolution falls back to
   the default colour for a missing key (defensive, noted in the UI).
4. **CardSettings**: new field kind `paletteColor` — a dropdown of the site
   palette rendered with swatches. The composer feeds the palette via a new
   `editor.setPalette(...)` (it knows the board's site).
5. **Consumers** (the app resolves selections to concrete colours; controls
   keep receiving plain colour strings — no control API changes):
   - **StatusTile**: `states` becomes an objectList `[{label, palette}]`.
     The mounter resolves each state's palette key and passes the colours via
     `theme.legend` positions the control already reads. Legacy csvChips
     value still accepted (labels only, current default colours).
   - **SqdpcCard**: `statusCodes.color` becomes a `paletteColor` select;
     legacy freeform hex values still honoured on read.
   - **ConditionsCard**: good/issue resolve from palette keys `good`/`issue`
     automatically (populated into `theme.legend[1]/[2]`); no new config.
6. `CardMount` gains `palette: Record<string,string>`; board.ts, cardEditor,
   composer and the live-tile renderer load it once per board (board → site →
   siteSettings) and pass it through.

Tests: palette parse/default; resolution fallbacks (missing key, legacy hex,
legacy csv states); mounter wiring test extended to assert palette is passed.

- [x] DONE 2026-07-25 (code side). shared/palette.ts (parse / serialize /
  paletteMap / resolvePaletteColor / mintPaletteKey); SiteSettings gains
  statePaletteJson + sitePalette(); settings site tab gets the palette
  editor (sparse: "" until a site customises); CardSettings gains the
  paletteColor field kind (Default + site labels + "(custom)" for legacy
  hex, resolved swatch) and setPalette; StatusTile states became an
  objectList (label + palette) with legacy CSV/JSON adoption; SQDPC
  statusCodes colour is a palette select; mounters resolve StatusTile
  legend slots, SQDPC code colours and Conditions good/issue through the
  board site's palette. Proof: 182 vitest green (15 new), builds clean,
  palette-audit.html dev page ALL PASS (rendered colours + editor selects).

  **Scope change (Ben, mid-phase): the palette is APP-level, not site-level**
  — status colours are semantics ("good" means the same on every board), it
  removes the LinkCard host-site ambiguity, and it lives with the rest of
  the visual identity. The editor sits on Settings → Branding (super-admin);
  a per-site OVERRIDE can layer on later exactly like accent. Store:
  `appStatePalette()`/`saveAppStatePalette()` on the branding row;
  `SiteSettings` carries no palette.

  Column: `ben_statepalette` added via the repo's own schema pipeline —
  data/schema.mjs + deploy-schema.mjs (device-code token from Ben, Web API,
  idempotent: exactly one component created). Model refreshed
  (`pac code add-data-source -a dataverse -t ben_ltksitesettings`), typed
  field in use. Proven end-to-end with a write → read-back → revert on the
  branding row (204/match/204, net-zero change).

## Phase 4 — LinkCard (and link policy removal)

Goal: one explicit, traceable card type for "show a card from another board".

1. **Registry**: new `CardSpec` — type `LinkCard`, label "Linked card",
   new group **Reference** (appended to `CARD_GROUPS`), description "Shows a
   card from another board, read-only — a live window that makes linkages
   between meetings traceable."
   Config: `sourceBoardId` + `sourceCardId` (bespoke pickers in the editor,
   reusing the boards-manifest feed the action surfaces already use) and
   `showCaption` (boolean, default on — "from *board* · *card title*" under
   the title bar).
   Picker exclusions for the source: EmbedCard (v1 — embed frames have their
   own lifecycle; use an EmbedCard with the same URL instead), ActionBoard /
   EscalationViewer (they already have source pickers), MeetingScheduler,
   and LinkCard itself (**no chains** — plus a runtime guard that renders a
   note instead of recursing if data contains one anyway).
2. **Mounter** (app cardRegistry): resolve the source board's manifest → find
   the slot (its cardType, title, settings) → resolve content:
   - series-backed or shared source → the source's **live row** (and series
     read with the SOURCE board/card ids — which finally makes linked series
     cards work);
   - carry/clear source → the source's **newest instance row**, falling back
     to its live/template row.
   Mount the target card type with the source's settings and ids,
   **read-only with no-op writes** (the mountTile contract for tiles; the
   focused view mounts readOnly without the pointer-events kill so long
   registers still scroll).
3. **Seeding/archive** (policies.ts, instances.ts): LinkCard takes no
   document seed; each instance gets an empty row as an archive target, and
   **close-meeting stamps the SOURCE's current tile svg** onto it — the
   permanent record of what the linked card showed at that meeting.
4. **Live tiles**: the live renderer mounts LinkCard like any other type
   (async resolve inside the mount). Stored mode uses the archived svg, and
   catalog art before the first close. Regenerate `tools/tile-defaults.json`
   and bump `APP_VERSION` so the catalog heals (LinkCard's empty state —
   "Choose a source card" — becomes its default art).
5. **Link policy removal**: migrate every Phase-0-found `policy:"link"` slot
   to a LinkCard (`board.source` → config source keys; same cardId kept so
   nothing else moves). Then remove `link` from `slotPolicy`, `seedPlan`,
   the BoardDraft type and the editor. `parseDraft` still tolerates the key
   on old blobs (lossless), it just no longer means anything.
6. Traceability note for later (not built now): LinkCard makes linkages
   queryable — a manifest scan can list every cross-board reference.

Tests: source resolution matrix (shared/series/carry sources); no-chain
guard; migration transform; archive stamping; policies.ts updated tests.

- [x] DONE 2026-07-25. LinkCard registry entry (Reference group, `policies:
  []` = no-document declaration), editor Source section (board/card pickers,
  LINK_SOURCE_EXCLUDED filtered), app mounter that mounts the SOURCE's card
  type with the source's ids/settings — read-only, no-op writes, optional
  "from board · card" caption; content per pickLinkContent (shared → live
  row; carry/clear → newest non-empty instance row, template fallback).
  Seeding creates an empty archive-target row; close stamps the SOURCE's
  live tile svg (ArchiveStamp.from). Link policy removed from slotPolicy /
  seedPlan / BoardDraft / the editor; stored "link" parses to default.
  Production migration: both legacy no-op link slots stripped (204s) —
  zero link policies remain. tile-defaults regenerated (20 tiles, LinkCard
  placeholder art), APP_VERSION → 0.1.2. Proof: 188 vitest green, builds
  clean, policy-matrix.html ALL PASS (incl. no-doc note + Source pickers +
  link-retired parse check). Focused view of a closed meeting shows live
  source content read-only — consistent with shared cards; the archived
  record is the stamped tile image, as elsewhere. Hosted checks for Ben:
  a LinkCard against a real register/series card, and an archive stamp at
  close.

## Phase 5 — Config conformance sweep

Goal: the remaining format-in-document stragglers, smallest first.

1. **ParetoCard `unit` → config** (text field), document value as fallback —
   exactly the KpiTrendCard precedent. Categories stay in-card (decided).
2. **BenefitEffort quadrant labels → config**: four text fields
   (`quadTL/quadTR/quadBL/quadBR`), prompts-hint values as fallback so
   existing cards keep their labels. Help text on the prompts field stops
   advertising the hint mechanism for quadrants.
3. ConditionsCard `asOfDate` help text clarified: "overrides the meeting-date
   window — for pinned reviews".

Tests: fallback order per card (config wins, doc/hint fallback).

- [x] DONE 2026-07-25. Pareto gained a real `unit` config (the envelope
  field existed but was never rendered anywhere — it now shows in bar
  tooltips and the edit dialog's Count label, document value as fallback);
  BenefitEffort quadrant labels are four config fields resolved
  config → prompt hint → classic default (verified through the real
  mounter: config corners win, unset corners keep defaults); Conditions
  asOfDate help now says it overrides the meeting-date window. setUnit /
  setQuadrantLabels added to the mounter-wiring guard. 191 vitest green.

## Phase 6 — Docs, release, deploy

1. Update `docs/master-leanboard.md`: the policy matrix, the site palette,
   LinkCard semantics (incl. archive behaviour), the settings model
   (format=setup / content=board / structural-content exceptions).
2. Full verification: root `npm run typecheck`, app `npx tsc --noEmit`,
   `npx vitest run`, `npm run build`; dev-harness pass over the composer,
   a series board, a StatusTile board, and a LinkCard pointing at a shared
   register. Ben's hosted checks: palette column reads, LinkCard against
   real boards, close-meeting archive stamp.
3. `./release.sh <version>` + tag push; `pac code push` from `app/`.

- [x] DONE 2026-07-25. master-leanboard.md updated: per-type policy matrix
  (link retired, LinkCard semantics incl. the source-svg archive stamp),
  series cards implicitly shared, clear = standard content, and a new
  "settings model" section (format=setup / content=board / structural
  content exceptions; titlebar-only Appearance; app-level state palette).
  Released v0.15.0 and pushed.

---

## Assumptions (flag if wrong)

1. The card-level customisation that stays is the **title strip colour**
   (the message trailed off — this matches the review's recommendation).
2. LinkCard v1 excludes EmbedCard sources; an EmbedCard with the same URL
   covers that case.
3. Palette starter keys `good/issue/atrisk/info/neutral` are acceptable seeds
   (site admins can rename/recolour).

## Later / out of scope

- Board-level theme identity (board-wide default title-strip colour).
- "Referenced by" view — reverse listing of LinkCard sources per board.
- ActionBoard non-persistent in-card view flip.
- Focused-view interaction polish for LinkCard targets (zoom clusters etc.).

---

## Phase 7 — title-strip palette (added 2026-07-25)

Ben: the card title colours should ALSO come from a controlled palette,
managed in Settings → Branding. Kept SEPARATE from the state palette —
title strips are association/brand colours; state colours are semantics
(recolouring "Issue" must never repaint title bars).

1. `ben_titlepalette` (memo) on sitesettings via the schema pipeline;
   branding row storage, typed model.
2. shared/palette.ts: `defaultTitlePalette()` starter set; parse accepts a
   defaults parameter.
3. Branding tab: a second "Title strip palette" block, same editor.
4. CardSettings: the Appearance "Title strip" field becomes a select over
   the title palette (new `titleColor` field kind); legacy freeform hex
   shows as "(custom)" and keeps rendering.
5. Runtime: every `theme.titlebar` read resolves through the title palette
   (board, cardEditor, composer, tiles join barColor) — keys resolve, hex
   passes through, deleted keys fall back to no strip.

- [x] DONE 2026-07-25. `ben_titlepalette` deployed (schema pipeline, one
  component created; model regenerated, typed). shared/palette.ts:
  `defaultTitlePalette` (navy/brick/olive/teal/plum/slate), parsePalette
  gained a defaults param, and `titleStripColor()` is the single resolver
  every titlebar read now goes through (board live renderer + tiles-join
  barColor + walk-view tabs + cardEditor + composer previews). Branding
  tab renders both palettes via one reusable block, saved together
  (`appPalettes`/`saveAppPalettes`, one row read). The Appearance "Title
  strip" field is a `titleColor` select over the title palette — stores
  the KEY; legacy hex shows as "(custom)" and keeps rendering. Proof: 193
  vitest green, builds clean, palette-audit ALL PASS + live checks
  (select offers palette, pick stores key, joinTiles resolves key→colour,
  legacy hex honoured).
