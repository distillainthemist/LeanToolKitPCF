// Standard Documents — the board cards (doc-cards plan A/B2):
// "Standard documents" renders the register's OWN rows — same cells,
// same feed road — and "Document health" derives overdue / due-soon
// reviews at read time (never stored, per the repo's own rule: stored
// "overdue" goes stale).
//
// Card contract (the resolved Phase 2 design): the grid paints the
// stored tile SVG before this module even loads (cardRegistry reaches
// it by DYNAMIC import only — the gate enforces that); the live fetch
// happens after paint with jitter, so a wall of boards opening at shift
// start cannot synchronise into a 429 storm. Cards hold no document of
// their own — the tile snapshot is the only thing they emit.
//
// Configuration is a PASTED register link (plan part A): Copy link
// carries the whole view state — library, organisation and taxonomy
// filters by term id (rename-proof), search words, date windows, the
// column set — so the card shows exactly what the register showed, and
// there is ONE source of filter truth. The older text settings
// (docsLibrary, docsOrg, docsMatch) keep working when nothing is
// pasted: a stored board keeps its meaning.

import type { CardMount } from "../cardRegistry";
import { el, clear } from "../../../shared/ui/dom";
import { statusChip as tonePill } from "../../../shared/ui/format";
import { renderTitleBar, parsePrompts } from "../../../shared/ui/chrome";
import { applyThemeVars } from "../../../shared/tokens";
import { paletteMap } from "../../../shared/palette";
import { appPalettes } from "../store/config";
import { currentViewer } from "../runtime";
import { docsConfig, DocLibrary } from "./docsStore";
import { renderListPage, driveIdFor } from "./data";
import { TermNode, cachedTermPaths, fetchTermsInSet } from "./sp";
import {
  DocRow,
  browseComparator,
  buildRenderViewXml,
  formatDayMonthYear,
  isNonCurrentStatus,
  pickBrowseHead,
} from "./rows";
import { taskGroupHeader, taskRowEl } from "./taskRows";
import { DocView, emptyDocView, viewFromPaste } from "./views";
import { SiteDictionary, emptySiteDictionary, siteKey } from "./model";
import {
  RegisterCellCtx,
  buildRegisterColumns,
  statusTone,
  WidthBucket,
} from "./registerCells";
import { mountDocList } from "./listView";
import { openDocViewer } from "./viewer";

type Kind = "docs" | "health";

