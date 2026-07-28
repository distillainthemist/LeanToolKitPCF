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
import {
  AppDocsConfig,
  COLUMN_ROLES,
  ColumnConfig,
  DriftReport,
  LIBRARY_TYPES,
  LibraryConfig,
  LibraryType,
  SpField,
  SpLibrary,
  fieldsFromResponse,
  librariesFromLists,
  mergeColumns,
  orgDrift,
  orgTreePaths,
} from "./model";
import {
  fetchFields,
  fetchLibraries,
  fetchTermGroups,
  fetchTermPaths,
  fetchTermSets,
  fetchTermsInSet,
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
    ctx.markClean();
    paintLibraries();
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
    lib.config.columns = mergeColumns(lib.config.columns, live);
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
      ctx.markDirty();
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

    // columns table
    host.appendChild(el("div", "app-field-label", "Columns"));
    const grid = el("div", "app-docs-cols");
    grid.append(
      el("span", "app-docs-colhead", "SharePoint column"),
      el("span", "app-docs-colhead", "Display as"),
      el("span", "app-docs-colhead", "Available"),
      el("span", "app-docs-colhead", "Default"),
      el("span", "app-docs-colhead", "Role")
    );
    for (const col of lib.config.columns) {
      const liveField = liveByName.get(col.internal);
      grid.appendChild(
        el("span", "app-docs-colname", `${liveField?.title ?? col.internal} · ${col.internal}`)
      );
      const label = el("input", "app-input") as HTMLInputElement;
      label.placeholder = liveField?.title ?? col.internal;
      label.value = col.label;
      label.addEventListener("input", () => {
        col.label = label.value.trim();
        ctx.markDirty();
      });
      grid.appendChild(label);
      const avail = el("input", "") as HTMLInputElement;
      avail.type = "checkbox";
      avail.checked = col.available;
      avail.addEventListener("change", () => {
        col.available = avail.checked;
        ctx.markDirty();
      });
      grid.appendChild(avail);
      const def = el("input", "") as HTMLInputElement;
      def.type = "checkbox";
      def.checked = col.inDefault;
      def.addEventListener("change", () => {
        col.inDefault = def.checked;
        ctx.markDirty();
      });
      grid.appendChild(def);
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
        paintStatus();
      });
      grid.appendChild(role);
    }
    host.appendChild(grid);

    // ---- status colours -------------------------------------------------
    // The values come from the COLUMN, never from typing: a Choice column
    // carries its own choices, and a managed-metadata column names a term
    // set whose terms we read. Nothing to keep in step by hand, and no way
    // to map a colour onto a value the column cannot hold.
    const statusBox = el("div", "");
    host.appendChild(statusBox);

    const paintStatus = () => {
      clear(statusBox);
      const statusCol = lib.config.columns.find((c) => c.role === "status");
      if (!statusCol) return;
      const field = liveByName.get(statusCol.internal);
      statusBox.appendChild(el("div", "app-field-label", "Status colours"));
      const kind = field?.isTaxonomy
        ? "managed metadata"
        : field?.choices.length
          ? "choice column"
          : "";
      statusBox.appendChild(
        note(
          `Each value of ${field?.title ?? statusCol.internal}` +
            (kind !== "" ? ` (${kind})` : "") +
            " takes a state colour from Branding — one truth for what a colour means."
        )
      );
      const rows = el("div", "app-dept-list");
      statusBox.appendChild(rows);

      /** One value → colour row. `value` is fixed: it comes from the column. */
      const drawRow = (value: string) => {
        const row = el("div", "app-docs-statusrow");
        row.appendChild(el("span", "app-docs-statusval", value));
        const pick = el("select", "app-input") as HTMLSelectElement;
        const none = el("option", "", "— no colour —") as HTMLOptionElement;
        none.value = "";
        pick.appendChild(none);
        for (const p of palettes.states) {
          const o = el("option", "", p.label) as HTMLOptionElement;
          o.value = p.key;
          pick.appendChild(o);
        }
        pick.value = lib.config.statusColors[value] ?? "";
        const swatch = el("span", "app-docs-statusswatch");
        const paintSwatch = () => {
          const hit = palettes.states.find((p) => p.key === pick.value);
          swatch.style.background = hit?.color ?? "transparent";
        };
        paintSwatch();
        pick.addEventListener("change", () => {
          if (pick.value === "") delete lib.config.statusColors[value];
          else lib.config.statusColors[value] = pick.value;
          paintSwatch();
          ctx.markDirty();
        });
        row.append(pick, swatch);
        rows.appendChild(row);
      };

      const drawValues = (values: string[]) => {
        clear(rows);
        if (values.length === 0) {
          rows.appendChild(
            note(
              "No values could be read from this column — check it is a choice or " +
                "managed-metadata column, then reopen this library."
            )
          );
          return;
        }
        for (const v of values) drawRow(v);
        // colours saved against values the column no longer offers would
        // be invisible and un-removable, so surface them for cleanup
        const stale = Object.keys(lib.config.statusColors).filter((v) => !values.includes(v));
        if (stale.length > 0) {
          const warn = note(`Not in this column any more: ${stale.join(", ")}`);
          const drop = el("button", "app-btn", "Remove") as HTMLButtonElement;
          drop.addEventListener("click", () => {
            for (const v of stale) delete lib.config.statusColors[v];
            ctx.markDirty();
            drawValues(values);
          });
          warn.appendChild(drop);
          rows.appendChild(warn);
        }
      };

      if (field?.isTaxonomy) {
        if (field.termSetId === "") {
          rows.appendChild(
            note(
              "This is a managed-metadata column, but SharePoint did not report its " +
                "term set — pick the set under Term store above and reopen the library."
            )
          );
          return;
        }
        rows.appendChild(el("div", "app-field-hint", "Reading the term set…"));
        void fetchTermsInSet(app.siteUrl, field.termSetId).then((r) => {
          const terms = Array.isArray((r.data as { value?: unknown[] })?.value)
            ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
            : [];
          drawValues(
            terms
              .map((t) => {
                const labels = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
                const def = Array.isArray(labels)
                  ? (labels.find((l) => l.isDefault) ?? labels[0])
                  : undefined;
                return (def?.name ?? "").trim();
              })
              .filter((n) => n !== "")
          );
        });
      } else {
        drawValues(field?.choices ?? Object.keys(lib.config.statusColors));
      }
    };
    paintStatus();
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
      for (const g of groups) {
        const o = el("option", "", g.name ?? "") as HTMLOptionElement;
        o.value = g.id ?? "";
        groupSel.appendChild(o);
      }
      if (groups.some((g) => g.id === app.termGroupId)) groupSel.value = app.termGroupId;
      loadGroups.textContent = "Load groups";
    })();
  });
  groupSel.addEventListener("change", () => {
    app.termGroupId = groupSel.value;
    app.termGroupName = groupSel.selectedOptions[0]?.textContent ?? "";
    ctx.markDirty();
    void (async () => {
      const r = await fetchTermSets(app.siteUrl, app.termGroupId);
      const sets = Array.isArray((r.data as { value?: unknown[] })?.value)
        ? ((r.data as { value: unknown[] }).value as {
            id?: string;
            localizedNames?: { name?: string }[];
          }[])
        : [];
      clear(setSel);
      for (const s of sets) {
        const o = el("option", "", s.localizedNames?.[0]?.name ?? "") as HTMLOptionElement;
        o.value = s.id ?? "";
        setSel.appendChild(o);
      }
      if (sets.some((s) => s.id === app.orgSetId)) setSel.value = app.orgSetId;
      app.orgSetId = setSel.value;
      app.orgSetName = setSel.selectedOptions[0]?.textContent ?? "";
    })();
  });
  setSel.addEventListener("change", () => {
    app.orgSetId = setSel.value;
    app.orgSetName = setSel.selectedOptions[0]?.textContent ?? "";
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
  body.appendChild(companyWrap);

  const driftBtn = el("button", "app-btn", "Load drift report") as HTMLButtonElement;
  body.appendChild(driftBtn);
  const driftBox = el("div", "");
  body.appendChild(driftBox);
  driftBtn.addEventListener("click", () => {
    void (async () => {
      driftBtn.disabled = true;
      driftBtn.textContent = "Comparing…";
      clear(driftBox);
      const [{ paths, truncated, error }, orgRaw] = await Promise.all([
        fetchTermPaths(app.siteUrl, app.orgSetId),
        orgJson(),
      ]);
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
