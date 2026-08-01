// Standard Documents — the #/docs area (plan Phase 2): title bar with
// search, left navigation (All documents / per-library / the org tree
// from the term store), right document list. Browse mode reads list
// REST pages; any search text (and the All view) rides permission-
// trimmed site search. The viewer and properties overlays hang off rows.
//
// Org-tree nodes render from the term store but stay selection-disabled
// until a deployment maps crawled → managed properties (spike 3's
// lead-time item) — filtering that silently applied to loaded rows only
// would lie about the corpus.

import { el, clear } from "../../../shared/ui/dom";
import { withStatusGlyph } from "../../../shared/ui/format";
import { draggableRow } from "../../../shared/ui/dragList";
import { showLoading } from "../loading";
import { detectHost } from "../runtime";
import { paletteMap, resolvePaletteColor } from "../../../shared/palette";
import { textOn } from "../../../shared/tokens";
import { appPalettes } from "../store/config";
import { browsePage, driveIdFor, searchPage } from "./data";
import { ListColumn, mountDocList } from "./listView";
import {
  DocRow,
  extGlyph,
  formatWhen,
  isNonCurrentStatus,
  pdfViewUrlFor,
  taxonomySearchProperty,
} from "./rows";
import { DocLibrary, docsConfig } from "./docsStore";
import { TermNode, fetchTermPaths } from "./sp";
import { currentViewer } from "../runtime";
import { viewerPerson } from "../store/people";
import { docsViewUrl, takePendingDocView } from "../links";
import {
  DocUiPrefs,
  DocView,
  FavDoc,
  decodeDocView,
  emptyDocUiPrefs,
  emptyDocView,
  encodeDocView,
  toCsv,
} from "./views";
import {
  deleteDocView,
  docPrefs,
  saveDocUi,
  saveDocView,
  toggleFavorite,
} from "./prefs";

// Applied by the next mount: saved-view clicks, the Favourites entry and
// library ticks re-mount the screen in place (the embedded pattern), and
// the state rides here rather than in the hash.
let pendingView: DocView | null = null;
let pendingFav = false;
let pendingLibs: string[] | null = null;
import { openDocProperties, openDocViewer } from "./viewer";

const PAGE = 50;

export interface DocsMountOpts {
  /** Inside the hub's Documents tab: no page title, and navigation
   *  re-mounts in place instead of writing the hash (a hash write would
   *  route away to the standalone #/docs screen). */
  embedded?: boolean;
}

