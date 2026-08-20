# LeanBoard visual UI standard

The app's design vocabulary as actually built (audited 2026-08-20 after
drift crept into the Improvement/Priorities work). This is the reference
for any new surface; deviations are bugs unless the design record says
otherwise. Keep it current: a deliberate new pattern updates this page in
the same commit.

## 1. Foundations

- **Font**: `"Segoe UI", system-ui, sans-serif`. Body 13–13.5px;
  meta/help 12–12.5px; tiny labels 11–11.5px.
- **Canvas**: warm neutrals. Ink `#26241f`; muted ink `#6d675c`; faint
  `#a39c90`. Surfaces: page white; panel `#faf9f7` / `#f4f1ea`; borders
  `#ece8e0` (hairline) / `#e4dfd6` (card) / `#d9d3c8` (control).
- **Accent**: `var(--app-accent)` (site branding; default `#2563eb`).
  Links, focus rings, primary-ish emphasis. NEVER hard-code an accent.
- **State colours** (Good / At risk / Issue / Info / Neutral) come from
  the SITE STATE PALETTE (`appPalettes().states` → `paletteMap`), keys
  `good` / `atrisk` / `issue` / `info` / `neutral`. Cards and screens
  store KEYS and resolve colours at render (`ragPaletteKey` maps
  green→good, amber→atrisk, red→issue, grey→neutral). **Never hard-code
  a state hex.** The two amber/red text tints used for prose warnings
  (`#7a4d00` on `#fff7e0`, `#b3261e` on `#fdecea`) are NOTE surfaces,
  not data states.
- **The one sanctioned fixed set**: PDCA tokens (Plan amber · Do blue ·
  Check green · Act purple, `PDCA_TOKENS`) — app-wide by design
  decision 5; they identify cycle position, not performance.
- **Sentence case everywhere.** All-caps only for tiny section labels
  (11px, `letter-spacing: 0.04–0.06em`, muted).
- **Touch**: interactive targets ≥44px on TV/touch surfaces; ≥30px
  minimum elsewhere. Status is always glyph/word + colour, never colour
  alone.

## 2. Controls

- **Buttons**: `.app-btn` (outline, white, hover accent), primary =
  `.app-btn-primary` (accent fill; the dark `#26241f` fill is reserved
  for overlay-rail primaries), danger = `.app-btn-danger`. Text-links =
  `.app-link` (accent, hover underline). **One solid primary per
  surface.** Secondary actions go behind a kebab `⋮`.
- **Inputs/selects**: `.app-input` (app screens) / `.ltk-mw-input`
  (wizard shells). Labelled filters use a small caps label above the
  control (`.app-im-filter` pattern), not a bare select.
- **Chips**: pill radius 999px. Filter/tag chips outline `#d9d3c8`,
  selected = dark fill `#26241f` white text. People = initials circles
  (`.app-ib-avatar` / owner chips). Status chips tinted bg + strong fg.
- **Toggles**: `.app-tw-toggle` (self-updating). Segmented controls:
  `.app-cp-seg` with `.app-cp-seg-on` dark fill.
- **Kebab menus**: `.app-cp-menu` fixed popover, `.app-cp-menu-h` small
  caps section heads, ●/○ prefix for radio-ish items.

## 3. Page anatomy (the Documents register is the reference)

1. **Title block** left: bold 20–22px scope title, muted subtitle,
   muted "n matching" count.
2. **Action cluster** right: solid primary (`＋ …`), outline `Filters`
   (badged `Filters · n` when active), `List | Tiles` segmented, `⋮`.
3. **Filters behind the button**, opening a labelled panel row on
   `#faf9f7`, never a bare strip of selects.
4. **Tables**: a muted column-header row (12px, `#6d675c`, hairline
   bottom border), then FLAT rows with hairline dividers (`#f1efec`)
   and a subtle hover wash `#faf9f7` — not bordered card rows. A 4px
   left status edge is allowed where the design specifies it (the one
   full-strength state colour on a row).
5. **Group heads**: quiet 14–15px bold labels with counts; the divider
   belongs to the column-header row beneath, not a heavy rule.

## 4. Overlays, dialogs, wizards

- **Detail overlays** (Documents/Priorities pattern): scrim
  `rgba(20,20,20,.5)`, white 12px-radius sheet, header (chip · title ·
  meta · boxed ✕), left tab strip + body, right rail on `#faf8f4` with
  small-caps section heads, bottom-anchored stacked full-width buttons —
  one solid primary, `⋮ More` as a centred text link. Esc + scrim close;
  scroll/context restored on close.
- **Centred modals**: `.app-modal-overlay`/`.app-modal` (440px;
  `.app-modal-wide` = min(92vw, 1080px)), title 17px bold, muted note,
  footer Cancel text-link + primary. Reason picklists = chip rows
  (`.app-cp-reason`, selected dark).
- **Wizards** (meeting + template): accent title bar with ✕, numbered
  step strip (✓ on done, filled current), 620px centred column, step
  title 18px bold + one-line purpose, footer `‹ Back · Step n of N ·
  Next: <name> ›`. Board-design steps widen via `.ltk-mw-boardhost`.

## 5. Cards & tiles

- Board tiles: title chip strip (per-tile colour from the TITLE palette
  — a separate palette from states, never mixed), optional stage chip
  (PDCA tint) and 2px accent ring for current-stage. Tile snapshots must
  read as static images — no hover-only state.
- Matrix/list cards: 4px status edge + 13.5–14px semibold statement +
  muted meta lines. Tallies are symbols (`✓ ! ✕`) with zeros muted.

## 6. Settings surfaces

- Tabbed sections; `h3.app-pr-h3` section titles + `.app-settings-note`
  intro line. Editable lists = the org editor's row look: `#faf9f7`
  rounded rows, ⠿ drag handle, red `×` (`.app-org-x`), input + `＋`
  adder row (`.app-org-row`). Owner chips = `.app-owner`.

## 7. Known drift log (fix on sight)

- ~~Improvement tab/tiles hard-coded RAG hexes~~ — fixed 2026-08-20
  (now resolved through the site state palette like Priorities).
- `walk.ts` / `lifecycle.ts` fall back to `#9a948a` for grey edges —
  acceptable as the neutral fallback but prefer `palette.neutral`.
- Chip class reuse across modules (`app-cp-*` used by Improvement) is
  fine for identical patterns; fork the class the moment behaviour or
  look diverges.
