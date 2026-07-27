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
import { browsePage, searchPage } from "./data";
import { ListColumn, mountDocList } from "./listView";
import {
  DocRow,
  extGlyph,
  formatWhen,
  isNonCurrentStatus,
  openUrlFor,
} from "./rows";
import { DocLibrary, docsConfig } from "./docsStore";
import { fetchTermPaths } from "./sp";
import { openDocProperties, openDocViewer } from "./viewer";

const PAGE = 50;

export function mountDocs(parent: HTMLElement, selected: string): () => void {
  const wrap = el("div", "app-docs-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;

  void (async () => {
    // a bare dev server has no host — SDK calls would HANG, not reject
    if (!(await detectHost())) {
      stopLoading();
      if (dead) return;
      wrap.appendChild(el("h2", "app-docs-title", "Documents"));
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
      wrap.appendChild(el("h2", "app-docs-title", "Documents"));
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
    const current: DocLibrary | null = byListId.get(selected.toLowerCase()) ?? null;

    // ---- chrome: title, search, controls -------------------------------
    const top = el("div", "app-docs-top");
    top.appendChild(el("h2", "app-docs-title", "Documents"));
    const search = el("input", "app-input app-docs-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = current
      ? `Search ${current.config.title || current.name}…`
      : "Search all documents…";
    const scope = el("select", "app-input app-docs-scope") as HTMLSelectElement;
    for (const [v, label] of [
      ["library", "This library"],
      ["all", "All documents"],
    ] as const) {
      const o = el("option", "", label) as HTMLOptionElement;
      o.value = v;
      scope.appendChild(o);
    }
    scope.style.display = current ? "" : "none";
    const nonCurrent = el("label", "app-docs-check app-docs-noncurrent");
    const nonCurrentBox = el("input", "") as HTMLInputElement;
    nonCurrentBox.type = "checkbox";
    nonCurrent.append(nonCurrentBox, document.createTextNode(" Include drafts & superseded"));
    top.append(search, scope, nonCurrent);
    wrap.appendChild(top);

    const bodyRow = el("div", "app-docs-body");
    wrap.appendChild(bodyRow);

    // ---- left nav ------------------------------------------------------
    const nav = el("nav", "app-docs-nav");
    bodyRow.appendChild(nav);
    const navLink = (label: string, hash: string, active: boolean, hint = "") => {
      const a = el("a", `app-docs-navitem${active ? " app-docs-navitem-on" : ""}`) as HTMLAnchorElement;
      a.href = hash;
      a.append(el("span", "app-docs-navlabel", label));
      if (hint !== "") a.appendChild(el("span", "app-field-hint", hint));
      nav.appendChild(a);
      return a;
    };
    navLink("All documents", "#/docs", current === null);
    for (const lib of libraries) {
      navLink(
        lib.config.title || lib.name,
        `#/docs/${lib.listId}`,
        current?.listId === lib.listId,
        lib.libType
      );
    }
    if (app.orgSetId !== "") {
      const orgHead = el("div", "app-docs-navorg", "Organisation");
      nav.appendChild(orgHead);
      const orgBox = el("div", "app-docs-navorgbox");
      nav.appendChild(orgBox);
      orgBox.appendChild(el("div", "app-field-hint", "Loading…"));
      void fetchTermPaths(app.siteUrl, app.orgSetId, 3, 40).then(({ paths, error }) => {
        if (dead) return;
        clear(orgBox);
        if (error !== "" || paths.length === 0) {
          orgBox.appendChild(el("div", "app-field-hint", "No organisation terms yet."));
          return;
        }
        for (const p of paths) {
          const node = el("div", "app-docs-navterm", p[p.length - 1]);
          node.style.paddingLeft = `${8 + (p.length - 1) * 14}px`;
          node.title =
            "Filtering by organisation arrives once the site's search mapping for this column is in place.";
          orgBox.appendChild(node);
        }
      });
    }

    // ---- the list ------------------------------------------------------
    const main = el("div", "app-docs-main");
    bodyRow.appendChild(main);
    const status = el("div", "app-docs-status");
    main.appendChild(status);

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
        openDocViewer({
          site: app.siteUrl,
          row,
          libraryName: lib ? lib.config.title || lib.name : "",
          askToWork: lib?.libType === "working",
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
      item("Properties & history", () =>
        openDocProperties({
          site: app.siteUrl,
          row,
          labels: Object.fromEntries(
            (lib?.config.columns ?? [])
              .filter((c) => c.label !== "")
              .map((c) => [c.internal, c.label])
          ),
        })
      );
      item("Open in SharePoint ↗", () => window.open(openUrlFor(app.siteUrl, row), "_blank"));
      item("Copy link", () => void navigator.clipboard.writeText(openUrlFor(app.siteUrl, row)));
      if (lib?.libType === "working") {
        item("Request check-out", null, "Document control arrives in a later phase");
      }
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    };

    // ---- data flow -----------------------------------------------------
    let query = "";
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
      inFlight = true;
      const gen = reset ? ++generation : generation;
      if (reset) {
        nextToken = "";
        done = false;
        list.setRows([]);
      }
      list.setLoading(true);
      const useSearch = query.trim() !== "" || current === null || scope.value === "all";
      if (useSearch) {
        const startRow = nextToken === "" ? 0 : Number(nextToken);
        const page = await searchPage(app.siteUrl, query, {
          listId: current && scope.value === "library" ? current.listId : "",
          rowLimit: PAGE,
          startRow,
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
    nonCurrentBox.addEventListener("change", () => void load(true));
    // the heuristic toggle only bites where a status column is mapped
    if (!statusCol) {
      nonCurrentBox.disabled = true;
      nonCurrent.title = current
        ? "Map a column to the Approval status role in Settings → Documents first"
        : "Applies inside a library with a status column mapped";
    }

    void load(true);
  })();

  return () => {
    dead = true;
    wrap.remove();
  };
}
