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
import { fileTypeChip, withStatusGlyph } from "../../../shared/ui/format";
import { draggableRow } from "../../../shared/ui/dragList";
import { showLoading } from "../loading";
import { detectHost } from "../runtime";
import { paletteMap, resolvePaletteColor } from "../../../shared/palette";
import { textOn } from "../../../shared/tokens";
import { appPalettes } from "../store/config";
import {
  driveIdFor,
  listItemCount,
  renderListPage,
  searchPage,
  tileThumbFor,
} from "./data";
import { DocList, ListColumn, mountDocList } from "./listView";
import { mountDocTiles } from "./docsTiles";
import {
  DocRow,
  browseComparator,
  buildRenderViewXml,
  formatWhen,
  isNonCurrentStatus,
  pdfViewUrlFor,
  pickBrowseHead,
  splitNameForEllipsis,
  tallySubtreeCounts,
  taxonomySearchProperty,
} from "./rows";
import { DocLibrary, docsConfig } from "./docsStore";
import {
  BasePermissions,
  emptySiteDictionary,
  isDateColumn,
  paletteEntryFor,
  parseBasePermissions,
  siteKey,
  sortByDictionary,
  sortLibrariesForDisplay,
  spErrorText,
} from "./model";
import {
  TermNode,
  checkInFile,
  checkOutFile,
  fetchFileInfo,
  fetchListPermissions,
  fetchTermPaths,
  fetchTermsInSet,
  undoCheckOut,
} from "./sp";
import { openDialog } from "../../../shared/ui/dialog";
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
import { openDocViewer } from "./viewer";

const PAGE = 50;

/**
 * How many rows the folder counts may read per library. They are ids and
 * one column, so this is cheap — but a library past the cap would report
 * a floor as if it were a total, and the tree falls back to counting
 * loaded rows instead of overstating.
 */
const COUNT_CAP = 2000;

/**
 * How many content matches the index may contribute to one search.
 * CAML's `In` operator carries at most 500 values, and postquery returns
 * at most 500 rows a page — so 500 is both engines' natural ceiling.
 * Ranked by relevance, so a truncated set is the BEST content matches,
 * and the status line says when it truncated rather than implying the
 * answer was complete.
 */
