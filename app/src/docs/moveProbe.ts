// Document ingestion — the move-road probe (2026-10-08, the first step of
// document-ingestion-proposal-2026-10.md §5). One question the design
// cannot guess: when a file MOVES between two libraries of one site,
// what does it carry (its Title / shared columns, its version history),
// in what state does it land on the destination's rules (check-out,
// moderation), and does the approve bracket then take it to an approved
// major? The probe creates a text file in the SOURCE library, gives it
// a Title and two versions, moves it, reads everything back, runs the
// bracket, then does the same with COPY, and recycles every file it
// made — even when a step fails half-way. Loaded on demand from the
// settings tab, as the write probe is.
//
// One variable per step (sharepoint-writes.md, "A probe must test one
// variable"): a refused step says so in SharePoint's own words and the
// later steps that depend on it are skipped, never faked.

import { spErrorText, parseBasePermissions } from "./model";
import type { SpResult } from "./sp";
import {
  addFile,
  checkInFile,
  checkOutFile,
  copyFileByPath,
  fetchFileInfo,
  fetchFileItemId,
  fetchFileItemState,
  fetchFileVersions,
  fetchListPermissions,
  fetchListRoot,
  fetchListRules,
  moveFileByPath,
  recycleFile,
  validateUpdateListItem,
} from "./sp";
import type { ProbeStep } from "./writeProbe";

export interface MoveProbeInput {
  site: string;
  sourceListId: string;
  destListId: string;
}

const say = (r: { ok: boolean; status: string }, good: string) => (r.ok ? good : spErrorText(r.status).slice(0, 500) || "refused");

interface Rules {
  title: string;
  moderation: boolean;
  forceCheckout: boolean;
  versioning: boolean;
  minors: boolean;
}

const rulesOf = (r: SpResult): Rules => {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return {
    title: String(d.Title ?? ""),
    moderation: d.EnableModeration === true,
    forceCheckout: d.ForceCheckout === true,
    versioning: d.EnableVersioning === true,
    minors: d.EnableMinorVersions === true,
  };
};
const rulesText = (r: Rules) =>
  `${r.title}: content approval ${r.moderation ? "ON" : "off"}, require check-out ${r.forceCheckout ? "ON" : "off"}, versioning ${r.versioning ? (r.minors ? "major + minor" : "major only") : "off"}`;

interface ItemState {
  id: number;
  title: string;
  moderation: string;
  version: string;
}
const stateOf = (r: SpResult): ItemState | null => {
  if (!r.ok) return null;
  const d = (r.data ?? {}) as Record<string, unknown>;
  const mod = d.OData__ModerationStatus ?? d._ModerationStatus;
  return {
    id: Number(d.Id ?? 0),
    title: String(d.Title ?? ""),
    moderation: mod === undefined || mod === null ? "n/a" : String(mod),
    version: String(d.OData__UIVersionString ?? d._UIVersionString ?? "?"),
  };
};
const moderationWord = (m: string) => (m === "0" ? "approved" : m === "1" ? "rejected" : m === "2" ? "pending" : m === "3" ? "draft" : m === "4" ? "scheduled" : m);
const checkOutWord = (t: unknown) => (t === 0 ? "checked out (online)" : t === 1 ? "checked out (offline)" : t === 2 ? "checked in" : `check-out type ${String(t)}`);

const versionLabels = async (site: string, url: string): Promise<string> => {
  const v = await fetchFileVersions(site, url);
  if (!v.ok) return `versions unreadable (${spErrorText(v.status).slice(0, 120)})`;
  const list = ((v.data ?? {}) as { value?: { VersionLabel?: string }[] }).value ?? [];
  return list.length === 0 ? "no prior versions" : `prior versions ${list.map((x) => x.VersionLabel ?? "?").join(", ")}`;
};

