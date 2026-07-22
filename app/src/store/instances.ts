// Board Instance IO — instance creation with the four data policies and
// close-meeting with the shared-card SVG archive (master-leanboard.md
// recipes as tested TypeScript).

import type { Ben_ltkboardinstances } from "../generated/models/Ben_ltkboardinstancesModel";
import { Ben_ltkboardinstancesService } from "../generated/services/Ben_ltkboardinstancesService";
import { Ben_ltkcarddatasService } from "../generated/services/Ben_ltkcarddatasService";
import { getBoard } from "./boards";
import {
  createInstanceRow,
  ensureLiveRow,
  instanceRow,
  liveRow,
  stampArchiveSvg,
} from "./cards";
import { allWhere, eq, firstWhere } from "./dv";
import { parseManifest } from "./mappers";
import { archiveSlots, isActionSurface, seedPlan } from "./policies";

export interface InstanceSummary {
  id: string; // GUID
  boardId: string;
  when: string; // ISO datetime
  status: "open" | "closed";
  isAdhoc: boolean;
  /** Per-instance board override manifest ("" = use the board's own). */
  manifestRaw: string;
}

function fromRow(row: Ben_ltkboardinstances): InstanceSummary {
  return {
    id: row.ben_ltkboardinstanceid,
    boardId: row.ben_boardid ?? "",
    when: row.ben_when ?? "",
    status: row.ben_status === "closed" ? "closed" : "open",
    isAdhoc: row.ben_isadhoc === true,
    manifestRaw: row.ben_manifestjson ?? "",
  };
}

export async function getInstance(id: string): Promise<InstanceSummary | null> {
  const result = await Ben_ltkboardinstancesService.get(id);
  return result.data ? fromRow(result.data) : null;
}

export async function listInstances(boardId: string): Promise<InstanceSummary[]> {
  const rows = await allWhere(
    Ben_ltkboardinstancesService.getAll,
    eq("ben_boardid", boardId),
    undefined,
    ["ben_when desc"]
  );
  return rows.map(fromRow);
}

export async function instanceByWhen(
  boardId: string,
  whenIso: string
): Promise<InstanceSummary | null> {
  const row = await firstWhere(
    Ben_ltkboardinstancesService.getAll,
    `${eq("ben_boardid", boardId)} and ben_when eq ${whenIso}`
  );
  return row ? fromRow(row) : null;
}

/**
 * Create a meeting instance and seed every slot's Card Data row per its
 * policy. "Previous" is the latest instance by scheduled datetime — the
 * carry chain follows the meeting, never the crew.
 */
export async function createInstance(
  boardId: string,
  whenIso: string,
  adhoc = false
): Promise<InstanceSummary> {
  const board = await getBoard(boardId);
  if (!board) throw new Error(`unknown board ${boardId}`);
  const manifest = parseManifest(board.manifestRaw);

  // the carry chain follows the scheduled cadence — ad-hoc records are
  // neither carry sources nor influenced by being newest
  const previous =
    (await listInstances(boardId)).find((i) => i.when < whenIso && !i.isAdhoc) ?? null;

  const created = await Ben_ltkboardinstancesService.create({
    ben_name: `${board.name} — ${whenIso.slice(0, 16).replace("T", " ")}`,
    ben_boardid: boardId,
    ben_when: whenIso,
    ben_status: "open",
    ben_isadhoc: adhoc,
    ben_settingsjson: board.occurrenceSettingsRaw,
    "ben_Board@odata.bind": `/ben_ltkboards(${board.id})`,
  } as never);
  const instance = created.data ? fromRow(created.data) : null;
  if (!instance) throw new Error("instance create returned no row");
  await seedInstanceRows(boardId, manifest.slots, instance, previous);
  return instance;
}

