// Standard Documents — the SharePoint transport (plan A, proven by the
// Phase 0 hosted spike). One door for everything: the connector's
// HttpRequest operation ("Send an HTTP request to SharePoint"), which
// pac generates no wrapper for but the SDK executes happily once the
// operation is declared in the client-side apis map — the SDK resolves
// path, method and body from dataSourcesInfo (verified in its source).
//
// The bound "documents" data source carries the CONNECTION; the actual
// target site travels as a per-call dataset override, so configured
// sites need no rebinding. Site-scoped REST covers the whole plan:
// search postquery, list REST, /_api/v2.1 term store, the /_api/v2.0
// drive surface and format=pdf (Phase 0 probes, 6/6).

import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import { termTreeOrder } from "./rows";
import { bytesToBase64, spQuote } from "./model";

// the import is for side effect typing only — the data source must exist
// in the app for the connection to be present at runtime
import "../generated/services/DocumentsService";

export interface SpResult {
  ok: boolean;
  status: string;
  data: unknown;
}

let declared = false;

/** Declare the connector's HttpRequest op in the local apis map (once). */
function declare(): void {
  if (declared) return;
  declared = true;
  const info = dataSourcesInfo as unknown as {
    documents: { apis: Record<string, unknown> };
  };
  info.documents.apis["HttpRequest"] ??= {
    path: "/{connectionId}/datasets/{dataset}/httprequest",
    method: "POST",
    parameters: [
      { name: "connectionId", in: "path", required: true, type: "string" },
      { name: "dataset", in: "path", required: true, type: "string" },
      { name: "parameters", in: "body", required: true, type: "object" },
    ],
    responseInfo: { "200": { type: "object" } },
  };
}

/**
 * One site-scoped SharePoint REST call as the signed-in user.
 * `uri` is site-relative ("_api/web?$select=Title"). Never throws — a
 * refused or failed call comes back as {ok:false} with what we know.
 */
export async function spRequest(
  site: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  uri: string,
  opts: {
    headers?: Record<string, string>;
    body?: string;
    /** Bytes, sent in Power Platform's binary envelope instead of as a
     *  string body — see bytesToBase64 for why a string cannot work. */
    bytes?: Uint8Array;
    contentType?: string;
  } = {}
): Promise<SpResult> {
  declare();
  const client = getClient(dataSourcesInfo);
  try {
    const r = (await client.executeAsync<object, unknown>({
      connectorOperation: {
        tableName: "documents",
        operationName: "HttpRequest",
        parameters: {
          dataset: site.replace(/\/$/, ""),
          parameters: {
            method,
            uri,
            headers: {
              Accept: "application/json;odata=nometadata",
              ...(opts.headers ?? {}),
            },
            ...(opts.bytes !== undefined
              ? {
                  body: {
                    "$content-type": opts.contentType ?? "application/octet-stream",
                    $content: bytesToBase64(opts.bytes),
                  },
                }
              : opts.body !== undefined
                ? { body: opts.body }
                : {}),
          },
        },
      },
    })) as { success?: boolean; data?: unknown; error?: unknown };
    if (r && r.success === false) {
      // the status line clips long errors — the console keeps the whole
      // thing for diagnosis (connector errors nest the SP odata.error)
      console.error("[docs] SharePoint request failed", method, uri, r.error);
      return { ok: false, status: summarizeError(r.error), data: r.error ?? null };
    }
    return { ok: true, status: "", data: (r as { data?: unknown })?.data ?? null };
  } catch (e) {
    console.error("[docs] SharePoint request threw", method, uri, e);
    return { ok: false, status: String(e), data: null };
  }
}

function summarizeError(err: unknown): string {
  if (err == null) return "request failed";
  if (typeof err === "string") return err.slice(0, 1500);
  const o = err as { message?: unknown; code?: unknown };
  const msg = typeof o.message === "string" ? o.message : JSON.stringify(err);
  return `${typeof o.code === "string" ? `${o.code}: ` : ""}${msg}`.slice(0, 1500);
}

// ---- the specific calls Phase 1 needs ----------------------------------

