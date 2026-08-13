// The reverse links index (relationships L2, 2026-08-13 — the hybrid
// answer to Ben's 100k question): who names THIS document?
//
// Two roads, one shape:
//  - UNDER the cap: one lean sweep per session (the links column and
//    the document-id column only) builds a uid → declarers map. At
//    register scale (hundreds to a few thousand) this costs less than
//    the count sweep the screen already runs.
//  - OVER the cap the sweep ABANDONS — never half-answers — and the
//    per-document road is SEARCH at overlay-open time: one query per
//    open scales to any corpus, with the crawl lag stated on screen.
//    Each hit's links column is then read in full (search hits carry
//    no item id, so itemDetails resolves by uniqueId) to recover the
//    declared rel.
//
// The index only sees the libraries this app exposes — the same
// boundary the health scan lives with.

import { DocLibrary } from "./docsStore";
import { DocLink, DocLinkRel, parseDocLinks } from "./model";
import { buildRenderViewXml } from "./rows";
import { itemDetails, renderListPage, searchPage } from "./data";

/** One document naming the asked-about one, with the rel IT declared. */
export interface InboundLink {
  fromUid: string;
  fromName: string;
  fromDocId: string;
  fromListId: string;
  site: string;
  /** The rel as declared ON THE FAR DOCUMENT ("B is my parent"). */
  rel: DocLinkRel;
}

/** Past this many scanned documents the sweep abandons and the search
 *  road takes over — a 100k register must not be paged through for a
 *  side pane. */
const INDEX_CAP = 2000;

interface IndexState {
  map: Map<string, InboundLink[]>;
  complete: boolean;
}

let state: Promise<IndexState> | null = null;
let stateKey = "";

/** Links changed (an Edit properties save) — the next ask re-sweeps. */
export function invalidateLinksIndex(): void {
  state = null;
}

async function build(
  site: string,
  libraries: DocLibrary[],
  linksInternal: string,
  docIdInternal: string
): Promise<IndexState> {
  const map = new Map<string, InboundLink[]>();
  let scanned = 0;
  for (const lib of libraries) {
    const viewXml = buildRenderViewXml({
      fields: [linksInternal, ...(docIdInternal !== "" ? [docIdInternal] : [])],
      rowLimit: 200,
    });
    let next = "";
    for (;;) {
      const page = await renderListPage(site, lib.listId, viewXml, next);
      if (page.error !== "") break; // a refused library indexes nothing
      for (const row of page.rows) {
        scanned++;
        if (scanned > INDEX_CAP) return { map, complete: false };
        // a feed-clipped JSON parses to null → misses, never lies
        const links = parseDocLinks(row.values[linksInternal] ?? "") ?? [];
        for (const l of links) {
          const key = l.uid.toLowerCase();
          const list = map.get(key) ?? [];
          list.push({
            fromUid: row.uniqueId,
            fromName: row.name,
            fromDocId: docIdInternal !== "" ? (row.values[docIdInternal] ?? "") : "",
            fromListId: row.listId,
            site: (lib.siteUrl ?? "") !== "" ? lib.siteUrl : site,
            rel: l.rel,
          });
          map.set(key, list);
        }
      }
      next = page.next;
      if (next === "") break;
    }
  }
  return { map, complete: true };
}

/**
 * The documents naming `uid`, by whichever road the corpus size
 * allows. `road` says which answered; "search" answers can lag the
 * crawl and the pane should say so.
 */
export async function inboundFor(
  site: string,
  libraries: DocLibrary[],
  linksInternal: string,
  docIdInternal: string,
  uid: string
): Promise<{ entries: InboundLink[]; road: "index" | "search" }> {
  const key = `${site}|${linksInternal}|${libraries.map((l) => l.listId).join(",")}`;
  if (state === null || stateKey !== key) {
    stateKey = key;
    state = build(site, libraries, linksInternal, docIdInternal);
    state.catch(() => (state = null)); // a failed sweep must not stick
  }
  const idx = await state;
  if (idx.complete) {
    return { entries: idx.map.get(uid.toLowerCase()) ?? [], road: "index" };
  }

  // ---- the search road ---------------------------------------------------
  const hits = await searchPage(site, uid, {
    listIds: libraries.map((l) => l.listId),
    rowLimit: 25,
  });
  const entries: InboundLink[] = [];
  for (const hit of hits.rows) {
    if (hit.uniqueId.toLowerCase() === uid.toLowerCase()) continue;
    const full = await itemDetails(site, hit);
    if (full.error !== "") continue;
    const links = parseDocLinks(full.values[linksInternal] ?? "") ?? [];
    for (const l of links) {
      if (l.uid.toLowerCase() !== uid.toLowerCase()) continue;
      entries.push({
        fromUid: hit.uniqueId,
        fromName: hit.name,
        fromDocId: docIdInternal !== "" ? (full.values[docIdInternal] ?? "") : "",
        fromListId: hit.listId,
        site,
        rel: l.rel,
      });
    }
  }
  return { entries, road: "search" };
}

/** How an inbound declaration reads on THIS document's pane: the far
 *  document declaring "parent" makes it OUR child, and vice versa. */
export const INVERSE_REL: Record<DocLinkRel, DocLinkRel> = {
  parent: "child",
  peer: "peer",
  child: "parent",
  regulatorCopy: "regulatorCopyOf",
  regulatorCopyOf: "regulatorCopy",
};

/** An inbound entry reshaped as a DocLink for the open road. */
export function inboundAsLink(e: InboundLink): DocLink {
  return {
    uid: e.fromUid,
    rel: INVERSE_REL[e.rel],
    site: e.site,
    listId: e.fromListId,
    name: e.fromName,
    docId: e.fromDocId,
  };
}