export async function runMoveProbe(input: MoveProbeInput, onStep: (step: ProbeStep) => void): Promise<void> {
  const { site, sourceListId, destListId } = input;
  const created: string[] = [];
  const step = (name: string, ok: boolean, detail: string) => onStep({ name, ok, detail });
  const origin = new URL(site).origin;
  const abs = (serverRelative: string) => `${origin}${serverRelative}`;

  try {
    // ---- the two libraries' rules and the viewer's rights ---------------
    const [srcRules, dstRules, srcPerm, dstPerm, srcRoot, dstRoot] = await Promise.all([
      fetchListRules(site, sourceListId),
      fetchListRules(site, destListId),
      fetchListPermissions(site, sourceListId),
      fetchListPermissions(site, destListId),
      fetchListRoot(site, sourceListId),
      fetchListRoot(site, destListId),
    ]);
    const sr = rulesOf(srcRules);
    const dr = rulesOf(dstRules);
    step("Source library rules", srcRules.ok, say(srcRules, rulesText(sr)));
    step("Destination library rules", dstRules.ok, say(dstRules, rulesText(dr)));
    const sp = parseBasePermissions(srcPerm.data);
    const dp = parseBasePermissions(dstPerm.data);
    step("Your rights", sp.add && sp.remove && dp.add && dp.edit, `source add ${sp.add ? "yes" : "no"} / delete ${sp.remove ? "yes" : "no"}; destination add ${dp.add ? "yes" : "no"} / edit ${dp.edit ? "yes" : "no"} / delete ${dp.remove ? "yes" : "no"}`);
    const srcFolder = String(((srcRoot.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? "");
    const dstFolder = String(((dstRoot.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? "");
    step("Library folders", srcFolder !== "" && dstFolder !== "", `${srcFolder || say(srcRoot, "")} → ${dstFolder || say(dstRoot, "")}`);
    if (!(sp.add && dp.add) || srcFolder === "" || dstFolder === "") {
      step("Everything below", false, "skipped — rights or folders missing");
      return;
    }

    // ---- a probe file with a Title and two versions in the source --------
    const stamp = String(Date.now());
    const makeProbeFile = async (label: string): Promise<{ url: string; title: string } | null> => {
      const name = `LeanBoard ${label} probe ${stamp}.txt`;
      const url = `${srcFolder}/${name}`;
      const add = await addFile(site, srcFolder, name, `LeanBoard ${label} probe — safe to delete.`);
      step(`Create "${name}"`, add.ok, say(add, "created in the source library"));
      if (!add.ok) return null;
      created.push(url);
      // Files/add lands checked out on a require-check-out library and
      // checked in elsewhere (cookbook): read, then settle it checked in
      const info = await fetchFileInfo(site, url);
      const co = ((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType;
      if (co !== 2) {
        const ci = await checkInFile(site, url, "LeanBoard probe: created", true);
        step(`Settle "${label}" checked in`, ci.ok, say(ci, `was ${checkOutWord(co)}; checked in as a major`));
      }
      const idRes = await fetchFileItemId(site, url);
      const itemId = Number(((idRes.data ?? {}) as { Id?: unknown }).Id ?? 0);
      if (itemId === 0) {
        step(`Item id of "${label}"`, false, say(idRes, "no item id"));
        return null;
      }
      const title = `LeanBoard ${label} probe ${stamp}`;
      // one write bracket per version: check-out (where the rule asks),
      // the Title through the forms engine, a major check-in
      for (const n of [1, 2]) {
        if (sr.forceCheckout) await checkOutFile(site, url);
        const w = await validateUpdateListItem(site, sourceListId, itemId, [{ FieldName: "Title", FieldValue: `${title} v${n}` }], false);
        const ci = await checkInFile(site, url, `LeanBoard probe: version ${n}`, true);
        step(`"${label}" version ${n}`, w.ok && (ci.ok || /not checked out/i.test(ci.status)), `${say(w, "Title written")}; ${ci.ok ? "checked in as a major" : /not checked out/i.test(ci.status) ? "no check-out to release (no rule here)" : say(ci, "")}`);
      }
      const before = stateOf(await fetchFileItemState(site, url));
      step(`"${label}" before the move`, before !== null, before ? `Title "${before.title}", version ${before.version}, moderation ${moderationWord(before.moderation)}; ${await versionLabels(site, url)}` : "unreadable");
      return { url, title: `${title} v2` };
    };

    // ---- MOVE --------------------------------------------------------------
    const mv = await makeProbeFile("move");
    if (mv) {
      const destUrl = `${dstFolder}/${mv.url.slice(srcFolder.length + 1)}`;
      const moved = await moveFileByPath(site, abs(mv.url), abs(destUrl));
      step("MoveFileByPath", moved.ok, say(moved, "accepted"));
      if (moved.ok) {
        created.push(destUrl);
        const gone = await fetchFileInfo(site, mv.url);
        step("Source after the move", !gone.ok, gone.ok ? "the file is STILL in the source library" : "gone from the source (as a move should)");
        const info = await fetchFileInfo(site, destUrl);
        const co = ((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType;
        const after = stateOf(await fetchFileItemState(site, destUrl));
        step("Landed in the destination", info.ok && after !== null, info.ok ? `${checkOutWord(co)}; ${after ? `Title "${after.title}" (${after.title === mv.title ? "CARRIED" : "LOST"}), version ${after.version}, moderation ${moderationWord(after.moderation)}` : "item unreadable"}; ${await versionLabels(site, destUrl)}` : say(info, ""));
        // ---- the approve bracket on the moved file ---------------------
        if (info.ok && after) {
          if (co === 2) {
            const out = await checkOutFile(site, destUrl);
            step("Check out (destination)", out.ok, say(out, "checked out"));
          } else step("Check out (destination)", true, "already checked out on landing");
          const ci = await checkInFile(site, destUrl, "Ingested — LeanBoard move probe", true);
          step("Check in as a MAJOR", ci.ok, say(ci, "checked in"));
          if (dr.moderation) {
            const pub = await validateUpdateListItem(site, destListId, after.id, [{ FieldName: "_ModerationStatus", FieldValue: "0" }], false);
            step("Publish (moderation → approved)", pub.ok, say(pub, "published"));
          }
          const final = stateOf(await fetchFileItemState(site, destUrl));
          step("Moved file, final state", final !== null && (!dr.moderation || final.moderation === "0"), final ? `version ${final.version}, moderation ${moderationWord(final.moderation)}; ${await versionLabels(site, destUrl)}` : "unreadable");
        }
      }
    }

    // ---- COPY (the fallback if a move carries history) ---------------------
    const cp = await makeProbeFile("copy");
    if (cp) {
      const destUrl = `${dstFolder}/${cp.url.slice(srcFolder.length + 1)}`;
      const copied = await copyFileByPath(site, abs(cp.url), abs(destUrl));
      step("CopyFileByPath", copied.ok, say(copied, "accepted"));
      if (copied.ok) {
        created.push(destUrl);
        const info = await fetchFileInfo(site, destUrl);
        const co = ((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType;
        const after = stateOf(await fetchFileItemState(site, destUrl));
        step("Copy in the destination", info.ok && after !== null, info.ok ? `${checkOutWord(co)}; ${after ? `Title "${after.title}" (${after.title === cp.title ? "CARRIED" : "LOST"}), version ${after.version}, moderation ${moderationWord(after.moderation)}` : "item unreadable"}; ${await versionLabels(site, destUrl)}` : say(info, ""));
        const still = await fetchFileInfo(site, cp.url);
        step("Source after the copy", still.ok, still.ok ? "still in the source (a copy leaves it; the run would recycle it)" : "gone from the source?!");
        // a second copy onto the same name must be a clean refusal
        const again = await copyFileByPath(site, abs(cp.url), abs(destUrl));
        step("Copy onto an existing name (overwrite=false)", !again.ok, again.ok ? "ACCEPTED — the collision rule needs its own check" : `refused: ${spErrorText(again.status).slice(0, 160)}`);
      }
    }
  } finally {
    // newest first: the destination copies before the sources they came from
    let n = 0;
    const failed: string[] = [];
    for (const url of [...created].reverse()) {
      const r = await recycleFile(site, url);
      if (r.ok) n++;
      else if (!/not exist|not found|404/i.test(r.status)) failed.push(url.slice(url.lastIndexOf("/") + 1));
    }
    onStep({ name: "Clean up", ok: failed.length === 0, detail: failed.length === 0 ? `${n} probe file${n === 1 ? "" : "s"} recycled` : `NOT recycled: ${failed.join(", ")} — remove by hand` });
  }
}