/** Visible document libraries (BaseTemplate 101) on a site. */
export function fetchLibraries(site: string): Promise<SpResult> {
  return spRequest(
    site,
    "GET",
    "_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false&$select=Id,Title,ItemCount&$orderby=Title"
  );
}

/** A library's visible fields (columns). SchemaXml comes along because a
 *  taxonomy column's term set is sometimes reported only in there — it is
 *  what lets LeanBoard find a status column's terms by itself. */
export function fetchFields(site: string, listId: string): Promise<SpResult> {
  return spRequest(
    site,
    "GET",
    `_api/web/lists(guid'${listId}')/fields?$filter=Hidden eq false` +
      `&$select=InternalName,Title,TypeAsString,Choices,TermSetId,SchemaXml`
  );
}

/** Every term in a set, flattened — the values a managed-metadata column
 *  can hold, which is what colours get attached to. */
export function fetchTermsInSet(site: string, setId: string): Promise<SpResult> {
  return spRequest(site, "GET", `_api/v2.1/termStore/sets/${setId}/terms?$select=id,labels`, {
    headers: { Accept: "application/json" },
  });
}

/** Term store groups (site-scoped v2.1 — Phase 0 probe). */
export function fetchTermGroups(site: string): Promise<SpResult> {
  return spRequest(site, "GET", "_api/v2.1/termStore/groups?$select=id,name", {
    headers: { Accept: "application/json" },
  });
}

/** Term sets under a group. */
export function fetchTermSets(site: string, groupId: string): Promise<SpResult> {
  return spRequest(
    site,
    "GET",
    `_api/v2.1/termStore/groups/${groupId}/sets?$select=id,localizedNames`,
    { headers: { Accept: "application/json" } }
  );
}

// ---- writes (Phase 4A) -------------------------------------------------
// Everything below CHANGES a document. Each is one site-scoped REST call
// as the signed-in user, so SharePoint's own permissions are the gate and
// the UI only decides what to offer — a user who should not be able to
// check a document out gets SharePoint's refusal, not ours.
//
// Paths go through GetFileByServerRelativePath(decodedUrl='…') rather
// than the older …ByServerRelativeUrl: it is the one that survives the
// apostrophes, ampersands and accents real document names carry.

const filePath = (serverRelativeUrl: string) =>
  `_api/web/GetFileByServerRelativePath(decodedUrl='${spQuote(serverRelativeUrl)}')`;
const folderPath = (serverRelativeUrl: string) =>
  `_api/web/GetFolderByServerRelativePath(decodedUrl='${spQuote(serverRelativeUrl)}')`;

/** What the signed-in user may do in a library, as SharePoint sees it. */
export function fetchListPermissions(site: string, listId: string): Promise<SpResult> {
  return spRequest(site, "GET", `_api/web/lists(guid'${listId}')/EffectiveBasePermissions`);
}

/** A library's root folder — where an added document lands. */
export function fetchListRoot(site: string, listId: string): Promise<SpResult> {
  return spRequest(
    site,
    "GET",
    `_api/web/lists(guid'${listId}')/RootFolder?$select=ServerRelativeUrl`
  );
}

export function checkOutFile(site: string, url: string): Promise<SpResult> {
  return spRequest(site, "POST", `${filePath(url)}/CheckOut()`);
}

/** `major` writes a 1.0-style version; minor keeps it a draft. The
 *  comment is required by the UI, not by SharePoint — an entry an
 *  auditor reads is worth more than a keystroke saved (Ben). */
export function checkInFile(
  site: string,
  url: string,
  comment: string,
  major: boolean
): Promise<SpResult> {
  return spRequest(
    site,
    "POST",
    `${filePath(url)}/CheckIn(comment='${spQuote(comment)}',checkintype=${major ? 1 : 0})`
  );
}

/** Discards the check-out AND the edits made under it — SharePoint keeps
 *  no copy, so every caller confirms first. */
export function undoCheckOut(site: string, url: string): Promise<SpResult> {
  return spRequest(site, "POST", `${filePath(url)}/UndoCheckOut()`);
}

/** Server-side copy: no bytes cross the wire, which is what makes the
 *  template route certain where upload is not. */
