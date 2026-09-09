// Improvement — initiatives (ben_ltkinitiative) + their event history
// (ben_ltkinitiativeevent). Pure shape in improvement/initiativeModel.ts.
// createInitiative clones the template's MANDATORY slots into a fresh
// project board (design 1.3: "lands on the new board with the first stage
// current and its mandatory cards created"); optional cards are offered
// later from the template (P6's ＋ Add card from template).

import { Ben_ltkinitiativesService } from "../generated/services/Ben_ltkinitiativesService";
import type { Ben_ltkinitiatives } from "../generated/models/Ben_ltkinitiativesModel";
import { Ben_ltkinitiativeeventsService } from "../generated/services/Ben_ltkinitiativeeventsService";
import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { allWhere, eq, upsertWhere } from "./dv";
import { getBoard } from "./boards";
import { parseManifest } from "./mappers";
import { newId, nowIso } from "../../../shared/schema/id";
import {
  Initiative,
  parsePendingGate,
  parsePriorityLinks,
  parseRolesJson,
  parseSnapshot,
  parseStringMap,
  snapshotOf,
  stageTargetsFrom,
} from "../improvement/initiativeModel";
import { TemplateMetric, InitiativeTemplate, parseMetrics, slotFlags } from "../improvement/templateModel";

function fromRow(r: Ben_ltkinitiatives): Initiative {
  const snapshot = parseSnapshot(r.ben_snapshotjson ?? "");
  return {
    rowId: r.ben_ltkinitiativeid,
    id: r.ben_initiativeid ?? "",
    title: r.ben_name ?? "",
    templateId: r.ben_templateid ?? "",
    method: r.ben_method ?? "",
    description: r.ben_description ?? "",
    singleAction: r.ben_singleaction === true,
    org: {
      company: r.ben_company ?? "",
      site: r.ben_site ?? "",
      department: r.ben_department ?? "",
      area: r.ben_area ?? "",
    },
    stageId: r.ben_stage ?? "",
    status: r.ben_status === "completed" || r.ben_status === "archived" ? r.ben_status : "active",
    confidential: r.ben_confidential === true,
    flag: r.ben_flag === "flag" || r.ben_flag === "escalated" ? r.ben_flag : "",
    flagNote: r.ben_flagnote ?? "",
    endorsement: r.ben_endorsement === true,
    period: r.ben_period ?? "",
    boardId: r.ben_boardid ?? "",
    snapshot,
    roles: parseRolesJson(r.ben_rolesjson ?? ""),
    priorities: parsePriorityLinks(r.ben_prioritiesjson ?? ""),
    fieldValues: parseStringMap(r.ben_fieldsjson ?? ""),
    metrics: parseMetrics(r.ben_metricsjson ?? ""),
    gate: parsePendingGate(r.ben_gatejson ?? ""),
    stageTargets: parseStringMap(r.ben_stagetargetsjson ?? ""),
  };
}

export async function listInitiatives(): Promise<Initiative[]> {
  const rows = await allWhere(Ben_ltkinitiativesService.getAll);
  return rows.map(fromRow).filter((i) => i.id !== "");
}

/** Remove a deleted priority's links from every initiative carrying it;
 *  a removed primary promotes the first remaining link. */
export async function unlinkPriorityEverywhere(priorityId: string): Promise<number> {
  const all = await listInitiatives();
  let n = 0;
  for (const i of all) {
    if (!i.priorities.some((l) => l.priorityId === priorityId)) continue;
    const wasPrimary = i.priorities.find((l) => l.priorityId === priorityId)?.primary === true;
    i.priorities = i.priorities.filter((l) => l.priorityId !== priorityId);
    if (wasPrimary && i.priorities.length > 0) i.priorities[0].primary = true;
    await saveInitiative(i);
    n++;
  }
  return n;
}

