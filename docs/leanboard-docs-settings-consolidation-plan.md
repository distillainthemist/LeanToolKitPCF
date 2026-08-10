# Standard Documents — settings consolidation plan

Review requested by Ben, 2026-08-02: if every document library draws on
the same **site columns** and the same **term sets**, the column mapping
should be done once, and each term set should be colour-coded once —
today status colours can only be set library by library.

This document is the critical review, the proposed model, further
enhancements that follow from it, and a phased plan with a verification
gate per phase.

---

## 1. What exists today

**Storage** — Dataverse table `ben_ltkdoclibrary`, one row per exposed
library plus a reserved `__app__` row.

| Where | Holds |
| --- | --- |
| `__app__` row | `siteUrl`, `termGroupId/Name`, `orgSetId/Name` |
| per-library row | `listId`, `siteUrl`, `name`, `libType`, and a `config` blob |
| per-library `config` | `title`, `columns[]`, `statusColors{}`, `renditionPath` |
| per column | `internal`, `label`, `available`, `inDefault`, `role`, `termSetId` |

**Settings IA** — three sections: SharePoint connection → Libraries (a
panel per library carrying columns + status colours + rendition) → Term
store (term group, Organisation set, search-filter diagnostic, org drift
report).

**Roles** — 23 document-management roles (`documentId`, `owner`,
`status`, `effectiveDate`, …). `suggestRoles()` fills unset roles from
exact `DMS*` internal names; `seedDefaultColumns()` ticks a starter view
per library type; `mergeColumns()` reconciles stored config with the
live SharePoint schema on every settings load.

---

## 2. Critical review

### F1 — The unit of configuration is wrong (the core issue)

`ColumnConfig` is stored **per library**, but its contents describe a
**site column**: `internal` is a site-wide name, `role` is a property of
the column's meaning, `termSetId` belongs to the column's term set, and
`label` is an organisation-wide display preference. Only `available` and
`inDefault` are genuinely about one library's *view*.

With three libraries this is 3× the same mapping, entered by hand, with
nothing detecting divergence. At ten libraries it is unmanageable, and
the failure is silent: the register simply shows different things in
different libraries with no warning that a role was missed.

### F2 — Multi-library browse is measurably degraded by F1 (not cosmetic)

`docsScreen.ts` derives every metadata decision from `current`, which is
**null whenever more than one library is selected**:

```ts
const current = favMode || selectedIds.length !== 1 ? null : byListId.get(...)
```

Consequences when the user ticks two or more libraries — the mode Ben
specifically asked for and we shipped in v0.26/v0.27:

- `buildColumns()` is wrapped in `if (current)`, so the register falls
  back to **Document / Library / Modified only**: no status, owner,
  document type, effective date.
- `statusChip()` and `applyNonCurrent()` need `statusCol`, which is null
  → no status chips, and the drafts-hidden rule stops applying.
- `fieldsFor()` only requests DMS fields for the library that *is*
  `current`, so the data layer does not even fetch them.

This is visible in the live app today: single-library shows five
columns, "All libraries" shows three. A site-level dictionary removes
the cause rather than patching each symptom — there is a coherent answer
to "what does this column mean" that does not depend on which library a
row came from.

### F3 — Colours are keyed by label, per library, and only for status

`statusColors: Record<string, string>` maps a **display value** →
palette key, inside one library's config. Three problems:

1. **Duplicated**: the same term set colour-coded once per library, free
   to disagree ("Approved" green in Standards, amber in Records).
2. **Brittle keys**: keyed by label text. Rename a term and the colour
   silently detaches; two term sets sharing a label collide — we already
   have two distinct `Maintenance` terms in the Organisation set.
3. **Status only**: importance, confidentiality, document type and tags
   are equally colour-worthy in the register and tiles, and cannot be
   coloured at all.

### F4 — Term sets are second-class citizens

The app knows about exactly one term set by name (Organisation, for the
folder tree). Every other set is reachable only as a `termSetId` cached
on a column inside a library. There is nowhere to say "this is the
Approval status set, here is its palette, here are its glyphs" — which
is precisely what Ben is asking for.

### F5 — Glyphs are hardcoded where colours are configurable

`statusGlyph()` in `shared/ui/format.ts` keyword-matches (`/approved|
current|published/` → ✓). A site whose vocabulary is "Issued" or
"Live" gets no glyph, while its colour is configurable. Since the design
rule is *glyph + word, never colour alone*, the configurable half and the
hardcoded half are the wrong way round.

