// Standard Documents — the Settings → Documents tab (plan Phase 1).
// Super-admin surface: connect a SharePoint site, choose which document
// libraries LeanBoard exposes, configure each library's presentation
// (display names, view columns, document-management column roles, status
// colours from the app state palette, rendition location), pick the term
// group / Organisation set, and run the read-only org drift report.
//
// Loaded ONLY by dynamic import from the settings screen — the import
// gate (rule C) fails the build if a static chain ever reaches the
// SharePoint service from outside src/docs/.

import { appPalettes } from "../store/config";
import { el, clear } from "../../../shared/ui/dom";
import { statusGlyph } from "../../../shared/ui/format";
import {
  AppDocsConfig,
  COLUMN_ROLES,
  ColumnConfig,
  DictionaryConflict,
  DriftReport,
  LIBRARY_TYPES,
  LibraryConfig,
  LibrarySchema,
  LibraryType,
  SiteColumn,
  SiteDictionary,
  SpField,
  SpLibrary,
  TermPalette,
  applyViewTemplate,
  buildSiteDictionary,
  colourableSets,
  emptySiteDictionary,
  fieldsFromResponse,
  isDateColumn,
  librariesFromLists,
  mergeColumns,
  orgDrift,
  dictionaryHealth,
  orgTreePaths,
  paletteKeyFor,
  rekeyPaletteToTerms,
  resolveLibraryConfig,
  matchesTemplate,
  seedDefaultColumns,
  siteKey,
  templateFor,
  syncSiteDictionary,
} from "./model";
import {
  fetchFields,
  fetchLibraries,
  fetchTermGroups,
  fetchTermPaths,
  fetchTermSets,
  fetchTermsInSet,
  invalidateTermPaths,
} from "./sp";
import {
  DocLibrary,
  appDocsConfig,
  deleteDocLibrary,
  invalidateDocsCache,
  listDocLibraries,
  saveAppDocsConfig,
  saveDocLibrary,
} from "./docsStore";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { orgJson } from "../store/config";
import { searchPage } from "./data";
import { taxonomySearchProperty } from "./rows";

interface Ctx {
  markDirty: () => void;
  markClean: () => void;
  registerSave: (fn: () => Promise<void>) => void;
}

const note = (text: string) => el("div", "app-settings-note", text);
const section = (text: string) => el("div", "app-section", text);

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const f = el("div", "app-field");
  f.append(el("span", "app-field-label", label), control);
  if (hint) f.appendChild(el("span", "app-field-hint", hint));
  return f;
}

