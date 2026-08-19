// Cascaded priorities IO (plan P0): pillars, priorities, assignments and
// events over the generated services. Rows carry lookups as GUIDs while
// the model keys by business id (ben_pillarid / ben_priorityid), so this
// module bridges the two: reads resolve GUID → id through the loaded
// sets, writes bind by row GUID. Everything the screens need for one
// company arrives in ONE `loadCascade` call (a few hundred rows at most).

import { newId, nowIso } from "../../../shared/schema/id";
import type { Ben_ltkpillars } from "../generated/models/Ben_ltkpillarsModel";
import type { Ben_ltkpriorities } from "../generated/models/Ben_ltkprioritiesModel";
import type { Ben_ltkpriorityassignments } from "../generated/models/Ben_ltkpriorityassignmentsModel";
import type { Ben_ltkpriorityevents } from "../generated/models/Ben_ltkpriorityeventsModel";
import { Ben_ltkpillarsService } from "../generated/services/Ben_ltkpillarsService";
import { Ben_ltkprioritiesService } from "../generated/services/Ben_ltkprioritiesService";
import { Ben_ltkpriorityassignmentsService } from "../generated/services/Ben_ltkpriorityassignmentsService";
import { Ben_ltkpriorityeventsService } from "../generated/services/Ben_ltkpriorityeventsService";
import {
  AssignmentStatus,
  isAssignmentStatus,
  isPriorityStatus,
  OrgRef,
  Pillar,
  Priority,
  PriorityAssignment,
  PriorityEvent,
  PriorityEventKind,
} from "../priorities/model";
import { allWhere, eq } from "./dv";

function settle<R extends { success?: boolean; error?: { message?: string } }>(r: R, what: string): R {
  if (r.success === false) {
    throw new Error(`Dataverse ${what} failed: ${r.error?.message ?? "unknown error"}`);
  }
  return r;
}

const orgOf = (r: {
  ben_company?: string;
  ben_site?: string;
  ben_department?: string;
  ben_area?: string;
}): OrgRef => ({
  company: r.ben_company ?? "",
  site: r.ben_site ?? "",
  department: r.ben_department ?? "",
  area: r.ben_area ?? "",
});

const orgCols = (o: OrgRef) => ({
  ben_company: o.company,
  ben_site: o.site,
  ben_department: o.department,
  ben_area: o.area,
});

// ---- pillars ----------------------------------------------------------------

function pillarFromRow(row: Ben_ltkpillars, guidToId: Map<string, string>): Pillar {
  return {
    rowId: row.ben_ltkpillarid,
    id: row.ben_pillarid,
    name: row.ben_name ?? row.ben_pillarid,
    level: row.ben_level === 1 ? 1 : 2,
    parentId: guidToId.get(row._ben_parentpillar_value ?? "") ?? "",
    color: row.ben_color ?? "",
    order: typeof row.ben_order === "number" ? row.ben_order : 0,
    active: row.ben_active !== false,
    company: row.ben_company ?? "",
  };
}

export async function listPillars(): Promise<Pillar[]> {
  const rows = await allWhere(Ben_ltkpillarsService.getAll);
  const guidToId = new Map(rows.map((r) => [r.ben_ltkpillarid, r.ben_pillarid]));
  return rows.map((r) => pillarFromRow(r, guidToId));
}

/** Create or update a pillar; the parent binds by the parent's row GUID
 *  (looked up from the current list). Returns the row GUID. */
export async function savePillar(p: Pillar, all: Pillar[]): Promise<string> {
  const parent = p.parentId !== "" ? all.find((x) => x.id === p.parentId) : undefined;
  const fields = {
    ben_pillarid: p.id,
    ben_name: p.name.slice(0, 200),
    ben_level: p.level,
    ben_color: p.color,
    ben_order: p.order,
    ben_active: p.active,
    ben_company: p.company,
    "ben_ParentPillar@odata.bind": parent?.rowId ? `/ben_ltkpillars(${parent.rowId})` : undefined,
  } as never;
  if (p.rowId) {
    settle(await Ben_ltkpillarsService.update(p.rowId, fields), "pillar update");
    return p.rowId;
  }
  const r = settle(await Ben_ltkpillarsService.create(fields), "pillar create");
  return r.data?.ben_ltkpillarid ?? "";
}

export async function deletePillar(rowId: string): Promise<void> {
  await Ben_ltkpillarsService.delete(rowId); // the generated delete resolves void
}

