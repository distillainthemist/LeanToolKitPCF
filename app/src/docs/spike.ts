// Phase 0 runtime spike (docs/leanboard-standard-documents-plan.md): can
// executeAsync invoke a SharePoint connector operation pac generated no
// wrapper for? The SDK resolves method, path and body from the
// CLIENT-side dataSourcesInfo apis map (verified in the SDK source:
// connectorDataOperationExecutor._buildOperationUrl reads
// apis[operationName].path), so the probe declares HttpRequest locally
// and lets the gateway be the judge — that answer decides plan A vs B.
//
// TEMPORARY: remove, or grow into the real docs store, once the decision
// gate closes. Reached via #/docs-spike (no nav link).

import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import { DocumentsService } from "../generated/services/DocumentsService";
import { el } from "../../../shared/ui/dom";

const SEARCH_BODY = JSON.stringify({
  request: { Querytext: "*", RowLimit: 3, TrimDuplicates: false },
});

/** Declare the connector's HttpRequest op in the local apis map. */
function declareHttpRequest(): void {
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

export function mountDocsSpike(parent: HTMLElement): () => void {
  const host = el("div", "app-docs-spike");
  host.style.padding = "16px";
  host.appendChild(el("h2", "", "Standard Documents — runtime spike"));
  const out = el("pre", "");
  out.style.cssText =
    "white-space:pre-wrap;background:#111;color:#0f0;padding:12px;border-radius:8px;font-size:12px;";
  out.textContent = "running…\n";
  host.appendChild(out);
  parent.appendChild(host);

  const line = (s: string) => {
    out.textContent += `${s}\n`;
  };
  const show = (label: string, r: unknown) => {
    const text = JSON.stringify(r, null, 1) ?? String(r);
    line(`\n=== ${label} ===\n${text.length > 900 ? text.slice(0, 900) + " …" : text}`);
  };

  void (async () => {
    // 1. tabular baseline — proves the data source works in this host
    try {
      const all = await DocumentsService.getAll();
      show(`1. tabular getAll — ${all.data?.length ?? 0} row(s)`, {
        first: all.data?.[0]?.["{FilenameWithExtension}"] ?? all.data?.[0] ?? null,
      });
    } catch (e) {
      show("1. tabular getAll THREW", String(e));
    }

    const client = getClient(dataSourcesInfo);

    // 2. control: a DECLARED non-CRUD operation (GetEditor exists in the
    //    generated apis map) — proves executeAsync itself works here
    try {
      const r = await client.executeAsync<{ search: string }, unknown>({
        connectorOperation: {
          tableName: "documents",
          operationName: "GetEditor",
          parameters: { search: "a" },
        },
      });
      show("2. executeAsync GetEditor (declared control)", r);
    } catch (e) {
      show("2. executeAsync GetEditor THREW", String(e));
    }

    // 3. the decision gate: HttpRequest, declared locally, GET _api/web
    declareHttpRequest();
    try {
      const r = await client.executeAsync<object, unknown>({
        connectorOperation: {
          tableName: "documents",
          operationName: "HttpRequest",
          parameters: {
            parameters: {
              method: "GET",
              uri: "_api/web?$select=Title,Url",
              headers: { Accept: "application/json;odata=nometadata" },
            },
          },
        },
      });
      show("3. HttpRequest GET _api/web  ← THE PLAN A/B ANSWER", r);
    } catch (e) {
      show("3. HttpRequest GET _api/web THREW", String(e));
    }

    // 4. the prize: search postquery through the same door
    try {
      const r = await client.executeAsync<object, unknown>({
        connectorOperation: {
          tableName: "documents",
          operationName: "HttpRequest",
          parameters: {
            parameters: {
              method: "POST",
              uri: "_api/search/postquery",
              headers: {
                "Content-Type": "application/json;odata=verbose",
                Accept: "application/json;odata=verbose",
              },
              body: SEARCH_BODY,
            },
          },
        },
      });
      show("4. HttpRequest POST search/postquery", r);
    } catch (e) {
      show("4. HttpRequest POST search/postquery THREW", String(e));
    }

    line("\ndone.");
  })();

  return () => host.remove();
}
