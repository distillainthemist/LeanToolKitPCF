// Standard Documents — transport for the read experience (plan Phase 2).
// Thin: every function is spRequest + a pure parser from rows.ts, so the
// logic stays tested and this file stays boring.

import { spRequest } from "./sp";
import {
  BrowseOpts,
  DocRow,
  ItemsPage,
  PresignedUrls,
  SearchOpts,
  SearchPage,
  buildBrowseUri,
  buildSearchBody,
  parseItemsPage,
  parseRenderPage,
  presignedFromItem,
  rowsFromSearch,
} from "./rows";

const VERBOSE = {
  "Content-Type": "application/json;odata=verbose",
  Accept: "application/json;odata=verbose",
};

/**
 * listId → drive id, cached for the session (a library's drive id never
 * changes). Every PDF URL needs it: addressing an item through the
 * site's default drive answers `itemNotFound` for any library that is
 * not the default one — which is every purpose-made document library.
 *
 * Returns "" when it cannot be resolved; callers fall back to the
 * site-scoped viewer rather than showing an error.
 */
const drives = new Map<string, Promise<string>>();

export function driveIdFor(site: string, listId: string): Promise<string> {
  const key = `${site}|${listId.toLowerCase()}`;
  let hit = drives.get(key);
  if (hit === undefined) {
    hit = spRequest(site, "GET", `_api/v2.0/sites/root/lists/${listId}/drive`).then((r) => {
      const id = (r.data as { id?: unknown } | null)?.id;
      return r.ok && typeof id === "string" ? id : "";
    });
    // a failed lookup must not stick as the cached answer
    hit.catch(() => drives.delete(key));
    drives.set(key, hit);
  }
  return hit;
}

/** A library's total item count (session-cached) — the up-front "N
 *  documents" total for plain browsing. -1 = unavailable, caller skips
 *  the total rather than guessing. Includes items in folders, so it is
 *  an honest LIBRARY total, not a strict row count. */
const itemCounts = new Map<string, Promise<number>>();

export function listItemCount(site: string, listId: string): Promise<number> {
  const key = `${site}|${listId.toLowerCase()}`;
  let hit = itemCounts.get(key);
  if (hit === undefined) {
    hit = spRequest(site, "GET", `_api/web/lists(guid'${listId}')?$select=ItemCount`).then(
      (r) => {
        const n = (r.data as { ItemCount?: unknown } | null)?.ItemCount;
        return r.ok && typeof n === "number" ? n : -1;
      }
    );
    hit.catch(() => itemCounts.delete(key));
    itemCounts.set(key, hit);
  }
  return hit;
}

/** First (or next: pass the previous page's `next`) browse page. */
export async function browsePage(
  site: string,
  listId: string,
  next = "",
  opts: BrowseOpts = {}
): Promise<ItemsPage & { error: string }> {
  const uri = next === "" ? buildBrowseUri(listId, 50, opts) : next;
  const r = await spRequest(site, "GET", uri);
  if (!r.ok) return { rows: [], next: "", error: r.status };
  return { ...parseItemsPage(r.data, site, listId), error: "" };
}

/** One RenderListDataAsStream page — the register's browse feed (Vault,
 *  2026-08-02): display-ready values for every field type, CAML-driven
 *  server-side search/filter/sort. `next` is the response's opaque
 *  NextHref query string, appended to the endpoint on the next call. */
export async function renderListPage(
  site: string,
  listId: string,
  viewXml: string,
  next = ""
): Promise<import("./rows").RenderPage & { error: string }> {
  const r = await spRequest(
    site,
    "POST",
    `_api/web/lists(guid'${listId}')/RenderListDataAsStream${next}`,
    {
      headers: {
        "Content-Type": "application/json;odata=nometadata",
        Accept: "application/json;odata=nometadata",
      },
      body: JSON.stringify({
        parameters: { RenderOptions: 2, ViewXml: viewXml, DatesInUtc: true },
      }),
    }
  );
  if (!r.ok) return { rows: [], next: "", error: r.status };
  return { ...parseRenderPage(r.data, listId), error: "" };
}

/** One search page (permission-trimmed, bounded to the given libraries).
 *  No libraries in scope means no corpus — answering with the whole
 *  tenant index would be worse than answering with nothing. */
export async function searchPage(
  site: string,
  text: string,
  opts: SearchOpts
): Promise<SearchPage & { error: string }> {
  if (opts.listIds.filter((id) => id.trim() !== "").length === 0) {
    return { rows: [], total: 0, error: "" };
  }
  const r = await spRequest(site, "POST", "_api/search/postquery", {
    headers: VERBOSE,
    body: buildSearchBody(text, opts),
  });
  if (!r.ok) return { rows: [], total: 0, error: r.status };
  return { ...rowsFromSearch(r.data), error: "" };
}

/** Cookie-free preview URLs for one item (see PresignedUrls in rows.ts
 *  for why the frame cannot use the cookie-authenticated URLs). One
 *  round trip: the item with its thumbnails expanded. */
export async function presignedUrls(
  site: string,
  driveId: string,
  row: DocRow
): Promise<PresignedUrls & { error: string }> {
  if (driveId === "")
    return { downloadUrl: "", thumbUrl: "", tileThumbUrl: "", error: "drive unknown" };
  const r = await spRequest(
    site,
    "GET",
    `_api/v2.0/drives/${driveId}/items/${row.uniqueId}?expand=thumbnails`
  );
  if (!r.ok) return { downloadUrl: "", thumbUrl: "", tileThumbUrl: "", error: r.status };
  return { ...presignedFromItem(r.data), error: "" };
}