### F6 — No validation, no drift report for columns

Nothing warns that a library has two `status` columns, or no `owner`, or
that Records maps `DMSDocumentType` → *Document type* while Working
Documents leaves it unmapped. The Organisation term set already has a
drift report; columns deserve the same treatment.

### F7 — The per-library panel carries site-level furniture

Each library panel repeats the full column table and colour editor, so
the settings tab grows linearly with libraries. The genuinely
per-library decisions are few: type, title override, which columns show
in its view, rendition path.

### F8 — Site scope is ambiguous

`AppDocsConfig.siteUrl` is single, but every library row carries its own
`siteUrl` — so multiple sites are structurally possible while the term
store config assumes one. Any dictionary must decide whether it is
per-tenant or per-site before it is written, not after.

---

## 3. Proposed model

Three layers, resolved at read time so consumers keep seeing one shape.

### 3.1 Site column dictionary (new, app-level)

```ts
interface SiteColumn {
  internal: string;      // identity, the site column's internal name
  label: string;         // display override, "" = SharePoint's title
  role: string;          // one of COLUMN_ROLES
  available: boolean;    // offered in the column picker anywhere
  termSetId: string;     // cached from the live schema
  kind: "text" | "choice" | "taxonomy" | "person" | "date" | "number" | "bool";
}
```

Discovered by union across every exposed library, seeded by
`suggestRoles()` exactly as today. **One row per column, not per
library-column.**

### 3.2 Term set palettes (new, app-level)

```ts
interface TermPalette {
  setId: string;
  setName: string;
  entries: Record<string, { color: string; glyph: string; label?: string }>;
  //        ^ keyed by TERM GUID for taxonomy, by exact choice text for
  //          Choice columns (which have no GUIDs)
}
```

Applies wherever that set is used — status, importance, confidentiality,
document type — in the register, tiles, overlay and board cards.
Addresses F3, F4 and F5 in one structure: `glyph` defaults to the
current keyword matcher, so nothing regresses if left blank.

### 3.3 Library view config (slimmed)

```ts
interface LibraryConfig {
  title: string;
  renditionPath: string;
  view: { columns: string[] };        // internal names, ordered
  overrides?: Partial<SiteColumn>[];  // advanced escape hatch, badged in UI
}
```

### 3.4 Resolution rule

```
resolveLibrary(lib, dictionary, palettes) → LibraryConfig (today's shape)
```

One pure function, unit-tested, called by `docsConfig()`. Every consumer
(`docsScreen`, `docsCards`, `viewer`, `exportRegister`) keeps its current
interface — which is what makes this a large change to *settings* and a
small change everywhere else.

Per-library defaults come from a **type template** (standard / record /
working / revision / template), so a newly exposed library is configured
the moment its type is chosen.

---

## 4. Settings information architecture

| Today | Proposed |
| --- | --- |
| SharePoint connection | **Site** — URL, term group, Organisation set |
| Libraries (panel each: type, title, columns, colours, rendition) | **Document columns** — one table: column, label, role, available, term set → palette link |
| Term store (group, org set, diagnostics, drift) | **Term sets & colours** — a palette editor per set in use (colour + glyph per value) |
| | **Libraries** — type, title, view columns (ticked from the dictionary), rendition path |
| | **Health** — column drift, unmapped roles, stale colours, search-filter diagnostic, org drift |

The existing search-filter diagnostic and org drift report move into
Health rather than being rewritten.

---

## 5. Further enhancements this unlocks

1. **Fix multi-library rendering (F2)** — with the dictionary, the union
   register renders status, owner and type for every row regardless of
   which libraries are selected, and `fieldsFor()` can request the right
   fields per library.
2. **Role validation** — "Approval status is mapped twice in Controlled
   Records", "Owner is not mapped" — shown in Health and beside the
   offending row.
3. **Column drift report** — mirrors the org drift report: which
   libraries lack a dictionary column, which columns exist in only one
   library, where an override disagrees.
4. **Type templates** — expose a library, choose "Controlled records",
   get the right view columns immediately; changing a template offers to
   apply it to libraries still on defaults.
5. **Glyph vocabulary per term** (F5) — completes the accessibility rule
   for site-specific vocabularies.
6. **Palette reuse across the app** — status colours currently come from
   the app state palette (`appPalettes()`); term palettes should draw
   from the same source so a document status and a board status of the
   same name look the same.