export function mountDocs(
  parent: HTMLElement,
  selected: string,
  opts: DocsMountOpts = {}
): () => void {
  const wrap = el("div", "app-docs-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;

  void (async () => {
    // a bare dev server has no host — SDK calls would HANG, not reject
    if (!(await detectHost())) {
      stopLoading();
      if (dead) return;
      if (!opts.embedded) wrap.appendChild(el("h2", "app-docs-title", "Documents"));
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          "Standard documents run in the hosted app (SharePoint and Dataverse live host-side)."
        )
      );
      return;
    }
    let cfg: Awaited<ReturnType<typeof docsConfig>>;
    let palettes: Awaited<ReturnType<typeof appPalettes>>;
    try {
      [cfg, palettes] = await Promise.all([docsConfig(), appPalettes()]);
    } catch (e) {
      stopLoading();
      if (dead) return;
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          `Standard documents need the hosted app. ${String(e).slice(0, 160)}`
        )
      );
      return;
    }
    stopLoading();
    if (dead) return;

    const { app, libraries } = cfg;
    if (app.siteUrl === "" || libraries.length === 0) {
      if (!opts.embedded) wrap.appendChild(el("h2", "app-docs-title", "Documents"));
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          "Standard documents haven't been set up yet — a super admin connects SharePoint " +
            "and picks the libraries under Settings → Documents."
        )
      );
      return;
    }

    const states = paletteMap(palettes.states);
    const byListId = new Map(libraries.map((l) => [l.listId.toLowerCase(), l]));
    /** The whole corpus LeanBoard can see — every exposed library, and
     *  the widest any query here is ever allowed to reach. */
    const allListIds = libraries.map((l) => l.listId);

    // a view to boot into: a saved-view click (module stash) or a shared
    // link's payload (launch param, consumed once)
    const bootRaw = takePendingDocView();
    const bootView: DocView | null =
      pendingView ?? (bootRaw !== "" ? decodeDocView(bootRaw) : null);
    pendingView = null;
    const favMode = pendingFav;
    pendingFav = false;

    const stashedLibs = pendingLibs;
    pendingLibs = null;

    const whoId = currentViewer()?.objectId ?? "";
    let favs: FavDoc[] = [];
    let savedViews: DocView[] = [];

    // ---- library selection (Vault V1: a ticked set, minimum one) -------
    // Presentation prefs ride the person's userprefs row (Ben's call:
    // Dataverse, so state follows them across devices). The read is the
    // same cached promise the favourites/views block awaits below — the
    // first Documents open of a session pays it once.
    let uiState: DocUiPrefs = emptyDocUiPrefs();
    if (whoId !== "") {
      uiState = await docPrefs(whoId).then(
        (p) => p.ui,
        () => emptyDocUiPrefs()
      );
      if (dead) return;
    }
    const validIds = new Set(allListIds.map((id) => id.toLowerCase()));
    const wantedIds: string[] =
      bootView !== null
        ? bootView.listId !== ""
          ? [bootView.listId]
          : allListIds
        : (stashedLibs ??
          (selected !== ""
            ? [selected]
            : uiState.libraries.length > 0
              ? uiState.libraries
              : allListIds));
    let selectedIds = wantedIds.filter((id) => validIds.has(id.toLowerCase()));
    if (selectedIds.length === 0) selectedIds = allListIds;
    const isSelected = (listId: string): boolean =>
      selectedIds.some((id) => id.toLowerCase() === listId.toLowerCase());
    const allSelected = selectedIds.length === allListIds.length;

    const current: DocLibrary | null =
      favMode || selectedIds.length !== 1
        ? null
        : (byListId.get(selectedIds[0].toLowerCase()) ?? null);

    const persistUi = (patch: Partial<DocUiPrefs>) => {
      if (whoId === "") return;
      uiState = { ...uiState, ...patch };
      saveDocUi(whoId, uiState);
    };

    // ---- chrome: title, search, controls -------------------------------
    const top = el("div", "app-docs-top");
    if (!opts.embedded) top.appendChild(el("h2", "app-docs-title", "Documents"));
    const search = el("input", "app-input app-docs-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = favMode
      ? "Favourites"
      : current
        ? `Search ${current.config.title || current.name}…`
        : allSelected
          ? "Search all documents…"
          : `Search ${selectedIds.length} libraries…`;
    search.disabled = favMode;
    if (bootView) search.value = bootView.query;
    const scope = el("select", "app-input app-docs-scope") as HTMLSelectElement;
    for (const [v, label] of [
      ["library", "This library"],
      ["all", "All documents"],
    ] as const) {
      const o = el("option", "", label) as HTMLOptionElement;
      o.value = v;
      scope.appendChild(o);
    }
    scope.title =
      "Search what you are looking at, or every library this site exposes — " +
      "never the wider SharePoint.";
    scope.style.display = current ? "" : "none";
    const contents = el("label", "app-docs-check");
    const contentsBox = el("input", "") as HTMLInputElement;
    contentsBox.type = "checkbox";
    contents.append(contentsBox, document.createTextNode(" Search everything"));
    contents.title =
      "Off, this matches document names and titles — how you look for something " +
      "you know exists. On, it matches everything the index knows: the text " +
      "inside every document and the value of every field — which finds far more.";
    const nonCurrent = el("label", "app-docs-check app-docs-noncurrent");
    const nonCurrentBox = el("input", "") as HTMLInputElement;
    nonCurrentBox.type = "checkbox";
    nonCurrent.append(nonCurrentBox, document.createTextNode(" Include drafts & superseded"));
    if (bootView) {
      contentsBox.checked = bootView.contents;
      nonCurrentBox.checked = bootView.nonCurrent;
    }

    // secondary actions (share the current filter as a player link,
    // export the register) live behind one kebab — the app's convention
    const topKebab = el("button", "app-kebab app-docs-topkebab", "⋮") as HTMLButtonElement;
    topKebab.title = "More actions";
    top.append(search, scope, contents, nonCurrent, topKebab);
    if (favMode) {
      scope.style.display = "none";
      contents.style.display = "none";
      nonCurrent.style.display = "none";
      topKebab.style.display = "none";
    }
    wrap.appendChild(top);

    const bodyRow = el("div", "app-docs-body");
    wrap.appendChild(bodyRow);

    // ---- left nav ------------------------------------------------------
    const nav = el("nav", "app-docs-nav");
    bodyRow.appendChild(nav);

    /** Re-mount in place with a stashed boot state (both modes — the
     *  embedded pattern; the hash stays put). */
    const remount = () => {
      dead = true;
      wrap.remove();
      mountDocs(parent, "", opts);
    };

    const navCard = (label: string): { card: HTMLElement; head: HTMLElement } => {
      const card = el("section", "app-docs-navcard");
      const head = el("div", "app-docs-navhead");
      head.appendChild(el("span", "app-docs-navheadlabel", label));
      card.appendChild(head);
      nav.appendChild(card);
      return { card, head };
    };

    // ---- LIBRARIES card (Vault V1) -------------------------------------
    // Checkbox = include toggle (minimum one stays ticked); the name and
    // the hover/focus "Only" affordance solo-select (finding 3). One
    // ticked library keeps the fast browse path; two or more ride search.
    const switchTo = (ids: string[]) => {
      persistUi({ libraries: ids });
      pendingLibs = ids;
      remount();
    };
    const libCard = navCard("Libraries");
    const selectAll = el(
      "button",
      "app-linklike app-docs-navheadaction",
      "Select all"
    ) as HTMLButtonElement;
    selectAll.title = "Include every library";
    selectAll.disabled = allSelected && !favMode;
    selectAll.addEventListener("click", () => switchTo(allListIds));
    libCard.head.appendChild(selectAll);
    for (const lib of libraries) {
      const on = !favMode && isSelected(lib.listId);
      const row = el("div", `app-docs-librow2${on ? " app-docs-librow2-on" : ""}`);
      const box = el("input", "app-docs-libcheck") as HTMLInputElement;
      box.type = "checkbox";
      box.checked = on;
      box.setAttribute("aria-label", `Include ${lib.config.title || lib.name}`);
      box.addEventListener("change", () => {
        const next = box.checked
          ? [...selectedIds.filter((id) => id.toLowerCase() !== lib.listId.toLowerCase()), lib.listId]
          : selectedIds.filter((id) => id.toLowerCase() !== lib.listId.toLowerCase());
        if (next.length === 0) {
          box.checked = true; // the last library cannot be unticked
          return;
        }
        switchTo(next);
      });
      const name = el(
        "button",
        "app-docs-libname2",
        lib.config.title || lib.name
      ) as HTMLButtonElement;
      name.title = "Show only this library";
      name.addEventListener("click", () => switchTo([lib.listId]));
      const only = el("button", "app-docs-only", "Only") as HTMLButtonElement;
      only.setAttribute("aria-label", `Only ${lib.config.title || lib.name}`);
      only.addEventListener("click", () => switchTo([lib.listId]));
      row.append(box, name, el("span", "app-field-hint", lib.libType), only);
      libCard.card.appendChild(row);
    }

    // ---- favourites (pinned pseudo-row under the libraries) ------------
    const favLink = el(
      "button",
      `app-docs-librow2 app-docs-favrow${favMode ? " app-docs-librow2-on" : ""}`
    ) as HTMLButtonElement;
    favLink.appendChild(el("span", "app-docs-libname2", "★ Favourites"));
    const favHint = el("span", "app-field-hint", "");
    favLink.appendChild(favHint);
    favLink.addEventListener("click", () => {
      pendingFav = true;
      remount();
    });
    libCard.card.appendChild(favLink);

    // ---- SAVED VIEWS card (finding 9: views above the tree) ------------
    const viewsCard = navCard("Saved views");
    const viewsBox = el("div", "app-docs-navorgbox");
    viewsCard.card.appendChild(viewsBox);
    const paintViews = () => {
      clear(viewsBox);
      for (const v of savedViews) {
        const row = el("div", "app-docs-viewrow");
        const open = el("button", "app-docs-navterm", v.name) as HTMLButtonElement;
        open.title = "Open this view";
        open.addEventListener("click", () => {
          pendingView = v;
          remount();
        });
        // secondary actions ride the app's kebab convention
        const kb = el("button", "app-kebab app-docs-viewkebab", "⋮") as HTMLButtonElement;
        kb.setAttribute("aria-label", `${v.name} actions`);
        kb.addEventListener("click", (e) => {
          e.stopPropagation();
          if (menu) {
            closeMenu();
            return;
          }
          menu = el("div", "app-docs-menu");
          const item = (label: string, onPick: () => void) => {
            const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
            b.addEventListener("click", () => {
              closeMenu();
              onPick();
            });
            menu!.appendChild(b);
          };
          item("Copy link to this view", () => {
            void navigator.clipboard.writeText(docsViewUrl(encodeDocView(v)));
            status.textContent = "Link copied ✓";
          });
          item("Delete view", () => {
            void deleteDocView(whoId, v.name).then((list) => {
              if (dead) return;
              savedViews = list;
              paintViews();
            });
          });
          const r = kb.getBoundingClientRect();
          menu.style.top = `${r.bottom + 4}px`;
          menu.style.left = `${Math.max(8, r.right - 200)}px`;
          document.body.appendChild(menu);
        });
        row.append(open, kb);
        viewsBox.appendChild(row);
      }
      // one button; the name input appears only when saving
      const saveBtn = el("button", "app-docs-navterm app-docs-saveview", "＋ Save view") as HTMLButtonElement;
      saveBtn.title = "Save the current filter as a view";
      saveBtn.addEventListener("click", () => {
        if (whoId === "" || favMode) return;
        const saveRow = el("div", "app-docs-viewrow");
        const nameIn = el("input", "app-input app-docs-viewname") as HTMLInputElement;
        nameIn.placeholder = "View name…";
        const commit = () => {
          const name = nameIn.value.trim();
          if (name === "") return;
          void saveDocView(whoId, { ...currentView(), name }).then((list) => {
            if (dead) return;
            savedViews = list;
            paintViews();
          });
        };
        nameIn.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") paintViews();
        });
        saveRow.appendChild(nameIn);
        saveBtn.replaceWith(saveRow);
        nameIn.focus();
      });
      viewsBox.appendChild(saveBtn);
    };
    if (whoId !== "") {
      void docPrefs(whoId).then((p) => {
        if (dead) return;
        favs = p.favorites;
        savedViews = p.views;
        favHint.textContent = favs.length === 0 ? "" : String(favs.length);
        paintViews();
        if (favMode) void load(true); // favourites arrived — paint them
      });
    }
    // ---- taxonomy filters + the group-by tree (Phase 3a) ---------------
    // Filtering keys on the auto-created owstaxId<Column> property with
    // term GUIDs (verified 2026-07-28: no admin mapping needed on the dev
    // tenant). A GUID matches only its exact term, so picking a node ORs
    // the node with its whole subtree — the walk yields it anyway. The
    // organisation filter of Phase 2 is now one entry in a general list:
    // any taxonomy column with a known term set can filter, and any of
    // them can drive the tree.
    const orgCols = new Set<string>();
    for (const lib of libraries) {
      for (const c of lib.config.columns) if (c.role === "orgUnit") orgCols.add(c.internal);
    }
    const orgProps = [...orgCols].map(taxonomySearchProperty);

    /** Taxonomy columns beyond the organisation, unioned across the
     *  exposed libraries: internal → display label + term set. */
    const taxCols = new Map<string, { label: string; setId: string }>();
    for (const lib of libraries) {
      for (const c of lib.config.columns) {
        if (!c.available || c.termSetId === "" || c.role === "orgUnit") continue;
        if (!taxCols.has(c.internal)) {
          taxCols.set(c.internal, { label: c.label || c.internal, setId: c.termSetId });
        }
      }
    }
    /** col "" = the organisation (its own slot in links). */
    const colLabel = (col: string): string =>
      col === "" ? "Organisation" : (taxCols.get(col)?.label ?? col);
    const setFor = (col: string): string =>
      col === "" ? app.orgSetId : (taxCols.get(col)?.setId ?? "");
    const propsFor = (col: string): string[] =>
      col === "" ? orgProps : [taxonomySearchProperty(col)];

    interface ActiveFilter {
      col: string;
      node: TermNode;
      ids: string[];
    }
    let filters: ActiveFilter[] = [];
    const filterFor = (col: string): ActiveFilter | null =>
      filters.find((f) => f.col === col) ?? null;

    const subtreeIdsIn = (nodes: TermNode[], node: TermNode): string[] =>
      nodes
        .filter(
          (n) =>
            n.id === node.id ||
            (n.labels.length > node.labels.length &&
              node.labels.every((l, i) => n.labels[i] === l))
        )
        .map((n) => n.id);

    /** Set/replace (node) or clear (null) the filter on one column. */
    const applyFilter = (col: string, node: TermNode | null, nodes: TermNode[]) => {
      filters = filters.filter((f) => f.col !== col);
      if (node !== null) filters.push({ col, node, ids: subtreeIdsIn(nodes, node) });
      paintTreeSelection();
      paintChips();
      void load(true);
    };

    // ---- the tree ------------------------------------------------------
    let groupBy = bootView?.groupBy ?? "";
    if (groupBy !== "" && !taxCols.has(groupBy)) groupBy = "";
    let treeNodes: TermNode[] = [];
    const treeButtons = new Map<string, HTMLElement>();
    const countSpans = new Map<string, HTMLElement>();
    let allBtn: HTMLButtonElement | null = null;
    let collapsed = new Set<string>();

    const paintTreeSelection = () => {
      const active = filterFor(groupBy);
      allBtn?.classList.toggle("app-docs-navterm-on", active === null);
      for (const [id, btn] of treeButtons) {
        btn.classList.toggle("app-docs-navterm-on", active?.node.id === id);
      }
    };

    // Loaded-row counts (Ben, 2026-08-01: speed first, live counts can
    // come later). Browse rows carry every column as display text, so a
    // term's count = loaded rows whose group-by column holds its label;
    // search rows carry no field text, so counts stay blank there rather
    // than lie. Scoped honestly via the title attribute.
    let lastUsedSearch = false;
    const paintTreeCounts = () => {
      if (countSpans.size === 0) return;
      const cols = groupBy === "" ? [...orgCols] : [groupBy];
      const rows = lastUsedSearch || favMode ? [] : loadedRows();
      const tally = new Map<string, number>();
      for (const r of rows) {
        for (const col of cols) {
          for (const part of (r.values[col] ?? "").split(";")) {
            const label = part.trim().toLowerCase();
            if (label !== "") tally.set(label, (tally.get(label) ?? 0) + 1);
          }
        }
      }
      for (const n of treeNodes) {
        const span = countSpans.get(n.id);
        if (!span) continue;
        const count = tally.get(n.labels[n.labels.length - 1].toLowerCase()) ?? 0;
        span.textContent = rows.length > 0 && count > 0 ? String(count) : "";
        span.title = "In the documents loaded so far";
      }
    };

    /** Deepest term whose label path matches the viewer's own site /
     *  department / area (offset 1 tolerates a company-rooted set). */
    const viewerNode = async (): Promise<TermNode | null> => {
      const viewer = currentViewer();
      if (!viewer) return null;
      const me = await viewerPerson(viewer.objectId).catch(() => null);
      if (!me) return null;
      const want = [me.site, me.department, me.area]
        .map((s) => (s ?? "").trim().toLowerCase())
        .filter((s) => s !== "");
      if (want.length === 0) return null;
      let best: TermNode | null = null;
      for (const n of treeNodes) {
        for (const offset of [0, 1]) {
          const labels = n.labels.slice(offset).map((l) => l.toLowerCase());
          if (labels.length === 0 || labels.length > want.length) continue;
          if (labels.every((l, i) => l === want[i])) {
            if (!best || n.labels.length > best.labels.length) best = n;
          }
        }
      }
      return best;
    };

    const treeCard = el("section", "app-docs-navcard");
    const treeHead = el("div", "app-docs-navhead");
    treeHead.appendChild(el("span", "app-docs-navheadlabel", "Browse by"));
    treeCard.appendChild(treeHead);

    /** Persisted collapse state per term set (Vault V1). */
    const persistCollapse = (setId: string) => {
      persistUi({ collapsed: { ...uiState.collapsed, [setId]: [...collapsed] } });
    };
    const groupSel = el("select", "app-input app-docs-groupby") as HTMLSelectElement;
    const groupOpt = (value: string, label: string) => {
      const o = el("option", "", label) as HTMLOptionElement;
      o.value = value;
      groupSel.appendChild(o);
    };
    if (app.orgSetId !== "") groupOpt("", "Organisation");
    for (const [internal, meta] of taxCols) groupOpt(internal, meta.label);
    groupSel.value = groupBy;
    const treeBox = el("div", "app-docs-navorgbox");

    const paintTree = () => {
      clear(treeBox);
      treeButtons.clear();
      countSpans.clear();
      allBtn = null;
      const setId = setFor(groupBy);
      if (setId === "") {
        treeBox.appendChild(el("div", "app-field-hint", "No term set for this column."));
        return;
      }
      collapsed = new Set(uiState.collapsed[setId] ?? []);
      treeBox.appendChild(el("div", "app-field-hint", "Loading…"));
      void fetchTermPaths(app.siteUrl, setId, 4, 60).then(async ({ nodes, error }) => {
        if (dead || setFor(groupBy) !== setId) return;
        clear(treeBox);
        if (error !== "" || nodes.length === 0) {
          treeBox.appendChild(el("div", "app-field-hint", "No terms yet."));
          return;
        }
        treeNodes = nodes;
        const disabled = groupBy === "" && orgProps.length === 0;
        const SEP = "\u0000";
        const key = (labels: string[]) => labels.join(SEP);
        const hasChildren = new Set<string>();
        for (const n of nodes) {
          if (n.labels.length > 1) hasChildren.add(key(n.labels.slice(0, -1)));
        }
        // the misclick recovery row: one click back to the unfiltered
        // register (the Vault's "All folders" anatomy)
        const allRow = el("div", "app-docs-treerow");
        allRow.appendChild(el("span", "app-docs-caret app-docs-caret-none", ""));
        allBtn = el("button", "app-docs-navterm", "All (no filter)") as HTMLButtonElement;
        allBtn.title = `Clear the ${colLabel(groupBy)} filter`;
        if (!(groupBy === "" && orgProps.length === 0)) {
          allBtn.addEventListener("click", () => applyFilter(groupBy, null, []));
        }
        allRow.appendChild(allBtn);
        treeBox.appendChild(allRow);
        const rows = new Map<string, HTMLElement>();
        const paintCollapse = () => {
          for (const n of nodes) {
            const row = rows.get(n.id);
            if (!row) continue;
            let hidden = false;
            for (let d = 1; d < n.labels.length && !hidden; d++) {
              if (collapsed.has(key(n.labels.slice(0, d)))) hidden = true;
            }
            row.style.display = hidden ? "none" : "";
          }
        };
        for (const n of nodes) {
          const row = el("div", "app-docs-treerow");
          row.style.paddingLeft = `${(n.labels.length - 1) * 14}px`;
          const k = key(n.labels);
          if (hasChildren.has(k)) {
            const caret = el("button", "app-docs-caret", collapsed.has(k) ? "▸" : "▾") as HTMLButtonElement;
            caret.setAttribute("aria-expanded", String(!collapsed.has(k)));
            caret.addEventListener("click", () => {
              if (collapsed.has(k)) collapsed.delete(k);
              else collapsed.add(k);
              caret.textContent = collapsed.has(k) ? "▸" : "▾";
              caret.setAttribute("aria-expanded", String(!collapsed.has(k)));
              paintCollapse();
              persistCollapse(setId);
            });
            row.appendChild(caret);
          } else {
            row.appendChild(el("span", "app-docs-caret app-docs-caret-none", ""));
          }
          const btn = el("button", "app-docs-navterm", n.labels[n.labels.length - 1]) as HTMLButtonElement;
          if (disabled) {
            btn.disabled = true;
            btn.title =
              "Map a column to the Organisation unit role in Settings → Documents to filter by organisation.";
          } else {
            btn.title = n.labels.join(" › ");
            btn.addEventListener("click", () =>
              applyFilter(groupBy, filterFor(groupBy)?.node.id === n.id ? null : n, nodes)
            );
          }
          row.appendChild(btn);
          const count = el("span", "app-docs-navcount", "");
          row.appendChild(count);
          countSpans.set(n.id, count);
          treeButtons.set(n.id, btn);
          rows.set(n.id, row);
          treeBox.appendChild(row);
        }
        paintCollapse();
        paintTreeSelection();
        paintTreeCounts();
        // boot: a shared/saved view's org filter first; otherwise land on
        // the viewer's own corner of the organisation (chip makes either
        // one-click removable). Organisation tree only.
        if (groupBy === "" && filterFor("") === null) {
          const wantOrg = bootView?.orgTermId ?? "";
          if (wantOrg !== "") {
            const match = nodes.find((x) => x.id === wantOrg);
            if (match) applyFilter("", match, nodes);
          } else if (orgProps.length > 0 && bootView === null && !favMode) {
            const mine = await viewerNode();
            if (!dead && mine && filterFor("") === null) applyFilter("", mine, nodes);
          }
        }
      });
    };

    groupSel.addEventListener("change", () => {
      groupBy = groupSel.value;
      treeNodes = []; // collapse state re-boots from prefs in paintTree
      paintTree();
    });

    // keyboard: Up/Down walk the visible rows, Left/Right drive the
    // focused row's caret (Vault V1 accept criterion)
    treeBox.addEventListener("keydown", (e) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      const rowEls = [...treeBox.querySelectorAll<HTMLElement>(".app-docs-treerow")].filter(
        (r) => r.style.display !== "none"
      );
      const rowOf = rowEls.find((r) => r.contains(focused));
      if (!rowOf) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = rowEls.indexOf(rowOf) + (e.key === "ArrowDown" ? 1 : -1);
        const next = rowEls[i]?.querySelector<HTMLButtonElement>("button.app-docs-navterm");
        next?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const caret = rowOf.querySelector<HTMLButtonElement>("button.app-docs-caret");
        if (!caret) return;
        const expanded = caret.getAttribute("aria-expanded") === "true";
        if ((e.key === "ArrowLeft" && expanded) || (e.key === "ArrowRight" && !expanded)) {
          e.preventDefault();
          caret.click();
        }
      }
    });

    if (app.orgSetId !== "" || taxCols.size > 0) {
      if (taxCols.size > 0) treeCard.appendChild(groupSel);
      treeCard.appendChild(treeBox);
      nav.appendChild(treeCard);
      paintTree();
    }

    // boot: filters a shared/saved view carries beyond the organisation —
    // each needs its own set's walk for subtree ids
    for (const f of bootView?.filters ?? []) {
      const setId = setFor(f.col);
      if (setId === "" || filterFor(f.col) !== null) continue;
      void fetchTermPaths(app.siteUrl, setId, 4, 60).then(({ nodes }) => {
        if (dead) return;
        const match = nodes.find((n) => n.id === f.termId);
        if (match && filterFor(f.col) === null) applyFilter(f.col, match, nodes);
      });
    }

    // ---- the list ------------------------------------------------------
    const main = el("div", "app-docs-main");
    bodyRow.appendChild(main);
    const filterBar = el("div", "app-docs-filterbar");
    main.appendChild(filterBar);
    const status = el("div", "app-docs-status");
    main.appendChild(status);

    const paintChips = () => {
      clear(filterBar);
      for (const f of filters) {
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(
          document.createTextNode(`${colLabel(f.col)}: ${f.node.labels.join(" › ")}`)
        );
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = `Clear the ${colLabel(f.col)} filter`;
        x.addEventListener("click", () => applyFilter(f.col, null, []));
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      // add a filter on any other taxonomy column (same mechanism as the
      // tree — column, then term)
      const addable: string[] = [];
      if (app.orgSetId !== "" && orgProps.length > 0 && filterFor("") === null) addable.push("");
      for (const col of taxCols.keys()) {
        if (filterFor(col) === null) addable.push(col);
      }
      if (addable.length === 0 || favMode) return;
      const add = el("button", "app-docs-addfilter", "＋ Filter") as HTMLButtonElement;
      add.addEventListener("click", () => {
        if (menu) {
          closeMenu();
          return;
        }
        menu = el("div", "app-docs-menu");
        for (const col of addable) {
          const b = el("button", "app-docs-menuitem", colLabel(col)) as HTMLButtonElement;
          b.addEventListener("click", () => {
            closeMenu();
            const setId = setFor(col);
            if (setId === "") return;
            menu = el("div", "app-docs-menu app-docs-termmenu");
            menu.appendChild(el("div", "app-field-hint", "Loading terms…"));
            const anchor = add.getBoundingClientRect();
            menu.style.top = `${anchor.bottom + 4}px`;
            menu.style.left = `${anchor.left}px`;
            document.body.appendChild(menu);
            void fetchTermPaths(app.siteUrl, setId, 4, 60).then(({ nodes, error }) => {
              if (dead || !menu) return;
              clear(menu);
              if (error !== "" || nodes.length === 0) {
                menu.appendChild(el("div", "app-field-hint", "No terms found."));
                return;
              }
              for (const n of nodes) {
                const t = el("button", "app-docs-menuitem", n.labels[n.labels.length - 1]) as HTMLButtonElement;
                t.style.paddingLeft = `${10 + (n.labels.length - 1) * 12}px`;
                t.title = n.labels.join(" › ");
                t.addEventListener("click", () => {
                  closeMenu();
                  applyFilter(col, n, nodes);
                });
                menu!.appendChild(t);
              }
            });
          });
          menu!.appendChild(b);
        }
        const r = add.getBoundingClientRect();
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.left = `${r.left}px`;
        document.body.appendChild(menu);
      });
      filterBar.appendChild(add);
    };
    paintChips();

    const statusCol = current?.config.columns.find((c) => c.role === "status") ?? null;
    // glyph + word so status reads under any colour-vision (finding 5);
    // the fill still follows the site's configured status palette
    const statusChip = (value: string): HTMLElement => {
      const chip = el("span", "app-docs-chip", withStatusGlyph(value));
      const color = resolvePaletteColor(
        states,
        current?.config.statusColors[value] ?? "",
        ""
      );
      if (color !== "") {
        chip.style.background = color;
        chip.style.color = textOn(color);
      }
      return chip;
    };

    const nameCol: ListColumn<DocRow> = {
      key: "name",
      label: "Document",
      width: "minmax(220px, 2fr)",
      render: (row) => {
        const cell = el("span", "app-docs-namecell");
        cell.append(
          el("span", "app-docs-glyph", extGlyph(row.ext)),
          el("span", "app-docs-name", row.name)
        );
        return cell;
      },
    };
    const kebabCol: ListColumn<DocRow> = {
      key: "kebab",
      label: "",
      width: "34px",
      render: (row) => {
        const b = el("button", "app-kebab app-docs-kebab", "⋮") as HTMLButtonElement;
        b.setAttribute("aria-label", "Document actions");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          openKebab(b, row);
        });
        return b;
      },
    };
    const modifiedCol: ListColumn<DocRow> = {
      key: "modified",
      label: "Modified",
      width: "110px",
      render: (row) => formatWhen(row.modified),
    };

    // the view's own column set beats the library default (Phase 3a —
    // carried by saved views and shared links; [] = default)
    const chosenColumns = bootView?.columns ?? [];
    const columns: ListColumn<DocRow>[] = [nameCol];
    if (current) {
      const byInternal = new Map(current.config.columns.map((c) => [c.internal, c]));
      const shown: { internal: string; label: string; role: string }[] = [];
      if (chosenColumns.length > 0) {
        for (const internal of chosenColumns) {
          if (internal === "Modified") {
            shown.push({ internal: "Modified", label: "Modified", role: "" });
            continue;
          }
          const c = byInternal.get(internal);
          if (c && c.available) {
            shown.push({ internal, label: c.label !== "" ? c.label : internal, role: c.role });
          }
        }
      } else {
        for (const c of current.config.columns) {
          if (!c.inDefault) continue;
          shown.push({
            internal: c.internal,
            label: c.label !== "" ? c.label : c.internal,
            role: c.role,
          });
        }
      }
      for (const c of shown) {
        if (c.internal === "Modified") {
          columns.push(modifiedCol);
          continue;
        }
        const live = c.internal;
        const role = c.role;
        columns.push({
          key: live,
          label: c.label,
          render: (row) => {
            const v = row.values[live] ?? "";
            if (v === "") return "";
            return role === "status" ? statusChip(v) : v;
          },
        });
      }
      if (!shown.some((c) => c.internal === "Modified")) {
        columns.push(modifiedCol);
      }
    } else {
      columns.push(
        {
          key: "library",
          label: "Library",
          width: "minmax(110px, 1fr)",
          render: (row) => {
            const lib = byListId.get(row.listId);
            return lib ? lib.config.title || lib.name : "";
          },
        },
        modifiedCol
      );
    }
    columns.push(kebabCol);

    const list = mountDocList<DocRow>(main, {
      columns,
      emptyText: "No documents here yet.",
      onRow: (row) => {
        const lib = byListId.get(row.listId) ?? current;
        // the drive is per LIBRARY, and the PDF routes need it — resolve
        // before opening (cached, so only the first open of a library pays)
        void driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((driveId) => {
          if (dead) return;
          openDocViewer({
            site: app.siteUrl,
            row,
            driveId,
            libraryName: lib ? lib.config.title || lib.name : "",
            askToWork: lib?.libType === "working",
          });
        });
      },
      onNearEnd: () => void loadMore(),
    });
    const loadedRows = (): DocRow[] => list.rows();

    // ---- kebab menu ----------------------------------------------------
    let menu: HTMLElement | null = null;
    const closeMenu = () => {
      menu?.remove();
      menu = null;
    };
    document.addEventListener("pointerdown", (e) => {
      if (menu && !menu.contains(e.target as Node)) closeMenu();
    });
    const openKebab = (anchor: HTMLElement, row: DocRow) => {
      closeMenu();
      menu = el("div", "app-docs-menu");
      const item = (label: string, onPick: (() => void) | null, hint = "") => {
        const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
        if (onPick) {
          b.addEventListener("click", () => {
            closeMenu();
            onPick();
          });
        } else {
          b.disabled = true;
          if (hint !== "") b.title = hint;
        }
        menu!.appendChild(b);
      };
      const lib = byListId.get(row.listId) ?? current;
      if (whoId !== "") {
        const isFav = favs.some((f) => f.uniqueId === row.uniqueId);
        item(isFav ? "★ Remove favourite" : "☆ Add to favourites", () => {
          void toggleFavorite(whoId, {
            uniqueId: row.uniqueId,
            name: row.name,
            ext: row.ext,
            serverUrl: row.serverUrl,
            listId: row.listId,
          }).then((next) => {
            if (dead) return;
            favs = next;
            favHint.textContent = favs.length === 0 ? "" : String(favs.length);
            if (favMode) void load(true);
          });
        });
      }
      item("Properties & history", () =>
        openDocProperties({
          site: app.siteUrl,
          row,
          labels: Object.fromEntries(
            (lib?.config.columns ?? [])
              .filter((c) => c.label !== "")
              .map((c) => [c.internal, c.label])
          ),
          linkColumns: (lib?.config.columns ?? [])
            .filter((c) => c.role === "linkedDocuments")
            .map((c) => c.internal),
          // readers see the register's fields, not SharePoint's plumbing:
          // exactly the columns ticked available in the library settings
          columns: lib
            ? lib.config.columns.filter((c) => c.available).map((c) => c.internal)
            : undefined,
        })
      );
      // readers get the PDF rendering, never the editable source
      const pdfUrl = () =>
        driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((d) =>
          pdfViewUrlFor(app.siteUrl, d, row)
        );
      item("Open PDF ↗", () => {
        // opened synchronously with about:blank so the popup blocker sees
        // a user gesture, then pointed at the URL once the drive resolves
        const tab = window.open("", "_blank", "noopener");
        void pdfUrl().then((u) => {
          if (tab) tab.location.href = u;
          else window.open(u, "_blank", "noopener");
        });
      });
      item("Copy PDF link", () => {
        void pdfUrl().then((u) => navigator.clipboard.writeText(u));
      });
      if (lib?.libType === "working") {
        item("Request check-out", null, "Document control arrives in a later phase");
      }
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    };

    // ---- data flow -----------------------------------------------------
    let query = bootView?.query ?? "";
    let generation = 0;
    let nextToken = ""; // browse: next uri; search: startRow as string
    let inFlight = false;
    let done = false;

    const applyNonCurrent = (rows: DocRow[]): DocRow[] => {
      if (nonCurrentBox.checked || !statusCol) return rows;
      return rows.filter((r) => !isNonCurrentStatus(r.values[statusCol.internal] ?? ""));
    };

    const paintStatus = (total: number | null, error: string) => {
      if (error !== "") {
        status.textContent = `Something refused: ${error}`;
        return;
      }
      const n = list.count();
      if (n === 0) {
        // an empty answer names the way out rather than dead-ending
        status.textContent =
          filters.length > 0 || query.trim() !== ""
            ? "No documents match — clear filters or change the search."
            : "No documents here yet.";
        return;
      }
      const docs = (k: number) => `${k} document${k === 1 ? "" : "s"}`;
      status.textContent =
        query.trim() === "" && current && filters.length === 0
          ? docs(n)
          : total !== null && total > n
            ? `${docs(n)} of ${total} matching`
            : `${docs(n)} matching`;
    };

    const load = async (reset: boolean) => {
      if (inFlight || (done && !reset)) return;
      // favourites are local rows — no query, no paging
      if (favMode) {
        list.setRows(
          favs.map((f) => ({
            id: 0,
            uniqueId: f.uniqueId,
            name: f.name,
            ext: f.ext,
            serverUrl: f.serverUrl,
            listId: f.listId,
            modified: "",
            values: {},
          }))
        );
        done = true;
        status.textContent = `${favs.length} favourite(s)`;
        return;
      }
      inFlight = true;
      const gen = reset ? ++generation : generation;
      if (reset) {
        nextToken = "";
        done = false;
        list.setRows([]);
      }
      list.setLoading(true);
      // any taxonomy filter forces search mode: list REST cannot filter
      // by taxonomy, the index can
      const useSearch =
        query.trim() !== "" ||
        current === null ||
        scope.value === "all" ||
        filters.length > 0;
      lastUsedSearch = useSearch;
      if (useSearch) {
        const startRow = nextToken === "" ? 0 : Number(nextToken);
        // never unscoped: the library in view, the ticked set, or every
        // library this site exposes — the corpus is what was configured,
        // not the whole SharePoint tenant
        const page = await searchPage(app.siteUrl, query, {
          listIds:
            current && scope.value === "library"
              ? [current.listId]
              : current
                ? allListIds
                : selectedIds,
          rowLimit: PAGE,
          startRow,
          searchContents: contentsBox.checked,
          termFilters:
            filters.length > 0
              ? filters.map((f) => ({ properties: propsFor(f.col), termIds: f.ids }))
              : undefined,
        });
        if (dead || gen !== generation) return;
        list.append(applyNonCurrent(page.rows));
        nextToken = String(startRow + page.rows.length);
        done = page.rows.length < PAGE;
        paintStatus(page.total, page.error);
      } else {
        const page = await browsePage(app.siteUrl, current!.listId, nextToken);
        if (dead || gen !== generation) return;
        list.append(applyNonCurrent(page.rows));
        nextToken = page.next;
        done = page.next === "";
        paintStatus(null, page.error);
      }
      list.setLoading(false);
      inFlight = false;
      paintTreeCounts();
    };
    const loadMore = () => load(false);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    search.addEventListener("input", () => {
      query = search.value;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => void load(true), 300);
    });
    scope.addEventListener("change", () => void load(true));
    contentsBox.addEventListener("change", () => void load(true));
    nonCurrentBox.addEventListener("change", () => void load(true));
    // the heuristic toggle only bites where a status column is mapped
    if (!statusCol) {
      nonCurrentBox.disabled = true;
      nonCurrent.title = current
        ? "Map a column to the Approval status role in Settings → Documents first"
        : "Applies inside a library with a status column mapped";
    }

    // ---- share + register export ---------------------------------------
    const currentView = (): DocView => {
      const org = filterFor("");
      return {
        ...emptyDocView(),
        listId: current?.listId ?? "",
        query: query.trim(),
        contents: contentsBox.checked,
        nonCurrent: nonCurrentBox.checked,
        // the organisation keeps its own slot so pre-3a links stay valid
        orgTermId: org?.node.id ?? "",
        orgPath: org?.node.labels ?? [],
        filters: filters
          .filter((f) => f.col !== "")
          .map((f) => ({ col: f.col, termId: f.node.id, path: f.node.labels })),
        columns: chosenColumns,
        groupBy,
      };
    };
    const copyViewLink = () => {
      void navigator.clipboard
        .writeText(docsViewUrl(encodeDocView(currentView())))
        .then(() => {
          status.textContent = "Link copied ✓ — it opens Documents exactly as you see it now.";
        });
    };
    const EXPORT_CAP = 2000;
    let exporting = false;
    const exportRegister = () => {
      if (exporting) return;
      void (async () => {
        exporting = true;
        status.textContent = "Exporting…";
        const scopeLibs = current
          ? [current]
          : libraries.filter((l) => isSelected(l.listId));
        // the union of configured available columns, labelled
        const cols: { internal: string; label: string }[] = [];
        for (const lib of scopeLibs) {
          for (const c of lib.config.columns) {
            if (!c.available) continue;
            if (!cols.some((x) => x.internal === c.internal)) {
              cols.push({ internal: c.internal, label: c.label || c.internal });
            }
          }
        }
        const rows: string[][] = [];
        let truncated = false;
        for (const lib of scopeLibs) {
          let next = "";
          for (;;) {
            const page = await browsePage(app.siteUrl, lib.listId, next);
            for (const r of page.rows) {
              if (rows.length >= EXPORT_CAP) {
                truncated = true;
                break;
              }
              rows.push([
                r.name,
                lib.config.title || lib.name,
                formatWhen(r.modified),
                ...cols.map((c) => r.values[c.internal] ?? ""),
              ]);
            }
            next = page.next;
            if (next === "" || truncated || page.error !== "") break;
          }
          if (truncated) break;
        }
        const csv = toCsv(
          ["Document", "Library", "Modified", ...cols.map((c) => c.label)],
          rows
        );
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const a = el("a", "") as HTMLAnchorElement;
        a.href = URL.createObjectURL(blob);
        a.download = `documents-register-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        exporting = false;
        status.textContent = `${rows.length} row(s) exported${truncated ? ` — capped at ${EXPORT_CAP}` : ""}`;
      })();
    };
    /** Pick the view's columns from the library's available set — the
     *  choice rides the view state, so saved views and shared links
     *  carry it (spec: "users can add/remove available columns"). */
    const chooseColumns = () => {
      if (!current) return;
      const lib = current;
      const scrim = el("div", "app-docs-scrim");
      const dialog = el("div", "app-docs-dialog app-docs-chooser");
      scrim.appendChild(dialog);
      const head = el("div", "app-docs-viewhead");
      head.appendChild(el("span", "app-docs-viewname", "Choose columns"));
      const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
      x.addEventListener("click", () => scrim.remove());
      head.appendChild(x);
      dialog.appendChild(head);
      const body = el("div", "app-docs-propsbody");
      dialog.appendChild(body);
      const effective =
        chosenColumns.length > 0
          ? chosenColumns
          : [
              ...lib.config.columns.filter((c) => c.inDefault).map((c) => c.internal),
              "Modified",
            ];
      const entries = [
        ...lib.config.columns
          .filter((c) => c.available)
          .map((c) => ({ internal: c.internal, label: c.label !== "" ? c.label : c.internal })),
        { internal: "Modified", label: "Modified" },
      ];
      // ordered model: the shown columns first in their current order,
      // the rest after — ticks choose, drag sets the order (Ben,
      // 2026-07-30), and Apply reads the ticked rows top to bottom
      const rows: { internal: string; label: string; on: boolean }[] = [];
      for (const key of effective) {
        const e = entries.find((x) => x.internal === key);
        if (e) rows.push({ ...e, on: true });
      }
      for (const e of entries) {
        if (!rows.some((r) => r.internal === e.internal)) rows.push({ ...e, on: false });
      }
      body.appendChild(
        el("div", "app-field-hint", "Tick the columns to show; drag ⠿ to set their order.")
      );
      const listBox = el("div", "app-docs-colslist");
      body.appendChild(listBox);
      const paintRows = () => {
        clear(listBox);
        rows.forEach((r, i) => {
          const row = el("div", "app-docs-colorderrow");
          const handle = el("span", "app-drag-handle", "⠿");
          handle.title = "Drag to reorder";
          const pick = el("label", "app-docs-check");
          const box = el("input", "") as HTMLInputElement;
          box.type = "checkbox";
          box.checked = r.on;
          box.addEventListener("change", () => {
            r.on = box.checked;
          });
          pick.append(box, document.createTextNode(` ${r.label}`));
          row.append(handle, pick);
          draggableRow(row, handle, "docs-cols", i, rows, paintRows);
          listBox.appendChild(row);
        });
      };
      paintRows();
      const actions = el("div", "app-docs-viewactions");
      const apply = el("button", "app-btn app-btn-primary", "Apply") as HTMLButtonElement;
      apply.addEventListener("click", () => {
        const picked = rows.filter((r) => r.on).map((r) => r.internal);
        scrim.remove();
        pendingView = { ...currentView(), columns: picked };
        remount();
      });
      const reset = el("button", "app-btn", "Reset to default") as HTMLButtonElement;
      reset.addEventListener("click", () => {
        scrim.remove();
        pendingView = { ...currentView(), columns: [] };
        remount();
      });
      actions.append(apply, reset);
      dialog.appendChild(actions);
      scrim.addEventListener("pointerdown", (e) => {
        if (e.target === scrim) scrim.remove();
      });
      document.body.appendChild(scrim);
    };

    topKebab.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu");
      const item = (label: string, title: string, onPick: () => void) => {
        const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
        b.title = title;
        b.addEventListener("click", () => {
          closeMenu();
          onPick();
        });
        menu!.appendChild(b);
      };
      if (current) {
        item(
          "Choose columns…",
          "Add or remove this view's columns from the library's available set.",
          chooseColumns
        );
      }
      item(
        "Copy link to this view",
        "A link that opens Documents exactly as you see it now.",
        copyViewLink
      );
      item(
        "Export register (CSV)",
        "Every document in the current scope with its configured columns " +
          "(search text is not applied).",
        exportRegister
      );
      const r = topKebab.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    });

    void load(true);
  })();

  return () => {
    dead = true;
    wrap.remove();
  };
}
