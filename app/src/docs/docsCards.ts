// Standard Documents — the board cards (plan Phase 3): "Standard
// documents" (the area's controlled documents, live) and "Document
// health" (overdue / due-soon reviews, derived at read time — never
// stored, per the repo's own rule: stored "overdue" goes stale).
//
// Card contract (the resolved Phase 2 design): the grid paints the
// stored tile SVG before this module even loads (cardRegistry reaches
// it by DYNAMIC import only — the gate enforces that); the live fetch
// happens after paint with jitter, so a wall of boards opening at shift
// start cannot synchronise into a 429 storm. Cards hold no document of
// their own — the tile snapshot is the only thing they emit.

import type { CardMount } from "../cardRegistry";
import { el, clear } from "../../../shared/ui/dom";
import { renderTitleBar, parsePrompts } from "../../../shared/ui/chrome";
import { applyThemeVars } from "../../../shared/tokens";
import { docsConfig, DocLibrary } from "./docsStore";
import { searchPage, browsePage } from "./data";
import { fetchTermPaths } from "./sp";
import {
  DocRow,
  extGlyph,
  formatWhen,
  taxonomySearchProperty,
} from "./rows";
import { openDocViewer } from "./viewer";
import { driveIdFor } from "./data";

type Kind = "docs" | "health";