export async function saveInitiative(i: Initiative): Promise<string> {
  return upsertWhere(
    Ben_ltkinitiativesService,
    eq("ben_initiativeid", i.id),
    (row: Ben_ltkinitiatives) => row.ben_ltkinitiativeid,
    {
      ben_initiativeid: i.id,
      ben_name: i.title.slice(0, 300),
      ben_templateid: i.templateId,
      ben_method: i.method,
      ben_description: i.description,
      ben_singleaction: i.singleAction,
      ben_company: i.org.company,
      ben_site: i.org.site,
      ben_department: i.org.department,
      ben_area: i.org.area,
      ben_stage: i.stageId,
      ben_status: i.status,
      ben_confidential: i.confidential,
      ben_flag: i.flag,
      ben_flagnote: i.flagNote.slice(0, 400),
      ben_endorsement: i.endorsement,
      ben_period: i.period,
      ben_boardid: i.boardId,
      ben_snapshotjson: JSON.stringify(i.snapshot),
      ben_rolesjson: JSON.stringify(i.roles),
      ben_prioritiesjson: JSON.stringify(i.priorities),
      ben_fieldsjson: JSON.stringify(i.fieldValues),
      ben_metricsjson: JSON.stringify(i.metrics),
      ben_gatejson: i.gate ? JSON.stringify(i.gate) : "",
      ben_stagetargetsjson: JSON.stringify(i.stageTargets),
    }
  );
}

export async function appendInitiativeEvent(
  i: Initiative,
  kind: string,
  detail: Record<string, unknown>,
  actor: { whoId: string; who: string }
): Promise<void> {
  if (!i.rowId) return;
  await Ben_ltkinitiativeeventsService.create({
    ben_name: `${kind} · ${i.title.slice(0, 120)}`.slice(0, 400),
    ben_kind: kind,
    ben_detailjson: JSON.stringify(detail),
    ben_actorid: actor.whoId,
    ben_actorname: actor.who,
    ben_at: nowIso(),
    "ben_Initiative@odata.bind": `/ben_ltkinitiatives(${i.rowId})`,
  } as never);
}

export interface InitiativeEvent {
  kind: string;
  detail: Record<string, unknown>;
  actorId: string;
  actorName: string;
  at: string;
}

export async function listInitiativeEvents(i: Initiative): Promise<InitiativeEvent[]> {
  if (!i.rowId) return [];
  const rows = await allWhere(Ben_ltkinitiativeeventsService.getAll, `_ben_initiative_value eq ${i.rowId}`, undefined, ["ben_at desc"]);
  return rows.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      const o = JSON.parse(r.ben_detailjson ?? "{}") as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) detail = o as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return { kind: r.ben_kind ?? "", detail, actorId: r.ben_actorid ?? "", actorName: r.ben_actorname ?? "", at: r.ben_at ?? "" };
  });
}

/** Create an initiative from a template: snapshot, stage targets, and —
 *  unless single-action — a fresh project board holding the template's
 *  MANDATORY cards (stage tags kept for P6's current-stage filter). */
export async function createInitiative(
  t: InitiativeTemplate,
  header: Omit<
    Initiative,
    "rowId" | "id" | "templateId" | "method" | "singleAction" | "snapshot" | "stageId" | "boardId" | "gate" | "stageTargets" | "status"
  >,
  actor: { whoId: string; who: string }
): Promise<Initiative> {
  const created = nowIso();
  const i: Initiative = {
    ...header,
    id: newId("in"),
    templateId: t.id,
    method: t.method,
    singleAction: t.singleAction,
    status: "active",
    stageId: t.stages[0]?.id ?? "",
    boardId: "",
    snapshot: snapshotOf(t),
    gate: null,
    stageTargets: stageTargetsFrom(t.stages, created),
  };
  if (!t.singleAction && t.boardId !== "") {
    const tplBoard = await getBoard(t.boardId);
    if (tplBoard) {
      const manifest = parseManifest(tplBoard.manifestRaw);
      // mandatory cards only; the charter and the action plan always come
      const keep = manifest.slots.filter((s) => {
        const f = slotFlags(s.settings);
        return f.mandatory || s.cardType === "CanvasCard" || s.cardType === "ActionBoard";
      });
      const boardId = `init-${i.id}`;
      const slots = keep.map((s, idx) => ({
        pos: idx + 1,
        w: s.w,
        h: s.h,
        nav: idx + 1,
        cardId: s.cardId,
        cardType: s.cardType,
        title: s.title,
        // the initiative's action plan gets the Verify column + reschedule
        // reasons (design 2.4) whatever the template author set
        settingsJSON:
          s.cardType === "ActionBoard"
            ? {
                ...s.settings,
                config: { ...((s.settings.config ?? {}) as Record<string, unknown>), view: "kanban", verifyColumn: true, rescheduleReasons: true },
              }
            : s.settings,
      }));
      // ONE Metrics card for the initiative (Ben, 2026-09-08), one by one,
      // second after the charter; it lists the metrics from the definition
      // so a metric added later appears without touching the board
      slots.splice(Math.min(1, slots.length), 0, metricsCardSlot());
      slots.forEach((s, k) => {
        s.pos = k + 1;
        s.nav = k + 1;
      });
      await upsertWhere(
        Ben_ltkboardsService,
        eq("ben_boardid", boardId),
        (row) => row.ben_ltkboardid,
        {
          ben_boardid: boardId,
          ben_name: i.title !== "" ? i.title : boardId,
          ben_boardkind: "project",
          ben_site: i.org.site,
          ben_department: i.org.department,
          ben_manifestjson: JSON.stringify({
            grid: String(manifest.grid ?? "2"),
            columnTitles: manifest.columnTitles,
            slots,
          }),
        }
      );
      i.boardId = boardId;
    }
  }
  i.rowId = await saveInitiative(i);
  await appendInitiativeEvent(i, "created", { template: t.name, method: t.method }, actor);
  return i;
}

