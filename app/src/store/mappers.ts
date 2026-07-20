// Pure row ↔ domain conversions (no IO — unit tested). The domain types
// are the toolkit's own schemas; JSON columns hold the nested structures
// verbatim per docs/actions-dataverse.md and master-leanboard.md.

import { LtkAction, sanitizeAction } from "../../../shared/schema/actions";
import type { Ben_ltkactionsBase, Ben_ltkactions } from "../generated/models/Ben_ltkactionsModel";
import type { Ben_ltkboards } from "../generated/models/Ben_ltkboardsModel";
import type { Ben_ltkpeoples } from "../generated/models/Ben_ltkpeoplesModel";
import type { Ben_ltksitesettingses } from "../generated/models/Ben_ltksitesettingsesModel";

// ---- boards ----

export interface BoardSummary {
  id: string; // Dataverse GUID
  boardId: string;
  name: string;
  kind: "meeting" | "project";
  category: string;
  site: string;
  department: string;
  isTemplate: boolean;
  isArchived: boolean;
  occurrenceSettingsRaw: string;
  manifestRaw: string;
  peopleRaw: string;
}

export function boardFromRow(row: Ben_ltkboards): BoardSummary {
  return {
    id: row.ben_ltkboardid,
    boardId: row.ben_boardid,
    name: row.ben_name ?? row.ben_boardid,
    kind: row.ben_boardkind === "project" ? "project" : "meeting",
    category: row.ben_category ?? "",
    site: row.ben_site ?? "",
    department: row.ben_department ?? "",
    isTemplate: row.ben_istemplate === true,
    isArchived: row.ben_isarchived === true,
    occurrenceSettingsRaw: row.ben_occurrencesettings ?? "",
    manifestRaw: row.ben_manifestjson ?? "",
    peopleRaw: row.ben_peoplejson ?? "",
  };
}

// ---- board manifest ----

export interface ManifestSlot {
  pos: number;
  w: number;
  h: number;
  nav: number;
  cardId: string;
  cardType: string;
  title: string;
  /** The slot's settings blob (object), incl. board.policy + theme. */
  settings: Record<string, unknown>;
}

export interface BoardManifest {
  grid: string;
  columnTitles: string[];
  slots: ManifestSlot[];
}

export function parseManifest(raw: string): BoardManifest {
  const empty: BoardManifest = { grid: "3", columnTitles: [], slots: [] };
  const t = raw.trim();
  if (t === "" || !t.startsWith("{")) return empty;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const slots: ManifestSlot[] = [];
    if (Array.isArray(o.slots)) {
      for (const item of o.slots) {
        if (!item || typeof item !== "object") continue;
        const s = item as Record<string, unknown>;
        const cardId = typeof s.cardId === "string" ? s.cardId : "";
        if (cardId === "") continue;
        const settings =
          s.settingsJSON && typeof s.settingsJSON === "object"
            ? (s.settingsJSON as Record<string, unknown>)
            : typeof s.settingsJSON === "string" && s.settingsJSON.trim().startsWith("{")
              ? (JSON.parse(s.settingsJSON) as Record<string, unknown>)
              : {};
        slots.push({
          pos: Number(s.pos) >= 1 ? Math.round(Number(s.pos)) : 0,
          w: Number(s.w) >= 1 ? Math.round(Number(s.w)) : 1,
          h: Number(s.h) >= 1 ? Math.round(Number(s.h)) : 1,
          nav: Number(s.nav) >= 1 ? Math.round(Number(s.nav)) : 0,
          cardId,
          cardType: typeof s.cardType === "string" ? s.cardType : "",
          title: typeof s.title === "string" ? s.title : "",
          settings,
        });
      }
    }
    return {
      grid: typeof o.grid === "string" && o.grid !== "" ? o.grid : "3",
      columnTitles: Array.isArray(o.columnTitles)
        ? o.columnTitles.map((v) => String(v ?? ""))
        : [],
      slots,
    };
  } catch {
    return empty;
  }
}

export function serializeManifest(manifest: BoardManifest): string {
  return JSON.stringify({
    grid: manifest.grid,
    columnTitles: manifest.columnTitles,
    slots: manifest.slots.map((s) => ({
      pos: s.pos,
      w: s.w,
      h: s.h,
      nav: s.nav,
      cardId: s.cardId,
      cardType: s.cardType,
      title: s.title,
      settingsJSON: s.settings,
    })),
  });
}

