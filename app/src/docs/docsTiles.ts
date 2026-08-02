// Standard Documents — the register's tiles view (Vault V3). Card
// anatomy per the Vault prototype (thumbnail area, chip row, name,
// owner/modified) in the app's card styling, satisfying the same
// DocList contract as listView so the screen can swap views freely.
//
// The thumbnail area paints the file-type placeholder first and swaps in
// the real page-one image when one arrives (Ben, 2026-08-02). It cannot
// use SharePoint's cookie-authenticated thumbnail URLs — the player
// iframe carries no SharePoint cookies (the v0.23 lesson), which is what
// made a wall of tiles a wall of broken images — so it asks the caller
// for the same PRESIGNED url the document overlay uses. Requests are
// lazy (a tile asks only once it nears the viewport) and the placeholder
// stays put for anything SharePoint cannot render.

import { el, clear } from "../../../shared/ui/dom";
import { fileTypeChip } from "../../../shared/ui/format";
import { FILE_TYPE_HUES, fileTypeFamily, readableShade, tint } from "../../../shared/tokens";
import { DocRow, formatWhen, splitNameForEllipsis } from "./rows";
import type { DocList } from "./listView";

export interface DocTilesOptions {
  onRow: (row: DocRow) => void;
  onNearEnd: () => void;
  emptyText: string;
  emptyExtra?: () => HTMLElement | null;
  /** Status pill for a value (the screen's palette-aware chip), or null
   *  when no status column is configured. */
  statusChip?: ((value: string) => HTMLElement) | null;
  /** Configured internal names ("" = not configured). */
  statusColumn?: string;
  ownerColumn?: string;
  /** Presigned page-one image for a row, "" when there is none. Called
   *  at most once per tile, as the tile nears the viewport. */
  thumbUrlFor?: (row: DocRow) => Promise<string>;
}

export function mountDocTiles(host: HTMLElement, opts: DocTilesOptions): DocList<DocRow> {
  const wrap = el("div", "app-doctiles-wrap");
  const grid = el("div", "app-doctiles");
  const tail = el("div", "app-doclist-tail");
  const sentinel = el("div", "app-doclist-sentinel");
  wrap.append(grid, tail, sentinel);
  host.appendChild(wrap);

  let held: DocRow[] = [];

  // Lazy thumbnails: the band asks for its image only once it is within
  // a screen of the viewport, so scrolling past a hundred tiles costs
  // nothing for the ones never seen.
  const bandRows = new WeakMap<Element, DocRow>();
  const paintThumb = (band: HTMLElement, row: DocRow) => {
    void opts.thumbUrlFor?.(row).then((url) => {
      if (url === "" || !band.isConnected) return;
      // A FRAME, not an <img>: measured in the hosted player 2026-08-02 —
      // the page's policy refuses SharePoint's media host to img-src and
      // fetch alike, but allows it to frame-src (which is what makes the
      // document overlay's preview work). Same picture, the one door the
      // player leaves open. Inert: no pointer events, no tab stop, so the
      // tile underneath stays a plain button.
      const frame = el("iframe", "app-doctile-thumb") as HTMLIFrameElement;
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute("scrolling", "no");
      frame.loading = "lazy";
      frame.addEventListener("load", () => {
        band.classList.add("app-doctile-band-shown");
        // the band only grows to page proportions once a page actually
        // paints — a host that refuses thumbnails keeps compact tiles
        grid.classList.add("app-doctiles-thumbs");
      });
      frame.src = url;
      band.appendChild(frame);
    });
  };
  const thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        thumbObserver.unobserve(e.target);
        const row = bandRows.get(e.target);
        if (row) paintThumb(e.target as HTMLElement, row);
      }
    },
    { root: wrap, rootMargin: "400px" }
  );

  const tile = (row: DocRow): HTMLElement => {
    const card = el("button", "app-doctile") as HTMLButtonElement;
    const base = FILE_TYPE_HUES[fileTypeFamily(row.ext)];
    const band = el("div", "app-doctile-band");
    band.style.background = tint(base, 0.92);
    const bandExt = el("span", "app-doctile-bandext", row.ext === "" ? "FILE" : row.ext.toUpperCase());
    bandExt.style.color = readableShade(base, 0.15);
    band.appendChild(bandExt);
    card.appendChild(band);
    if (opts.thumbUrlFor) {
      bandRows.set(band, row);
      thumbObserver.observe(band);
    }

    const body = el("div", "app-doctile-body");
    const chips = el("div", "app-doctile-chips");
    chips.appendChild(fileTypeChip(row.ext));
    const statusVal = opts.statusColumn ? (row.values[opts.statusColumn] ?? "") : "";
    if (statusVal !== "" && opts.statusChip) chips.appendChild(opts.statusChip(statusVal));
    body.appendChild(chips);

    const { stem } = splitNameForEllipsis(row.name);
    const name = el("div", "app-doctile-name");
    name.title = row.name;
    name.append(el("span", "app-doctile-stem", stem));
    body.appendChild(name);

    const metaBits: string[] = [];
    const owner = opts.ownerColumn ? (row.values[opts.ownerColumn] ?? "") : "";
    if (owner !== "") metaBits.push(owner.split(";")[0].trim());
    if (row.modified !== "") metaBits.push(formatWhen(row.modified));
    body.appendChild(el("div", "app-doctile-meta", metaBits.join(" · ")));
    card.appendChild(body);
    card.addEventListener("click", () => opts.onRow(row));
    return card;
  };

  const empty = () => {
    const existing = grid.querySelector(".app-doclist-empty");
    if (held.length === 0 && !existing) {
      const box = el("div", "app-doclist-empty", opts.emptyText);
      const extra = opts.emptyExtra?.();
      if (extra) box.appendChild(extra);
      grid.appendChild(box);
    } else if (held.length > 0 && existing) {
      existing.remove();
    }
  };

  const appendRows = (rows: DocRow[]) => {
    held = held.concat(rows);
    const frag = document.createDocumentFragment();
    for (const row of rows) frag.appendChild(tile(row));
    grid.appendChild(frag);
    empty();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) opts.onNearEnd();
    },
    { root: wrap, rootMargin: "300px" }
  );
  observer.observe(sentinel);

  empty();
  return {
    setRows: (rows) => {
      // the outgoing tiles are about to leave the DOM — stop watching
      // them before they do (appendRows re-observes the new ones)
      thumbObserver.disconnect();
      clear(grid);
      held = [];
      appendRows(rows);
      wrap.scrollTop = 0;
    },
    append: appendRows,
    setLoading: (on) => {
      tail.textContent = on ? "Loading…" : "";
    },
    count: () => held.length,
    rows: () => held,
    destroy: () => {
      observer.disconnect();
      thumbObserver.disconnect();
      wrap.remove();
    },
  };
}
