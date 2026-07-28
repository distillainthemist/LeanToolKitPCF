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
  opts: { headers?: Record<string, string>; body?: string } = {}
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
            ...(opts.body !== undefined ? { body: opts.body } : {}),
          },
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

function summarizeError(err: unknown): string {
  if (err == null) return "request failed";
  if (typeof err === "string") return err.slice(0, 300);
  const o = err as { message?: unknown; code?: unknown };
  const msg = typeof o.message === "string" ? o.message : JSON.stringify(err);
  return `${typeof o.code === "string" ? `${o.code}: ` : ""}${msg}`.slice(0, 300);
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
