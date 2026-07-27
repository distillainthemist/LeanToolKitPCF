// Standard Documents — transport for the read experience (plan Phase 2).
// Thin: every function is spRequest + a pure parser from rows.ts, so the
// logic stays tested and this file stays boring.

import { spRequest } from "./sp";
import {
  DocRow,
  ItemsPage,
  SearchOpts,
  SearchPage,
  buildBrowseUri,
  buildSearchBody,
  parseItemsPage,
  rowsFromSearch,
} from "./rows";

const VERBOSE = {
  "Content-Type": "application/json;odata=verbose",
  Accept: "application/json;odata=verbose",
};

/** First (or next: pass the previous page's `next`) browse page. */
export async function browsePage(
  site: string,
  listId: string,
  next = ""
): Promise<ItemsPage & { error: string }> {
  const uri = next === "" ? buildBrowseUri(listId) : next;
  const r = await spRequest(site, "GET", uri);
  if (!r.ok) return { rows: [], next: "", error: r.status };
  return { ...parseItemsPage(r.data, site, listId), error: "" };
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