const cfg = (opts: CardMount, key: string): string => {
  const c = (opts.settings.config ?? {}) as Record<string, unknown>;
  const v = c[key];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tile snapshot: a simple readable SVG of what the card shows. */
function snapshotSvg(title: string, lines: { text: string; strong?: boolean }[]): string {
  const rows = lines
    .slice(0, 8)
    .map(
      (l, i) =>
        `<text x="16" y="${64 + i * 30}" font-size="${l.strong ? 20 : 16}" ` +
        `font-weight="${l.strong ? 700 : 400}" fill="#333" ` +
        `font-family="system-ui, sans-serif">${esc(l.text.slice(0, 60))}</text>`
    )
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

/** Resolve the configured scope against the docs configuration. */
async function resolveScope(opts: CardMount): Promise<{
  site: string;
  libs: DocLibrary[];
  orgIds: string[];
  orgProps: string[];
  note: string;
}> {
  const { app, libraries } = await docsConfig();
  if (app.siteUrl === "" || libraries.length === 0) {
    return { site: "", libs: [], orgIds: [], orgProps: [], note: "Set up Settings → Documents first." };
  }
  const wantLib = cfg(opts, "docsLibrary").toLowerCase();
  const libs =
    wantLib === ""
      ? libraries
      : libraries.filter(
          (l) => (l.config.title || l.name).toLowerCase() === wantLib
        );
  if (libs.length === 0) {
    return { site: app.siteUrl, libs: [], orgIds: [], orgProps: [], note: `No exposed library called “${cfg(opts, "docsLibrary")}”.` };
  }
  let orgIds: string[] = [];
  const orgProps = [
    ...new Set(
      libs.flatMap((l) =>
        l.config.columns.filter((c) => c.role === "orgUnit").map((c) => c.internal)
      )
    ),
  ].map(taxonomySearchProperty);
  const wantOrg = cfg(opts, "docsOrg").toLowerCase();
  if (wantOrg !== "" && app.orgSetId !== "") {
    const { nodes } = await fetchTermPaths(app.siteUrl, app.orgSetId);
    // deepest node whose leaf label matches; the filter is the subtree
    const target = nodes
      .filter((n) => n.labels[n.labels.length - 1].toLowerCase() === wantOrg)
      .sort((a, b) => b.labels.length - a.labels.length)[0];
    if (target) {
      orgIds = nodes
        .filter(
          (n) =>
            n.id === target.id ||
            (n.labels.length > target.labels.length &&
              target.labels.every((l, i) => n.labels[i] === l))
        )
        .map((n) => n.id);
    }
  }
  return { site: app.siteUrl, libs, orgIds, orgProps, note: "" };
}

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

async function paintDocs(
  opts: CardMount,
  body: HTMLElement
): Promise<{ text: string; strong?: boolean }[] | null> {
  const scope = await resolveScope(opts);
  if (scope.note !== "") return note(body, scope.note);
  const n = Math.max(1, Math.min(20, Number(cfg(opts, "docsCount")) || 8));
  const page = await searchPage(scope.site, cfg(opts, "docsMatch"), {
    listIds: scope.libs.map((l) => l.listId),
    rowLimit: n,
    byModified: true,
    termFilters:
      scope.orgIds.length > 0 && scope.orgProps.length > 0
        ? [{ properties: scope.orgProps, termIds: scope.orgIds }]
        : undefined,
  });
  if (page.error !== "") return note(body, `Documents refused: ${page.error}`);
  clear(body);
  if (page.rows.length === 0) {
    body.appendChild(el("div", "app-field-hint", "No documents in this scope yet."));
    return [{ text: "No documents in scope" }];
  }
  const byListId = new Map(scope.libs.map((l) => [l.listId.toLowerCase(), l]));
  for (const row of page.rows) {
    const line = el("button", "app-docscard-row") as HTMLButtonElement;
    line.append(
      el("span", "app-docs-glyph", extGlyph(row.ext)),
      el("span", "app-docscard-name", row.name),
      el("span", "app-field-hint", formatWhen(row.modified))
    );
    line.addEventListener("click", () => {
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
    });
    body.appendChild(line);
  }
  return page.rows.map((r) => ({ text: r.name }));
}

async function paintHealth(
  opts: CardMount,
  body: HTMLElement
): Promise<{ text: string; strong?: boolean }[] | null> {
  const scope = await resolveScope(opts);
  if (scope.note !== "") return note(body, scope.note);
  const dueSoonDays = Math.max(1, Number(cfg(opts, "dueSoonDays")) || 30);
  const CAP = 200; // per library — derive-at-read on pilot-scale libraries
  const now = Date.now();
  const soon = now + dueSoonDays * 86400000;
  let overdue: { row: DocRow; when: number }[] = [];
  let dueSoon = 0;
  let scanned = 0;
  let capped = false;
  let reviewColSeen = false;
  for (const lib of scope.libs) {
    const reviewCol = lib.config.columns.find((c) => c.role === "nextReviewDate");
    if (!reviewCol) continue;
    reviewColSeen = true;
    let next = "";
    let taken = 0;
    for (;;) {
      const page = await browsePage(scope.site, lib.listId, next);
      if (page.error !== "") return note(body, `Documents refused: ${page.error}`);
      for (const row of page.rows) {
        scanned++;
        const when = Date.parse(row.values[reviewCol.internal] ?? "");
        if (Number.isNaN(when)) continue;
        if (when < now) overdue.push({ row, when });
        else if (when < soon) dueSoon++;
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
  overdue = overdue.sort((a, b) => a.when - b.when);
  clear(body);
  const stat = (label: string, count: number, cls: string) => {
    const box = el("div", `app-docscard-stat ${cls}`);
    box.append(el("span", "app-docscard-statn", String(count)), el("span", "", label));
    return box;
  };
  const statRow = el("div", "app-docscard-stats");
  statRow.append(
    stat("overdue", overdue.length, overdue.length > 0 ? "app-docscard-bad" : "app-docscard-good"),
    stat(`due in ${dueSoonDays}d`, dueSoon, dueSoon > 0 ? "app-docscard-warn" : "app-docscard-good")
  );
  body.appendChild(statRow);
  for (const o of overdue.slice(0, 5)) {
    const line = el("div", "app-docscard-row");
    line.append(
      el("span", "app-docscard-name", o.row.name),
      el("span", "app-field-hint", formatWhen(new Date(o.when).toISOString()))
    );
    body.appendChild(line);
  }
  if (capped) {
    body.appendChild(
      el("div", "app-field-hint", `First ${CAP} documents per library scanned.`)
    );
  }
  return [
    { text: `${overdue.length} overdue`, strong: true },
    { text: `${dueSoon} due in ${dueSoonDays} days`, strong: true },
    ...overdue.slice(0, 5).map((o) => ({ text: o.row.name })),
  ];
}