const CONTENT_HITS = 500;

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
  // document-level listeners this mount registers (Cmd/K, menu close) —
  // run on the returned cleanup AND on in-place remounts, or every
  // library click would stack another global listener
  const innerCleanups: (() => void)[] = [];

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

    const { app } = cfg;
    // display order everywhere libraries are listed: standards, working,
    // revision, records, templates — then by name (Ben, 2026-08-04)
    const libraries = sortLibrariesForDisplay(cfg.libraries);
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
    /** Who I am to SharePoint. Email, because that is what a person
     *  field carries back and what makes "checked out by me" reliable. */
    const myEmail = (currentViewer()?.email ?? "").toLowerCase();

    // ---- document control state (Phase 4B/4C) ---------------------------
    // Declared up here because the toolbar reads it synchronously while
    // it is being built; the commands themselves live further down.

    /** listId → what SharePoint says this user may do. Primed for the
     *  writable libraries at mount, so the kebab can answer instantly. */
    const permsByLib = new Map<string, BasePermissions>();

    const permsReady = Promise.all(
      libraries
        .filter((l) => l.libType === "working" || l.libType === "revision")
        .map(async (l) => {
          const r = await fetchListPermissions(app.siteUrl, l.listId);
          if (r.ok) permsByLib.set(l.listId.toLowerCase(), parseBasePermissions(r.data));
        })
    );

    /** One host for every command dialog, carrying the toolkit's colour
     *  variables — see .app-dlghost. Created once, reused, so nothing
     *  accumulates on the body. */
    const dialogHost = el("div", "app-dlghost");
    document.body.appendChild(dialogHost);
    innerCleanups.push(() => dialogHost.remove());

    /** The open document overlay's repaint, while one is open. A command
     *  run from the overlay changes state the overlay is showing, so it
     *  has to hear about it — discarding a check-out left "Check in…"
     *  sitting there otherwise (Ben, 2026-08-03). */
    let viewerRepaint: (() => void) | null = null;

    const canWriteIn = (lib: DocLibrary | null | undefined): boolean =>
      lib != null &&
      (lib.libType === "working" || lib.libType === "revision") &&
      (permsByLib.get(lib.listId.toLowerCase())?.edit ?? false);

    /** Mine by EMAIL. Display names collide, and two people called Ben
     *  would each be offered the other's check-in. */
    const isMine = (row: DocRow): boolean =>
      myEmail !== "" && (row.checkoutEmail ?? "") === myEmail;
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

    // ---- what a column MEANS (C3) ---------------------------------------
    // Every question below used to be asked of `current`, which is null
    // the moment two libraries are ticked — so the union register lost
    // its status, owner and type columns entirely, and the data layer
    // stopped even requesting them (the plan's finding F2). A column's
    // meaning belongs to the site, so it is answered by the dictionary
    // and holds however many libraries are in view.
    const siteDict = app.sites[siteKey(app.siteUrl)] ?? emptySiteDictionary();
    const dictBy = new Map(siteDict.columns.map((c) => [c.internal, c]));
    /** The libraries whose rows can appear right now. */
    const viewLibs = (): DocLibrary[] =>
      scopeAll ? libraries : libraries.filter((l) => isSelected(l.listId));
    const roleOf = (internal: string): string => dictBy.get(internal)?.role ?? "";
    const labelOf = (internal: string): string => {
      const c = dictBy.get(internal);
      return c && c.label !== "" ? c.label : internal;
    };
    const internalForRole = (role: string): string =>
      siteDict.columns.find((c) => c.role === role)?.internal ?? "";
    const statusInternal = internalForRole("status");
    const ownerInternal = internalForRole("owner");
    const reviewInternal = internalForRole("nextReviewDate");
    /**
     * The register's columns: the view's own choice when there is one,
     * otherwise every column any library in view opens with — in
     * dictionary order, so two libraries never disagree about sequence.
     * A row whose library lacks a column simply shows nothing there.
     */
    const defaultInternals = (): string[] => {
      const libs = viewLibs();
      const wanted = new Set<string>();
      for (const lib of libs) {
        for (const c of lib.config.columns) if (c.inDefault) wanted.add(c.internal);
      }
      const out = siteDict.columns
        .filter((c) => c.available && wanted.has(c.internal))
        .map((c) => c.internal);
      // a site with no dictionary yet (nothing exposed) still browses
      return out.length > 0 ? out : [...wanted];
    };

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
    // (the Cmd/K shortcut and keycap badge were cut — Ben, 2026-08-01)
    const searchWrap = el("div", "app-docs-searchwrap");
    searchWrap.appendChild(search);

    // ---- scope + depth: one dropdown (Vault V2, finding 4) -------------
    // Scope picks the corpus — the ticked set or every exposed library,
    // NEVER the wider SharePoint (the app's standing corpus rule; the
    // Vault's "Everything (all sites)" option is deliberately not built).
    // Depth widens matching from names/titles to contents & every field.
    let scopeAll = false;
    let searchContents = bootView?.contents ?? false;
    const scopeBtn = el("button", "app-btn app-docs-scopebtn") as HTMLButtonElement;
    scopeBtn.title =
      "What to search: the libraries you have ticked, or every library " +
      "this site exposes — never the wider SharePoint.";
    const scopeLabel = (): string =>
      scopeAll || allSelected
        ? "All libraries"
        : current
          ? "This library"
          : "Selected libraries";
    const paintScopeBtn = () => {
      scopeBtn.textContent = `${scopeLabel()} ▾`;
    };
    paintScopeBtn();
    scopeBtn.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu");
      const pick = (label: string, on: boolean, onPick: () => void) => {
        const b = el("button", "app-docs-menuitem", `${on ? "✓ " : ""}${label}`) as HTMLButtonElement;
        b.setAttribute("aria-pressed", String(on));
        b.addEventListener("click", () => {
          closeMenu();
          onPick();
        });
        menu!.appendChild(b);
      };
      if (!allSelected) {
        pick(current ? "This library" : "Selected libraries", !scopeAll, () => {
          scopeAll = false;
          paintScopeBtn();
          void load(true);
        });
      }
      pick("All libraries", scopeAll || allSelected, () => {
        scopeAll = true;
        paintScopeBtn();
        void load(true);
      });
      menu.appendChild(el("div", "app-docs-menusep", ""));
      const depth = el(
        "button",
        "app-docs-menuitem",
        `${searchContents ? "✓ " : ""}Match contents & every field`
      ) as HTMLButtonElement;
      depth.title =
        "Off, search matches document names and titles — how you look for " +
        "something you know exists. On, it ALSO matches what the index " +
        "reads inside each document, so it can only add results, never " +
        "take them away.";
      depth.addEventListener("click", () => {
        closeMenu();
        searchContents = !searchContents;
        void load(true);
      });
      menu.appendChild(depth);
      const r = scopeBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 240)}px`;
      document.body.appendChild(menu);
    });

    // ---- My tasks (Phase 4D) -------------------------------------------
    // The V2 "Action needed" placeholder, live. A QUERY, not a store:
    // documents checked out to me (any exposed library) and documents I
    // own whose review date is due — both answered by SharePoint's own
    // columns via CAML <UserID/>, so there is no state to go stale and
    // nothing to sweep. Checking a document in makes it leave the list
    // because the list never existed anywhere else.
    const actionNeeded = el("button", "app-btn app-docs-actionneeded", "My tasks") as HTMLButtonElement;
    actionNeeded.title = "Documents checked out to you, and your documents due for review";

    interface TaskRow {
      row: DocRow;
      libName: string;
      why: string;
      overdue: boolean;
    }
    /** "Near" for a review date: due within this many days counts. */
    const REVIEW_HORIZON_DAYS = 30;

    const fetchMyTasks = async (): Promise<{ held: TaskRow[]; review: TaskRow[] }> => {
      const held: TaskRow[] = [];
      const review: TaskRow[] = [];
      const nameOf = (l: DocLibrary) => l.config.title || l.name;
      await Promise.all(
        libraries.map(async (l) => {
          const page = await renderListPage(
            app.siteUrl,
            l.listId,
            buildRenderViewXml({ checkedOutToMe: true, fields: ["CheckoutUser"], rowLimit: 30 })
          );
          for (const row of page.rows) {
            held.push({ row, libName: nameOf(l), why: "Checked out to you", overdue: false });
          }
        })
      );
      if (reviewInternal !== "" && ownerInternal !== "") {
        const carriers = libraries.filter((l) => {
          const set = new Set(l.config.columns.map((c) => c.internal));
          return set.has(reviewInternal) && set.has(ownerInternal);
        });
        await Promise.all(
          carriers.map(async (l) => {
            const page = await renderListPage(
              app.siteUrl,
              l.listId,
              buildRenderViewXml({
                personIsMe: ownerInternal,
                dueWithinDays: { col: reviewInternal, days: REVIEW_HORIZON_DAYS },
                fields: [reviewInternal],
                rowLimit: 30,
              })
            );
            for (const row of page.rows) {
              const when = row.values[reviewInternal] ?? "";
              // membership in the list is SharePoint's (server-side
              // Today+offset); this flag only colours the row, and
              // Date.parse of a display date is a heuristic that may
              // misread day-first locales — acceptable for a colour
              const t = Date.parse(when);
              const overdue = !Number.isNaN(t) && t < Date.now();
              review.push({
                row,
                libName: nameOf(l),
                why: when === "" ? "Review due" : overdue ? `Review overdue · ${when}` : `Review due · ${when}`,
                overdue,
              });
            }
          })
        );
      }
      return { held, review };
    };

    let tasksBadgeGen = 0;
    const paintTasksBadge = (n: number) => {
      actionNeeded.textContent = n > 0 ? `My tasks · ${n}` : "My tasks";
      actionNeeded.classList.toggle("app-docs-actionneeded-hot", n > 0);
    };
    /** Recounted in the background — at mount, and after every command
     *  that can change the answer (check-out/in/discard, add). */
    const refreshTasksBadge = () => {
      const gen = ++tasksBadgeGen;
      void fetchMyTasks().then(({ held, review }) => {
        if (dead || gen !== tasksBadgeGen) return;
        paintTasksBadge(held.length + review.length);
      });
    };
    refreshTasksBadge();

    actionNeeded.addEventListener("click", () => {
      const scrim = el("div", "app-docs-tasksscrim");
      const panel = el("div", "app-docs-taskspanel");
      const closePanel = () => {
        scrim.remove();
        document.removeEventListener("keydown", onTasksKey, true);
      };
      const onTasksKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePanel();
        }
      };
      document.addEventListener("keydown", onTasksKey, true);
      scrim.addEventListener("pointerdown", (e) => {
        if (e.target === scrim) closePanel();
      });
      const r = actionNeeded.getBoundingClientRect();
      panel.style.top = `${r.bottom + 6}px`;
      panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      const bodyEl = el("div", "app-docs-tasksbody");
      bodyEl.appendChild(el("div", "app-loading-line", "Asking SharePoint…"));
      panel.append(el("div", "app-docs-taskshead", "My tasks"), bodyEl);
      scrim.appendChild(panel);
      document.body.appendChild(scrim);
      void fetchMyTasks().then(({ held, review }) => {
        if (!scrim.isConnected) return;
        clear(bodyEl);
        paintTasksBadge(held.length + review.length);
        if (held.length + review.length === 0) {
          bodyEl.appendChild(el("div", "app-field-hint", "Nothing needs you."));
          return;
        }
        const group = (title: string, rows: TaskRow[]) => {
          if (rows.length === 0) return;
          bodyEl.appendChild(el("div", "app-docs-tasksgroup", `${title} (${rows.length})`));
          for (const t of rows) {
            const b = el("button", "app-docs-taskrow") as HTMLButtonElement;
            b.append(
              el("span", "app-docs-taskname", t.row.name),
              el(
                "span",
                `app-field-hint${t.overdue ? " app-docs-taskoverdue" : ""}`,
                `${t.libName} · ${t.why}`
              )
            );
            b.addEventListener("click", () => {
              closePanel();
              onRowOpen(t.row);
            });
            bodyEl.appendChild(b);
          }
        };
        group("Checked out to you", held);
        group("Review due", review);
      });
    });
    // toggles that used to be toolbar checkboxes ride the register
    // kebab from V3 — state only here
    /**
     * "Show only Approved" — ON by default (Ben, 2026-08-03). A
     * controlled-document register is asked for the approved copy;
     * everything else is noise until someone says otherwise. Stored as
     * its inverse so links and saved views written before this keep
     * meaning what they meant.
     */
    let onlyApproved = !(bootView?.nonCurrent ?? false);
    let modifiedDays = bootView?.modifiedDays ?? 0;
    // declared HERE, not in the data-flow section: the register's empty
    // state reads it during the initial mount, and a later `let` would be
    // a temporal-dead-zone crash that kills the whole screen
    let query = bootView?.query ?? "";
    const modifiedIso = (): string | undefined =>
      modifiedDays > 0
        ? new Date(Date.now() - modifiedDays * 86400000).toISOString()
        : undefined;

    // secondary actions (share the current filter as a player link,
    // export the register) live behind one kebab — the app's convention
    const topKebab = el("button", "app-kebab app-docs-topkebab", "⋮") as HTMLButtonElement;
    topKebab.title = "More actions";
    top.append(searchWrap, scopeBtn, actionNeeded);
    if (favMode) {
      scopeBtn.style.display = "none";
      actionNeeded.style.display = "none";
    }
    // the toolbar rides the REGISTER pane, not the whole screen (Ben,
    // 2026-08-01): appended into `main` below, above the title row

    const bodyRow = el("div", "app-docs-body");
    wrap.appendChild(bodyRow);

    // ---- left nav ------------------------------------------------------
    const nav = el("nav", "app-docs-nav");
    bodyRow.appendChild(nav);

    /** Re-mount in place with a stashed boot state (both modes — the
     *  embedded pattern; the hash stays put). */
    const remount = () => {
      dead = true;
      for (const f of innerCleanups) f();
      innerCleanups.length = 0;
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
      row.append(box, name, only);
      libCard.card.appendChild(row);
    }
    // (the ★ Favourites row and the libType subtitles were cut — Ben,
    // 2026-08-02; favourite toggles remain in the kebab and overlay, and
    // the favMode machinery stays for a future entry point)

    // saved views moved OUT of this pane (Ben, 2026-08-01) — they live
    // in the register kebab now; the nav is libraries + browse-by only
    if (whoId !== "") {
      void docPrefs(whoId).then((p) => {
        if (dead) return;
        favs = p.favorites;
        savedViews = p.views;
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
    /** Date columns the site left filterable — the from/to rows in the
     *  Filters pane (Ben, 2026-08-03). */
    const dateCols = (): { internal: string; label: string }[] =>
      siteDict.columns
        .filter((c) => c.available && c.filterable && isDateColumn(c))
        .map((c) => ({ internal: c.internal, label: c.label !== "" ? c.label : c.internal }));

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
      /** Lowercased subtree labels — the REST-path label match. */
      labels: Set<string>;
    }
    let filters: ActiveFilter[] = [];
    const filterFor = (col: string): ActiveFilter | null =>
      filters.find((f) => f.col === col) ?? null;

    /** From/to bounds per date column (Ben, 2026-08-03). Either end may
     *  be blank; an entry with both blank is dropped rather than kept as
     *  a filter that filters nothing. */
    interface DateFilter {
      col: string;
      from: string;
      to: string;
    }
    let dateFilters: DateFilter[] = (bootView?.dates ?? []).map((d) => ({ ...d }));
    const dateFor = (col: string): DateFilter | null =>
      dateFilters.find((d) => d.col === col) ?? null;
    const setDateFilter = (col: string, from: string, to: string) => {
      dateFilters = dateFilters.filter((d) => d.col !== col);
      if (from !== "" || to !== "") dateFilters.push({ col, from, to });
      paintChips();
      void load(true);
    };

    const subtreeIn = (nodes: TermNode[], node: TermNode): TermNode[] =>
      nodes.filter(
        (n) =>
          n.id === node.id ||
          (n.labels.length > node.labels.length &&
            node.labels.every((l, i) => n.labels[i] === l))
      );
    /** Set/replace (node) or clear (null) the filter on one column. */
    const applyFilter = (col: string, node: TermNode | null, nodes: TermNode[]) => {
      filters = filters.filter((f) => f.col !== col);
      if (node !== null) {
        const subtree = subtreeIn(nodes, node);
        filters.push({
          col,
          node,
          ids: subtree.map((n) => n.id),
          labels: new Set(
            // the picked node itself even when the walk missed it
            [node, ...subtree].map((n) => n.labels[n.labels.length - 1].toLowerCase())
          ),
        });
      }
      paintTreeSelection();
      paintChips();
      void load(true);
    };

    // ---- the tree ------------------------------------------------------
    // the tree is FIXED to the organisation hierarchy (Ben, 2026-08-02:
    // with the Filters popover covering every column, a configurable
    // group-by was redundant) — saved views' groupBy is ignored
    const groupBy = "";
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
    // come later). Every rendered row now comes from the browse feed and
    // carries its columns as display text, so a term's count = loaded
    // rows whose group-by column holds its label — including under a
    // contents search. Favourites carry no field values, so they count
    // nothing rather than lie. Scoped honestly via the title attribute.
    /** Totals per node from the index (null until they answer, or when
     *  they cannot). Counting LOADED rows made the numbers climb as you
     *  scrolled — a progress report where a total was meant (Ben,
     *  2026-08-03). */
    let treeTotals: Map<string, number> | null = null;

    const paintTreeCounts = () => {
      if (countSpans.size === 0) return;
      const cols = groupBy === "" ? [...orgCols] : [groupBy];
      const rows = favMode ? [] : loadedRows();
      // a site counts what its departments and areas hold, not only what
      // was pinned at site level (Ben, 2026-08-03)
      const tally = treeTotals ?? tallySubtreeCounts(rows, cols, treeNodes);
      const whole = treeTotals !== null;
      for (const n of treeNodes) {
        const span = countSpans.get(n.id);
        if (!span) continue;
        const count = tally.get(n.id) ?? 0;
        span.textContent = (whole || rows.length > 0) && count > 0 ? String(count) : "";
        const where =
          n.labels.length > 0
            ? `${n.labels[n.labels.length - 1]} and everything under it`
            : "this folder";
        span.title = whole
          ? `Documents in ${where}`
          : `Documents loaded so far in ${where}`;
      }
    };

    /**
     * Ask the index for a count per organisation term — one request for
     * the whole tree, matching the register's current scope, query and
     * term filters.
     *
     * Date bounds are the exception: they are CAML-only (a custom date
     * column has no dependable managed property), so with one applied
     * the totals would overstate. Rather than show a number that
     * disagrees with the list, the tree falls back to counting loaded
     * rows and says so in the tooltip.
     */
    const refreshTreeTotals = (gen: number) => {
      const libs = viewLibs();
      if (favMode || treeNodes.length === 0 || libs.length === 0) {
        treeTotals = null;
        paintTreeCounts();
        return;
      }
      const words = query.trim() === "" ? undefined : query.trim().split(/\s+/);
      // One id-and-organisation page per library, then count DOCUMENTS —
      // not (document, term) pairs. Grouping counts pairs, which made a
      // parent read 112 where its libraries held 100: a document tagged
      // in two areas is still one document (Ben, 2026-08-03). Same Where
      // as the register, so the totals answer the same question the list
      // does; only the folder's own filter is left out, or picking one
      // folder would zero every other count.
      void Promise.all(
        libs.map((lib) => {
          const col = [...orgCols].find((c) =>
            lib.config.columns.some((x) => x.internal === c)
          );
          if (col === undefined) return Promise.resolve({ rows: [], next: "", error: "" });
          const carried = new Set(lib.config.columns.map((c) => c.internal));
          const viewXml = buildRenderViewXml({
            modifiedAfterIso: modifiedIso(),
            nameWords: words,
            idIn: contentIds.get(lib.listId.toLowerCase()) ?? [],
            termFilters: [
              ...filters
                .filter((f) => f.col !== "")
                .map((f) => ({ cols: [f.col], labels: [...f.labels] })),
              ...approvedFilterFor(),
            ],
            dateRanges: dateFilters.filter((d) => carried.has(d.col)),
            fields: statusInternal !== "" && carried.has(statusInternal)
              ? [col, statusInternal]
              : [col],
            rowLimit: COUNT_CAP,
          });
          return renderListPage(app.siteUrl, lib.listId, viewXml);
        })
      ).then((pages) => {
        if (dead || gen !== generation) return;
        // a library with more than the cap would report a floor dressed
        // as a total, so the tree says "loaded so far" instead
        const truncated = pages.some((p) => p.next !== "" || p.error !== "");
        // the register hides drafts and superseded documents unless
        // asked; a total that counted them would describe a longer list
        // than the one on screen
        const rows = applyNonCurrent(pages.flatMap((p) => p.rows));
        if (truncated || rows.length === 0) {
          treeTotals = null;
          matchTotal = null;
        } else {
          treeTotals = tallySubtreeCounts(rows, [...orgCols], treeNodes);
          // with a folder picked, the matching total IS that folder's
          // count — the query deliberately leaves the folder filter out
          // so every other folder still counts
          const picked = filterFor("");
          matchTotal = picked ? (treeTotals.get(picked.node.id) ?? 0) : rows.length;
        }
        paintTreeCounts();
        paintStatus(knownTotal, "");
      });
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

    // the browse-by card fills the pane to the bottom (Ben, 2026-08-01:
    // full-height left column per the Vault design), its tree scrolling
    const treeCard = el("section", "app-docs-navcard app-docs-navcard-fill");
    const treeHead = el("div", "app-docs-navhead");
    treeHead.appendChild(el("span", "app-docs-navheadlabel", "Folders"));
    treeCard.appendChild(treeHead);

    /** Persisted collapse state per term set (Vault V1). */
    const persistCollapse = (setId: string) => {
      persistUi({ collapsed: { ...uiState.collapsed, [setId]: [...collapsed] } });
    };
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

    if (app.orgSetId !== "") {
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

    // ---- the register pane ---------------------------------------------
    const main = el("div", "app-docs-main");
    bodyRow.appendChild(main);
    main.appendChild(top); // search + scope + Action needed, full width

    // title row (Vault V3): what you are looking at + the register's own
    // controls — Filters (badged), List/Tiles, the kebab
    const titleRow = el("div", "app-docs-titlerow");
    const titleBlock = el("div", "app-docs-titleblock");
    const h1 = el("h2", "app-docs-h1", "");
    const crumb = el("div", "app-docs-crumb", "");
    titleBlock.append(h1, crumb);
    const filtersBtn = el("button", "app-btn app-docs-filtersbtn", "Filters") as HTMLButtonElement;
    filtersBtn.title = "Filter the register by its configured columns";
    const seg = el("div", "app-docs-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Register view");
    const segList = el("button", "app-docs-segbtn", "List") as HTMLButtonElement;
    const segTiles = el("button", "app-docs-segbtn", "Tiles") as HTMLButtonElement;
    seg.append(segList, segTiles);
    // Add a document (Phase 4C) — appears once SharePoint's permission
    // answers arrive and only if somewhere writable exists to add to
    const addBtn = el("button", "app-btn app-btn-primary app-docs-addbtn", "＋ Add document") as HTMLButtonElement;
    addBtn.style.display = "none";
    void permsReady.then(() => {
      const canAdd = libraries.some(
        (l) =>
          (l.libType === "working" || l.libType === "revision") &&
          (permsByLib.get(l.listId.toLowerCase())?.add ?? false)
      );
      if (canAdd && !favMode) addBtn.style.display = "";
    });
    addBtn.addEventListener("click", () => {
      void (async () => {
        const { openAddDocument } = await import("./addDocument");
        openAddDocument({
          site: app.siteUrl,
          targets: libraries.filter(
            (l) =>
              (l.libType === "working" || l.libType === "revision") &&
              (permsByLib.get(l.listId.toLowerCase())?.add ?? false)
          ),
          templates: libraries.filter((l) => l.libType === "template"),
          dictBy,
          host: dialogHost,
          onCreated: (row) => {
            void load(true);
            refreshTasksBadge();
            onRowOpen(row);
          },
        });
      })();
    });
    titleRow.append(titleBlock, el("div", "app-docs-titlegap"), addBtn, filtersBtn, seg, topKebab);
    if (favMode) {
      filtersBtn.style.display = "none";
      seg.style.display = "none";
      topKebab.style.display = "none";
    }
    main.appendChild(titleRow);

    const libNames = favMode
      ? "Favourites"
      : current
        ? current.config.title || current.name
        : allSelected
          ? "All documents"
          : selectedIds
              .map((id) => byListId.get(id.toLowerCase()))
              .filter((l): l is DocLibrary => l !== undefined)
              .map((l) => l.config.title || l.name)
              .join(" & ");
    const paintTitle = () => {
      const f = filterFor(groupBy) ?? filters[0] ?? null;
      h1.textContent = f
        ? `${f.node.labels[f.node.labels.length - 1]} — ${libNames}`
        : libNames;
      crumb.textContent = f ? f.node.labels.join(" › ") : "";
      crumb.style.display = f ? "" : "none";
      // the organisation is not counted: the Folders pane IS that
      // selection and shows it, so "Filters · 1" for a picked folder
      // pointed at a pane that had nothing set in it (Ben, 2026-08-03)
      const active =
        filters.filter((f) => f.col !== "").length +
        dateFilters.length +
        (modifiedDays > 0 ? 1 : 0);
      filtersBtn.textContent = active > 0 ? `Filters · ${active}` : "Filters";
      filtersBtn.classList.toggle("app-docs-filtersbtn-on", active > 0);
    };

    const filterBar = el("div", "app-docs-filterbar");
    main.appendChild(filterBar);
    const status = el("div", "app-docs-status");
    main.appendChild(status);

    const paintChips = () => {
      paintTitle();
      clear(filterBar);
      if (modifiedDays > 0) {
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(document.createTextNode(`Modified: last ${modifiedDays} days`));
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = "Clear the modified filter";
        x.addEventListener("click", () => {
          modifiedDays = 0;
          paintChips();
          void load(true);
        });
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      for (const f of filters) {
        // the organisation has no chip: the Folders pane is that filter,
        // shows the selection and clears it, so a chip said it twice
        // (Ben, 2026-08-03)
        if (f.col === "") continue;
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
      for (const d of dateFilters) {
        const name = siteDict.columns.find((c) => c.internal === d.col);
        const label = name && name.label !== "" ? name.label : d.col;
        const when =
          d.from !== "" && d.to !== ""
            ? `${d.from} to ${d.to}`
            : d.from !== ""
              ? `from ${d.from}`
              : `up to ${d.to}`;
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(document.createTextNode(`${label}: ${when}`));
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = `Clear the ${label} filter`;
        x.addEventListener("click", () => setDateFilter(d.col, "", ""));
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      // adding filters lives in the Filters popover (Vault V3); the chip
      // row only shows what is applied
    };
    paintChips();

    // ---- Filters popover (Vault V3) ------------------------------------
    // The popover is the EDITOR; applied state keeps painting as the chip
    // row. Pills are the app's filter-chip treatment; one term per column
    // (a pick includes its subtree — the shipped semantics), AND across
    // columns. Counts stay honest: they ride the chips/tree, loaded-rows
    // only.
    filtersBtn.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu app-docs-filterpop");
      const body = el("div", "app-docs-filterpop-body");
      menu.appendChild(body);
      const paintPop = () => {
        clear(body);
        const group = (label: string): HTMLElement => {
          const g = el("div", "app-docs-fgroup");
          g.appendChild(el("div", "app-docs-fgroup-label", label));
          body.appendChild(g);
          return g;
        };
        // the site says which columns filter (Ben, 2026-08-03)
        const filterable = new Set(
          siteDict.columns.filter((c) => c.available && c.filterable).map((c) => c.internal)
        );
        // …and the organisation obeys that too. It used to be exempt
        // because the Folders pane drives it, which meant unticking it
        // in Settings changed nothing (Ben's screenshot). Unknown to the
        // dictionary = still shown, so a site that has never opened the
        // new settings keeps the pane it had.
        const orgCol = siteDict.columns.find((c) => orgCols.has(c.internal));
        const orgFilterable = orgCol === undefined || (orgCol.available && orgCol.filterable);
        const cols: string[] = [];
        if (app.orgSetId !== "" && orgProps.length > 0 && orgFilterable) cols.push("");
        cols.push(
          ...[...taxCols.keys()].filter(
            (c) =>
              filterable.has(c) &&
              // "Show only Approved" IS the status filter while it is on
              !(onlyApproved && c === statusInternal)
          )
        );
        for (const col of cols) {
          const g = group(colLabel(col));
          const pills = el("div", "app-docs-fpills");
          g.appendChild(pills);
          pills.appendChild(el("span", "app-field-hint", "Loading…"));
          const setId = setFor(col);
          void fetchTermPaths(app.siteUrl, setId, 4, 60).then(({ nodes, error }) => {
            if (dead || !menu || !menu.contains(pills)) return;
            clear(pills);
            if (error !== "" || nodes.length === 0) {
              pills.appendChild(el("span", "app-field-hint", "No terms."));
              return;
            }
            const active = filterFor(col);
            // top two levels as pills; a deeper active pick still shows
            const shallow = nodes.filter((n) => n.labels.length <= 2);
            const deepPick =
              active && !shallow.some((n) => n.id === active.node.id)
                ? [active.node]
                : [];
            const CAP = 14;
            let shown = [...deepPick, ...shallow];
            const capped = shown.length > CAP;
            if (capped) shown = shown.slice(0, CAP);
            for (const n of shown) {
              const on = active?.node.id === n.id;
              const pb = el(
                "button",
                `app-docs-fpill${on ? " app-docs-fpill-on" : ""}`,
                n.labels[n.labels.length - 1]
              ) as HTMLButtonElement;
              pb.title = n.labels.join(" › ");
              pb.setAttribute("aria-pressed", String(on));
              pb.addEventListener("click", () => {
                applyFilter(col, on ? null : n, nodes);
                paintPop();
              });
              pills.appendChild(pb);
            }
            if (capped) {
              pills.appendChild(
                el("span", "app-field-hint", "Deeper terms live in the Browse-by tree")
              );
            }
          });
        }
        // date columns: a from/to pair each (Ben, 2026-08-03). Native
        // date inputs, so the platform's own picker and keyboard entry
        // come for free — and blank means unbounded at that end.
        for (const dc of dateCols()) {
          const g = group(dc.label);
          const row = el("div", "app-docs-fdates");
          const cur = dateFor(dc.internal);
          const from = el("input", "app-input app-docs-fdate") as HTMLInputElement;
          from.type = "date";
          from.value = cur?.from ?? "";
          from.setAttribute("aria-label", `${dc.label} from`);
          const to = el("input", "app-input app-docs-fdate") as HTMLInputElement;
          to.type = "date";
          to.value = cur?.to ?? "";
          to.setAttribute("aria-label", `${dc.label} to`);
          const push = () => {
            setDateFilter(dc.internal, from.value.trim(), to.value.trim());
            paintPop();
          };
          from.addEventListener("change", push);
          to.addEventListener("change", push);
          row.append(
            el("span", "app-field-hint", "from"),
            from,
            el("span", "app-field-hint", "to"),
            to
          );
          if (cur) {
            const clear = el("button", "app-docs-fpill", "Clear") as HTMLButtonElement;
            clear.addEventListener("click", () => {
              setDateFilter(dc.internal, "", "");
              paintPop();
            });
            row.appendChild(clear);
          }
          g.appendChild(row);
        }

        const mg = group("Modified");
        const mp = el("div", "app-docs-fpills");
        mg.appendChild(mp);
        for (const [days, label] of [
          [0, "Any time"],
          [7, "Last 7 days"],
          [30, "Last 30 days"],
          [90, "Last 90 days"],
        ] as const) {
          const on = modifiedDays === days;
          const pb = el(
            "button",
            `app-docs-fpill${on ? " app-docs-fpill-on" : ""}`,
            label
          ) as HTMLButtonElement;
          pb.setAttribute("aria-pressed", String(on));
          pb.addEventListener("click", () => {
            modifiedDays = days;
            paintChips();
            void load(true);
            paintPop();
          });
          mp.appendChild(pb);
        }
        const foot = el("div", "app-docs-fpop-foot");
        const clearAll = el("button", "app-btn", "Clear all") as HTMLButtonElement;
        clearAll.addEventListener("click", () => {
          filters = [];
          dateFilters = [];
          modifiedDays = 0;
          paintTreeSelection();
          paintChips();
          void load(true);
          paintPop();
        });
        const doneB = el("button", "app-btn app-btn-primary", "Done") as HTMLButtonElement;
        doneB.addEventListener("click", () => closeMenu());
        foot.append(clearAll, doneB);
        body.appendChild(foot);
      };
      paintPop();
      const r = filtersBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 420))}px`;
      document.body.appendChild(menu);
    });

    /** The status column, from the dictionary — so it is found whether
     *  one library is in view or five (C3). */
    const statusCol = statusInternal !== "" ? (dictBy.get(statusInternal) ?? null) : null;
    /** Lowercased term label → GUID for the status set. The palette is
     *  keyed by GUID, and this is what lets a RENAMED term keep its
     *  colour: the row paints the new label, which resolves here to the
     *  id the palette already holds. Until it answers (or if it never
     *  does), matching falls back to the label stored beside each entry,
     *  so colours are never withheld waiting on a round trip. */
    const labelToId = new Map<string, string>();
    /** Read the status vocabulary once: it gives the palette its ids AND
     *  tells "Show only Approved" which values count as approved. */
    const readStatusTerms = async (): Promise<void> => {
      if (statusCol === null || statusCol.termSetId === "") return;
      const r = await fetchTermsInSet(app.siteUrl, statusCol.termSetId);
      const rows = Array.isArray((r.data as { value?: unknown[] })?.value)
        ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
        : [];
      const labels: string[] = [];
      for (const t of rows) {
        const names = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
        const def = Array.isArray(names) ? (names.find((l) => l.isDefault) ?? names[0]) : undefined;
        const name = (def?.name ?? "").trim();
        if (name === "") continue;
        labels.push(name);
        if (typeof t.id === "string") labelToId.set(name.toLowerCase(), t.id);
      }
      // "approved" is whatever this site's vocabulary calls current —
      // the same reading the status glyphs use, so ✓ and "only Approved"
      // can never disagree about what a value means
      approvedLabels = labels.filter((l) => !isNonCurrentStatus(l));
    };

    // glyph + word so status reads under any colour-vision (finding 5);
    // both now come from the site palette, falling back to the built-in
    // vocabulary when a site has not set a glyph of its own
    const statusChip = (value: string): HTMLElement => {
      const col = statusCol;
      const entry = paletteEntryFor(
        siteDict,
        col?.termSetId ?? "",
        col?.internal ?? "",
        value,
        labelToId
      );
      const glyph = entry?.glyph ?? "";
      const chip = el(
        "span",
        "app-docs-chip",
        glyph !== "" ? `${glyph} ${value}` : withStatusGlyph(value)
      );
      const color = resolvePaletteColor(states, entry?.color ?? "", "");
      if (color !== "") {
        chip.style.background = color;
        chip.style.color = textOn(color);
      }
      return chip;
    };

    const ownerColCfg = ownerInternal !== "" ? (dictBy.get(ownerInternal) ?? null) : null;
    /** Initials avatar + the full owner text (Vault V3 row anatomy). */
    const ownerCell = (v: string): HTMLElement => {
      const first = v.split(";")[0].trim();
      const initials = first
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
      const cell = el("span", "app-docs-ownercell");
      cell.title = v;
      cell.append(
        el("span", "app-docs-avatar", initials === "" ? "•" : initials),
        el("span", "app-docs-ownername", v)
      );
      return cell;
    };

    const nameCol: ListColumn<DocRow> = {
      key: "name",
      label: "Document",
      width: "minmax(190px, 3fr)",
      sortKey: "name",
      render: (row) => {
        const cell = el("span", "app-docs-namecell");
        // extension dropped from the display (Ben, 2026-08-02) — the
        // file-type chip carries it; the full filename stays in title
        const { stem } = splitNameForEllipsis(row.name);
        const nm = el("span", "app-docs-name");
        nm.title = row.name;
        nm.append(el("span", "app-docs-namestem", stem));
        cell.append(fileTypeChip(row.ext), nm);
        // checked out is a state worth seeing without opening anything,
        // and MINE is the only actionable case — so it reads differently
        if ((row.checkoutName ?? "") !== "") {
          const mine = isMine(row);
          const lock = el(
            "span",
            `app-docs-lock${mine ? " app-docs-lock-mine" : ""}`,
            mine ? "✎ you" : `🔒 ${row.checkoutName}`
          );
          lock.title = mine
            ? "You have this checked out"
            : `Checked out by ${row.checkoutName}`;
          cell.append(lock);
        }
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
      width: "124px",
      sortKey: "modified",
      render: (row) => formatWhen(row.modified),
    };

    // the view's own column set beats the library default (Phase 3a —
    // carried by saved views and shared links; [] = default)
    const chosenColumns = bootView?.columns ?? [];
    /** Column set for the current width bucket (Vault V3: the status
     *  column drops out first as the pane narrows, then owner and the
     *  other configured columns — name and Modified always survive). */
    const buildColumns = (): ListColumn<DocRow>[] => {
      const columns: ListColumn<DocRow>[] = [nameCol];
      // which columns to show is a VIEW question (the chooser, or what
      // the libraries in view open with); what each one means is the
      // dictionary's answer, so this holds for any number of libraries
      // the chooser and view templates decide WHICH columns show; the
      // dictionary decides their ORDER, so columns sit in the same
      // relative sequence whatever is hidden (Ben, 2026-08-04).
      // Modified is unknown to the dictionary, so it lands last.
      const wanted = sortByDictionary(
        chosenColumns.length > 0
          ? chosenColumns.filter((i) => i === "Modified" || dictBy.get(i)?.available === true)
          : defaultInternals(),
        [...dictBy.keys()]
      );
      // more than one library in view: say which one each row came from
      if (viewLibs().length > 1 && bucket !== "narrow") {
        columns.push({
          key: "library",
          label: "Library",
          width: "minmax(110px, 1fr)",
          render: (row) => {
            const lib = byListId.get(row.listId);
            return lib ? lib.config.title || lib.name : "";
          },
        });
      }
      for (const internal of wanted) {
        if (internal === "Modified") {
          columns.push(modifiedCol);
          continue;
        }
        const role = roleOf(internal);
        if (bucket !== "full" && role === "status") continue;
        if (bucket === "narrow") continue;
        columns.push({
          key: internal,
          label: labelOf(internal),
          render: (row) => {
            const v = row.values[internal] ?? "";
            if (v === "") return "";
            if (role === "status") return statusChip(v);
            if (role === "owner") return ownerCell(v);
            // RLDAS date fields arrive as ISO — humanize them
            return /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatWhen(v) : v;
          },
        });
      }
      if (!wanted.includes("Modified")) columns.push(modifiedCol);
      columns.push(kebabCol);
      return columns;
    };

    /** Favourite wiring shared by the overlay and the row kebab. */
    const favToggleFor = (row: DocRow) => async (): Promise<boolean> => {
      const next = await toggleFavorite(whoId, {
        uniqueId: row.uniqueId,
        name: row.name,
        ext: row.ext,
        serverUrl: row.serverUrl,
        listId: row.listId,
      });
      if (!dead) {
        favs = next;
        if (favMode) void load(true);
      }
      return next.some((f) => f.uniqueId === row.uniqueId);
    };

    const onRowOpen = (row: DocRow) => {
      const lib = byListId.get(row.listId) ?? current;
      // the drive is per LIBRARY, and the PDF routes need it — resolve
      // before opening (cached, so only the first open of a library pays)
      void driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((driveId) => {
        if (dead) return;
        const libStatusCol = lib?.config.columns.find((c) => c.role === "status") ?? null;
        // a previous overlay's repaint must not outlive it
        viewerRepaint = null;
        openDocViewer({
          site: app.siteUrl,
          row,
          driveId,
          libraryName: lib ? lib.config.title || lib.name : "",
          askToWork: lib?.libType === "working",
          // details pane (Vault V4): the register's fields, never
          // SharePoint's plumbing — exactly the available-ticked columns
          labels: Object.fromEntries(
            (lib?.config.columns ?? [])
              .filter((c) => c.label !== "")
              .map((c) => [c.internal, c.label])
          ),
          linkColumns: (lib?.config.columns ?? [])
            .filter((c) => c.role === "linkedDocuments")
            .map((c) => c.internal),
          // dictionary order — the same order the add form uses,
          // adjustable under Settings → Documents → Document columns
          columns: lib
            ? sortByDictionary(
                lib.config.columns.filter((c) => c.available).map((c) => c.internal),
                [...dictBy.keys()]
              )
            : undefined,
          statusValue: libStatusCol ? (row.values[libStatusCol.internal] ?? "") : "",
          statusChipFor: statusChip,
          favorite:
            whoId === ""
              ? null
              : {
                  isFav: () => favs.some((f) => f.uniqueId === row.uniqueId),
                  toggle: favToggleFor(row),
                },
          control: canWriteIn(lib)
            ? {
                // read live: a check-out made in the register behind the
                // overlay has to move these buttons too
                state: () => ({
                  checkedOut: (row.checkoutName ?? "") !== "",
                  mine: isMine(row),
                  by: row.checkoutName ?? "",
                }),
                register: (repaint) => {
                  viewerRepaint = repaint;
                },
                checkOut: () => runCommand("out", row),
                checkIn: () => openCheckIn(row),
                discard: () => openDiscard(row),
              }
            : null,
        });
      });
    };

    // ---- the register: one host, two views (Vault V3) ------------------
    // Sort and the Modified window are server-side; switching view or
    // density rebuilds the component and re-seats the loaded rows.
    const listHost = el("div", "app-docs-registerhost");
    main.appendChild(listHost);
    // every row is rendered by the browse feed, so the chosen sort always
    // applies — there is no relevance order left to preserve
    let sort: { key: string; asc: boolean } = { key: "modified", asc: false };
    let viewMode: "list" | "tiles" = uiState.viewMode === "tiles" ? "tiles" : "list";
    let density: "comfortable" | "compact" =
      uiState.density === "compact" ? "compact" : "comfortable";
    let bucket: "full" | "mid" | "narrow" = "full";

    const emptyExtra = (): HTMLElement | null => {
      if (filters.length === 0 && modifiedDays === 0 && query.trim() === "") return null;
      const b = el("button", "app-btn app-docs-clearfilters", "Clear all filters") as HTMLButtonElement;
      b.addEventListener("click", () => {
        filters = [];
        modifiedDays = 0;
        query = "";
        search.value = "";
        paintTreeSelection();
        paintChips();
        void load(true);
      });
      return b;
    };

    let list: DocList<DocRow>;
    const buildRegister = () => {
      const prev: DocRow[] = list !== undefined ? list.rows() : [];
      list?.destroy();
      list =
        viewMode === "tiles"
          ? mountDocTiles(listHost, {
              onRow: onRowOpen,
              onNearEnd: () => void loadMore(),
              emptyText: "No documents here yet.",
              emptyExtra,
              statusChip: statusCol ? statusChip : null,
              statusColumn: statusCol?.internal ?? "",
              ownerColumn: ownerColCfg?.internal ?? "",
              thumbUrlFor: (row) => tileThumbFor(app.siteUrl, row),
            })
          : mountDocList<DocRow>(listHost, {
              columns: buildColumns(),
              onRow: onRowOpen,
              onNearEnd: () => void loadMore(),
              emptyText: "No documents here yet.",
              emptyExtra,
              sort,
              onSort: (key) => {
                sort = sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === "name" };
                buildRegister();
                void load(true);
              },
              density,
            });
      if (prev.length > 0) list.setRows(prev);
    };
    buildRegister();
    const loadedRows = (): DocRow[] => list.rows();

    const paintSeg = () => {
      segList.classList.toggle("app-docs-segbtn-on", viewMode === "list");
      segTiles.classList.toggle("app-docs-segbtn-on", viewMode === "tiles");
      segList.setAttribute("aria-pressed", String(viewMode === "list"));
      segTiles.setAttribute("aria-pressed", String(viewMode === "tiles"));
    };
    paintSeg();
    segList.addEventListener("click", () => {
      if (viewMode === "list") return;
      viewMode = "list";
      persistUi({ viewMode });
      paintSeg();
      buildRegister();
    });
    segTiles.addEventListener("click", () => {
      if (viewMode === "tiles") return;
      viewMode = "tiles";
      persistUi({ viewMode });
      paintSeg();
      buildRegister();
    });

    // width buckets: the pane, not the window — the hub splits the screen
    const bucketFor = (w: number): "full" | "mid" | "narrow" =>
      w < 380 ? "narrow" : w < 560 ? "mid" : "full";
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w === 0) return;
      const b = bucketFor(w);
      if (b !== bucket) {
        bucket = b;
        if (viewMode === "list") buildRegister();
      }
    });
    ro.observe(main);
    innerCleanups.push(() => ro.disconnect());

    // ---- document control (Phase 4B): the commands -----------------------
    // Check-out, check-in and discard. Three rules hold the whole thing
    // together: only libraries meant to be worked on offer them; only
    // SharePoint decides whether the write lands; and afterwards the row
    // is re-read from list REST, never from the index, because the index
    // lags and a command's own result must not be a guess.
    // (The shared state — permsByLib, permsReady, dialogHost — lives up
    // near the top of the mount: the toolbar's Add button reads it
    // synchronously long before this section runs.)

    /** Re-read one document's check-out state and repaint just it. A
     *  full reload would lose the scroll position and re-ask for
     *  everything, to answer a question about one row. */
    const refreshRow = async (row: DocRow) => {
      const info = await fetchFileInfo(app.siteUrl, row.serverUrl);
      if (!info.ok) return;
      const d = (info.data ?? {}) as { CheckOutType?: unknown };
      // CheckOutType 2 means "not checked out"; anything else needs the
      // holder's name, which only the list row carries
      if (Number(d.CheckOutType ?? 2) === 2) {
        row.checkoutName = "";
        row.checkoutEmail = "";
      } else {
        const page = await renderListPage(
          app.siteUrl,
          row.listId,
          buildRenderViewXml({ idIn: [row.id], fields: ["CheckoutUser"], rowLimit: 1 })
        );
        const fresh = page.rows[0];
        row.checkoutName = fresh?.checkoutName ?? "";
        row.checkoutEmail = fresh?.checkoutEmail ?? "";
      }
      list?.setRows(list.rows());
      viewerRepaint?.();
      // a command that changes checkout state changes the My tasks count
      refreshTasksBadge();
    };

    const commandFailed = (what: string, why: string) => {
      const dlg = openDialog({
        host: dialogHost,
        title: `${what} did not go through`,
        buttons: [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }],
      });
      // SharePoint's own sentence, not the JSON-inside-JSON it travels in
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          why !== "" ? spErrorText(why) : "SharePoint refused it without saying why."
        )
      );
    };

    /**
     * What SharePoint says about this file RIGHT NOW. The register's row
     * is a snapshot: the document may have been checked in from Office,
     * or the check-out discarded in SharePoint, since it was painted —
     * and acting on the snapshot is what produced "the file is not
     * checked out" against a button that offered to check it in (Ben,
     * 2026-08-03). Every command asks first.
     */
    const liveCheckout = async (row: DocRow): Promise<"none" | "held" | "unknown"> => {
      const info = await fetchFileInfo(app.siteUrl, row.serverUrl);
      if (!info.ok) return "unknown";
      const t = Number(((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType ?? 2);
      return t === 2 ? "none" : "held";
    };

    const staleNotice = async (row: DocRow, what: string) => {
      await refreshRow(row);
      const dlg = openDialog({
        host: dialogHost,
        title: `${what} is no longer available`,
        buttons: [{ label: "OK", kind: "secondary", onClick: () => dlg.close() }],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "SharePoint says this document is not checked out any more — someone may have " +
            "checked it in, or it was done from Office. The register has been brought up to date."
        )
      );
    };

    const runCommand = async (
      kind: "out" | "undo",
      row: DocRow
    ): Promise<void> => {
      // ask SharePoint what is true before acting on a painted row
      const live = await liveCheckout(row);
      if (kind === "undo" && live === "none") {
        await staleNotice(row, "Discard");
        return;
      }
      if (kind === "out" && live === "held") {
        await refreshRow(row);
        commandFailed("Check-out", "Someone checked this document out first.");
        return;
      }
      const res =
        kind === "out"
          ? await checkOutFile(app.siteUrl, row.serverUrl)
          : await undoCheckOut(app.siteUrl, row.serverUrl);
      if (!res.ok) {
        commandFailed(kind === "out" ? "Check-out" : "Discard", res.status);
        return;
      }
      await refreshRow(row);
    };

    /** Check-in asks for a comment and REQUIRES it (Ben, 2026-08-03):
     *  the entry an auditor reads is worth more than a keystroke saved,
     *  so the button stays disabled until there is something to read. */
    const openCheckIn = (row: DocRow) => {
      let major = false;
      const comment = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
      comment.rows = 3;
      comment.placeholder = "What changed?";
      const dlg = openDialog({
        host: dialogHost,
        title: `Check in ${row.name}`,
        buttons: [
          { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "Check in",
            kind: "primary",
            onClick: () => {
              const text = comment.value.trim();
              if (text === "") return;
              dlg.close();
              void (async () => {
                if ((await liveCheckout(row)) === "none") {
                  await staleNotice(row, "Check-in");
                  return;
                }
                const res = await checkInFile(app.siteUrl, row.serverUrl, text, major);
                if (!res.ok) commandFailed("Check-in", res.status);
                else await refreshRow(row);
              })();
            },
          },
        ],
      });
      const submit = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement | null;
      const sync = () => {
        if (submit) submit.disabled = comment.value.trim() === "";
      };
      comment.addEventListener("input", sync);
      sync();
      const kinds = el("div", "app-docs-cikinds");
      for (const opt of [
        { label: "Minor version — still a draft", value: false },
        { label: "Major version", value: true },
      ]) {
        const wrap = el("label", "app-docs-check");
        const radio = el("input", "") as HTMLInputElement;
        radio.type = "radio";
        radio.name = "ltk-checkin-kind";
        radio.checked = opt.value === major;
        radio.addEventListener("change", () => {
          major = opt.value;
        });
        wrap.append(radio, document.createTextNode(` ${opt.label}`));
        kinds.appendChild(wrap);
      }
      dlg.body.append(el("div", "app-field-label", "Comment"), comment, kinds);
      comment.focus();
    };

    /** Discarding destroys the edits made under the check-out and
     *  SharePoint keeps no copy — so it confirms, and says that. */
    const openDiscard = (row: DocRow) => {
      const dlg = openDialog({
        host: dialogHost,
        title: `Discard your check-out of ${row.name}?`,
        buttons: [
          { label: "Keep it checked out", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "Discard",
            kind: "danger",
            onClick: () => {
              dlg.close();
              void runCommand("undo", row);
            },
          },
        ],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "Everything changed since the check-out is lost. SharePoint keeps no copy of it."
        )
      );
    };

    // ---- kebab menu ----------------------------------------------------
    let menu: HTMLElement | null = null;
    const closeMenu = () => {
      menu?.remove();
      menu = null;
    };
    const onMenuPointer = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", onMenuPointer);
    innerCleanups.push(() => document.removeEventListener("pointerdown", onMenuPointer));
    // Escape cascade (Vault V5): an open menu/popover eats Escape before
    // any overlay behind it — capture phase, so it runs first
    const onMenuKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu) {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("keydown", onMenuKey, true);
    innerCleanups.push(() => document.removeEventListener("keydown", onMenuKey, true));
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
      // slim kebab (Vault V4): one-click actions only — properties and
      // history live in the overlay a row click opens
      if (whoId !== "") {
        const isFav = favs.some((f) => f.uniqueId === row.uniqueId);
        item(isFav ? "★ Remove favourite" : "☆ Add to favourites", () => {
          void favToggleFor(row)();
        });
      }
      // readers get the PDF rendering, never the editable source.
      // A LINK, not a button running window.open: `window.open("",
      // "_blank", "noopener")` returns null — that is what noopener
      // means — so the old handler had nothing to point at, and the
      // retry that fired when the drive resolved was no longer a user
      // gesture, so the popup blocker ate it and the item did nothing
      // (Ben, 2026-08-02). The link carries the site-scoped viewer URL
      // immediately and upgrades to the converted-PDF one when the drive
      // resolves — a cached lookup, so normally before the click.
      let bestPdf = pdfViewUrlFor(app.siteUrl, "", row);
      const openPdf = el("a", "app-docs-menuitem", "Open PDF ↗") as HTMLAnchorElement;
      openPdf.href = bestPdf;
      openPdf.target = "_blank";
      openPdf.rel = "noopener";
      openPdf.addEventListener("click", () => closeMenu());
      menu.appendChild(openPdf);
      void driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((d) => {
        bestPdf = pdfViewUrlFor(app.siteUrl, d, row);
        openPdf.href = bestPdf;
      });
      item("Copy PDF link", () => {
        void navigator.clipboard.writeText(bestPdf);
      });
      // Phase 4B: the commands themselves. Offered only where a document
      // is meant to be worked on — controlled standards and records keep
      // their lifecycle for Phase 5, so nothing here can edit one.
      if (canWriteIn(lib)) {
        const held = (row.checkoutName ?? "") !== "";
        if (!held) {
          item("Check out", () => void runCommand("out", row));
        } else if (isMine(row)) {
          item("Check in…", () => openCheckIn(row));
          item("Discard check-out", () => openDiscard(row));
        } else {
          item(`Checked out by ${row.checkoutName}`, null, "Only they can check it in");
        }
      }
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    };

    // ---- data flow -----------------------------------------------------
    let generation = 0;
    let inFlight = false;
    let done = false;
    /** A reset asked for while a load was in flight (typing during a
     *  page): replayed when the load finishes, or the keystroke that
     *  landed mid-flight would silently never be queried. */
    let pendingReset = false;
    /** Per-library feed state for the browse union (RenderListDataAsStream). */
    interface BrowseFeed {
      listId: string;
      viewXml: string;
      buf: DocRow[];
      next: string;
      done: boolean;
    }
    let feeds: BrowseFeed[] = [];
    /** Library-total for plain browsing ("50 of 150"); null = unknown. */
    let knownTotal: number | null = null;
    /** How many documents match the current filters — from the same
     *  query the folder counts use, so "40 of 100 matching" is a total
     *  and not a count of what has scrolled by (Ben, 2026-08-03). */
    let matchTotal: number | null = null;
    /** listId (lowercase) → item ids the index matched inside documents,
     *  resolved once per reset and OR'd into every page's CAML. */
    let contentIds = new Map<string, number[]>();
    /** Honesty about the content half: "" fine, "capped" the index had
     *  more matches than one CAML In can carry, "failed" the index did
     *  not answer (name matching still stands). */
    let contentsNote: "" | "capped" | "failed" = "";

    /**
     * Status values meaning "this is the approved copy", read from the
     * status column's own term set — never typed here. Empty when the
     * set cannot be read, and the register then falls back to hiding
     * non-current rows client-side, which is what it did before.
     */
    let approvedLabels: string[] = [];
    /**
     * The silent status clause ([] when the toggle is off or the status
     * vocabulary could not be read). It applies to EVERY library,
     * working ones included (Ben, 2026-08-03): "only Approved" that
     * quietly excused a library would be answering a different question
     * there — a working library simply shows nothing until its drafts
     * are approved, which is the honest answer.
     */
    const approvedFilterFor = (): { cols: string[]; labels: string[] }[] =>
      onlyApproved && statusInternal !== "" && approvedLabels.length > 0
        ? [{ cols: [statusInternal], labels: approvedLabels }]
        : [];

    const applyNonCurrent = (rows: DocRow[]): DocRow[] => {
      // a no-op once the CAML filter carries this; it still covers the
      // case where the term set could not be read
      if (!onlyApproved || !statusCol || approvedLabels.length > 0) return rows;
      // every library, working ones included — the fallback has to mean
      // what the CAML filter means
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
      // plain browsing shows the LIBRARY total up front (ItemCount), so
      // the number does not creep up as pages load (Ben, 2026-08-02)
      const plainBrowse =
        query.trim() === "" && filters.length === 0 && dateFilters.length === 0;
      const note =
        contentsNote === "capped"
          ? ` · top ${CONTENT_HITS} content matches`
          : contentsNote === "failed"
            ? " · contents search unavailable"
            : "";
      // The counted total wins wherever it is known: the library's raw
      // ItemCount knows nothing of "Show only Approved", so a plain
      // browse would otherwise read "50 of 100" while the folders —
      // counted properly — read 76 (Ben, 2026-08-03).
      const shown = matchTotal ?? total;
      status.textContent =
        (plainBrowse
          ? shown !== null && shown > n
            ? `${docs(n)} of ${shown}`
            : docs(n)
          : shown !== null && shown > n
            ? `${docs(n)} of ${shown} matching`
            : `${docs(shown ?? n)} matching`) + note;
    };

    /** End of a load: drop the lock, then replay a reset that arrived
     *  mid-flight (the caller was turned away to keep one loader). */
    const finish = () => {
      inFlight = false;
      if (pendingReset && !dead) {
        pendingReset = false;
        void load(true);
      }
    };

    const load = async (reset: boolean) => {
      if (inFlight) {
        if (reset) pendingReset = true;
        return;
      }
      if (done && !reset) return;
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
        done = false;
        feeds = [];
        list.setRows([]);
      }
      list.setLoading(true);
      // RenderListDataAsStream renders EVERYTHING: it is the modern-view
      // engine, returns display-ready labels, and CAMLs name search, the
      // Modified window and taxonomy label filters server-side per
      // library. The search index's one irreplaceable job is reading
      // INSIDE documents, and its rows carry no field text — so it feeds
      // item ids into the CAML rather than rendering rows of its own
      // (routing rows through it blanked the register's columns —
      // Ben, 2026-08-02).
      const browseIds = scopeAll ? allListIds : selectedIds;
      const words = query.trim() === "" ? undefined : query.trim().split(/\s+/);
      const wantContents = words !== undefined && searchContents;
      // the up-front total for plain browsing (library ItemCounts)
      if (reset) {
        knownTotal = null;
        matchTotal = null;
        if (
          words === undefined &&
          modifiedDays === 0 &&
          filters.length === 0 &&
          dateFilters.length === 0
        ) {
          void Promise.all(browseIds.map((id) => listItemCount(app.siteUrl, id))).then(
            (counts) => {
              if (dead || gen !== generation) return;
              if (!counts.some((c) => c < 0)) {
                knownTotal = counts.reduce((a, b) => a + b, 0);
                paintStatus(knownTotal, "");
              }
            }
          );
        }
      }
      // "Match contents & every field" resolves to a set of item ids the
      // index matched inside the documents; those ids ride every page's
      // CAML alongside the name match, so the depth toggle can only ever
      // ADD documents to the name-only answer. Resolved once per reset —
      // the ids are baked into each feed's ViewXml.
      if (reset) {
        contentIds = new Map();
        contentsNote = "";
        if (wantContents) {
          const hits = await searchPage(app.siteUrl, query, {
            listIds: browseIds,
            rowLimit: CONTENT_HITS,
            startRow: 0,
            searchContents: true,
            modifiedAfterIso: modifiedIso(),
            termFilters: filters.map((f) => ({ properties: propsFor(f.col), termIds: f.ids })),
          });
          if (dead || gen !== generation) return finish();
          if (hits.error !== "") {
            contentsNote = "failed";
          } else {
            for (const r of hits.rows) {
              if (r.id <= 0 || r.listId === "") continue;
              const bucket = contentIds.get(r.listId) ?? [];
              bucket.push(r.id);
              contentIds.set(r.listId, bucket);
            }
            if (hits.total > hits.rows.length) contentsNote = "capped";
          }
        }
      }
      {
        // browse via RenderListDataAsStream (single library or union):
        // display-ready values for every field type, with name search,
        // the Modified window and taxonomy label filters all CAML'd
        // SERVER-side per library; feeds k-way merge client-side and a
        // drained buffer refills mid-page so the merge never skips rows
        if (feeds.length === 0) {
          feeds = browseIds.map((id) => {
            const lib = byListId.get(id.toLowerCase());
            // ONLY the fields the register renders: SharePoint throttles
            // any query touching >12 lookup-type columns (taxonomy and
            // person columns all count — Ben's SPQueryThrottledException,
            // 2026-08-02), so "every available column" is not requestable
            const carried = new Set((lib?.config.columns ?? []).map((c) => c.internal));
            const fieldsFor = (): string[] => {
              const out = new Set<string>();
              // EVERY library in view gets the register's columns, not
              // just the one that happened to be "current" — that test
              // is why a multi-library browse fetched no DMS fields at
              // all and rendered three bare columns (C3).
              const shown =
                chosenColumns.length > 0 ? chosenColumns : defaultInternals();
              for (const internal of shown) {
                // asking a library for a column it does not carry is a
                // guaranteed 400 from RLDAS, so each feed asks only for
                // what its own list actually has
                if (internal !== "Modified" && carried.has(internal)) out.add(internal);
              }
              for (const internal of [statusInternal, ownerInternal]) {
                if (internal !== "" && carried.has(internal)) out.add(internal);
              }
              for (const c of groupBy === "" ? [...orgCols] : [groupBy]) out.add(c);
              // who holds it checked out — asked for ONLY where documents
              // can be worked on. It is a person field, so it is a lookup,
              // and this tenant throttles a view past twelve of those
              // (Phase 0). A read-only register pays nothing for 4B.
              const feedLib = byListId.get(id.toLowerCase());
              if (feedLib?.libType === "working" || feedLib?.libType === "revision") {
                out.add("CheckoutUser");
              }
              return [...out];
            };
            const viewXml = buildRenderViewXml({
              sortName: sort.key === "name",
              asc: sort.asc,
              modifiedAfterIso: modifiedIso(),
              nameWords: words,
              idIn: contentIds.get(id.toLowerCase()) ?? [],
              termFilters: [
                ...filters.map((f) => ({
                  cols: f.col === "" ? [...orgCols] : [f.col],
                  labels: [...f.labels],
                })),
                // applied silently: no chip, no filter row — the toggle
                // says it (Ben, 2026-08-03)
                ...approvedFilterFor(),
              ],
              // only bind a date column the library actually carries
              dateRanges: dateFilters.filter((d) => carried.has(d.col)),
              fields: fieldsFor(),
              rowLimit: PAGE,
            });
            return { listId: id, viewXml, buf: [], next: "", done: false };
          });
        }
        let feedError = "";
        const fill = async (f: BrowseFeed) => {
          if (f.done || f.buf.length > 0) return;
          const page = await renderListPage(app.siteUrl, f.listId, f.viewXml, f.next);
          f.buf.push(...page.rows);
          f.next = page.next;
          if (page.error !== "") {
            feedError = page.error;
            f.done = true;
          } else if (page.next === "") {
            f.done = true;
          }
        };
        const cmp = browseComparator(sort.key === "name" ? "name" : "modified", sort.asc);
        const rowsOut: DocRow[] = [];
        while (rowsOut.length < PAGE) {
          await Promise.all(feeds.map(fill));
          if (dead || gen !== generation) return finish();
          const i = pickBrowseHead(feeds.map((f) => f.buf), cmp);
          if (i < 0) break;
          rowsOut.push(feeds[i].buf.shift()!);
        }
        list.append(applyNonCurrent(rowsOut));
        done = feeds.every((f) => f.done && f.buf.length === 0);
        paintStatus(knownTotal, feedError);
      }
      list.setLoading(false);
      paintTreeCounts();
      if (reset) refreshTreeTotals(gen);
      finish();
    };
    const loadMore = () => load(false);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    search.addEventListener("input", () => {
      query = search.value;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => void load(true), 300);
    });

    // ---- share + register export ---------------------------------------
    const currentView = (): DocView => {
      const org = filterFor("");
      return {
        ...emptyDocView(),
        listId: current?.listId ?? "",
        query: query.trim(),
        contents: searchContents,
        nonCurrent: !onlyApproved,
        modifiedDays,
        // the organisation keeps its own slot so pre-3a links stay valid
        orgTermId: org?.node.id ?? "",
        orgPath: org?.node.labels ?? [],
        filters: filters
          .filter((f) => f.col !== "")
          .map((f) => ({ col: f.col, termId: f.node.id, path: f.node.labels })),
        columns: chosenColumns,
        groupBy,
        dates: dateFilters.map((d) => ({ ...d })),
      };
    };
    const copyViewLink = () => {
      void navigator.clipboard
        .writeText(docsViewUrl(encodeDocView(currentView())))
        .then(() => {
          status.textContent = "Link copied ✓ — it opens Documents exactly as you see it now.";
        });
    };

    // saved views (relocated from the nav, Ben 2026-08-01): one menu —
    // save the current state on top, the saved list beneath, delete per
    // row. Opening a view remounts in place, same as always.
    const openViewsMenu = () => {
      menu = el("div", "app-docs-menu app-docs-viewsmenu");
      const paint = () => {
        clear(menu!);
        const saveRow = el("div", "app-docs-saverow");
        const nameIn = el("input", "app-input app-docs-viewname") as HTMLInputElement;
        nameIn.placeholder = "Save current view as…";
        const saveB = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
        const commit = () => {
          const name = nameIn.value.trim();
          if (name === "") return;
          void saveDocView(whoId, { ...currentView(), name }).then((list) => {
            if (dead) return;
            savedViews = list;
            paint();
          });
        };
        saveB.addEventListener("click", commit);
        nameIn.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
        });
        saveRow.append(nameIn, saveB);
        menu!.appendChild(saveRow);
        if (savedViews.length > 0) menu!.appendChild(el("div", "app-docs-menusep", ""));
        for (const v of savedViews) {
          const row = el("div", "app-docs-viewrow");
          const open = el("button", "app-docs-menuitem", v.name) as HTMLButtonElement;
          open.title = "Open this view";
          open.addEventListener("click", () => {
            closeMenu();
            pendingView = v;
            remount();
          });
          const del = el("button", "app-docs-viewbtn", "×") as HTMLButtonElement;
          del.title = `Delete “${v.name}”`;
          del.setAttribute("aria-label", `Delete the view ${v.name}`);
          del.addEventListener("click", () => {
            void deleteDocView(whoId, v.name).then((list) => {
              if (dead) return;
              savedViews = list;
              paint();
            });
          });
          row.append(open, del);
          menu!.appendChild(row);
        }
      };
      paint();
      const r = topKebab.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 280)}px`;
      document.body.appendChild(menu);
    };
    const EXPORT_CAP = 2000;
    let exporting = false;
    const exportRegister = () => {
      if (exporting) return;
      void (async () => {
        exporting = true;
        status.textContent = "Exporting…";
        const scopeLibs = viewLibs();
        // the register's own columns, named as the site names them and
        // in the same dictionary order — an export that disagreed with
        // the screen it came from would be its own small lie
        const wanted = sortByDictionary(
          chosenColumns.length > 0 ? chosenColumns : defaultInternals(),
          [...dictBy.keys()]
        );
        const cols = wanted
          .filter((i) => i !== "Modified")
          .map((i) => ({ internal: i, label: labelOf(i) }));
        const rows: string[][] = [];
        let truncated = false;
        // RLDAS, like the register (C3b): FieldValuesAsText renders
        // taxonomy as WssIds and drops whole columns depending on the
        // projection, so the old export could differ from the screen
        for (const lib of scopeLibs) {
          const carried = new Set(lib.config.columns.map((c) => c.internal));
          const viewXml = buildRenderViewXml({
            sortName: sort.key === "name",
            asc: sort.asc,
            fields: cols.map((c) => c.internal).filter((i) => carried.has(i)),
            rowLimit: 100,
          });
          let next = "";
          for (;;) {
            const page = await renderListPage(app.siteUrl, lib.listId, viewXml, next);
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
        chosenColumns.length > 0 ? chosenColumns : [...defaultInternals(), "Modified"];
      // offerable = what the site says is available AND some library in
      // view actually carries; the chooser opens whatever the scope
      const carried = new Set(viewLibs().flatMap((l) => l.config.columns.map((c) => c.internal)));
      const entries = [
        ...siteDict.columns
          .filter((c) => c.available && carried.has(c.internal))
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
      const item = (label: string, title: string, onPick: (() => void) | null) => {
        const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
        b.title = title;
        if (onPick) {
          b.addEventListener("click", () => {
            closeMenu();
            onPick();
          });
        } else {
          b.disabled = true;
        }
        menu!.appendChild(b);
      };
      // offered whatever the scope now: the columns come from the site's
      // mapping, so the chooser works across libraries too (C3)
      item(
        "Choose columns…",
        "Add or remove this view's columns from the site's available set.",
        chooseColumns
      );
      // presentation toggles relocated from the toolbar (Vault V3)
      if (viewMode === "list") {
        item(
          `${density === "compact" ? "✓ " : ""}Compact rows`,
          "Denser rows — more of the register on screen.",
          () => {
            density = density === "compact" ? "comfortable" : "compact";
            persistUi({ density });
            buildRegister();
          }
        );
      }
      item(
        `${onlyApproved ? "✓ " : ""}Show only Approved`,
        statusCol
          ? "On, the register answers with the approved copy only, and " +
            "Approval status drops out of Filters — it is already set."
          : "Map a column to the Approval status role in Settings → Documents first",
        statusCol
          ? () => {
              onlyApproved = !onlyApproved;
              // turning it on subsumes any status filter someone set by
              // hand; leaving it there would filter twice, invisibly
              if (onlyApproved && statusInternal !== "") {
                filters = filters.filter((f) => f.col !== statusInternal);
                paintChips();
              }
              void load(true);
            }
          : null
      );
      if (whoId !== "") {
        item(
          "Saved views…",
          "Save the current filter as a view, or open a saved one.",
          openViewsMenu
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

    // the status vocabulary first: "Show only Approved" is on by default,
    // so the very first page should already be filtered rather than
    // arrive unfiltered and blink
    void readStatusTerms().finally(() => void load(true));
  })();

  return () => {
    dead = true;
    for (const f of innerCleanups) f();
    innerCleanups.length = 0;
    wrap.remove();
  };
}