export function copyFileTo(site: string, url: string, newUrl: string): Promise<SpResult> {
  return spRequest(
    site,
    "POST",
    `${filePath(url)}/copyto(strnewurl='${spQuote(newUrl)}',boverwrite=false)`
  );
}

/** Add a file from content the caller holds. Text is certain; bytes are
 *  what 4A's probe exists to settle. */
export function addFile(
  site: string,
  folder: string,
  name: string,
  body: string
): Promise<SpResult> {
  return spRequest(
    site,
    "POST",
    `${folderPath(folder)}/Files/add(url='${spQuote(name)}',overwrite=true)`,
    { body }
  );
}

/** The same add, carrying real bytes rather than text. */
export function addFileBytes(
  site: string,
  folder: string,
  name: string,
  bytes: Uint8Array
): Promise<SpResult> {
  return spRequest(
    site,
    "POST",
    `${folderPath(folder)}/Files/add(url='${spQuote(name)}',overwrite=true)`,
    { bytes }
  );
}

/**
 * The connector's own **Create file** operation — a different door from
 * HttpRequest, declared the same way. Worth trying precisely because its
 * body parameter IS a file's content rather than a REST body: Power
 * Platform transmits binary parameters base64-encoded on the wire, so a
 * base64 string handed to a file-typed parameter can land as the bytes
 * it decodes to. Whether this SDK forwards it that way is what 4A's
 * third carriage measures.
 */
export async function connectorCreateFile(
  site: string,
  folder: string,
  name: string,
  content: string
): Promise<SpResult> {
  declare();
  const info = dataSourcesInfo as unknown as { documents: { apis: Record<string, unknown> } };
  info.documents.apis["CreateFile"] ??= {
    path: "/{connectionId}/datasets/{dataset}/files",
    method: "POST",
    parameters: [
      { name: "connectionId", in: "path", required: true, type: "string" },
      { name: "dataset", in: "path", required: true, type: "string" },
      { name: "folderPath", in: "query", required: true, type: "string" },
      { name: "name", in: "query", required: true, type: "string" },
      { name: "body", in: "body", required: true, type: "string" },
    ],
    responseInfo: { "200": { type: "object" } },
  };
  try {
    const r = (await getClient(dataSourcesInfo).executeAsync<object, unknown>({
      connectorOperation: {
        tableName: "documents",
        operationName: "CreateFile",
        parameters: {
          dataset: site.replace(/\/$/, ""),
          folderPath: folder,
          name,
          body: content,
        },
      },
    })) as { success?: boolean; data?: unknown; error?: unknown };
    if (r && r.success === false) {
      return { ok: false, status: summarizeError(r.error), data: r.error ?? null };
    }
    return { ok: true, status: "", data: (r as { data?: unknown })?.data ?? null };
  } catch (e) {
    return { ok: false, status: String(e), data: null };
  }
}

export function fetchFileInfo(site: string, url: string): Promise<SpResult> {
  return spRequest(site, "GET", `${filePath(url)}?$select=Length,CheckOutType,Name`);
}

/** The list item behind a file — its id is what metadata writes address. */
export function fetchFileItemId(site: string, url: string): Promise<SpResult> {
  return spRequest(site, "GET", `${filePath(url)}/ListItemAllFields?$select=Id`);
}

export function recycleFile(site: string, url: string): Promise<SpResult> {
  return spRequest(site, "POST", `${filePath(url)}/recycle()`);
}

/**
 * Metadata written the way SharePoint writes it itself. Taxonomy, date,
 * choice and person all arrive as DISPLAY TEXT and SharePoint coerces
 * them — the alternative is a PATCH per field type plus hidden note
 * fields for taxonomy, which is exactly the code that gets a term set
 * subtly wrong. Field-level failures come back per field rather than
 * failing the whole call, so the form can point at the offending row.
 */
export function validateUpdateListItem(
  site: string,
  listId: string,
  itemId: number,
  values: { FieldName: string; FieldValue: string }[]
): Promise<SpResult> {
  return spRequest(
    site,
    "POST",
    `_api/web/lists(guid'${listId}')/items(${itemId})/ValidateUpdateListItem`,
    {
      headers: { "Content-Type": "application/json;odata=nometadata" },
      body: JSON.stringify({ formValues: values, bNewDocumentUpdate: true }),
    }
  );
}