7. **Stale-value cleanup** — the per-library editor already surfaces
   colours mapped to values a column no longer offers; centralised, this
   becomes one list instead of N.
8. **Smaller rows, fewer writes** — the per-library blob shrinks to a
   handful of fields, and a role change is one write instead of N.

---

## 6. Migration (non-destructive)

1. On first load after upgrade, build the dictionary from the **union**
   of existing library configs. Per column: majority wins on `role` and
   `label`; any disagreement is recorded and badged for review rather
   than silently resolved.
2. Build palettes from existing `statusColors` maps, resolving labels →
   term GUIDs via the term set behind each status column. Labels that
   cannot be resolved stay as text keys (valid for Choice columns) and
   are listed in Health.
3. Keep reading the old per-library shape until the admin presses
   **Adopt** in the new Document columns section; until then
   `resolveLibrary()` prefers the library's own values, so an
   un-migrated deployment behaves exactly as it does today.
4. Old fields stay in the JSON for one release, ignored once adopted —
   a rollback needs no data repair.

---

## 7. Phased plan (verification gate after each)

| Phase | Scope | Verify |
| --- | --- | --- |
| **C0** | Model + `resolveLibrary()` + migration read path. No UI change. Unit tests for resolution, union-build, conflict detection. | Documents area behaves identically; tests green |
| **C1** | Settings: **Document columns** section (dictionary table, roles, labels, available, conflict badges) + Adopt. Library panels lose their column table. | One column table configures every library; a role change lands everywhere |
| **C2** | **Term sets & colours**: palette editor per set, keyed by term GUID, colour + glyph, drawn from the app state palette. Per-library `statusColors` migrated and retired. | Status colours set once show in all libraries; importance/type colourable |
| **C3** | Consumers: register/tiles/overlay/cards read resolved config; **multi-library register renders full columns** (fixes F2). | "All libraries" shows status, owner, type; chips coloured |
| **C4** | **Health** section: column drift, role validation, stale colours; existing search + org drift reports moved in. | Each check reports truthfully against dev's three libraries |
| **C5** | Type templates + apply-to-libraries; per-library override UI behind "Advanced" with badges. | New library configured by choosing its type |

Phases C0–C2 deliver Ben's two explicit asks; C3 pays the debt they
expose; C4–C5 are the consistency work that keeps it correct.

Estimated shape: C0 and C3 are the code-heavy phases, C1/C2/C4 are
settings UI, C5 is small. `exportRegister` and `docsCards` still ride the
legacy `browsePage`/`FieldValuesAsText` path (a known follow-up) — C3 is
the natural moment to migrate them onto RLDAS and the resolved config.

---

## 8. Decisions (settled by Ben, 2026-08-02)

1. **Dictionary scope: per SharePoint site**, keyed by `siteUrl`. Stored
   as a map on the `__app__` row so a second site simply adds a key
   (`ben_configjson` is memo(200000) — a 30-column dictionary with
   palettes is a few kB, no pressure).
2. **The dictionary is absolute — no per-library overrides.** `overrides`
   is dropped from `LibraryConfig` entirely; §3.3 above stands minus that
   field. Consequences accepted, and the pressure valve is the view:
   - A column meaning something different in one library must change for
     all — the answer is to fix the site column, not fork the mapping.
   - What stays per library is **which columns appear in its view**, so a
     column irrelevant to one library is simply not ticked there.
   - A library that does not carry a dictionary column just never renders
     it; no error, no special case.
3. **Palette source: the app state palette**, the same one board statuses
   draw from, so a document status and a board status of the same name
   look identical. Freeform colour only if asked for later.
4. **Migration is silent — no Adopt step.** Because nothing gates it,
   three properties are required of the implementation rather than
   optional:
   - **Read-time and pure.** `resolveLibrary()` runs on every read and
     writes nothing; the dictionary is persisted only when an admin saves
     in Settings. No background writes, and no write-permission surprises
     for ordinary users.
   - **Deterministic conflict resolution.** Per column, majority wins on
     `role` and `label`; a tie resolves to the alphabetically-first
     non-empty value so the same inputs always give the same answer.
   - **Nothing lost silently.** Every conflict the migration resolved
     stays visible in Health (C4), and the old per-library JSON is
     retained for one release, so a rollback needs no data repair.

---

# Part II — the column model, completed (Ben, 2026-08-10)

