// Actions IO — the central table on the standard channel: rollups for
// cards, boards and the viewer; upsert by action id (the alternate key's
// purpose, emulated through the generated client).

import { actionVisibleTo, LtkAction, visibleSetFor } from "../../../shared/schema/actions";
import { bumpChange } from "./changes";
import { Ben_ltkactionsService } from "../generated/services/Ben_ltkactionsService";
import { allWhere, eq, odata, upsertWhere } from "./dv";
import { actionFromRow, actionToRow, parseManifest } from "./mappers";
import { currentViewer } from "../runtime";
import { memoRead } from "./changes";
import { parseMeetingInfo } from "../../../shared/schema/meeting";

// ---- confidential actions (2026-09-16): ONE choke point for every read ----
//
// A confidential action is seen by its creator, its assignees, their direct
// managers and super admins. Every read below passes through `visible`, so
// every surface — boards, badges, the hub, the Gantt, roll-ups, tiles —
// inherits it without knowing. App-level confidentiality, like initiatives:
// the row stays readable through Dataverse itself.

async function viewerContext(): Promise<{ whoId: string; superAdmin: boolean }> {
  const whoId = currentViewer()?.objectId ?? "";
  if (whoId === "") return { whoId, superAdmin: false };
  const role = await memoRead("people", `role|${whoId}`, () => import("./people").then((m) => m.viewerRole(whoId))).catch(() => "user");
  return { whoId, superAdmin: role === "superadmin" };
}

async function visible(actions: LtkAction[]): Promise<LtkAction[]> {
  if (!actions.some((a) => a.confidential === true)) return actions;
  const v = await viewerContext();
  return actions.filter((a) => actionVisibleTo(a, v.whoId, v.superAdmin));
}

export async function actionsForInstance(instanceId: string): Promise<LtkAction[]> {
  const rows = await allWhere(Ben_ltkactionsService.getAll, eq("ben_instanceid", instanceId));
  return visible(rows.map(actionFromRow));
}

export async function actionsForBoard(boardId: string): Promise<LtkAction[]> {
  const rows = await allWhere(Ben_ltkactionsService.getAll, eq("ben_boardid", boardId));
  return visible(rows.map(actionFromRow));
}

/** The initiative an action belongs to, from the board it lives on
 *  (`init-<initiativeId>` boards). "" when it isn't an initiative board. */
async function initiativeIdForBoard(boardId: string): Promise<string> {
  if (!boardId.startsWith("init-")) return "";
  const { listInitiatives } = await import("./initiatives");
  const i = (await listInitiatives().catch(() => [])).find((x) => x.boardId === boardId);
  return i?.id ?? "";
}

/** The board an action lives on: the stamped one, else the instance key's
 *  prefix ("board:card"; the hub's personal keys don't count). */
function boardOf(action: LtkAction, boardId?: string): string {
  if (boardId) return boardId;
  const k = action.instanceId;
  if (k.includes(":") && !k.startsWith("hub")) return k.split(":")[0];
  return "";
}

/** Rows written before the initiative id was stamped at the write: heal
 *  them once per session (fire-and-forget, chunked). */
const healed = new Set<string>();
async function healInitiativeIds(actions: LtkAction[]): Promise<void> {
  const fixed = actions.filter((a) => a.initiativeId && !healed.has(a.id));
  for (const a of fixed) healed.add(a.id);
  for (let i = 0; i < fixed.length; i += 10) {
    await Promise.all(fixed.slice(i, i + 10).map((a) => upsertWhere(Ben_ltkactionsService, eq("ben_actionid", a.id), (row) => row.ben_ltkactionid, { ben_initiativeid: a.initiativeId ?? "" }).catch(() => undefined)));
  }
}

/** Every action linked to ANY initiative — one query for the cascade's
 *  R/A/G rollups and the Improvement rows (P6b). Reads the stamped id AND
 *  (2026-09-23) anything living on an initiative board, healing the id
 *  onto rows that predate the stamp. */