/** Seed every slot's Card Data row per its policy (create + reset). */
async function seedInstanceRows(
  boardId: string,
  slots: ReturnType<typeof parseManifest>["slots"],
  instance: InstanceSummary,
  previous: InstanceSummary | null
): Promise<void> {
  for (const slot of slots) {
    if (isActionSurface(slot)) continue; // live actions table, no document
    const plan = seedPlan(slot);
    if (plan.ensureLiveRow) {
      await ensureLiveRow(boardId, plan.cardId, plan.cardType);
      // the per-instance row exists purely as the SVG archive target
      await createInstanceRow(instance.id, boardId, plan.cardId, plan.cardType, "", "");
      continue;
    }
    let outputJson = "";
    let tileSvg = "";
    if (plan.copyFromPrevious && previous) {
      const prevRow = await instanceRow(previous.id, plan.cardId);
      outputJson = prevRow?.outputJson ?? "";
      tileSvg = prevRow?.tileSvg ?? "";
    } else if (plan.linkSource) {
      const src = await liveRow(plan.linkSource.boardId, plan.linkSource.cardId);
      // link reads the source's latest content; fall back to its newest
      // instance row when the source card is not shared
      outputJson = src?.outputJson ?? "";
    }
    // standard content: the card's live (instance-less) row is its
    // design-time template — the standard agenda etc. It seeds clear
    // cards every meeting and carry cards that have nothing to carry.
    if (outputJson === "" && !plan.linkSource) {
      const template = await liveRow(boardId, plan.cardId);
      outputJson = template?.outputJson ?? "";
      if (tileSvg === "") tileSvg = template?.tileSvg ?? "";
    }
    await createInstanceRow(
      instance.id,
      boardId,
      plan.cardId,
      plan.cardType,
      outputJson,
      tileSvg
    );
  }
}

/** Save (or clear, with "") the instance's board-override manifest. */
export async function saveInstanceManifest(
  instanceGuid: string,
  manifestRaw: string
): Promise<void> {
  await Ben_ltkboardinstancesService.update(instanceGuid, {
    ben_manifestjson: manifestRaw,
  });
}

/** Close the meeting and stamp the shared-card SVG archive. */
export async function closeInstance(instance: InstanceSummary): Promise<void> {
  await Ben_ltkboardinstancesService.update(instance.id, { ben_status: "closed" });
  const board = await getBoard(instance.boardId);
  if (!board) return;
  const manifest = parseManifest(board.manifestRaw);
  for (const cardId of archiveSlots(manifest.slots)) {
    await stampArchiveSvg(instance.id, instance.boardId, cardId);
  }
}

/** Reopen a closed meeting so its cards can be edited again. */
export async function reopenInstance(instanceGuid: string): Promise<void> {
  await Ben_ltkboardinstancesService.update(instanceGuid, { ben_status: "open" });
}

/**
 * Reset a meeting back to its newly created state: delete the instance's
 * Card Data rows and reseed them per the data policies (carry, standard
 * content, links), exactly as createInstance would.
 */
export async function resetInstance(instance: InstanceSummary): Promise<void> {
  const board = await getBoard(instance.boardId);
  if (!board) throw new Error(`unknown board ${instance.boardId}`);
  const rows = await allWhere(
    Ben_ltkcarddatasService.getAll,
    `_ben_instance_value eq ${instance.id}`
  );
  for (const row of rows) {
    await Ben_ltkcarddatasService.delete(row.ben_ltkcarddataid);
  }
  const previous =
    (await listInstances(instance.boardId)).find(
      (i) => i.when < instance.when && !i.isAdhoc && i.id !== instance.id
    ) ?? null;
  await seedInstanceRows(
    instance.boardId,
    parseManifest(board.manifestRaw).slots,
    instance,
    previous
  );
  // a per-meeting adjusted layout resets along with the content
  if (instance.manifestRaw.trim() !== "") {
    await saveInstanceManifest(instance.id, "");
  }
}

/** Move a meeting record to a new scheduled datetime. */
export async function rescheduleInstance(
  instance: InstanceSummary,
  whenIso: string
): Promise<void> {
  const board = await getBoard(instance.boardId);
  await Ben_ltkboardinstancesService.update(instance.id, {
    ben_when: whenIso,
    ben_name: `${board?.name ?? instance.boardId} — ${whenIso.slice(0, 16).replace("T", " ")}`,
  });
}