export async function renderDocsSettings(body: HTMLElement, ctx: Ctx): Promise<void> {
  clear(body);
  body.appendChild(el("div", "app-loading-line", "Loading documents configuration…"));

  let app: AppDocsConfig;
  let exposed: DocLibrary[];
  let palettes: Awaited<ReturnType<typeof appPalettes>>;
  try {
    [app, exposed, palettes] = await Promise.all([
      appDocsConfig(),
      listDocLibraries(),
      appPalettes(),
    ]);
  } catch (e) {
    clear(body);
    body.appendChild(
      note(
        "Documents configuration needs the hosted app (Dataverse and the SharePoint " +
          `connection are host-side). ${String(e).slice(0, 160)}`
      )
    );
    return;
  }
  clear(body);

  // ---- buffered state (written on Save) --------------------------------
  const removedRowIds: string[] = [];
  let discovered: SpLibrary[] = [];
  const fieldsByList = new Map<string, SpField[]>();

  const save = async () => {
    await saveAppDocsConfig(app);
    for (const lib of exposed) {
      await saveDocLibrary(lib);
    }
    for (const rowId of removedRowIds.splice(0)) {
      if (rowId !== "") await deleteDocLibrary(rowId);
    }
    // re-read so row GUIDs exist for later deletes
    exposed = await listDocLibraries();
    invalidateDocsCache(); // the #/docs area re-reads on next entry
    invalidateTermPaths(); // a changed group/set must not serve the old tree
    ctx.markClean();
    paintLibraries();
    void paintDictionary();
  };
  ctx.registerSave(save);

  // ---- connection section ----------------------------------------------
  body.appendChild(section("SharePoint connection"));
  body.appendChild(
    note(
      "One site serves all controlled-document libraries. Everything runs as the " +
        "signed-in user — people only ever see what SharePoint already lets them see."
    )
  );
  const siteInput = el("input", "app-input") as HTMLInputElement;
  siteInput.placeholder = "https://<tenant>.sharepoint.com/sites/<site>";
  siteInput.value = app.siteUrl;
  siteInput.addEventListener("input", () => {
    app.siteUrl = siteInput.value.trim().replace(/\/$/, "");
    ctx.markDirty();
  });
  const loadLibs = el("button", "app-btn", "Load libraries") as HTMLButtonElement;
  const siteRow = el("div", "app-docs-siterow");
  siteRow.append(siteInput, loadLibs);
  body.appendChild(field("Site URL", siteRow));

  // ---- document columns: the site dictionary (C1) -----------------------
  // These libraries share SharePoint SITE columns, so what a column is
  // called and what it means belong to the site, not to each library
  // that happens to carry it. Mapped once here; every library follows.
  body.appendChild(section("Document columns"));
  body.appendChild(
    note(
      "Every library on this site draws on the same site columns, so a column means " +
        "the same thing everywhere. Set its display name and document-management role " +
        "once here — each library then chooses only which of them its own view shows."
    )
  );
  const dictBox = el("div", "");
  body.appendChild(dictBox);

  const dictKey = () => siteKey(app.siteUrl);
  const dictionary = (): SiteDictionary =>
    (app.sites[dictKey()] ??= emptySiteDictionary());
  /** What the silent migration had to choose between, for the badges. */
  let migrated: DictionaryConflict[] = [];
  /** internal → the libraries carrying it, from the last dictionary pass. */
  let lastCarriers = new Map<string, string[]>();

  const paintDictionary = async () => {
    clear(dictBox);
    if (app.siteUrl === "" || exposed.length === 0) {
      dictBox.appendChild(
        note("Expose a library below first — its columns are what there is to map.")
      );
      return;
    }
    dictBox.appendChild(el("div", "app-loading-line", "Reading columns from every library…"));
    const schemas: LibrarySchema[] = await Promise.all(
      exposed.map(async (lib) => ({
        listId: lib.listId,
        name: lib.config.title !== "" ? lib.config.title : lib.name,
        fields: await loadFields(lib),
      }))
    );
    clear(dictBox);

    const key = dictKey();
    let dict = app.sites[key] ?? emptySiteDictionary();
    if (dict.columns.length === 0) {
      // first open since the upgrade: adopt what the libraries already
      // say, majority winning, and remember every disagreement so the
      // silent migration is still answerable for its choices
      const built = buildSiteDictionary(exposed);
      dict = built.dictionary;
      migrated = built.conflicts;
    }
    const { dictionary: synced, carriers } = syncSiteDictionary(dict, schemas);
    app.sites[key] = synced;
    lastCarriers = carriers;
    // the palettes section needs the live schema to tell a Choice column
    // from a taxonomy one, and repaints whenever the dictionary does
    liveByInternal.clear();
    for (const sc of schemas) for (const f of sc.fields) liveByInternal.set(f.internal, f);

    if (migrated.length > 0) {
      dictBox.appendChild(
        note(
          `${migrated.length} column${migrated.length === 1 ? "" : "s"} were mapped ` +
            "differently in different libraries. The most common answer was kept — " +
            "the ones marked below are worth a look."
        )
      );
    }

    const grid = el("div", "app-docs-dict");
    grid.append(
      el("span", "app-docs-colhead", "SharePoint column"),
      el("span", "app-docs-colhead", "Display as"),
      el("span", "app-docs-colhead", "Available"),
      el("span", "app-docs-colhead", "Filter"),
      el("span", "app-docs-colhead", "Role"),
      el("span", "app-docs-colhead", "In libraries")
    );
    for (const col of synced.columns) {
      const live = schemas
        .flatMap((s) => s.fields)
        .find((f) => f.internal === col.internal);
      const clash = migrated.filter((m) => m.internal === col.internal);
      if (clash.length > 0) {
        grid.appendChild(
          el(
            "div",
            "app-docs-dictwarn",
            clash
              .map(
                (m) =>
                  `${col.internal}: libraries disagreed on ${m.field} (` +
                  m.values.map((v) => `${v.value === "" ? "—" : v.value} ×${v.count}`).join(", ") +
                  `) — kept “${m.chosen === "" ? "—" : m.chosen}”`
              )
              .join(" · ")
          )
        );
      }
      grid.appendChild(
        el("span", "app-docs-colname", `${live?.title ?? col.internal} · ${col.internal}`)
      );
      const label = el("input", "app-input") as HTMLInputElement;
      label.placeholder = live?.title ?? col.internal;
      label.value = col.label;
      label.addEventListener("input", () => {
        col.label = label.value.trim();
        ctx.markDirty();
      });
      grid.appendChild(label);
      const avail = el("input", "") as HTMLInputElement;
      avail.type = "checkbox";
      avail.checked = col.available;
      avail.title = "Offered in the column picker in every library";
      avail.addEventListener("change", () => {
        col.available = avail.checked;
        ctx.markDirty();
      });
      grid.appendChild(avail);
      // only a column that CAN filter is worth offering as one: a term
      // set to pick from, or a date to bound (Ben, 2026-08-03)
      const canFilter = col.termSetId !== "" || isDateColumn(col);
      const filt = el("input", "") as HTMLInputElement;
      filt.type = "checkbox";
      filt.checked = canFilter && col.filterable;
      filt.disabled = !canFilter;
      filt.title = canFilter
        ? "Offered in the register's Filters pane"
        : "Only managed-metadata and date columns can filter";
      filt.addEventListener("change", () => {
        col.filterable = filt.checked;
        ctx.markDirty();
      });
      grid.appendChild(filt);
      const role = el("select", "app-input") as HTMLSelectElement;
      for (const r of COLUMN_ROLES) {
        const o = el("option", "", r.label) as HTMLOptionElement;
        o.value = r.key;
        role.appendChild(o);
      }
      role.value = COLUMN_ROLES.some((r) => r.key === col.role) ? col.role : "";
      role.addEventListener("change", () => {
        col.role = role.value;
        ctx.markDirty();
      });
      grid.appendChild(role);
      // which libraries actually carry it — a column missing from one
      // library is the quiet kind of drift, so it is stated plainly
      const who = carriers.get(col.internal) ?? [];
      const where = el(
        "span",
        `app-docs-colwhere${who.length < exposed.length ? " app-docs-colwhere-part" : ""}`,
        who.length === exposed.length ? `All ${who.length}` : `${who.length} of ${exposed.length}`
      );
      where.title = who.length > 0 ? who.join(", ") : "No library carries this column";
      grid.appendChild(where);
    }
    dictBox.appendChild(grid);
    paintPalettes();
    paintTemplates();
    paintHealth();
  };

  // ---- term sets & colours (C2) ----------------------------------------
  // One palette per TERM SET, not per library: the same set used by three
  // libraries had three colour maps free to disagree, and they were keyed
  // by label, so renaming a term detached its colour silently.
  body.appendChild(section("Term sets & colours"));
  body.appendChild(
    note(
      "A colour and a glyph per value, set once for the term set — every library " +
        "using that set follows. Colours come from Branding's state palette, so a " +
        "document status and a board status of the same name look alike. The glyph " +
        "carries as much as the colour: status has to read without relying on colour."
    )
  );
  const palBox = el("div", "");
  body.appendChild(palBox);

  /** Live schema by internal name, filled by the dictionary pass — it is
   *  what tells a Choice column from a taxonomy one. */
  const liveByInternal = new Map<string, SpField>();
  /** Term values per set, read once each per settings visit. */
  const termsBySet = new Map<string, Promise<{ id: string; label: string }[]>>();

  const termsInSet = (setId: string): Promise<{ id: string; label: string }[]> => {
    let hit = termsBySet.get(setId);
    if (hit === undefined) {
      hit = fetchTermsInSet(app.siteUrl, setId).then((r) => {
        const rows = Array.isArray((r.data as { value?: unknown[] })?.value)
          ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
          : [];
        return rows
          .map((t) => {
            const labels = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
            const def = Array.isArray(labels)
              ? (labels.find((l) => l.isDefault) ?? labels[0])
              : undefined;
            return { id: typeof t.id === "string" ? t.id : "", label: (def?.name ?? "").trim() };
          })
          .filter((t) => t.id !== "" && t.label !== "");
      });
      hit.catch(() => termsBySet.delete(setId));
      termsBySet.set(setId, hit);
    }
    return hit;
  };

  /** The stored palette for a key, created on first colour. */
  const paletteAt = (key: string): TermPalette => {
    const d = dictionary();
    let p = d.palettes.find((x) => x.setId === key);
    if (p === undefined) {
      p = { setId: key, setName: "", entries: {} };
      d.palettes.push(p);
    }
    return p;
  };

  const paletteCard = (key: string, setId: string, cols: SiteColumn[]): HTMLElement => {
    const box = el("div", "app-docs-palcard");
    const head = el("button", "app-docs-palhead") as HTMLButtonElement;
    const name = cols
      .map((c) => (c.label !== "" ? c.label : (liveByInternal.get(c.internal)?.title ?? c.internal)))
      .join(", ");
    const caret = el("span", "app-docs-palcaret", "▸");
    const count = el("span", "app-field-hint", "");
    const paintCount = () => {
      const n = Object.keys(paletteAt(key).entries).length;
      count.textContent = n === 0 ? "no colours set" : `${n} value${n === 1 ? "" : "s"} coloured`;
    };
    paintCount();
    head.append(caret, el("span", "app-docs-palname", name), count);
    const rows = el("div", "app-docs-palbody");
    rows.style.display = "none";
    let filled = false;
    head.addEventListener("click", () => {
      const open = rows.style.display === "none";
      rows.style.display = open ? "" : "none";
      caret.textContent = open ? "▾" : "▸";
      if (open && !filled) {
        filled = true;
        void fill();
      }
    });

    /** One value's colour + glyph. `entryKey` is the term GUID where
     *  there is one, so a renamed term keeps its colour. */
    const drawRow = (entryKey: string, label: string) => {
      const row = el("div", "app-docs-statusrow");
      row.appendChild(el("span", "app-docs-statusval", label));
      const pal = paletteAt(key);
      const pick = el("select", "app-input") as HTMLSelectElement;
      const none = el("option", "", "— no colour —") as HTMLOptionElement;
      none.value = "";
      pick.appendChild(none);
      for (const p of palettes.states) {
        const o = el("option", "", p.label) as HTMLOptionElement;
        o.value = p.key;
        pick.appendChild(o);
      }
      pick.value = pal.entries[entryKey]?.color ?? "";
      const swatch = el("span", "app-docs-statusswatch");
      const paintSwatch = () => {
        const hit = palettes.states.find((p) => p.key === pick.value);
        swatch.style.background = hit?.color ?? "transparent";
      };
      paintSwatch();
      const glyph = el("input", "app-input app-docs-palglyph") as HTMLInputElement;
      glyph.maxLength = 2;
      // the placeholder shows what the built-in vocabulary would use, so
      // a site only types a glyph where it wants a different one
      glyph.placeholder = statusGlyph(label) || "—";
      glyph.value = pal.entries[entryKey]?.glyph ?? "";
      glyph.title = "Shown before the value; blank uses the built-in match";
      const write = () => {
        const p = paletteAt(key);
        if (pick.value === "" && glyph.value.trim() === "") delete p.entries[entryKey];
        else p.entries[entryKey] = { color: pick.value, glyph: glyph.value.trim(), label };
        paintSwatch();
        paintCount();
        ctx.markDirty();
      };
      pick.addEventListener("change", write);
      glyph.addEventListener("input", write);
      row.append(pick, swatch, glyph);
      rows.appendChild(row);
    };

    const fill = async () => {
      clear(rows);
      rows.appendChild(el("div", "app-field-hint", "Reading values…"));
      let values: { key: string; label: string }[];
      if (setId !== "") {
        const terms = await termsInSet(setId);
        // colours migrated from the old per-library maps are keyed by
        // label; now that the term store has answered, key them properly
        const fixed = rekeyPaletteToTerms(paletteAt(key), terms);
        const d = dictionary();
        d.palettes = d.palettes.map((p) => (p.setId === key ? fixed : p));
        values = terms.map((t) => ({ key: t.id, label: t.label }));
      } else {
        // a Choice column has no GUIDs — its own text is the key
        const choices = cols.flatMap((c) => liveByInternal.get(c.internal)?.choices ?? []);
        values = [...new Set(choices)].map((v) => ({ key: v, label: v }));
      }
      clear(rows);
      if (values.length === 0) {
        rows.appendChild(note("No values could be read for this column."));
        return;
      }
      for (const v of values) drawRow(v.key, v.label);
      // a colour against a value the column no longer offers is invisible
      // and un-removable; C4 reports these, and this clears them
      const known = new Set(values.map((v) => v.key));
      const stale = Object.entries(paletteAt(key).entries).filter(([k]) => !known.has(k));
      if (stale.length > 0) {
        const warn = note(
          `Not offered by this column any more: ${stale
            .map(([k, e]) => (e.label !== "" ? e.label : k))
            .join(", ")}`
        );
        const drop = el("button", "app-btn", "Remove") as HTMLButtonElement;
        drop.addEventListener("click", () => {
          const p = paletteAt(key);
          for (const [k] of stale) delete p.entries[k];
          ctx.markDirty();
          paintCount();
          void fill();
        });
        warn.appendChild(drop);
        rows.appendChild(warn);
      }
    };

    box.append(head, rows);
    return box;
  };

  const paintPalettes = () => {
    clear(palBox);
    const dict = dictionary();
    const sets = colourableSets(dict);
    // Choice columns are colourable too, and only the live schema knows
    // which columns those are
    const choiceCols = dict.columns.filter(
      (c) =>
        c.available &&
        c.termSetId === "" &&
        (liveByInternal.get(c.internal)?.choices.length ?? 0) > 0
    );
    if (sets.length === 0 && choiceCols.length === 0) {
      palBox.appendChild(
        note("Nothing to colour yet — this appears once the libraries above have loaded.")
      );
      return;
    }
    for (const s of sets) palBox.appendChild(paletteCard(s.key, s.setId, s.columns));
    for (const c of choiceCols) {
      palBox.appendChild(paletteCard(paletteKeyFor("", c.internal), "", [c]));
    }
  };

  // ---- view templates (C5) ---------------------------------------------
  // What a library of each type opens with, held once for the site: a
  // newly exposed library is configured the moment its type is chosen,
  // instead of being ticked out by hand every time.
  body.appendChild(section("View templates"));
  body.appendChild(
    note(
      "The columns a library opens with, per library type. A library exposed below " +
        "picks these up as soon as you choose its type; changing a template here can " +
        "be applied to the libraries already using it."
    )
  );
  const tmplBox = el("div", "");
  body.appendChild(tmplBox);
  let tmplType: LibraryType = "standard";

  const paintTemplates = () => {
    clear(tmplBox);
    const dict = dictionary();
    if (dict.columns.length === 0) {
      tmplBox.appendChild(note("Load the libraries below first."));
      return;
    }
    const pick = el("select", "app-input") as HTMLSelectElement;
    for (const t of LIBRARY_TYPES) {
      const o = el("option", "", t.label) as HTMLOptionElement;
      o.value = t.key;
      pick.appendChild(o);
    }
    pick.value = tmplType;
    pick.addEventListener("change", () => {
      tmplType = pick.value as LibraryType;
      paintTemplates();
    });
    tmplBox.appendChild(field("Library type", pick));

    const chosen = new Set(templateFor(dict, tmplType));
    const grid = el("div", "app-docs-viewcols");
    grid.append(
      el("span", "app-docs-colhead", "Column"),
      el("span", "app-docs-colhead", "Role"),
      el("span", "app-docs-colhead", "Opens with")
    );
    for (const c of dict.columns) {
      if (!c.available) continue;
      // a template is about the columns that carry meaning; the rest are
      // still choosable per view, just not worth a template row
      if (c.role === "" && !chosen.has(c.internal)) continue;
      grid.appendChild(
        el(
          "span",
          "app-docs-colname",
          `${c.label !== "" ? c.label : (liveByInternal.get(c.internal)?.title ?? c.internal)} · ${c.internal}`
        )
      );
      grid.appendChild(
        el("span", "app-docs-colrole", COLUMN_ROLES.find((r) => r.key === c.role)?.label ?? "—")
      );
      const box = el("input", "") as HTMLInputElement;
      box.type = "checkbox";
      box.checked = chosen.has(c.internal);
      box.addEventListener("change", () => {
        const next = new Set(templateFor(dictionary(), tmplType));
        if (box.checked) next.add(c.internal);
        else next.delete(c.internal);
        // stored in dictionary order, so every library of this type
        // opens with the same sequence
        dictionary().templates[tmplType] = dictionary()
          .columns.filter((x) => next.has(x.internal))
          .map((x) => x.internal);
        ctx.markDirty();
        paintTemplates();
      });
      grid.appendChild(box);
    }
    tmplBox.appendChild(grid);

    // applying is explicit and says what it will change — a template is
    // a starting point, and a library may have been tuned since
    const mine = exposed.filter((l) => l.libType === tmplType);
    const differs = mine.filter((l) => !matchesTemplate(l.config, [...chosen]));
    const row = el("div", "app-docs-siterow");
    const apply = el("button", "app-btn", "Apply to these libraries") as HTMLButtonElement;
    apply.disabled = differs.length === 0;
    apply.addEventListener("click", () => {
      for (const lib of differs) lib.config = applyViewTemplate(lib.config, [...chosen]);
      ctx.markDirty();
      paintLibraries();
      paintTemplates();
    });
    row.appendChild(apply);
    tmplBox.appendChild(row);
    tmplBox.appendChild(
      note(
        mine.length === 0
          ? "No library of this type is exposed yet."
          : differs.length === 0
            ? mine.length === 1
              ? "The one library of this type already opens with these columns."
              : `All ${mine.length} libraries of this type already open with these columns.`
            : `Would change ${differs.map((l) => l.config.title || l.name).join(", ")} — ` +
              `${mine.length - differs.length} of ${mine.length} already match.`
      )
    );
  };

  // ---- libraries section -----------------------------------------------
  body.appendChild(section("Libraries"));
  const libsNote = note(
    "Tick a library to expose it in LeanBoard, then configure how it presents. " +
      "Unticking removes its configuration row entirely."
  );
  body.appendChild(libsNote);
  const libsBox = el("div", "app-dept-list");
  body.appendChild(libsBox);

  const typeLabel = (t: LibraryType) =>
    LIBRARY_TYPES.find((x) => x.key === t)?.label ?? t;

  const loadFields = async (lib: { listId: string; siteUrl: string }): Promise<SpField[]> => {
    const cached = fieldsByList.get(lib.listId);
    if (cached) return cached;
    const r = await fetchFields(lib.siteUrl, lib.listId);
    const fields = r.ok ? fieldsFromResponse(r.data) : [];
    fieldsByList.set(lib.listId, fields);
    return fields;
  };

  const configPanel = async (lib: DocLibrary, host: HTMLElement) => {
    clear(host);
    host.appendChild(el("div", "app-loading-line", "Loading columns…"));
    const live = await loadFields(lib);
    clear(host);
    if (live.length === 0) {
      host.appendChild(note("Columns could not be loaded (see the site URL, or try again in the hosted app)."));
    }
    // merge the live schema, then let the site dictionary say what each
    // column IS (label, role, availability); this library decides only
    // which of them its own register shows
    lib.config.columns = mergeColumns(lib.config.columns, live);
    lib.config = resolveLibraryConfig(lib.config, dictionary());
    lib.config = seedDefaultColumns(lib.config, lib.libType);
    const liveByName = new Map(live.map((f) => [f.internal, f]));

    const title = el("input", "app-input") as HTMLInputElement;
    title.placeholder = lib.name;
    title.value = lib.config.title;
    title.addEventListener("input", () => {
      lib.config.title = title.value.trim();
      ctx.markDirty();
    });
    host.appendChild(field("Display name", title, "Shown in LeanBoard; blank keeps the SharePoint name."));

    const type = el("select", "app-input") as HTMLSelectElement;
    for (const t of LIBRARY_TYPES) {
      const o = el("option", "", t.label) as HTMLOptionElement;
      o.value = t.key;
      type.appendChild(o);
    }
    type.value = lib.libType;
    type.addEventListener("change", () => {
      lib.libType = type.value as LibraryType;
      // a library nobody has ticked columns for takes the type's
      // template — which is the point of choosing a type (C5)
      if (!lib.config.columns.some((c) => c.inDefault)) {
        lib.config = applyViewTemplate(lib.config, templateFor(dictionary(), lib.libType));
        void configPanel(lib, host); // repaint the grid's ticks
      }
      ctx.markDirty();
      paintTemplates(); // the "would change" count follows the type
    });
    host.appendChild(
      field(
        "Library type",
        type,
        "Sets the document-management behaviour this library gets (records never revise; working documents check out)."
      )
    );

    const rendition = el("input", "app-input") as HTMLInputElement;
    rendition.placeholder = "e.g. Renditions";
    rendition.value = lib.config.renditionPath;
    rendition.addEventListener("input", () => {
      lib.config.renditionPath = rendition.value.trim();
      ctx.markDirty();
    });
    host.appendChild(
      field(
        "PDF rendition folder",
        rendition,
        "Where approved, watermarked PDF copies live (used once approvals arrive)."
      )
    );

    // view columns — the ONE column decision that is this library's own
    host.appendChild(el("div", "app-field-label", "View columns"));
    host.appendChild(
      note(
        "Which columns this library's register opens with. Names and roles come from " +
          "Document columns above, so they read the same in every library."
      )
    );
    const grid = el("div", "app-docs-viewcols");
    grid.append(
      el("span", "app-docs-colhead", "Column"),
      el("span", "app-docs-colhead", "Role"),
      el("span", "app-docs-colhead", "Default view")
    );
    for (const col of lib.config.columns) {
      // a column the site does not offer is not a view choice here
      if (!col.available) continue;
      const liveField = liveByName.get(col.internal);
      const shown = col.label !== "" ? col.label : (liveField?.title ?? col.internal);
      grid.appendChild(el("span", "app-docs-colname", `${shown} · ${col.internal}`));
      grid.appendChild(
        el(
          "span",
          "app-docs-colrole",
          COLUMN_ROLES.find((r) => r.key === col.role)?.label ?? "—"
        )
      );
      const def = el("input", "") as HTMLInputElement;
      def.type = "checkbox";
      def.checked = col.inDefault;
      def.addEventListener("change", () => {
        col.inDefault = def.checked;
        ctx.markDirty();
      });
      grid.appendChild(def);
    }
    host.appendChild(grid);

    // Colours used to be set here, once per library. They now live under
    // "Term sets & colours" — one palette per term set, so every library
    // using that set reads the same (C2).
  };

  const paintLibraries = () => {
    clear(libsBox);
    const byId = new Map(exposed.map((l) => [l.listId, l]));
    const all: { id: string; title: string; itemCount: number | null }[] = [];
    for (const d of discovered) all.push({ id: d.id, title: d.title, itemCount: d.itemCount });
    for (const l of exposed) {
      if (!discovered.some((d) => d.id === l.listId)) {
        all.push({ id: l.listId, title: l.name, itemCount: null });
      }
    }
    if (all.length === 0) {
      libsBox.appendChild(note("No libraries yet — set the site URL and Load libraries."));
      return;
    }
    for (const item of all) {
      const row = el("div", "app-docs-librow");
      const head = el("div", "app-docs-libhead");
      const tick = el("input", "") as HTMLInputElement;
      tick.type = "checkbox";
      tick.checked = byId.has(item.id);
      const name = el("span", "app-docs-libname", item.title);
      const meta = el(
        "span",
        "app-field-hint",
        byId.has(item.id)
          ? typeLabel(byId.get(item.id)!.libType)
          : item.itemCount === null
            ? "not on this site?"
            : `${item.itemCount} item(s)`
      );
      head.append(tick, name, meta);
      row.appendChild(head);
      const panel = el("div", "app-docs-libpanel");
      row.appendChild(panel);

      const openPanel = () => {
        const lib = byId.get(item.id);
        if (lib) void configPanel(lib, panel);
        else clear(panel);
      };

      tick.addEventListener("change", () => {
        if (tick.checked) {
          const lib: DocLibrary = {
            rowId: "",
            listId: item.id,
            siteUrl: app.siteUrl,
            name: item.title,
            libType: "standard",
            config: { title: "", columns: [], statusColors: {}, renditionPath: "" },
          };
          exposed.push(lib);
          byId.set(item.id, lib);
        } else {
          const lib = byId.get(item.id);
          if (lib) {
            if (lib.rowId !== "") removedRowIds.push(lib.rowId);
            exposed = exposed.filter((l) => l !== lib);
            byId.delete(item.id);
          }
        }
        ctx.markDirty();
        meta.textContent = tick.checked ? typeLabel("standard") : "";
        openPanel();
      });
      head.addEventListener("click", (e) => {
        if (e.target === tick) return;
        if (byId.has(item.id)) {
          panel.classList.toggle("app-docs-libpanel-open");
          if (panel.childElementCount === 0) openPanel();
        }
      });
      libsBox.appendChild(row);
    }
  };

  loadLibs.addEventListener("click", () => {
    void (async () => {
      loadLibs.disabled = true;
      loadLibs.textContent = "Loading…";
      const r = await fetchLibraries(app.siteUrl);
      loadLibs.disabled = false;
      loadLibs.textContent = "Load libraries";
      if (!r.ok) {
        libsNote.textContent = `Could not list libraries: ${r.status}`;
        return;
      }
      discovered = librariesFromLists(r.data);
      libsNote.textContent =
        "Tick a library to expose it in LeanBoard, then configure how it presents. " +
        "Unticking removes its configuration row entirely.";
      paintLibraries();
    })();
  });
  paintLibraries();
  // the dictionary is built from what the exposed libraries carry, so it
  // paints after them and repaints whenever that set changes
  void paintDictionary();

  // ---- term store section ----------------------------------------------
  body.appendChild(section("Term store"));
  body.appendChild(
    note(
      "Managed columns read their values from term sets under one group. The " +
        "Organisation set should mirror LeanBoard's organisation — the report below " +
        "shows any drift (read-only; nothing is changed)."
    )
  );
  const groupSel = el("select", "app-input") as HTMLSelectElement;
  const setSel = el("select", "app-input") as HTMLSelectElement;
  const seedOption = (sel: HTMLSelectElement, id: string, name: string) => {
    clear(sel);
    const o = el("option", "", name === "" ? "—" : name) as HTMLOptionElement;
    o.value = id;
    sel.appendChild(o);
  };
  seedOption(groupSel, app.termGroupId, app.termGroupName);
  seedOption(setSel, app.orgSetId, app.orgSetName);

  /**
   * Fill the set dropdown for the current group. This ran ONLY inside
   * the group-change handler before, so with a SAVED group the sets
   * never loaded and the dropdown sat on "—" forever (Ben's screenshot).
   * Now it also runs after Load groups and on opening the tab with a
   * saved group. A leading "—" keeps "no set chosen" an explicit state —
   * nothing is auto-assigned behind the maker's back.
   */
  const loadSets = async () => {
    if (app.termGroupId === "") return;
    const r = await fetchTermSets(app.siteUrl, app.termGroupId);
    const sets = Array.isArray((r.data as { value?: unknown[] })?.value)
      ? ((r.data as { value: unknown[] }).value as {
          id?: string;
          localizedNames?: { name?: string }[];
        }[])
      : [];
    if (!r.ok) return; // keep whatever is seeded rather than blanking
    clear(setSel);
    const dash = el("option", "", "—") as HTMLOptionElement;
    dash.value = "";
    setSel.appendChild(dash);
    for (const s of sets) {
      const o = el("option", "", s.localizedNames?.[0]?.name ?? "") as HTMLOptionElement;
      o.value = s.id ?? "";
      setSel.appendChild(o);
    }
    setSel.value = sets.some((s) => s.id === app.orgSetId) ? app.orgSetId : "";
  };
  if (app.termGroupId !== "") void loadSets();

  const loadGroups = el("button", "app-btn", "Load groups") as HTMLButtonElement;
  loadGroups.addEventListener("click", () => {
    void (async () => {
      const r = await fetchTermGroups(app.siteUrl);
      const groups = Array.isArray((r.data as { value?: unknown[] })?.value)
        ? ((r.data as { value: unknown[] }).value as { id?: string; name?: string }[])
        : [];
      if (!r.ok || groups.length === 0) {
        loadGroups.textContent = r.ok ? "No groups found" : "Failed — try again";
        return;
      }
      clear(groupSel);
      // "—" first when nothing is saved, so the display never claims a
      // selection the config does not hold
      if (!groups.some((g) => g.id === app.termGroupId)) {
        const dash = el("option", "", "—") as HTMLOptionElement;
        dash.value = "";
        groupSel.appendChild(dash);
      }
      for (const g of groups) {
        const o = el("option", "", g.name ?? "") as HTMLOptionElement;
        o.value = g.id ?? "";
        groupSel.appendChild(o);
      }
      if (groups.some((g) => g.id === app.termGroupId)) {
        groupSel.value = app.termGroupId;
        void loadSets();
      }
      loadGroups.textContent = "Load groups";
    })();
  });
  groupSel.addEventListener("change", () => {
    app.termGroupId = groupSel.value;
    app.termGroupName =
      groupSel.value === "" ? "" : (groupSel.selectedOptions[0]?.textContent ?? "");
    // a different group invalidates the saved set — explicit re-pick
    app.orgSetId = "";
    app.orgSetName = "";
    seedOption(setSel, "", "");
    ctx.markDirty();
    void loadSets();
  });
  setSel.addEventListener("change", () => {
    app.orgSetId = setSel.value;
    app.orgSetName =
      setSel.value === "" ? "" : (setSel.selectedOptions[0]?.textContent ?? "");
    ctx.markDirty();
  });
  const groupRow = el("div", "app-docs-siterow");
  groupRow.append(groupSel, loadGroups);
  body.appendChild(field("Term group", groupRow));
  body.appendChild(field("Organisation term set", setSel));

  const companyLevel = el("input", "") as HTMLInputElement;
  companyLevel.type = "checkbox";
  const companyWrap = el("label", "app-docs-check");
  companyWrap.append(
    companyLevel,
    document.createTextNode(" The term set starts at company level (skip its top level when comparing)")
  );
  // ---- health (C4) -----------------------------------------------------
  // Consolidating the mapping makes divergence findable; this is the
  // thing that looks. The org drift report and the search-filter
  // diagnostic move in here too — they were always health checks sitting
  // in the term store section because that is where they were written.
  body.appendChild(section("Health"));
  body.appendChild(
    note(
      "What is inconsistent across this site's libraries, and what the app decided " +
        "on its own. Nothing here changes anything — it points at where to look."
    )
  );
  const healthBox = el("div", "");
  body.appendChild(healthBox);

  const paintHealth = () => {
    clear(healthBox);
    const dict = dictionary();
    if (dict.columns.length === 0) {
      healthBox.appendChild(note("Nothing to check yet — load the libraries above."));
      return;
    }
    const findings = dictionaryHealth({
      dict,
      conflicts: migrated,
      carriers: lastCarriers,
      libraries: exposed.map((l) => ({
        name: l.config.title !== "" ? l.config.title : l.name,
        columns: l.config.columns,
      })),
      choicesBy: new Map([...liveByInternal].map(([k, f]) => [k, f.choices])),
    });
    if (findings.length === 0) {
      healthBox.appendChild(note("✓ Nothing to report — the libraries agree."));
      return;
    }
    const list = el("div", "app-dept-list");
    for (const f of findings) {
      const row = el("div", `app-docs-health app-docs-health-${f.level}`);
      row.append(
        el("span", "app-docs-healthmark", f.level === "warn" ? "⚠" : "•"),
        el("span", "app-docs-healthtitle", f.title),
        el("span", "app-field-hint", f.detail)
      );
      list.appendChild(row);
    }
    healthBox.appendChild(list);
  };

  body.appendChild(companyWrap);

  const driftBtn = el("button", "app-btn", "Load drift report") as HTMLButtonElement;
  // Does search filtering by organisation term WORK in this tenant?
  // Answers per top-level term with a live document count. All zeros
  // distinguishes the three honest possibilities in its hint — this is
  // the check a new deployment runs instead of guessing (dev tenants
  // auto-expose owstaxId<Column>; a locked-down tenant may need a
  // RefinableString mapping from a tenant admin).
  const diagBtn = el("button", "app-btn", "Test search filtering") as HTMLButtonElement;
  const btnRow = el("div", "app-docs-siterow");
  btnRow.append(driftBtn, diagBtn);
  body.appendChild(btnRow);
  const driftBox = el("div", "");
  body.appendChild(driftBox);
  diagBtn.addEventListener("click", () => {
    void (async () => {
      clear(driftBox);
      const props = [
        ...new Set(
          exposed.flatMap((l) =>
            l.config.columns.filter((c) => c.role === "orgUnit").map((c) => c.internal)
          )
        ),
      ].map(taxonomySearchProperty);
      const listIds = exposed.map((l) => l.listId);
      if (props.length === 0 || listIds.length === 0 || app.orgSetId === "") {
        driftBox.appendChild(
          note(
            "Needs an exposed library with a column mapped to the Organisation unit " +
              "role, and an Organisation term set selected above."
          )
        );
        return;
      }
      diagBtn.disabled = true;
      diagBtn.textContent = "Testing…";
      const { nodes, error } = await fetchTermPaths(app.siteUrl, app.orgSetId, 3, 40);
      if (error !== "" || nodes.length === 0) {
        driftBox.appendChild(note(`Could not read the term set: ${error || "no terms"}`));
      } else {
        const lines: string[] = [];
        let hits = 0;
        for (const top of nodes.filter((n) => n.labels.length === 1).slice(0, 6)) {
          const ids = nodes.filter((n) => n.labels[0] === top.labels[0]).map((n) => n.id);
          const res = await searchPage(app.siteUrl, "", {
            listIds,
            rowLimit: 1,
            termFilters: [{ properties: props, termIds: ids }],
          });
          hits += res.total;
          lines.push(
            `${top.labels[0]}: ${res.error !== "" ? `error — ${res.error.slice(0, 80)}` : `${res.total} document(s)`}`
          );
        }
        driftBox.appendChild(note(`Via ${props.join(", ")} — ${lines.join(" · ")}`));
        if (hits === 0) {
          driftBox.appendChild(
            note(
              "All zero. Either nothing is tagged yet, the search index has not " +
                "crawled the tags (minutes to hours), or this tenant needs a " +
                "RefinableString mapping from a tenant admin."
            )
          );
        }
      }
      diagBtn.disabled = false;
      diagBtn.textContent = "Test search filtering";
    })();
  });
  driftBtn.addEventListener("click", () => {
    void (async () => {
      driftBtn.disabled = true;
      driftBtn.textContent = "Comparing…";
      clear(driftBox);
      const [{ nodes, truncated, error }, orgRaw] = await Promise.all([
        fetchTermPaths(app.siteUrl, app.orgSetId),
        orgJson(),
      ]);
      const paths = nodes.map((n) => n.labels);
      driftBtn.disabled = false;
      driftBtn.textContent = "Load drift report";
      if (error !== "") {
        driftBox.appendChild(note(`Term walk failed: ${error}`));
        return;
      }
      const report: DriftReport = orgDrift(
        orgTreePaths(parseOrgTree(orgRaw)),
        paths,
        companyLevel.checked ? 1 : 0
      );
      const list = (title: string, items: string[][]) => {
        driftBox.appendChild(el("div", "app-field-label", `${title} (${items.length})`));
        if (items.length === 0) {
          driftBox.appendChild(el("div", "app-field-hint", "none"));
          return;
        }
        const ul = el("ul", "app-docs-driftlist");
        for (const p of items.slice(0, 50)) {
          ul.appendChild(el("li", "", p.join(" › ")));
        }
        if (items.length > 50) ul.appendChild(el("li", "", `… and ${items.length - 50} more`));
        driftBox.appendChild(ul);
      };
      driftBox.appendChild(
        note(
          `${report.matched} matched${truncated ? " (term walk truncated — large set)" : ""}. ` +
            "Alignment is by name; the sync that fixes drift comes later and never deletes terms."
        )
      );
      list("In LeanBoard only", report.onlyApp);
      list("In the term set only", report.onlyTerms);
    })();
  });
}