/** The initiative's Metrics card slot (1×1). */
export function metricsCardSlot(): { pos: number; w: number; h: number; nav: number; cardId: string; cardType: string; title: string; settingsJSON: Record<string, unknown> } {
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    pos: 2,
    w: 1,
    h: 1,
    nav: 2,
    cardId: `metrics-${rand}`,
    cardType: "MetricsCard",
    title: "Metrics",
    settingsJSON: { template: { stage: "", mandatory: true }, config: {} },
  };
}

/** The KPI-trend slot a metric gets on the initiative board — titled with
 *  the metric and its target; `metric.key` ties the card to its
 *  definition (the RAG roll-up and the register read it back). */
export function metricCardSlot(m: TemplateMetric, index: number): { pos: number; w: number; h: number; nav: number; cardId: string; cardType: string; title: string; settingsJSON: Record<string, unknown> } {
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    pos: index + 1,
    w: 1,
    h: 1,
    nav: index + 1,
    cardId: `kpi-${rand}`,
    cardType: "KpiTrendCard",
    title: `${m.name}${m.unit !== "" ? ` (${m.unit})` : ""}${m.target !== null ? ` → ${m.target}` : ""}`,
    settingsJSON: {
      template: { stage: "", mandatory: true },
      metric: { key: m.key },
      // the card's own spec starts as the metric's (owners may tune it there)
      config: {
        ...(m.target !== null ? { target: m.target } : {}),
        ...(typeof m.usl === "number" ? { usl: m.usl } : {}),
        ...(typeof m.lsl === "number" ? { lsl: m.lsl } : {}),
        ...(m.unit !== "" ? { unit: m.unit } : {}),
        ...(m.cadence ? { cadence: m.cadence } : {}),
        ...(m.rows ? { showPlan: m.rows.plan, showForecast: m.rows.forecast, showLsl: m.rows.lsl, showUsl: m.rows.usl } : {}),
      },
    },
  };
}

/** After editing an initiative's metrics (rework 2026-09-03): a card for
 *  every metric that lacks one; a removed metric's card goes only when
 *  it has no series points. Returns what was kept for the dialog. */
export async function ensureMetricCards(i: Initiative): Promise<{ added: number; removed: number; kept: string[] }> {
  if (i.boardId === "") return { added: 0, removed: 0, kept: [] };
  const [{ getBoard, saveManifest }, { parseManifest }, { hasAnySeries }] = await Promise.all([
    import("./boards"),
    import("./mappers"),
    import("./series"),
  ]);
  const board = await getBoard(i.boardId);
  if (!board) return { added: 0, removed: 0, kept: [] };
  const manifest = parseManifest(board.manifestRaw);
  // the Metrics card reads the definition, so the board needs exactly one
  // of it and no per-metric cards (2026-09-08); single KPI cards that
  // already exist stay (the Metrics card adopts their series)
  if (!manifest.slots.some((sl) => sl.cardType === "MetricsCard")) {
    const slot = metricsCardSlot();
    manifest.slots.splice(Math.min(1, manifest.slots.length), 0, { pos: slot.pos, w: slot.w, h: slot.h, nav: slot.nav, cardId: slot.cardId, cardType: slot.cardType, title: slot.title, settings: slot.settingsJSON } as (typeof manifest.slots)[number]);
    manifest.slots.forEach((s, k) => {
      s.pos = k + 1;
      s.nav = k + 1;
    });
    await saveManifest(board.id, manifest);
    return { added: 1, removed: 0, kept: [] };
  }
  void hasAnySeries;
  return { added: 0, removed: 0, kept: [] };
}
