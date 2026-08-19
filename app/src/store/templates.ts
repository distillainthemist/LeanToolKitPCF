// Improvement — initiative templates (ben_ltkinitiativetemplate) and the
// template board they lay their cards on (a project-kind board flagged
// isTemplate). Pure shape in improvement/templateModel.ts.

import { Ben_ltkinitiativetemplatesService } from "../generated/services/Ben_ltkinitiativetemplatesService";
import type { Ben_ltkinitiativetemplates } from "../generated/models/Ben_ltkinitiativetemplatesModel";
import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { allWhere, eq, upsertWhere } from "./dv";
import { getBoard } from "./boards";
import {
  InitiativeTemplate,
  parseFields,
  parseMetrics,
  parseRoles,
  parseStages,
  serializeStages,
} from "../improvement/templateModel";

function fromRow(r: Ben_ltkinitiativetemplates): InitiativeTemplate {
  const st = parseStages(r.ben_stagesjson ?? "");
  return {
    rowId: r.ben_ltkinitiativetemplateid,
    id: r.ben_templateid ?? "",
    name: r.ben_name ?? "",
    method: r.ben_method ?? "",
    description: r.ben_description ?? "",
    singleAction: r.ben_singleaction === true,
    active: r.ben_active !== false,
    order: typeof r.ben_order === "number" ? r.ben_order : 0,
    company: r.ben_company ?? "",
    stages: st.stages,
    completeGate: st.completeGate,
    roles: parseRoles(r.ben_rolesjson ?? ""),
    fields: parseFields(r.ben_fieldsjson ?? ""),
    metrics: parseMetrics(r.ben_metricsjson ?? ""),
    boardId: r.ben_boardid ?? "",
  };
}

export async function listTemplates(): Promise<InitiativeTemplate[]> {
  const rows = await allWhere(Ben_ltkinitiativetemplatesService.getAll, undefined, undefined, ["ben_order asc"]);
  return rows.map(fromRow).filter((t) => t.id !== "");
}

export async function getTemplate(id: string): Promise<InitiativeTemplate | null> {
  const rows = await allWhere(Ben_ltkinitiativetemplatesService.getAll, eq("ben_templateid", id));
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function saveTemplate(t: InitiativeTemplate): Promise<string> {
  const rowId = await upsertWhere(
    Ben_ltkinitiativetemplatesService,
    eq("ben_templateid", t.id),
    (row: Ben_ltkinitiativetemplates) => row.ben_ltkinitiativetemplateid,
    {
      ben_templateid: t.id,
      ben_name: t.name.slice(0, 200),
      ben_method: t.method,
      ben_description: t.description,
      ben_singleaction: t.singleAction,
      ben_active: t.active,
      ben_order: t.order,
      ben_company: t.company,
      ben_stagesjson: serializeStages(t.stages, t.completeGate),
      ben_rolesjson: JSON.stringify(t.roles),
      ben_fieldsjson: JSON.stringify(t.fields),
      ben_metricsjson: JSON.stringify(t.metrics),
      ben_boardid: t.boardId,
    }
  );
  return rowId;
}

export async function deleteTemplate(rowId: string): Promise<void> {
  await Ben_ltkinitiativetemplatesService.delete(rowId);
}

/** Create (or refresh the name of) the template's board: a project-kind
 *  board flagged isTemplate, seeded with a Canvas charter + Actions so the
 *  composer opens on something real. Returns the boardId. */
export async function ensureTemplateBoard(t: InitiativeTemplate): Promise<string> {
  const boardId = t.boardId !== "" ? t.boardId : `tpl-${t.id}`;
  const existing = await getBoard(boardId);
  const rand = () => Math.random().toString(36).slice(2, 6);
  await upsertWhere(
    Ben_ltkboardsService,
    eq("ben_boardid", boardId),
    (row) => row.ben_ltkboardid,
    {
      ben_boardid: boardId,
      ben_name: t.name !== "" ? `Template · ${t.name}` : `Template · ${t.id}`,
      ben_boardkind: "project",
      ben_istemplate: true,
      ...(existing
        ? {}
        : {
            ben_manifestjson: JSON.stringify({
              grid: "2",
              columnTitles: [],
              slots: [
                {
                  pos: 1, w: 1, h: 1, nav: 1,
                  cardId: `canvas-${rand()}`,
                  cardType: "CanvasCard",
                  title: "Charter",
                  settingsJSON: { template: { stage: t.stages[0]?.id ?? "", mandatory: true } },
                },
                {
                  pos: 2, w: 1, h: 1, nav: 2,
                  cardId: `actionboard-${rand()}`,
                  cardType: "ActionBoard",
                  title: "Action plan",
                  settingsJSON: { template: { stage: "", mandatory: true } },
                },
              ],
            }),
          }),
    }
  );
  return boardId;
}