Part I moved column MEANING to the site dictionary but ruled that
`available`/`inDefault` were "genuinely about one library's view" and
kept them per-library, seeded by type templates (C5). Ben's review:
that unit was wrong too. Libraries of the same TYPE should look the
same — nobody ever configured two standards libraries differently
except by accident, which is why the templates and the drift checks
exist. The remaining per-library column config, the type templates and
the dictionary's flags collapse into ONE manager.

## The model

Each site column carries, site-wide:

1. **Order + group.** The dictionary's array order IS the order —
   drag-and-drop, with columns grouped under sub-headings. Order feeds
   the register (flattened — a table cannot render sub-headings, so
   groups are ORDERING there) and the dialogs (the add form, Edit
   properties and the viewer's properties pane render each group as a
   real section header).
2. **`filterable`** — site-wide, as today (the filter pane is
   cross-library).
3. **A per-TYPE three-state cell** — the review's one merge: "relevant
   per type" and "in the default view" as separate axes cannot express
   real intents without becoming a matrix, so they ARE the matrix, one
   control: each column × type is **hidden / available / in default**.
   Three types get cells (standard / record / working); revision
   libraries mirror standard automatically, template libraries stay
   fixed (name + modified). `available` is DERIVED — a column hidden
   for every type is unavailable, one fewer flag to keep honest.

**Resolution rules** (pure, model.ts, shared by screen and cards):
- register defaults for a view = cells reading *default* for ANY type
  in view, dictionary-ordered ("Modified" appended as today);
- offered in the chooser/filters = *available-or-default* for any type
  in view (∧ `filterable` for the filter pane);
- dialog sections for a library = its type's non-hidden columns, in
  group order.
- Saved views, shared links and the per-user chooser are UNTOUCHED:
  `DocView.columns` still beats the default; only the default's source
  changes.
- The site defines INTENT; the library stays REALITY: feeds keep
  intersecting with what each list carries (the RLDAS-400 guard), and
  Health reports a library missing a column its type considers
  relevant — nothing fails.

**Storage** (sparse, on the existing dictionary — old payloads keep
parsing, the standing rule):

```ts
interface SiteColumn {
  internal; label; role; termSetId; filterable;
  group: string;                       // sub-heading ("" = ungrouped tail)
  types?: { standard?: S; record?: S; working?: S };  // S = "on" | "default"
  // absent type key = hidden; legacy `available` still parsed
}
interface SiteDictionary { columns: SiteColumn[]; groups: string[]; }
```

**Migration** (silent, read-time derive + persist on first admin save,
Part I's rules): per column × type, *default* if any library of that
type has `inDefault`, else *on* if any has `available`, else hidden.
Union widens, never narrows; what it derived stays visible in Health;
per-library configs go DORMANT (never destroyed — `mergeColumns` keeps
refreshing carried facts and termSetIds from the live schema).

## Settings information architecture

Libraries move to the TOP (Ben's first ask). The per-library panel
slims to what is genuinely per-library: type, title, rendition path,
staging flag. Then **Document columns** — the one manager: draggable
rows under draggable group headers; each row = label · role select ·
filterable toggle · three type cells · palette link for taxonomy
columns. The C5 template picker and the per-library column grid
RETIRE from the UI. Term sets & colours, Access control, Lifecycle and
Health follow as today.

## Phases

- **S0 — model + migration (pure).** Dictionary fields, sparse
  serialization both ways, `columnsForTypes` / `defaultColumnsFor` /
  `dialogSections` / `deriveTypeStates`, tests incl. old-payload
  round-trips.
- **S1 — the manager UI + IA reorder.** dragList-based rows and group
  headers; the three-state cells; Libraries section to the top;
  role/palette entry points absorbed into the manager.
- **S2 — consumers.** Screen `defaultInternals` and the docs card's
  defaults onto `defaultColumnsFor` (one source, both surfaces); add
  form / Edit properties / viewer properties onto `dialogSections`
  (group headers appear); chooser + filter offerings onto the
  availability rule.
- **S3 — retire + health + docs.** Per-library column grid and C5
  template picker removed from settings; health drift check compares
  type relevance vs carried columns; docs swept.

Gates per phase (full ritual; root typecheck untouched unless shared/
moves). Hosted checks (Ben): a saved v0.39 link opens unchanged; a
mixed standards+working view shows the union defaults; the add form
shows group headers; drag reorder reflects in register, dialogs and
export; prod's per-library configs (which DO differ within a type)
derive by union and Health names what widened.