// ---- the cascade (priorities + assignments) --------------------------------

function priorityFromRow(
  row: Ben_ltkpriorities,
  priorityGuidToId: Map<string, string>,
  pillarGuidToId: Map<string, string>
): Priority {
  return {
    rowId: row.ben_ltkpriorityid,
    id: row.ben_priorityid,
    statement: row.ben_statement ?? row.ben_name ?? "",
    org: orgOf(row),
    pillarId: pillarGuidToId.get(row._ben_pillar_value ?? "") ?? "",
    ownerId: row.ben_ownerid ?? "",
    ownerName: row.ben_ownername ?? "",
    period: row.ben_period ?? "",
    status: isPriorityStatus(row.ben_status) ? row.ben_status : "active",
    statusReason: row.ben_statusreason ?? "",
    parentId: priorityGuidToId.get(row._ben_parentpriority_value ?? "") ?? "",
    primaryInitiativeId: row.ben_primaryinitiativeid ?? "",
    order: typeof row.ben_order === "number" ? row.ben_order : 0,
    notes: row.ben_notes ?? "",
  };
}

function assignmentFromRow(
  row: Ben_ltkpriorityassignments,
  priorityGuidToId: Map<string, string>
): PriorityAssignment {
  return {
    id: row.ben_ltkpriorityassignmentid,
    priorityId: priorityGuidToId.get(row._ben_priority_value ?? "") ?? "",
    org: orgOf(row),
    status: isAssignmentStatus(row.ben_status) ? row.ben_status : "proposed",
    reason: row.ben_reason ?? "",
    decidedById: row.ben_decidedbyid ?? "",
    decidedByName: row.ben_decidedbyname ?? "",
    decidedAt: row.ben_decidedat ?? "",
    childPriorityId: row.ben_childpriorityid ?? "",
  };
}

export interface CascadeData {
  pillars: Pillar[];
  priorities: Priority[];
  assignments: PriorityAssignment[];
}

/** Everything the priorities screens need for one company, in one go
 *  (three reads, run together). Company "" = all rows. */
export async function loadCascade(company: string): Promise<CascadeData> {
  const filter = company !== "" ? eq("ben_company", company) : undefined;
  const [pillarRows, priorityRows, assignmentRows] = await Promise.all([
    allWhere(Ben_ltkpillarsService.getAll, filter),
    allWhere(Ben_ltkprioritiesService.getAll, filter),
    allWhere(Ben_ltkpriorityassignmentsService.getAll, filter),
  ]);
  const pillarGuidToId = new Map(pillarRows.map((r) => [r.ben_ltkpillarid, r.ben_pillarid]));
  const priorityGuidToId = new Map(
    priorityRows.map((r) => [r.ben_ltkpriorityid, r.ben_priorityid])
  );
  return {
    pillars: pillarRows.map((r) => pillarFromRow(r, pillarGuidToId)),
    priorities: priorityRows.map((r) => priorityFromRow(r, priorityGuidToId, pillarGuidToId)),
    assignments: assignmentRows.map((r) => assignmentFromRow(r, priorityGuidToId)),
  };
}

/** Create or update a priority. Lookups bind by the referenced rows'
 *  GUIDs, resolved from `data` (which must include them). Returns the
 *  row GUID. */
export async function savePriority(p: Priority, data: CascadeData): Promise<string> {
  const pillar = p.pillarId !== "" ? data.pillars.find((x) => x.id === p.pillarId) : undefined;
  const parent = p.parentId !== "" ? data.priorities.find((x) => x.id === p.parentId) : undefined;
  const fields = {
    ben_priorityid: p.id,
    ben_name: p.statement.slice(0, 400),
    ben_statement: p.statement,
    ...orgCols(p.org),
    ben_ownerid: p.ownerId,
    ben_ownername: p.ownerName,
    ben_period: p.period,
    ben_status: p.status,
    ben_statusreason: p.statusReason,
    ben_order: p.order,
    ben_primaryinitiativeid: p.primaryInitiativeId,
    ben_notes: p.notes,
    "ben_Pillar@odata.bind": pillar?.rowId ? `/ben_ltkpillars(${pillar.rowId})` : undefined,
    "ben_ParentPriority@odata.bind": parent?.rowId
      ? `/ben_ltkpriorities(${parent.rowId})`
      : undefined,
  } as never;
  if (p.rowId) {
    settle(await Ben_ltkprioritiesService.update(p.rowId, fields), "priority update");
    return p.rowId;
  }
  const r = settle(await Ben_ltkprioritiesService.create(fields), "priority create");
  return r.data?.ben_ltkpriorityid ?? "";
}