/** The slot's data policy, defaulted per the design (carry). */
export function slotPolicy(slot: ManifestSlot): "clear" | "carry" | "shared" | "link" {
  const board = (slot.settings.board ?? {}) as Record<string, unknown>;
  const policy = typeof board.policy === "string" ? board.policy : "";
  if (policy === "clear" || policy === "shared" || policy === "link") return policy;
  return "carry";
}

export function slotLinkSource(slot: ManifestSlot): { boardId: string; cardId: string } {
  const board = (slot.settings.board ?? {}) as Record<string, unknown>;
  const source = (board.source ?? {}) as Record<string, unknown>;
  return {
    boardId: typeof source.boardId === "string" ? source.boardId : "",
    cardId: typeof source.cardId === "string" ? source.cardId : "",
  };
}

// ---- actions ----

function parseJsonOr<T>(raw: string | undefined, fallback: T): T {
  const t = (raw ?? "").trim();
  if (t === "") return fallback;
  try {
    return JSON.parse(t) as T;
  } catch {
    return fallback;
  }
}

export function actionFromRow(row: Ben_ltkactions): LtkAction {
  return sanitizeAction({
    id: row.ben_actionid,
    instanceId: row.ben_instanceid ?? "",
    issue: row.ben_issue ?? "",
    description: row.ben_description ?? "",
    assignees: parseJsonOr(row.ben_assigneesjson, []),
    start: (row.ben_start ?? "").slice(0, 10),
    due: (row.ben_due ?? "").slice(0, 10),
    status: (row.ben_status as LtkAction["status"]) ?? "open",
    comments: parseJsonOr(row.ben_commentsjson, []),
    escalated: row.ben_escalated === true,
    acknowledged: parseJsonOr(row.ben_acknowledgedjson, undefined),
    context: {
      source: row.ben_source ?? "",
      sourceId: row.ben_sourceid ?? "",
      hint: row.ben_hint || undefined,
    },
  });
}

export function actionToRow(
  action: LtkAction,
  boardId?: string
): Partial<Ben_ltkactionsBase> {
  return {
    ben_actionid: action.id,
    ben_name: (action.issue || action.description).slice(0, 300),
    ben_instanceid: action.instanceId,
    // omit when unknown (e.g. hub edits across boards) so an update
    // never clobbers a stamped board id
    ...(boardId !== undefined ? { ben_boardid: boardId } : {}),
    ben_issue: action.issue.slice(0, 400),
    ben_description: action.description,
    ben_assigneesjson: JSON.stringify(action.assignees),
    ben_start: action.start !== "" ? action.start : undefined,
    ben_due: action.due !== "" ? action.due : undefined,
    ben_status: action.status,
    ben_commentsjson: JSON.stringify(action.comments),
    ben_escalated: action.escalated,
    ben_acknowledgedjson: action.acknowledged ? JSON.stringify(action.acknowledged) : "",
    ben_source: action.context.source,
    ben_sourceid: action.context.sourceId,
    ben_hint: action.context.hint ?? "",
  };
}

// ---- people ----

export interface RosterPerson {
  whoId: string;
  who: string;
  email: string;
  crew?: string;
  site: string;
  department: string;
  area: string;
  /** "user" (default) | "siteadmin" | "superadmin" */
  role: string;
  active: boolean;
}

export function personFromRow(row: Ben_ltkpeoples): RosterPerson {
  return {
    whoId: row.ben_whoid,
    who: row.ben_name ?? row.ben_whoid,
    email: row.ben_email ?? "",
    crew: row.ben_crew || undefined,
    site: row.ben_site ?? "",
    department: row.ben_department ?? "",
    area: row.ben_area ?? "",
    role: row.ben_role || "user",
    active: row.ben_active !== false,
  };
}

/** The peopleJSON shape every control consumes. */
export function toPeopleJson(people: RosterPerson[]): string {
  return JSON.stringify(
    people.map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
  );
}

// ---- site settings → org tree + protected times ----

export function orgTreeFromRows(rows: Ben_ltksitesettingses[]): unknown[] {
  return rows
    .map((r) => ({
      site: r.ben_site,
      departments: parseJsonOr<unknown[]>(r.ben_departments, []),
    }))
    .filter((s) => typeof s.site === "string" && s.site !== "");
}

export function protectedTimesForSite(
  rows: Ben_ltksitesettingses[],
  site: string
): string {
  const row = rows.find((r) => r.ben_site === site);
  return row?.ben_protectedtimes ?? "[]";
}