export async function actionsForInitiatives(): Promise<LtkAction[]> {
  const rows = await allWhere(
    Ben_ltkactionsService.getAll,
    "(ben_initiativeid ne null and ben_initiativeid ne '') or startswith(ben_boardid,'init-') or startswith(ben_instanceid,'init-')"
  );
  const actions = rows.map(actionFromRow);
  // in-memory first (this read sees them right), then the rows
  for (const a of actions) if (!a.initiativeId && boardOf(a).startsWith("init-")) a.initiativeId = await initiativeIdForBoard(boardOf(a));
  // rows that lacked the id but resolved to one: write it back once
  void healInitiativeIds(actions.filter((a) => a.initiativeId && !rows.find((r) => r.ben_actionid === a.id)?.ben_initiativeid)).catch(() => undefined);
  return visible(actions);
}

/** The viewer's rollup for LeanHub — their whoId appears in assignees. */
export async function actionsForViewer(whoId: string): Promise<LtkAction[]> {
  const rows = await allWhere(
    Ben_ltkactionsService.getAll,
    `contains(ben_assigneesjson, '${odata(`"whoId":"${whoId}"`)}')`
  );
  return visible(rows.map(actionFromRow));
}

/** Every open action (not done / cancelled) — the Actions tab's
 *  organisation scope filters these by assignee placement. */
export async function openActions(): Promise<LtkAction[]> {
  const rows = await allWhere(Ben_ltkactionsService.getAll, "ben_status ne 'done' and ben_status ne 'cancelled'");
  return visible(rows.map(actionFromRow));
}

/** The owners of boards whose Escalation viewer sources `boardId` — an
 *  escalated confidential action extends its visibility to them (Ben's
 *  decision 4, 2026-09-16). */
async function escalationTargetOwners(boardId: string): Promise<string[]> {
  if (boardId === "") return [];
  const boards = await memoRead("boards", "all", () => import("./boards").then((m) => m.listBoards())).catch(() => []);
  const out: string[] = [];
  for (const b of boards) {
    const slots = parseManifest(b.manifestRaw).slots;
    const sources = slots.filter((s) => s.cardType === "EscalationViewer").some((s) => JSON.stringify((s.settings.config ?? {}) as Record<string, unknown>).includes(boardId));
    if (!sources) continue;
    const owner = parseMeetingInfo(b.occurrenceSettingsRaw)?.owner?.whoId ?? "";
    if (owner !== "") out.push(owner);
  }
  return out;
}

/** Stamp the creator and, for a confidential action, its visible set
 *  (creator + assignees + their managers + escalation targets). */
async function stampVisibility(action: LtkAction, boardId?: string): Promise<void> {
  const me = currentViewer()?.objectId ?? "";
  if (!action.createdBy && me !== "") action.createdBy = me;
  if (action.confidential !== true) {
    delete action.visibleTo;
    return;
  }
  const { managerOf } = await import("./people");
  const managers = new Map<string, string>();
  await Promise.all(action.assignees.map(async (x) => managers.set(x.whoId, await managerOf(x.whoId).catch(() => ""))));
  const extra = action.escalated ? await escalationTargetOwners(boardId ?? "").catch(() => []) : [];
  action.visibleTo = visibleSetFor(action, (id) => managers.get(id) ?? "", extra);
}

/** Upsert the emitted set — one row per action, keyed by action id. */
export async function upsertActions(
  actions: LtkAction[],
  boardId?: string
): Promise<void> {
  for (const action of actions) {
    // ANY action raised on an initiative board belongs to that initiative
    // (Ben, 2026-09-23) — stamped here, at the one write path
    const home = boardOf(action, boardId);
    if (!action.initiativeId && home.startsWith("init-")) action.initiativeId = await initiativeIdForBoard(home);
    await stampVisibility(action, boardId);
    await upsertWhere(
      Ben_ltkactionsService,
      eq("ben_actionid", action.id),
      (row) => row.ben_ltkactionid,
      actionToRow(action, boardId)
    );
  }
  bumpChange("actions");
}