/** A fresh priority object (id minted here; rowId assigned on save). */
export function newPriority(org: OrgRef, period: string): Priority {
  return {
    id: newId("pr"),
    statement: "",
    org,
    pillarId: "",
    ownerId: "",
    ownerName: "",
    period,
    status: "active",
    statusReason: "",
    parentId: "",
    primaryInitiativeId: "",
    order: 0,
    notes: "",
  };
}

/** Create or update an assignment (the priority binds by its row GUID). */
export async function saveAssignment(a: PriorityAssignment, data: CascadeData): Promise<string> {
  const priority = data.priorities.find((x) => x.id === a.priorityId);
  if (!priority?.rowId) throw new Error("Assignment for an unsaved priority.");
  const fields = {
    ben_name: `${priority.statement.slice(0, 200)} → ${a.org.area || a.org.department || a.org.site || a.org.company}`.slice(0, 400),
    ...orgCols(a.org),
    ben_status: a.status,
    ben_reason: a.reason,
    ben_decidedbyid: a.decidedById,
    ben_decidedbyname: a.decidedByName,
    ben_decidedat: a.decidedAt !== "" ? a.decidedAt : undefined,
    ben_childpriorityid: a.childPriorityId,
    "ben_Priority@odata.bind": `/ben_ltkpriorities(${priority.rowId})`,
  } as never;
  if (a.id !== "") {
    settle(await Ben_ltkpriorityassignmentsService.update(a.id, fields), "assignment update");
    return a.id;
  }
  const r = settle(await Ben_ltkpriorityassignmentsService.create(fields), "assignment create");
  return r.data?.ben_ltkpriorityassignmentid ?? "";
}

/** The receiving org's decision on a cascade. */
export async function decideAssignment(
  a: PriorityAssignment,
  status: AssignmentStatus,
  reason: string,
  by: { whoId: string; who: string },
  childPriorityId: string,
  data: CascadeData
): Promise<void> {
  await saveAssignment(
    {
      ...a,
      status,
      reason,
      decidedById: by.whoId,
      decidedByName: by.who,
      decidedAt: nowIso(),
      childPriorityId,
    },
    data
  );
}

export async function deleteAssignment(rowId: string): Promise<void> {
  await Ben_ltkpriorityassignmentsService.delete(rowId);
}

// ---- events -----------------------------------------------------------------

function eventFromRow(row: Ben_ltkpriorityevents, priorityId: string): PriorityEvent {
  let detail: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.ben_detailjson ?? "") as unknown;
    if (parsed && typeof parsed === "object") detail = parsed as Record<string, unknown>;
  } catch {
    /* empty detail */
  }
  return {
    id: row.ben_ltkpriorityeventid,
    priorityId,
    kind: (row.ben_kind ?? "edited") as PriorityEventKind,
    detail,
    actorId: row.ben_actorid ?? "",
    actorName: row.ben_actorname ?? "",
    at: row.ben_at ?? "",
  };
}

export async function listEvents(priority: Priority): Promise<PriorityEvent[]> {
  if (!priority.rowId) return [];
  const rows = await allWhere(
    Ben_ltkpriorityeventsService.getAll,
    `_ben_priority_value eq ${priority.rowId}`,
    undefined,
    ["ben_at desc"]
  );
  return rows.map((r) => eventFromRow(r, priority.id));
}

export async function appendEvent(
  priority: Priority,
  kind: PriorityEventKind,
  detail: Record<string, unknown>,
  actor: { whoId: string; who: string }
): Promise<void> {
  if (!priority.rowId) return;
  settle(
    await Ben_ltkpriorityeventsService.create({
      ben_name: `${kind} · ${priority.statement.slice(0, 120)}`.slice(0, 400),
      ben_kind: kind,
      ben_detailjson: JSON.stringify(detail),
      ben_actorid: actor.whoId,
      ben_actorname: actor.who,
      ben_at: nowIso(),
      "ben_Priority@odata.bind": `/ben_ltkpriorities(${priority.rowId})`,
    } as never),
    "event create"
  );
}
