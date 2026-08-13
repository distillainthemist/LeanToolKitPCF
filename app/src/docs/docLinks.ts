// Document linking (relationships plan L1, revised 2026-08-13) — the
// ANCHOR RESOLVERS. Writes moved into the Edit properties form (the
// links editor): linking IS a properties edit, by Ben's call. What
// stays here is turning a stored link into something the screen can
// open — the same-site register target, or the file's own web URL.

import { DocLink } from "./model";
import { spRequest } from "./sp";

/** Resolve a SAME-SITE anchor to its register coordinates (null =
 *  gone) — the overlay switches to the target instead of leaving the
 *  app. */
export async function resolveLinkTarget(
  site: string,
  uid: string
): Promise<{ listId: string; itemId: number } | null> {
  const r = await spRequest(
    site,
    "GET",
    `_api/web/GetFileById('${uid}')/ListItemAllFields?$select=Id&$expand=ParentList($select=Id)`
  );
  const d = (r.data ?? {}) as { Id?: unknown; ParentList?: { Id?: unknown } };
  const itemId = Number(d.Id ?? 0);
  const listId = String(d.ParentList?.Id ?? "");
  return r.ok && itemId > 0 && listId !== "" ? { listId, itemId } : null;
}

/** Resolve a link's anchor to the document's web URL on ITS OWN site
 *  ("" = the anchor no longer resolves — the dangling case). */
export async function resolveLinkUrl(l: DocLink): Promise<string> {
  if (l.site === "" || l.uid === "") return "";
  const r = await spRequest(
    l.site,
    "GET",
    `_api/web/GetFileById('${l.uid}')?$select=ServerRelativeUrl`
  );
  const rel = String(((r.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? "");
  if (!r.ok || rel === "") return "";
  try {
    return `${new URL(l.site).origin}${rel}`;
  } catch {
    return "";
  }
}