/**
 * Tile thumbnails (Ben, 2026-08-02: real page-one images in the tiles
 * view) — the presigned page-one URL, which the tile paints in a frame
 * rather than an <img>; see docsTiles for why the player leaves that the
 * only door open.
 *
 * Two costs are managed here rather than in the view: it is one request
 * per document, so results are cached for the session (a tile that
 * scrolls back into view never asks again), and at most four are in
 * flight at once, so a page of tiles cannot starve the register's own
 * paging of connector capacity. "" means no thumbnail — the caller keeps
 * its file-type placeholder rather than showing a broken image.
 */
const tileThumbs = new Map<string, Promise<string>>();
const THUMB_PARALLEL = 4;
let thumbsInFlight = 0;
const thumbQueue: (() => void)[] = [];

function takeThumbSlot(): Promise<void> {
  if (thumbsInFlight < THUMB_PARALLEL) {
    thumbsInFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    thumbQueue.push(() => {
      thumbsInFlight++;
      resolve();
    });
  });
}

function releaseThumbSlot(): void {
  thumbsInFlight--;
  thumbQueue.shift()?.();
}

/** Consecutive empty answers before the register stops asking: a host
 *  that refuses one thumbnail refuses them all, and a page of tiles must
 *  not spend fifty round trips proving it. Reset by any success. */
const THUMB_GIVE_UP = 3;
let thumbMisses = 0;

export function tileThumbFor(site: string, row: DocRow): Promise<string> {
  if (thumbMisses >= THUMB_GIVE_UP) return Promise.resolve("");
  const key = `${site}|${row.uniqueId}`;
  let hit = tileThumbs.get(key);
  if (hit === undefined) {
    hit = (async () => {
      await takeThumbSlot();
      try {
        const url = await presignedThumb(site, row);
        if (url === "") thumbMisses++;
        else thumbMisses = 0;
        return url;
      } finally {
        releaseThumbSlot();
      }
    })();
    hit.catch(() => tileThumbs.delete(key));
    tileThumbs.set(key, hit);
  }
  return hit;
}

/**
 * A page-one rendering at a CHOSEN size — the drive API's custom
 * `c{w}x{h}` thumbnail (probed 2026-08-02: `large` caps at 800px, while
 * c1600x1600 comes back at 1600). The overlay asks for twice the size it
 * will display at, because a framed image renders at its natural size
 * with no shrink-to-fit: two device pixels per CSS pixel is what makes
 * the preview sharp. "" when the document has no rendering.
 */
export async function pagePreviewUrl(
  site: string,
  driveId: string,
  row: DocRow,
  width: number,
  height: number
): Promise<string> {
  if (driveId === "") return "";
  const box = `c${Math.round(width)}x${Math.round(height)}`;
  const r = await spRequest(
    site,
    "GET",
    `_api/v2.0/drives/${driveId}/items/${row.uniqueId}/thumbnails/0/${box}`
  );
  const u = (r.data as { url?: unknown } | null)?.url;
  return r.ok && typeof u === "string" ? u : "";
}

/** One document's presigned page-one image URL ("" when it has none).
 *  The TILE size: a frame shows an image at its natural size (no
 *  shrink-to-fit inside a frame), so the full-size rendering would fill
 *  a tile with two lines of text. */
async function presignedThumb(site: string, row: DocRow): Promise<string> {
  const driveId = await driveIdFor(site, row.listId);
  if (driveId === "") return "";
  const p = await presignedUrls(site, driveId, row);
  return p.tileThumbUrl;
}

/** Full text projection of one document's fields (properties pane) —
 *  by unique id, so search rows (no list item id) work too. Returns the
 *  values plus the item id for the versions call. */
export async function itemDetails(
  site: string,
  row: DocRow
): Promise<{ id: number; values: Record<string, string>; error: string }> {
  const r = await spRequest(
    site,
    "GET",
    `_api/web/GetFileById('${row.uniqueId}')/ListItemAllFields?$expand=FieldValuesAsText&$select=Id,FieldValuesAsText`
  );
  if (!r.ok) return { id: 0, values: {}, error: r.status };
  const o = (r.data ?? {}) as Record<string, unknown>;
  const fv =
    o.FieldValuesAsText && typeof o.FieldValuesAsText === "object"
      ? (o.FieldValuesAsText as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(fv)) {
    if (typeof v === "string" && !k.startsWith("odata")) values[k] = v;
  }
  return { id: typeof o.Id === "number" ? o.Id : 0, values, error: "" };
}

export interface DocVersion {
  label: string;
  when: string;
  comment: string;
  current: boolean;
}

/** SharePoint version history for one item (newest first). */
export async function itemVersions(
  site: string,
  listId: string,
  itemId: number
): Promise<{ versions: DocVersion[]; error: string }> {
  const r = await spRequest(
    site,
    "GET",
    `_api/web/lists(guid'${listId}')/items(${itemId})/versions` +
      `?$select=VersionLabel,Created,CheckInComment,IsCurrentVersion&$top=25`
  );
  if (!r.ok) return { versions: [], error: r.status };
  const rows = Array.isArray((r.data as { value?: unknown[] })?.value)
    ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
    : [];
  return {
    versions: rows.map((v) => ({
      label: typeof v.VersionLabel === "string" ? v.VersionLabel : "",
      when: typeof v.Created === "string" ? v.Created : "",
      comment: typeof v.CheckInComment === "string" ? v.CheckInComment : "",
      current: v.IsCurrentVersion === true,
    })),
    error: "",
  };
}
