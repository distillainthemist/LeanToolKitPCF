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
  DocView,
  FavDoc,
  decodeDocView,
  emptyDocView,
  encodeDocView,
  toCsv,
} from "./views";
import { deleteDocView, docPrefs, saveDocView, toggleFavorite } from "./prefs";

// Applied by the next mount: saved-view clicks and the Favourites entry
// re-mount the screen in place (the embedded pattern), and the state
// rides here rather than in the hash.
let pendingView: DocView | null = null;
let pendingFav = false;
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

    const current: DocLibrary | null = favMode
      ? null
      : (byListId.get((bootView?.listId || selected).toLowerCase()) ?? null);
    const whoId = currentViewer()?.objectId ?? "";
    let favs: FavDoc[] = [];
    let savedViews: DocView[] = [];

    // ---- chrome: title, search, controls -------------------------------
    const top = el("div", "app-docs-top");
    if (!opts.embedded) top.appendChild(el("h2", "app-docs-title", "Documents"));
    const search = el("input", "app-input app-docs-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = favMode
      ? "Favourites"
      : current
        ? `Search ${current.config.title || current.name}…`
        : "Search all documents…";
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
    contents.append(contentsBox, document.createTextNode(" Search inside documents"));
    contents.title =
      "Off, this matches document names and titles — how you look for something " +
      "you know exists. On, it also matches the text inside every document, " +
      "which finds far more.";
    const nonCurrent = el("label", "app-docs-check app-docs-noncurrent");
    const nonCurrentBox = el("input", "") as HTMLInputElement;
    nonCurrentBox.type = "checkbox";
    nonCurrent.append(nonCurrentBox, document.createTextNode(" Include drafts & superseded"));
    if (bootView) {
      contentsBox.checked = bootView.contents;
      nonCurrentBox.checked = bootView.nonCurrent;
    }

    // share the CURRENT filter as a player link (FR-SE — views travel as
    // state, not ids), and export the register (FR-RP-008)
    const shareBtn = el("button", "app-btn", "Copy link") as HTMLButtonElement;
    shareBtn.title = "A link that opens Documents exactly as you see it now.";
    const exportBtn = el("button", "app-btn", "Export") as HTMLButtonElement;
    exportBtn.title =
      "Download the register as CSV — every document in the current scope " +
      "with its configured columns (search text is not applied).";
    top.append(search, scope, contents, nonCurrent, shareBtn, exportBtn);
    if (favMode) {
      scope.style.display = "none";
      contents.style.display = "none";
      nonCurrent.style.display = "none";
      shareBtn.style.display = "none";
      exportBtn.style.display = "none";
    }
    wrap.appendChild(top);

    const bodyRow = el("div", "app-docs-body");
    wrap.appendChild(bodyRow);

    // ---- left nav ------------------------------------------------------
    const nav = el("nav", "app-docs-nav");
    bodyRow.appendChild(nav);
    const navLink = (label: string, listId: string, active: boolean, hint = "") => {
      const a = el("a", `app-docs-navitem${active ? " app-docs-navitem-on" : ""}`) as HTMLAnchorElement;
      a.href = listId === "" ? "#/docs" : `#/docs/${listId}`;
      a.append(el("span", "app-docs-navlabel", label));
      if (hint !== "") a.appendChild(el("span", "app-field-hint", hint));
      if (opts.embedded) {
        // stay inside the hub tab: remount in place, never touch the hash
        a.addEventListener("click", (e) => {
          e.preventDefault();
          dead = true;
          wrap.remove();
          mountDocs(parent, listId, opts);
        });
      }
      nav.appendChild(a);
      return a;
    };
    navLink("All documents", "", current === null && !favMode);
    for (const lib of libraries) {
      navLink(
        lib.config.title || lib.name,
        lib.listId,
        current?.listId === lib.listId,
        lib.libType
      );
    }

    /** Re-mount in place with a stashed boot state (both modes — the
     *  embedded pattern; the hash stays put). */
    const remount = () => {
      dead = true;
      wrap.remove();
      mountDocs(parent, "", opts);
    };

    // ---- favourites ----------------------------------------------------
    const favLink = el(
      "a",
      `app-docs-navitem${favMode ? " app-docs-navitem-on" : ""}`
    ) as HTMLAnchorElement;
    favLink.href = "#/docs";
    favLink.appendChild(el("span", "app-docs-navlabel", "★ Favourites"));
    const favHint = el("span", "app-field-hint", "");
    favLink.appendChild(favHint);
    favLink.addEventListener("click", (e) => {
      e.preventDefault();
      pendingFav = true;
      remount();
    });
    nav.appendChild(favLink);

    // ---- saved views ---------------------------------------------------
    const viewsHead = el("div", "app-docs-navorg", "Views");
    nav.appendChild(viewsHead);
    const viewsBox = el("div", "app-docs-navorgbox");
    nav.appendChild(viewsBox);
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
        const link = el("button", "app-docs-viewbtn", "⧉") as HTMLButtonElement;
        link.title = "Copy a link that opens this view";
        link.addEventListener("click", () => {
          void navigator.clipboard.writeText(docsViewUrl(encodeDocView(v)));
          link.textContent = "✓";
          setTimeout(() => (link.textContent = "⧉"), 1200);
        });
        const x = el("button", "app-docs-viewbtn", "×") as HTMLButtonElement;
        x.title = "Delete this view";
        x.addEventListener("click", () => {
          void deleteDocView(whoId, v.name).then((list) => {
            if (dead) return;
            savedViews = list;
            paintViews();
          });
        });
        row.append(open, link, x);
        viewsBox.appendChild(row);
      }
      // save the current filter under a name (inline, no dialog)
      const saveRow = el("div", "app-docs-viewrow");
      const nameIn = el("input", "app-input app-docs-viewname") as HTMLInputElement;
      nameIn.placeholder = "Save current view…";
      const ok = el("button", "app-docs-viewbtn", "＋") as HTMLButtonElement;
      ok.title = "Save the current filter as a view";
      const commit = () => {
        const name = nameIn.value.trim();
        if (name === "" || whoId === "" || favMode) return;
        void saveDocView(whoId, { ...currentView(), name }).then((list) => {
          if (dead) return;
          savedViews = list;
          paintViews();
        });
      };
      ok.addEventListener("click", commit);
      nameIn.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
      });
      saveRow.append(nameIn, ok);
      viewsBox.appendChild(saveRow);
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
    // ---- organisation tree — a real filter now -------------------------
    // Filtering keys on the auto-created owstaxId<Column> property with
    // term GUIDs (verified 2026-07-28: no admin mapping needed on the dev
    // tenant). A GUID matches only its exact term, so picking a node ORs
    // the node with its whole subtree — the walk yields it anyway.
    const orgCols = new Set<string>();
    for (const lib of libraries) {
      for (const c of lib.config.columns) if (c.role === "orgUnit") orgCols.add(c.internal);
    }
    const orgProps = [...orgCols].map(taxonomySearchProperty);
    let termNodes: TermNode[] = [];
    let orgFilter: { node: TermNode; ids: string[] } | null = null;
    const orgButtons = new Map<string, HTMLElement>();

    const paintOrgSelection = () => {
      for (const [id, btn] of orgButtons) {
        btn.classList.toggle("app-docs-navterm-on", orgFilter?.node.id === id);
      }
    };

    const subtreeIds = (node: TermNode): string[] =>
      termNodes
        .filter(
          (n) =>
            n.id === node.id ||
            (n.labels.length > node.labels.length &&
              node.labels.every((l, i) => n.labels[i] === l))
        )
        .map((n) => n.id);

    const applyOrg = (node: TermNode | null) => {
      orgFilter = node === null ? null : { node, ids: subtreeIds(node) };
      paintOrgSelection();
      paintChip();
      void load(true);
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
      for (const n of termNodes) {
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

    if (app.orgSetId !== "") {
      const orgHead = el("div", "app-docs-navorg", "Organisation");
      nav.appendChild(orgHead);
      const orgBox = el("div", "app-docs-navorgbox");
      nav.appendChild(orgBox);
      orgBox.appendChild(el("div", "app-field-hint", "Loading…"));
      void fetchTermPaths(app.siteUrl, app.orgSetId, 3, 40).then(async ({ nodes, error }) => {
        if (dead) return;
        clear(orgBox);
        if (error !== "" || nodes.length === 0) {
          orgBox.appendChild(el("div", "app-field-hint", "No organisation terms yet."));
          return;
        }
        termNodes = nodes;
        for (const n of nodes) {
          const btn = el("button", "app-docs-navterm", n.labels[n.labels.length - 1]) as HTMLButtonElement;
          btn.style.paddingLeft = `${8 + (n.labels.length - 1) * 14}px`;
          if (orgProps.length === 0) {
            btn.disabled = true;
            btn.title =
              "Map a column to the Organisation unit role in Settings → Documents to filter by organisation.";
          } else {
            btn.title = n.labels.join(" › ");
            btn.addEventListener("click", () =>
              applyOrg(orgFilter?.node.id === n.id ? null : n)
            );
          }
          orgButtons.set(n.id, btn);
          orgBox.appendChild(btn);
        }
        // a shared/saved view's org filter first; otherwise land on the
        // viewer's own corner of the organisation (chip makes either
        // one-click removable)
        const wantOrg = bootView?.orgTermId ?? "";
        if (wantOrg !== "") {
          const match = nodes.find((x) => x.id === wantOrg);
          if (match) applyOrg(match);
        } else if (
          orgProps.length > 0 &&
          orgFilter === null &&
          bootView === null &&
          !favMode
        ) {
          const mine = await viewerNode();
          if (!dead && mine && orgFilter === null) applyOrg(mine);
        }
      });
    }

    // ---- the list ------------------------------------------------------
    const main = el("div", "app-docs-main");
    bodyRow.appendChild(main);
    const filterBar = el("div", "app-docs-filterbar");
    main.appendChild(filterBar);
    const status = el("div", "app-docs-status");
    main.appendChild(status);

    const paintChip = () => {
      clear(filterBar);
      if (!orgFilter) return;
      const chip = el("span", "app-docs-orgchip");
      chip.appendChild(
        document.createTextNode(`Organisation: ${orgFilter.node.labels.join(" › ")}`)
      );
      const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
      x.title = "Clear the organisation filter";
      x.addEventListener("click", () => applyOrg(null));
      chip.appendChild(x);
      filterBar.appendChild(chip);
    };

    const statusCol = current?.config.columns.find((c) => c.role === "status") ?? null;
    const statusChip = (value: string): HTMLElement => {
      const chip = el("span", "app-docs-chip", value);
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

    const columns: ListColumn<DocRow>[] = [nameCol];
    if (current) {
      for (const c of current.config.columns) {
        if (!c.inDefault) continue;
        const live = c.internal;
        columns.push({
          key: live,
          label: c.label !== "" ? c.label : live,
          render: (row) => {
            const v = row.values[live] ?? "";
            if (v === "") return "";
            return c.role === "status" ? statusChip(v) : v;
          },
        });
      }
      if (!current.config.columns.some((c) => c.inDefault && c.internal === "Modified")) {
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
      status.textContent =
        query.trim() === "" && current
          ? `${n} document(s) loaded`
          : `${n}${total !== null && total > n ? ` of ${total}` : ""} result(s)`;
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
      // an organisation filter forces search mode: list REST cannot
      // filter by taxonomy, the index can
      const useSearch =
        query.trim() !== "" ||
        current === null ||
        scope.value === "all" ||
        orgFilter !== null;
      if (useSearch) {
        const startRow = nextToken === "" ? 0 : Number(nextToken);
        // never unscoped: either the library in view, or every library
        // this site exposes — the corpus is what was configured, not the
        // whole SharePoint tenant
        const page = await searchPage(app.siteUrl, query, {
          listIds:
            current && scope.value === "library" ? [current.listId] : allListIds,
          rowLimit: PAGE,
          startRow,
          searchContents: contentsBox.checked,
          termFilter: orgFilter
            ? { properties: orgProps, termIds: orgFilter.ids }
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
    const currentView = (): DocView => ({
      ...emptyDocView(),
      listId: current?.listId ?? "",
      query: query.trim(),
      contents: contentsBox.checked,
      nonCurrent: nonCurrentBox.checked,
      orgTermId: orgFilter?.node.id ?? "",
      orgPath: orgFilter?.node.labels ?? [],
    });
    shareBtn.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(docsViewUrl(encodeDocView(currentView())))
        .then(() => {
          shareBtn.textContent = "Copied ✓";
          setTimeout(() => (shareBtn.textContent = "Copy link"), 1500);
        });
    });
    const EXPORT_CAP = 2000;
    exportBtn.addEventListener("click", () => {
      void (async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = "Exporting…";
        const scopeLibs = current ? [current] : libraries;
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
        exportBtn.disabled = false;
        exportBtn.textContent = "Export";
        status.textContent = `${rows.length} row(s) exported${truncated ? ` — capped at ${EXPORT_CAP}` : ""}`;
      })();
    });

    void load(true);
  })();

  return () => {
    dead = true;
    wrap.remove();
  };
}
