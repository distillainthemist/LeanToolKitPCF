// Document ingestion — the task store (ben_ltkingestiontask, decision 2
// of document-ingestion-proposal-2026-10.md). One row per task; the
// generated service is called directly, as tagProposals.ts does, and a
// refused call is thrown so the screen can say so.

import { Ben_ltkingestiontasksService } from "../generated/services/Ben_ltkingestiontasksService";
import { IngestionTask, IngestionTaskRow, rowFromTask, taskFromRow } from "./ingestionModel";

const fail = (what: string, err: unknown): never => {
  const msg = (err as { message?: unknown })?.message;
  throw new Error(`${what}: ${typeof msg === "string" ? msg : "refused"}`);
};

export async function listIngestionTasks(): Promise<IngestionTask[]> {
  const r = await Ben_ltkingestiontasksService.getAll({ top: 500 });
  if (r.success === false) fail("Could not read ingestion tasks", r.error);
  const rows = (r.data ?? []) as IngestionTaskRow[];
  return rows.map(taskFromRow);
}

/** Create or update; returns the row id. */
export async function saveIngestionTask(t: IngestionTask): Promise<string> {
  const fields = rowFromTask(t);
  if (t.rowId === "") {
    const r = await Ben_ltkingestiontasksService.create(fields as Parameters<typeof Ben_ltkingestiontasksService.create>[0]);
    if (r.success === false) fail("Could not create the ingestion task", r.error);
    const id = String((r.data as { ben_ltkingestiontaskid?: unknown } | undefined)?.ben_ltkingestiontaskid ?? "");
    t.rowId = id;
    return id;
  }
  const r = await Ben_ltkingestiontasksService.update(t.rowId, fields as Parameters<typeof Ben_ltkingestiontasksService.update>[1]);
  if (r.success === false) fail("Could not save the ingestion task", r.error);
  return t.rowId;
}

export async function deleteIngestionTask(rowId: string): Promise<void> {
  await Ben_ltkingestiontasksService.delete(rowId);
}