const cfg = (opts: CardMount, key: string): string => {
  const c = (opts.settings.config ?? {}) as Record<string, unknown>;
  const v = c[key];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface SnapshotLine {
  text: string;
  strong?: boolean;
  /** Status dot colour (B4) — resolved through statusTone, so the tile
   *  wears the same palette the chips wear. "" / absent = no dot. */
  dot?: string;
}

/** The tile snapshot: a simple readable SVG of what the card shows. */
function snapshotSvg(title: string, lines: SnapshotLine[]): string {
  const rows = lines
    .slice(0, 8)
    .map((l, i) => {
      const y = 64 + i * 30;
      const dot =
        (l.dot ?? "") !== ""
          ? `<circle cx="21" cy="${y - 5}" r="5" fill="${esc(l.dot ?? "")}"/>`
          : "";
      const x = (l.dot ?? "") !== "" ? 34 : 16;
      return (
        dot +
        `<text x="${x}" y="${y}" font-size="${l.strong ? 20 : 16}" ` +
        `font-weight="${l.strong ? 700 : 400}" fill="#333" ` +
        `font-family="system-ui, sans-serif">${esc(l.text.slice(0, 60))}</text>`
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">` +
    `<rect width="480" height="320" fill="#ffffff"/>` +
    `<text x="16" y="32" font-size="19" font-weight="600" fill="#111" ` +
    `font-family="system-ui, sans-serif">${esc(title.slice(0, 44))}</text>` +
    rows +
    `</svg>`
  );
}

// ---- scope: what the card is looking at -------------------------------

interface CardScope {
  site: string;
  libs: DocLibrary[];
  dict: SiteDictionary;
  /** The effective view — pasted, or synthesised from the legacy keys. */
  view: DocView;
  /** CAML label filters (org + taxonomy), subtree-expanded — the same
   *  shape the register's own feed carries. */
  termFilters: { cols: string[]; labels: string[] }[];
  statusCol: { internal: string; termSetId: string } | null;
  ownerInternal: string;
  labelToId: Map<string, string>;
  /** Status values meaning "the approved copy" — [] when the set could
   *  not be read; the client-side fallback then stands in. */
  approvedLabels: string[];
  /** Human line describing the scope (shown while designing). */
  summary: string;
  /** Non-fatal notes, painted above the rows. */
  notes: string[];
  /** Nothing renderable — the reason. */
  fatal: string;
}

const subtreeIn = (nodes: TermNode[], node: TermNode): TermNode[] =>
  nodes.filter(
    (n) =>
      n.id === node.id ||
      (n.labels.length > node.labels.length &&
        node.labels.every((l, i) => n.labels[i] === l))
  );

const leafLabels = (node: TermNode, subtree: TermNode[]): string[] => [
  ...new Set([node, ...subtree].map((n) => n.labels[n.labels.length - 1].toLowerCase())),
];

/** Resolve the configured scope. Anything unresolvable is REPORTED, and
 *  a filter that cannot be applied is fatal rather than dropped — a
 *  card silently showing more than it was scoped to would lie. */
async function resolveCardScope(opts: CardMount): Promise<CardScope> {
  const out: CardScope = {
    site: "",
    libs: [],
    dict: emptySiteDictionary(),
    view: emptyDocView(),
    termFilters: [],
    statusCol: null,
    ownerInternal: "",
    labelToId: new Map(),
    approvedLabels: [],
    summary: "",
    notes: [],
    fatal: "",
  };
  const { app, libraries } = await docsConfig();
  if (app.siteUrl === "" || libraries.length === 0) {
    out.fatal = "Set up Settings → Documents first.";
    return out;
  }
  out.site = app.siteUrl;
  out.dict = app.sites[siteKey(app.siteUrl)] ?? emptySiteDictionary();

  // ---- the effective view --------------------------------------------
  const pasted = cfg(opts, "docsView");
  const view = viewFromPaste(pasted);
  if (pasted !== "" && view === null) {
    out.notes.push("The pasted view didn't decode — using the card's other settings.");
  }
  if (view !== null) {
    out.view = view;
  } else {
    // legacy keys, synthesised into the same shape (docsOrg resolves
    // against the walk below, by leaf label — its historical meaning)
    out.view = { ...emptyDocView(), query: cfg(opts, "docsMatch") };
  }

  // ---- libraries -------------------------------------------------------
  let libs = libraries;
  if (out.view.listId !== "") {
    libs = libraries.filter((l) => l.listId.toLowerCase() === out.view.listId.toLowerCase());
    if (libs.length === 0) {
      out.fatal = "The pasted view's library is not exposed here.";
      return out;
    }
  }
  const wantNames = cfg(opts, "docsLibrary")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
  if (wantNames.length > 0) {
    const nameOf = (l: DocLibrary) => (l.config.title || l.name).toLowerCase();
    const missing = wantNames.filter((w) => !libs.some((l) => nameOf(l) === w));
    libs = libs.filter((l) => wantNames.includes(nameOf(l)));
    if (missing.length > 0) {
      out.notes.push(`No exposed library called ${missing.map((m) => `“${m}”`).join(", ")}.`);
    }
    if (libs.length === 0) {
      out.fatal = "None of the configured libraries are exposed here.";
      return out;
    }
  }
  out.libs = libs;

  // ---- column roles ----------------------------------------------------
  const forRole = (role: string): string =>
    out.dict.columns.find((c) => c.role === role)?.internal ?? "";
  const statusInternal = forRole("status");
  out.ownerInternal = forRole("owner");
  if (statusInternal !== "") {
    const sc = out.dict.columns.find((c) => c.internal === statusInternal);
    out.statusCol = { internal: statusInternal, termSetId: sc?.termSetId ?? "" };
  }

  // ---- status vocabulary (BEFORE any feed: an approved-only clause
  // built from an unresolved vocabulary is unscoped — the 13-vs-9
  // lesson, 2026-08-08) ------------------------------------------------
  if (out.statusCol !== null && out.statusCol.termSetId !== "") {
    const r = await fetchTermsInSet(out.site, out.statusCol.termSetId);
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
      if (typeof t.id === "string") out.labelToId.set(name.toLowerCase(), t.id);
    }
    // "approved" is whatever this site's vocabulary calls current — the
    // same reading the register uses, so card and screen cannot disagree
    out.approvedLabels = labels.filter((l) => !isNonCurrentStatus(l));
  }

  // ---- filters (org + taxonomy), subtree-expanded ---------------------
  const orgCols = [
    ...new Set(
      libs.flatMap((l) =>
        l.config.columns.filter((c) => c.role === "orgUnit").map((c) => c.internal)
      )
    ),
  ];
  const setForCol = (col: string): string => {
    for (const l of libraries) {
      const c = l.config.columns.find((x) => x.internal === col && x.termSetId !== "");
      if (c) return c.termSetId;
    }
    return "";
  };
  const filterPaths: string[] = [];
  const addFilter = async (
    col: string,
    setId: string,
    termId: string,
    legacyLeaf: string
  ): Promise<boolean> => {
    if (setId === "") {
      out.fatal = "A filtered column's term set is unknown here.";
      return false;
    }
    const { nodes } = await cachedTermPaths(out.site, setId);
    let node: TermNode | undefined;
    if (termId !== "") {
      node = nodes.find((n) => n.id === termId);
    } else {
      // legacy docsOrg: deepest node whose LEAF label matches
      node = nodes
        .filter((n) => n.labels[n.labels.length - 1].toLowerCase() === legacyLeaf)
        .sort((a, b) => b.labels.length - a.labels.length)[0];
    }
    if (node === undefined) {
      out.fatal =
        termId !== ""
          ? "A term this view filters on no longer exists — re-copy the link from Documents."
          : `No organisation term called “${legacyLeaf}”.`;
      return false;
    }
    out.termFilters.push({
      cols: col === "" ? orgCols : [col],
      labels: leafLabels(node, subtreeIn(nodes, node)),
    });
    filterPaths.push(node.labels[node.labels.length - 1]);
    return true;
  };
  if (out.view.orgTermId !== "") {
    if (!(await addFilter("", app.orgSetId, out.view.orgTermId, ""))) return out;
  } else if (view === null && cfg(opts, "docsOrg") !== "") {
    if (app.orgSetId === "") {
      out.fatal = "No organisation term set is configured.";
      return out;
    }
    if (!(await addFilter("", app.orgSetId, "", cfg(opts, "docsOrg").toLowerCase()))) return out;
  }
  for (const f of out.view.filters) {
    if (!(await addFilter(f.col, setForCol(f.col), f.termId, ""))) return out;
  }

  // ---- the human summary ----------------------------------------------
  const parts: string[] = [
    out.view.listId !== "" || wantNames.length > 0
      ? libs.map((l) => l.config.title || l.name).join(", ")
      : "All documents",
    ...filterPaths,
  ];
  if (out.view.query !== "") parts.push(`“${out.view.query}”`);
  if (out.view.modifiedDays > 0) parts.push(`modified ${out.view.modifiedDays}d`);
  parts.push(out.view.nonCurrent ? "including drafts & superseded" : "approved only");
  out.summary = parts.join(" · ");
  return out;
}

// ---- the card shell ----------------------------------------------------

export function mountDocsCard(kind: Kind, opts: CardMount): void {
  const root = el("div", "app-docscard");
  applyThemeVars(root, opts.theme);
  opts.host.appendChild(root);
  renderTitleBar(root, opts.title, parsePrompts(""));
  const body = el("div", "app-docscard-body");
  root.appendChild(body);
  body.appendChild(el("div", "app-field-hint", "Loading…"));

  // after-paint jitter: boards opening together must not synchronise
  const jitter = opts.designTime ? 0 : 300 + Math.floor(Math.random() * 1200);
  setTimeout(() => {
    if (!root.isConnected) return;
    void (kind === "docs" ? paintDocs(opts, body) : paintHealth(opts, body)).then(
      (lines) => {
        if (!root.isConnected || lines === null) return;
        opts.onTile?.(snapshotSvg(opts.title || cardTitle(kind), lines));
      }
    );
  }, jitter);
}

function cardTitle(kind: Kind): string {
  return kind === "docs" ? "Standard documents" : "Document health";
}

const note = (body: HTMLElement, text: string): null => {
  clear(body);
  body.appendChild(el("div", "app-settings-note", text));
  return null;
};

/** Scope preamble: while DESIGNING, say exactly what the card watches
 *  (the paste's validator); on the board, only the notes that matter. */
function paintScopeLines(opts: CardMount, body: HTMLElement, scope: CardScope): void {
  if (opts.designTime === true) {
    body.appendChild(el("div", "app-field-hint", scope.summary));
  }
  for (const n of scope.notes) body.appendChild(el("div", "app-settings-note", n));
}

// ---- Standard documents: the register's rows, on the board ------------

async function paintDocs(
  opts: CardMount,
  body: HTMLElement
): Promise<{ text: string; strong?: boolean }[] | null> {
  const scope = await resolveCardScope(opts);
  if (scope.fatal !== "") return note(body, scope.fatal);
  const n = Math.max(1, Math.min(20, Number(cfg(opts, "docsCount")) || 8));
  const onlyApproved = !scope.view.nonCurrent;

  // the register's feed, in miniature: one RLDAS page per library —
  // filters in the CAML, fields only where the library carries them —
  // merged newest-first (C3b: the search road disagreed with the screen)
  const modifiedAfterIso =
    scope.view.modifiedDays > 0
      ? new Date(Date.now() - scope.view.modifiedDays * 86400000).toISOString()
      : undefined;
  const words = scope.view.query.trim() === "" ? undefined : scope.view.query.trim().split(/\s+/);
  const approvedFilter =
    onlyApproved && scope.statusCol !== null && scope.approvedLabels.length > 0
      ? [{ cols: [scope.statusCol.internal], labels: scope.approvedLabels }]
      : [];

  // which columns: the view's own choice, else what the libraries in
  // view open with — availability answered by the dictionary (the
  // register's own rule)
  const dictBy = new Map(scope.dict.columns.map((c) => [c.internal, c]));
  const defaults = (): string[] => {
    const wanted = new Set<string>();
    for (const lib of scope.libs) {
      for (const c of lib.config.columns) if (c.inDefault) wanted.add(c.internal);
    }
    const fromDict = scope.dict.columns
      .filter((c) => c.available && wanted.has(c.internal))
      .map((c) => c.internal);
    return fromDict.length > 0 ? fromDict : [...wanted];
  };
  const wanted =
    scope.view.columns.length > 0
      ? scope.view.columns.filter((i) => i === "Modified" || dictBy.get(i)?.available === true)
      : defaults();

  const feeds = scope.libs.map((lib) => {
    const carried = new Set(lib.config.columns.map((c) => c.internal));
    const fields = new Set<string>();
    for (const internal of wanted) {
      if (internal !== "Modified" && carried.has(internal)) fields.add(internal);
    }
    for (const internal of [scope.statusCol?.internal ?? "", scope.ownerInternal]) {
      if (internal !== "" && carried.has(internal)) fields.add(internal);
    }
    // the checkout lock, where documents can be worked on (a lookup —
    // scoped exactly as the register scopes it)
    if (lib.libType === "working" || lib.libType === "revision" || lib.libType === "standard") {
      fields.add("CheckoutUser");
    }
    const viewXml = buildRenderViewXml({
      modifiedAfterIso,
      nameWords: words,
      termFilters: [...scope.termFilters, ...approvedFilter],
      dateRanges: scope.view.dates.filter((d) => carried.has(d.col)),
      fields: [...fields],
      rowLimit: n,
    });
    return { lib, viewXml };
  });

  const pages = await Promise.all(
    feeds.map((f) => renderListPage(scope.site, f.lib.listId, f.viewXml, ""))
  );
  const err = pages.find((p) => p.error !== "");
  if (err !== undefined) return note(body, `Documents refused: ${err.error}`);

  // merge newest-first across libraries — each page is already its
  // library's top-n, so the merged head is the true top-n
  const cmp = browseComparator("modified", false);
  const buffers = pages.map((p) => [...p.rows]);
  let rows: DocRow[] = [];
  for (;;) {
    const i = pickBrowseHead(buffers, cmp);
    if (i < 0 || rows.length >= n) break;
    rows.push(buffers[i].shift()!);
  }
  // vocabulary unreadable: the CAML clause could not be built, so the
  // register's client-side fallback stands in — same meaning, stated
  if (onlyApproved && scope.statusCol !== null && scope.approvedLabels.length === 0) {
    const col = scope.statusCol.internal;
    rows = rows.filter((r) => !isNonCurrentStatus(r.values[col] ?? ""));
  }

  const palettes = await appPalettes();
  clear(body);
  paintScopeLines(opts, body, scope);
  const cellCtx: RegisterCellCtx = {
    dict: scope.dict,
    states: paletteMap(palettes.states),
    labelToId: scope.labelToId,
    statusCol: scope.statusCol,
    myEmail: (currentViewer()?.email ?? "").toLowerCase(),
  };
  const w = body.clientWidth;
  const bucket: WidthBucket = w > 0 && w < 380 ? "narrow" : w < 560 ? "mid" : "full";
  const byListId = new Map(scope.libs.map((l) => [l.listId.toLowerCase(), l]));
  const listHost = el("div", "app-docscard-list");
  body.appendChild(listHost);
  const list = mountDocList<DocRow>(listHost, {
    columns: buildRegisterColumns(cellCtx, {
      wanted,
      bucket,
      libraryLabel:
        scope.libs.length > 1
          ? (row) => {
              const lib = byListId.get(row.listId);
              return lib ? lib.config.title || lib.name : "";
            }
          : undefined,
    }),
    onRow: (row) => {
      const lib = byListId.get(row.listId);
      void driveIdFor(scope.site, row.listId).then((driveId) =>
        openDocViewer({
          site: scope.site,
          row,
          driveId,
          libraryName: lib ? lib.config.title || lib.name : "",
          askToWork: lib?.libType === "working",
        })
      );
    },
    onNearEnd: () => undefined,
    emptyText: "No documents in this scope yet.",
    density: "compact",
  });
  list.setRows(rows);
  if (rows.length === 0) return [{ text: "No documents in scope" }];
  // B4: the tile wears the chips' own palette — a coloured dot per row
  // where the status resolves, the status word where it does not
  const statusOf = (r: DocRow): string =>
    scope.statusCol !== null ? (r.values[scope.statusCol.internal] ?? "") : "";
  return rows.map((r) => {
    const s = statusOf(r);
    const color = s !== "" ? statusTone(cellCtx, s).color : "";
    return color !== ""
      ? { text: r.name, dot: color }
      : { text: s !== "" ? `${r.name} — ${s}` : r.name };
  });
}

// ---- Document health: derive-at-read, never stored --------------------

async function paintHealth(
  opts: CardMount,
  body: HTMLElement
): Promise<{ text: string; strong?: boolean }[] | null> {
  const scope = await resolveCardScope(opts);
  if (scope.fatal !== "") return note(body, scope.fatal);
  const dueSoonDays = Math.max(1, Number(cfg(opts, "dueSoonDays")) || 30);
  const CAP = 200; // FINDINGS per library — the cap is stated when hit
  // only approved documents owe a periodic review (5D: the review-due
  // queue is scoped to the APPROVED stage — a draft or superseded
  // standard has nothing to chase); unscoped only when the status
  // vocabulary could not be read, exactly like the register's sweep
  const approvedClause =
    scope.statusCol !== null && scope.approvedLabels.length > 0
      ? [{ cols: [scope.statusCol.internal], labels: scope.approvedLabels }]
      : [];
  interface Due {
    row: DocRow;
    when: number;
    label: string;
    owner: string;
    lib: DocLibrary;
  }
  const overdue: Due[] = [];
  const dueSoon: Due[] = [];
  let capped = false;
  let reviewColSeen = false;
  const now = Date.now();
  for (const lib of scope.libs) {
    const reviewCol = lib.config.columns.find((c) => c.role === "nextReviewDate");
    if (!reviewCol) continue;
    reviewColSeen = true;
    const carried = new Set(lib.config.columns.map((c) => c.internal));
    const fields = [reviewCol.internal];
    // the owner names the row's meta line (a lookup — one, deliberate)
    if (scope.ownerInternal !== "" && carried.has(scope.ownerInternal)) {
      fields.push(scope.ownerInternal);
    }
    // the register's own review sweep, communal: the due question is
    // asked SERVER-SIDE (dueWithinDays covers overdue and due-soon in
    // one clause), so only findings come back — not the corpus
    const viewXml = buildRenderViewXml({
      dueWithinDays: { col: reviewCol.internal, days: dueSoonDays },
      termFilters: [...scope.termFilters, ...approvedClause],
      fields,
      rowLimit: 100,
    });
    let next = "";
    let taken = 0;
    for (;;) {
      const page = await renderListPage(scope.site, lib.listId, viewXml, next);
      if (page.error !== "") return note(body, `Documents refused: ${page.error}`);
      for (const row of page.rows) {
        // the ISO twin ("Column.") is the real value; the display text
        // is a site-locale guess we only fall back to
        const iso = row.values[`${reviewCol.internal}.`] ?? "";
        const disp = row.values[reviewCol.internal] ?? "";
        const t = Date.parse(iso !== "" ? iso : disp);
        if (Number.isNaN(t)) continue;
        (t < now ? overdue : dueSoon).push({
          row,
          when: t,
          label: formatDayMonthYear(new Date(t).toISOString()),
          owner: (row.values[scope.ownerInternal] ?? "").split(";")[0].trim(),
          lib,
        });
      }
      taken += page.rows.length;
      next = page.next;
      if (next === "" || taken >= CAP) {
        capped = capped || next !== "";
        break;
      }
    }
  }
  if (!reviewColSeen) {
    return note(
      body,
      "Map a column to the Next review date role in Settings → Documents — health is derived from it."
    );
  }
  overdue.sort((a, b) => a.when - b.when);
  dueSoon.sort((a, b) => a.when - b.when);

  clear(body);
  paintScopeLines(opts, body, scope);
  const stat = (label: string, count: number, cls: string) => {
    const box = el("div", `app-docscard-stat ${cls}`);
    box.append(el("span", "app-docscard-statn", String(count)), el("span", "", label));
    return box;
  };
  const statRow = el("div", "app-docscard-stats");
  statRow.append(
    stat("overdue", overdue.length, overdue.length > 0 ? "app-docscard-bad" : "app-docscard-good"),
    stat(
      `due in ${dueSoonDays}d`,
      dueSoon.length,
      dueSoon.length > 0 ? "app-docscard-warn" : "app-docscard-good"
    )
  );
  body.appendChild(statRow);

  // R5 task rows (taskRows.ts — the register's Document-tasks anatomy):
  // pill · name-over-meta · chevron, the whole row opens the overlay
  // with the details pane up, where Mark reviewed lives
  const openRow = (d: Due) => {
    void driveIdFor(scope.site, d.row.listId).then((driveId) =>
      openDocViewer({
        site: scope.site,
        row: d.row,
        driveId,
        libraryName: d.lib.config.title || d.lib.name,
        askToWork: false,
        detailsOpen: true,
      })
    );
  };
  const ROWS_SHOWN = 8;
  const renderGroup = (title: string, list: Due[], pill: () => HTMLElement, room: number) => {
    if (list.length === 0) return 0;
    body.appendChild(taskGroupHeader(title, list.length));
    const shown = list.slice(0, Math.max(0, room));
    for (const d of shown) {
      body.appendChild(
        taskRowEl({
          pill: pill(),
          name: d.row.name,
          meta: d.owner !== "" ? `${d.owner} · Due ${d.label}` : `Due ${d.label}`,
          onOpen: () => openRow(d),
        })
      );
    }
    return shown.length;
  };
  const used = renderGroup("Review overdue", overdue, () => tonePill("⚑ Overdue", "red"), ROWS_SHOWN);
  renderGroup("Review due soon", dueSoon, () => tonePill("● Due soon", "amber"), ROWS_SHOWN - used);
  const hidden = overdue.length + dueSoon.length - Math.min(overdue.length + dueSoon.length, ROWS_SHOWN);
  if (hidden > 0) {
    body.appendChild(
      el("div", "app-field-hint", `${hidden} more in the register's Document tasks.`)
    );
  }
  if (capped) {
    body.appendChild(el("div", "app-field-hint", `First ${CAP} findings per library counted.`));
  }
  if (overdue.length === 0 && dueSoon.length === 0) {
    body.appendChild(el("div", "app-field-hint", "Nothing due — reviews are up to date."));
  }
  // B4: overdue names carry the pill's red as a dot
  return [
    { text: `${overdue.length} overdue`, strong: true },
    { text: `${dueSoon.length} due in ${dueSoonDays} days`, strong: true },
    ...overdue.slice(0, 5).map((o) => ({ text: o.row.name, dot: "#c43d3d" })),
  ];
}
