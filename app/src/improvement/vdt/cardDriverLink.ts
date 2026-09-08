// A KPI card linking ITSELF to a value driver (Ben, 2026-09-08: on a
// meeting board a KPI card may be a window onto a driver that an
// initiative also works). Any board editor may link. The flow: pick the
// site when the board has none → the full-path picker (leaves + leading
// only) → merge the card's private readings into the driver's series
// (the driver's dates win) → seed the driver's spec from the card's
// level values when the driver has none (Option C) → save the link in
// the slot's settings. Lazy from the board path.

import { el } from "../../../../shared/ui/dom";
import { parseOrgTree } from "../../../../shared/schema/meeting";
import { bucketSpan } from "../../../../shared/schema/buckets";
import { todayIso } from "../../../../shared/schema/id";
import { promptConfirm } from "../../prompts";
import { getBoard, patchSlotSettings } from "../../store/boards";
import { orgJson } from "../../store/config";
import { listDrivers } from "../../store/valueDrivers";
import { hasAnySeries } from "../../store/series";
import { mergeCardSeriesIntoDriver, seedDriverSpecIfEmpty } from "../../store/driverSeries";
import { isLeaf } from "./model";
import { openDriverLinkPicker } from "./linkPicker";

export interface LinkCardOpts {
  boardId: string;
  cardId: string;
  title: string;
  unit: string;
  level: { target: number | null; lsl: number | null; usl: number | null };
}

/** Returns true when a link was saved. */
export async function linkCardToDriver(o: LinkCardOpts): Promise<boolean> {
  const board = await getBoard(o.boardId);
  let site = board?.site ?? "";
  if (site === "") {
    const sites = parseOrgTree(await orgJson()).map((s) => s.site);
    if (sites.length === 0) {
      await promptConfirm({ title: "No sites", note: "Value driver trees are per site, and the organisation has none yet.", confirmLabel: "OK" });
      return false;
    }
    site = sites.length === 1 ? sites[0] : await pickSite(sites);
    if (site === "") return false;
  }
  const r = await openDriverLinkPicker(document.body, site, { name: o.title, unit: o.unit }, null);
  if (r === null || r === "clear") return false;
  const nodes = await listDrivers(site);
  const n = nodes.find((d) => d.id === r.driverId) ?? null;
  if (!n) return false;
  if (n.kind === "driver" && !isLeaf(nodes, n)) {
    await promptConfirm({ title: `${n.name} comes from its formula`, note: "A computed driver can't take readings. Pick one of the drivers beneath it.", confirmLabel: "OK" });
    return false;
  }
  // the card's private readings move onto the driver (its dates win)
  if (await hasAnySeries(o.boardId, o.cardId)) {
    const t = await mergeCardSeriesIntoDriver(o.boardId, o.cardId, n.id);
    if (t.moved + t.kept > 0) {
      await promptConfirm({
        title: `Linked to ${n.name}`,
        note: `${t.moved} reading${t.moved === 1 ? "" : "s"} moved onto the driver's series${t.kept > 0 ? `; ${t.kept} kept the driver's existing value for that date` : ""}. From here the card shows the driver's numbers.`,
        confirmLabel: "OK",
      });
    }
  }
  // Option C: the driver owns targets — seed from this card's level when bare
  await seedDriverSpecIfEmpty(n.id, bucketSpan(todayIso(), n.cadence).from, o.level).catch(() => false);
  await patchSlotSettings(o.boardId, o.cardId, { driver: { site, driverId: n.id } });
  return true;
}

export async function unlinkCardFromDriver(boardId: string, cardId: string, driverName: string): Promise<boolean> {
  const ok = await promptConfirm({
    title: `Unlink from ${driverName}?`,
    note: "Readings stay on the value driver; this card goes back to its own (possibly empty) readings.",
    confirmLabel: "Unlink",
  });
  if (!ok) return false;
  await patchSlotSettings(boardId, cardId, { driver: undefined });
  return true;
}

function pickSite(sites: string[]): Promise<string> {
  return new Promise((resolve) => {
    const scrim = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", "Which site's value drivers?"));
    box.appendChild(el("div", "app-modal-note", "This board has no site of its own, so choose the tree to link into."));
    const sel = el("select", "app-input") as HTMLSelectElement;
    for (const s of sites) {
      const op = el("option", "", s) as HTMLOptionElement;
      op.value = s;
      sel.appendChild(op);
    }
    box.appendChild(sel);
    const foot = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      scrim.remove();
      resolve("");
    });
    const go = el("button", "app-btn app-btn-primary", "Next") as HTMLButtonElement;
    go.type = "button";
    go.addEventListener("click", () => {
      scrim.remove();
      resolve(sel.value);
    });
    foot.append(cancel, go);
    box.appendChild(foot);
    scrim.appendChild(box);
    document.body.appendChild(scrim);
  });
}
