# LeanBoard v3 — Rituals

Ben's seven-point brief (2026-07-20) reviewed against the codebase, with
challenges resolved and the slice plan. Follows the v2 plan's format.

## Review & decisions

### 1. Rebrand "Boards & meetings" → Rituals
- Settings tab becomes **Rituals**; the My day tab becomes **Rituals**;
  the rituals list is the board directory.
- **Challenge — how far does the word go?** "Board" stays for the tile
  wall itself (Meeting board, board grid); *ritual* = the recurring
  meeting + its board as a unit. A full "board"-ectomy would rename
  Dataverse tables and PCF controls for zero functional gain.
- LeanHub is a shared toolkit control: its "Boards" tab label must stay
  generic for standalone makers. `setBoards()` gains an optional label
  param (default "Boards"); LeanBoard passes "Rituals".

### 2. Ritual category colours
- Storage: `ben_meetingcategories` (app row) goes from `["Daily"]` to
  `[{name, color}]`. Parser accepts both shapes; saving writes the new
  one. No schema change.
- Single source of truth: colour lives on the category, so recolouring
  a category recolours every ritual using it.
- Surfaces: category swatch chips in Settings → Rituals; colour chip /
  left border on the hub calendar entries and the rituals list; the
  rituals rows in Settings. LeanHub gains a `color` on its meeting and
  board entries (small, backward-compatible API addition); the app
  resolves category → colour and passes it through.
- Wizard's category select is name-based and unaffected.

### 3. Wizard ends at the meeting board
- **Challenge — embed vs flow.** Embedding BoardGrid inside the
  MeetingWizard PCF nests two toolkit controls and bloats the wizard
  for standalone users. Instead the APP owns the flow: wizard submit →
  route to the composer screen (retitled **Meeting board**) with a
  "Step 2 of 2 — design the meeting board" note. Same UX, no control
  surgery.
- Default board: `saveMeetingBoard` seeds a NEW board's manifest with
  **2 columns, Agenda + Actions (ActionBoard)** instead of the current
  empty grid — so even a maker who bails at step 2 gets a working
  board.
- Editing an existing meeting does not redirect.

### 4. Wizard edit-mode UX
- MeetingWizard gains a mode: submit label **Create meeting** (create)
  vs **Save changes** (edit); in edit mode the button stays disabled
  until something changed.
- The control already fires `onChange(draft)` — the app tracks dirty
  from it and registers the shell leave-guard, so leaving the wizard
  with unsaved edits prompts Save / Discard / Cancel (same dialog as
  Settings; `promptUnsaved` moves to a shared app module).

### 5. Card picker groups + renames + hide scheduler
- `CardSpec` gains `group`; the picker renders grouped sections (search
  filters across all groups). `MeetingScheduler` gains `hidden: true` —
  never offered, still resolvable for existing data.
- Renames are **display labels only** — `ben_cardtype` values and
  control names are untouched, so existing boards and archives are
  unaffected. Labels propagate wherever a raw type shows today
  (composer pane, card editor title fallback, hub source labels) via
  `cardSpec(type).label`.
- **Challenge — duplicates.** The brief lists ActionBoard and
  EscalationViewer in two groups. One home each reads better in a
  grouped picker. Proposed grouping (flag if wrong):
  - **Rituals**: Agenda, Capture
  - **Action management**: Actions (ActionBoard), Escalation viewer
  - **Performance**: SQDPC, Winning conditions (ConditionsCard),
    KPI trend, Status tile, Heatmap, Pareto, Embed
  - **Problem solving**: Process map, Five whys, Fishbone, Fault tree,
    Benefit / effort (unassigned in the brief — it's countermeasure
    prioritisation, so it lives here)
  - **Project management**: RACI, Risk management (RiskMatrix),
    Skills matrix

### 6. Theme section last
- CardSettings section order becomes: Card type, Common,
  Configuration, Board/New-instance, **Theme** (was after Common).

### 7. Board-screen editing surface
- The **Board setup** button leaves the board toolbar entirely.
  Standard-board design is managed from Settings → Rituals (Meeting
  board) and the wizard's step 2.
- **Adjust this meeting** stays, gated ONLY by the meeting's
  `instancesAdjustable` toggle + an open record — independent of admin
  status (already true today).

## Slices

### Slice R1 — Rituals rebrand + category colours (M) — DONE 2026-07-20
Settings tab + hub tab labels (LeanHub label param), category
{name,color} storage + swatch UI, colour propagation to hub calendar /
rituals list (LeanHub color support), string sweep.

### Slice R2 — Wizard flow (M) — DONE 2026-07-20
Default 2-column Agenda+Actions seed; submit → Meeting board step with
step banner; composer retitle; edit mode = Save changes + disabled
until dirty + leave-guard prompt; Board setup button removed from the
board toolbar; promptUnsaved extracted to a shared module.

### Slice R3 — Card picker + settings polish (M) — DONE 2026-07-20
Grouped picker with display renames; MeetingScheduler hidden; label
propagation app-wide; Theme section moved last.

Order: R1 → R2 → R3 (independent; R3 touches the same CardSettings
surface R2's step-2 flow leans on, so it goes last).
