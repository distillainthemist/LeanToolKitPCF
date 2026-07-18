// Card Catalog self-heal — on app start, upsert one row per card type
// from the installed registry (CardSettings' catalogJSON) + the shipped
// default tile SVGs, keyed to the app version. The catalog can never
// drift from the deployed code.

import { buildCatalogJson } from "../../../controls/CardSettings/registry";
import tileDefaults from "../../../tools/tile-defaults.json";
import { Ben_ltkcardcatalogsService } from "../generated/services/Ben_ltkcardcatalogsService";
import { allWhere, eq, upsertWhere } from "./dv";

export const APP_VERSION = "0.1.0"; // bumped with releases; drives the heal

interface CatalogEntry {
  type: string;
  label: string;
  description: string;
}

export async function selfHealCatalog(): Promise<void> {
  const rows = await allWhere(Ben_ltkcardcatalogsService.getAll, undefined, [
    "ben_cardtype",
    "ben_solutionversion",
  ]);
  const healed = rows.every((r) => r.ben_solutionversion === APP_VERSION);
  if (healed && rows.length > 0) return;

  const entries = JSON.parse(buildCatalogJson()) as CatalogEntry[];
  const svgs = (tileDefaults as { tiles: Record<string, string> }).tiles;
  for (const entry of entries) {
    await upsertWhere(
      Ben_ltkcardcatalogsService,
      eq("ben_cardtype", entry.type),
      (row) => row.ben_ltkcardcatalogid,
      {
        ben_cardtype: entry.type,
        ben_name: entry.label,
        ben_label: entry.label,
        ben_description: entry.description.slice(0, 400),
        ben_defaultsvg: svgs[entry.type] ?? "",
        ben_solutionversion: APP_VERSION,
      }
    );
  }
}

export async function catalogSvgByType(): Promise<Record<string, string>> {
  const rows = await allWhere(Ben_ltkcardcatalogsService.getAll, undefined, [
    "ben_cardtype",
    "ben_defaultsvg",
  ]);
  return Object.fromEntries(rows.map((r) => [r.ben_cardtype, r.ben_defaultsvg ?? ""]));
}
