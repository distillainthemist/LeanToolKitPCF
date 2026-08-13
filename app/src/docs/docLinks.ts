// Document linking (relationships plan L1, 2026-08-13) — the WRITE
// road and the anchor resolver. Links ride the declaring document's
// own DMSLinkedDocuments column via the bracket every property edit
// rides: check-out → VULI → minor check-in → moderation publish on
// reader-facing stages. A document someone else holds is refused
// honestly; one the ACTING USER holds is written without a check-in
// (the change publishes with their next check-in, like any edit).
//
// Mutations NEVER start from a feed value: RLDAS clips multiline
// columns, and mutating a clipped list would silently drop links. The
// full value is re-read over REST first (readFullLinks).

import {
  DocLink,
  parseDocLinks,
  serializeDocLinks,
  spErrorText,
  validateItemErrors,
} from "./model";
import { DocRow } from "./rows";
import {
  checkInFile,
  checkOutFile,
  fetchListItem,
  fetchListModeration,
  spRequest,
  validateUpdateListItem,
} from "./sp";

export interface WriteLinksOpts {
  site: string;
  listId: string;
  row: DocRow;
  /** The linked-documents column's internal name. */
  internal: string;
  links: DocLink[];
  /** approved/superseded/obsolete — the bracket publishes after check-in. */
  readerFacing: boolean;
  /** Checked out to the acting user — ride it, no bracket. */
  heldByMe: boolean;
}

/** The FULL current links list over REST (null = the column holds
 *  legacy text or nothing parseable — the caller must not overwrite
 *  it blindly). */
export async function readFullLinks(
  site: string,
  listId: string,
  itemId: number,
  internal: string
): Promise<{ links: DocLink[] | null; raw: string; error: string }> {
  const r = await fetchListItem(site, listId, itemId);
  if (!r.ok) return { links: null, raw: "", error: spErrorText(r.status).slice(0, 200) };
  const raw = String(((r.data ?? {}) as Record<string, unknown>)[internal] ?? "");
  return { links: parseDocLinks(raw) ?? (raw.trim() === "" ? [] : null), raw, error: "" };
}

/** error "" = written; warn carries a non-fatal aftermath (publish
 *  refused — the write LANDED, readers wait on approval). */
export async function writeDocLinks(o: WriteLinksOpts): Promise<{ error: string; warn: string }> {
  const held = (o.row.checkoutName ?? "") !== "";
  if (held && !o.heldByMe) {
    return { error: `checked out by ${o.row.checkoutName}`, warn: "" };
  }
  if (!o.heldByMe) {
    const out = await checkOutFile(o.site, o.row.serverUrl);
    if (!out.ok && !/checked out/i.test(spErrorText(out.status))) {
      return { error: spErrorText(out.status).slice(0, 200), warn: "" };
    }
  }
  const res = await validateUpdateListItem(
    o.site,
    o.listId,
    o.row.id,
    [{ FieldName: o.internal, FieldValue: serializeDocLinks(o.links) }],
    false
  );
  const errs = validateItemErrors(res.data);
  if (!res.ok || errs.length > 0) {
    return {
      error:
        (errs.map((e) => e.message).join("; ") || spErrorText(res.status)).slice(0, 200) +
        (o.heldByMe ? "" : " — the document stays checked out"),
      warn: "",
    };
  }
  if (o.heldByMe) return { error: "", warn: "" };
  const cin = await checkInFile(o.site, o.row.serverUrl, "Links updated", false);
  if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) {
    return { error: `check-in refused: ${spErrorText(cin.status).slice(0, 160)}`, warn: "" };
  }
  // CA1: a links change on a reader-facing document publishes with the
  // save — the same rule as every quick property edit
  if (o.readerFacing) {
    const mod = await fetchListModeration(o.site, o.listId);
    const moderated =
      mod.ok && ((mod.data ?? {}) as { EnableModeration?: unknown }).EnableModeration === true;
    if (moderated) {
      const pub = await validateUpdateListItem(
        o.site,
        o.listId,
        o.row.id,
        [{ FieldName: "_ModerationStatus", FieldValue: "0" }],
        false
      );
      const perrs = validateItemErrors(pub.data);
      if (!pub.ok || perrs.length > 0) {
        return {
          error: "",
          warn:
            "saved — but content approval is still PENDING: readers see the previous " +
            "links until a document controller approves it",
        };
      }
    }
  }
  return { error: "", warn: "" };
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
