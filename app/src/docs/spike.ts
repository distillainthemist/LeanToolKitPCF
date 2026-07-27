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
import { spRequest } from "./sp";

const SITE = "https://pecheydistillingcom.sharepoint.com/sites/Dev";
const SEARCH_BODY = JSON.stringify({
  request: { Querytext: "*", RowLimit: 3, TrimDuplicates: false },
});

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

    // 3. the decision gate (kept green as the transport's smoke test):
    //    HttpRequest GET _api/web through sp.ts — the real data layer
    const web = await spRequest(SITE, "GET", "_api/web?$select=Title,Url");
    show("3. spRequest GET _api/web  ← plan A transport", web);

    // 4. the prize: search postquery through the same door
    const search = await spRequest(SITE, "POST", "_api/search/postquery", {
      headers: {
        "Content-Type": "application/json;odata=verbose",
        Accept: "application/json;odata=verbose",
      },
      body: SEARCH_BODY,
    });
    show(
      "4. spRequest POST search/postquery",
      search.ok
        ? {
            ok: true,
            rows:
              ((search.data as Record<string, never>)?.["d"] as Record<string, never>)?.[
                "postquery"
              ] !== undefined
                ? "postquery payload present"
                : "unexpected shape",
          }
        : search
    );

    line("\ndone.");
  })();

  return () => host.remove();
}
