// Value driver tree store (P9a): one row per node, one per saved
// scenario. Values + the change log ride JSON columns on the node.

import { Ben_ltkvaluedriversService } from "../generated/services/Ben_ltkvaluedriversService";
import type { Ben_ltkvaluedrivers } from "../generated/models/Ben_ltkvaluedriversModel";
import { Ben_ltkvdtscenariosService } from "../generated/services/Ben_ltkvdtscenariosService";
import type { Ben_ltkvdtscenarios } from "../generated/models/Ben_ltkvdtscenariosModel";
import { allWhere, eq, upsertWhere } from "./dv";
import {
  AGGREGATES,
  CADENCES,
  DriverNode,
  parseAssumed,
  parseFormat,
  parseHistory,
  parseScenarioToggles,
  parseValues,
  Scenario,
} from "../improvement/vdt/model";

function nodeFromRow(r: Ben_ltkvaluedrivers): DriverNode {
  const cadence = CADENCES.includes(r.ben_cadence as DriverNode["cadence"]) ? (r.ben_cadence as DriverNode["cadence"]) : "monthly";
  const aggregate = AGGREGATES.includes(r.ben_aggregate as DriverNode["aggregate"]) ? (r.ben_aggregate as DriverNode["aggregate"]) : "sum";
  return {
    rowId: r.ben_ltkvaluedriverid,
    id: r.ben_driverid ?? "",
    site: r.ben_site ?? "",
    parentId: r.ben_parentid ?? "",
    name: r.ben_name ?? "",
    definition: r.ben_definition ?? "",
    unit: r.ben_unit ?? "",
    source: r.ben_source ?? "",
    kind: r.ben_kind === "leading" ? "leading" : "driver",
    formula: r.ben_formula ?? "",
    cadence,
    aggregate,
    sourceUrl: r.ben_sourceurl ?? "",
    format: parseFormat(r.ben_formatjson ?? ""),
    order: typeof r.ben_order === "number" ? r.ben_order : 0,
    values: parseValues(r.ben_valuesjson ?? ""),
    history: parseHistory(r.ben_historyjson ?? ""),
  };
}

export async function listDrivers(site: string): Promise<DriverNode[]> {
  const rows = await allWhere(Ben_ltkvaluedriversService.getAll, site !== "" ? eq("ben_site", site) : undefined);
  return rows.map(nodeFromRow).filter((n) => n.id !== "");
}

export async function saveDriver(n: DriverNode): Promise<string> {
  const rowId = await upsertWhere(
    Ben_ltkvaluedriversService,
    eq("ben_driverid", n.id),
    (row: Ben_ltkvaluedrivers) => row.ben_ltkvaluedriverid,
    {
      ben_driverid: n.id,
      ben_name: n.name.slice(0, 200),
      ben_site: n.site,
      ben_parentid: n.parentId,
      ben_definition: n.definition,
      ben_unit: n.unit,
      ben_source: n.source,
      ben_sourceurl: n.sourceUrl,
      ben_kind: n.kind,
      ben_formula: n.formula,
      ben_cadence: n.cadence,
      ben_aggregate: n.aggregate,
      ben_formatjson: JSON.stringify(n.format),
      ben_order: n.order,
      ben_valuesjson: JSON.stringify(n.values),
      ben_historyjson: JSON.stringify(n.history),
    }
  );
  n.rowId = rowId;
  return rowId;
}

/** Delete a node AND its subtree (children first — never orphan). */
export async function deleteDriverTree(nodes: DriverNode[], id: string): Promise<void> {
  const kids = nodes.filter((n) => n.parentId === id);
  for (const k of kids) await deleteDriverTree(nodes, k.id);
  const n = nodes.find((x) => x.id === id);
  if (n?.rowId) await Ben_ltkvaluedriversService.delete(n.rowId);
}

// ---- scenarios ----------------------------------------------------------------

function scenarioFromRow(r: Ben_ltkvdtscenarios): Scenario {
  return {
    rowId: r.ben_ltkvdtscenarioid,
    id: r.ben_scenarioid ?? "",
    site: r.ben_site ?? "",
    period: r.ben_period ?? "",
    name: r.ben_name ?? "",
    authorId: r.ben_authorid ?? "",
    author: r.ben_author ?? "",
    at: r.ben_at ?? "",
    toggles: parseScenarioToggles(r.ben_togglesjson ?? ""),
    assumed: parseAssumed(r.ben_assumedjson ?? ""),
  };
}

export async function listScenarios(site: string): Promise<Scenario[]> {
  const rows = await allWhere(Ben_ltkvdtscenariosService.getAll, eq("ben_site", site), undefined, ["ben_at desc"]);
  return rows.map(scenarioFromRow).filter((s) => s.id !== "");
}

export async function saveScenario(s: Scenario): Promise<string> {
  const rowId = await upsertWhere(
    Ben_ltkvdtscenariosService,
    eq("ben_scenarioid", s.id),
    (row: Ben_ltkvdtscenarios) => row.ben_ltkvdtscenarioid,
    {
      ben_scenarioid: s.id,
      ben_name: s.name.slice(0, 200),
      ben_site: s.site,
      ben_period: s.period,
      ben_authorid: s.authorId,
      ben_author: s.author,
      ben_at: s.at,
      ben_togglesjson: JSON.stringify(s.toggles),
      ben_assumedjson: JSON.stringify(s.assumed),
    }
  );
  s.rowId = rowId;
  return rowId;
}

export async function deleteScenario(rowId: string): Promise<void> {
  await Ben_ltkvdtscenariosService.delete(rowId);
}
