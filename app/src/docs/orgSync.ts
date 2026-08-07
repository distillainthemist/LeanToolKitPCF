// 5F — executes an OrgSyncPlan against the Organisation term set.
// Renames land first (in place, on the GUID), then creates parent-first;
// every step logs its own OK/FAIL line — the first hosted run doubles as
// the transport measurement, so nothing here may fail silently. Nothing
// is ever deleted.

import { OrgSyncPlan } from "./model";
import {
  TermNode,
  createTerm,
  fetchTerm,
  fetchTermStoreLanguage,
  invalidateTermPaths,
  patchTermLabels,
} from "./sp";

const norm = (p: string[]) => p.map((s) => s.trim().toLowerCase()).join("¦");

/** Runs the plan. Returns the number of steps that FAILED (0 = clean). */
export async function executeOrgSync(opts: {
  site: string;
  setId: string;
  plan: OrgSyncPlan;
  /** The walk the plan was computed from — the parent-id lookup. */
  termNodes: TermNode[];
  termOffset: number;
  log: (line: string) => void;
}): Promise<number> {
  const { site, setId, plan, termNodes, termOffset, log } = opts;
  let failed = 0;

  const langRes = await fetchTermStoreLanguage(site);
  const lang =
    ((langRes.data ?? {}) as { defaultLanguageTag?: string }).defaultLanguageTag ?? "en-US";

  // Parent lookup keyed by the FINAL (post-rename, offset-sliced) path —
  // the plan's create paths speak the app's labels, so the map must too.
  const ids = new Map<string, string>();
  // the single top-level term a company-rooted set syncs under
  let rootId = "";
  for (const n of termNodes) {
    if (termOffset > 0 && n.labels.length === 1) rootId = n.id;
    let sliced = n.labels.slice(termOffset);
    if (sliced.length === 0) continue;
    for (const r of plan.renames) {
      if (sliced.length >= r.from.length && norm(sliced.slice(0, r.from.length)) === norm(r.from)) {
        sliced = [...r.to, ...sliced.slice(r.to.length)];
      }
    }
    ids.set(norm(sliced), n.id);
  }

  for (const r of plan.renames) {
    const label = `${r.from.join(" › ")} → ${r.to[r.to.length - 1]}`;
    // read-modify-write keeps synonyms and other languages alive
    const current = await fetchTerm(site, setId, r.id);
    const labels = ((current.data ?? {}) as {
      labels?: { languageTag?: string; name?: string; isDefault?: boolean }[];
    }).labels;
    if (!current.ok || !Array.isArray(labels) || labels.length === 0) {
      failed++;
      log(`FAIL — rename ${label}: could not read the term (${current.status.slice(0, 160)})`);
      continue;
    }
    const next = labels.map((l) => ({
      languageTag: l.languageTag ?? lang,
      name: l.isDefault ? r.to[r.to.length - 1] : (l.name ?? ""),
      isDefault: l.isDefault === true,
    }));
    if (!next.some((l) => l.isDefault)) {
      next[0] = { ...next[0], name: r.to[r.to.length - 1], isDefault: true };
    }
    const res = await patchTermLabels(site, setId, r.id, next);
    if (res.ok) {
      log(`OK — renamed ${label} (term kept its id; tags and mappings survive).`);
    } else {
      failed++;
      log(`FAIL — rename ${label}: ${res.status.slice(0, 200)}`);
    }
  }

  for (const path of plan.creates) {
    const label = path.join(" › ");
    const parentId = path.length === 1 ? rootId : ids.get(norm(path.slice(0, -1)));
    if (parentId === undefined) {
      failed++;
      log(`SKIP — ${label}: its parent was not created.`);
      continue;
    }
    const res = await createTerm(site, setId, parentId, path[path.length - 1], lang);
    const newId = ((res.data ?? {}) as { id?: unknown }).id;
    if (res.ok && typeof newId === "string" && newId !== "") {
      ids.set(norm(path), newId);
      log(`OK — created ${label}.`);
    } else {
      failed++;
      log(
        res.ok
          ? `FAIL — ${label}: the create answered OK but returned no term id.`
          : `FAIL — ${label}: ${res.status.slice(0, 200)}`
      );
    }
  }

  // the walk cache now describes the old tree
  invalidateTermPaths();
  return failed;
}