/** One term level: children of a set (parentId "") or of a term. */
export function fetchTermChildren(
  site: string,
  setId: string,
  parentId: string
): Promise<SpResult> {
  const base = parentId === ""
    ? `_api/v2.1/termStore/sets/${setId}/children`
    : `_api/v2.1/termStore/sets/${setId}/terms/${parentId}/children`;
  return spRequest(site, "GET", `${base}?$select=id,labels`, {
    headers: { Accept: "application/json" },
  });
}

/**
 * The Organisation term set flattened to label paths, walked level by
 * level (v2.1 has no subtree expand). Depth-capped and request-capped —
 * a drift report is an admin surface, not a hot path.
 */
export interface TermNode {
  /** Term id — what search filtering keys on (owstaxId… properties). */
  id: string;
  /** Full label path from the set root, e.g. ["Bell Bay", "Casting"]. */
  labels: string[];
}

interface TermWalk {
  nodes: TermNode[];
  truncated: boolean;
  error: string;
}

// Session cache — term sets change rarely, and the walk is the docs
// tab's slowest load (Ben timed it). In the hub tab, every library
// click re-mounts the screen, so without this the walk re-ran on every
// navigation. The settings save invalidates it.
const termCache = new Map<string, Promise<TermWalk>>();

export function invalidateTermPaths(): void {
  termCache.clear();
}

export function fetchTermPaths(
  site: string,
  setId: string,
  maxDepth = 4,
  maxRequests = 120
): Promise<TermWalk> {
  const key = `${site}|${setId}|${maxDepth}`;
  let hit = termCache.get(key);
  if (hit === undefined) {
    hit = walkTermSet(site, setId, maxDepth, maxRequests);
    // a failed or empty walk must not stick as the cached answer
    hit.then(
      (r) => {
        if (r.error !== "" || r.nodes.length === 0) termCache.delete(key);
      },
      () => termCache.delete(key)
    );
    termCache.set(key, hit);
  }
  return hit;
}

/** Breadth-first, one PARALLEL batch per level: wall time is the tree's
 *  depth in round-trips, not its node count — sequential per-node walking
 *  took ~8 gateway round-trips even for a two-branch dev tree. */
async function walkTermSet(
  site: string,
  setId: string,
  maxDepth: number,
  maxRequests: number
): Promise<TermWalk> {
  const nodes: TermNode[] = [];
  let requests = 0;
  let truncated = false;
  let firstError = "";
  const label = (t: Record<string, unknown>): string => {
    const labels = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
    if (!Array.isArray(labels)) return "";
    const def = labels.find((l) => l.isDefault) ?? labels[0];
    return (def?.name ?? "").trim();
  };
  let frontier: { id: string; labels: string[] }[] = [{ id: "", labels: [] }];
  while (frontier.length > 0) {
    const parents = frontier.filter((p) => p.labels.length < maxDepth);
    if (parents.length === 0) break;
    if (requests + parents.length > maxRequests) {
      truncated = true;
      break;
    }
    requests += parents.length;
    const results = await Promise.all(
      parents.map((p) => fetchTermChildren(site, setId, p.id))
    );
    const next: typeof frontier = [];
    for (let i = 0; i < parents.length; i++) {
      const r = results[i];
      if (!r.ok) {
        if (firstError === "") firstError = r.status;
        continue; // a partial tree beats none — the error only surfaces if NOTHING loads
      }
      const terms = Array.isArray((r.data as { value?: unknown[] })?.value)
        ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
        : [];
      for (const t of terms) {
        const name = label(t);
        const id = typeof t.id === "string" ? t.id : "";
        if (name === "" || id === "") continue;
        const labels = [...parents[i].labels, name];
        nodes.push({ id, labels });
        next.push({ id, labels });
      }
    }
    frontier = next;
  }
  return {
    // the walk collects level by level; callers render array order, so
    // hand back depth-first order (children under their parent)
    nodes: termTreeOrder(nodes),
    truncated,
    error: nodes.length === 0 ? firstError : "",
  };
}
