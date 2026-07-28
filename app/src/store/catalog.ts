// Card Catalog self-heal — on app start, upsert one row per card type
// from the installed registry (CardSettings' catalogJSON) + the shipped
// default tile SVGs, keyed to the app version. The catalog can never
// drift from the deployed code.

import { buildCatalogJson } from "../../../controls/CardSettings/registry";
import { Ben_ltkcardcatalogsService } from "../generated/services/Ben_ltkcardcatalogsService";
import { allWhere, eq, upsertWhere } from "./dv";

// Drives the heal: selfHealCatalog() skips a catalog already stamped with
// this value, so it MUST change whenever tools/tile-defaults.json is
// regenerated (app/tile-defaults.html) or the new tiles never land.
export const APP_VERSION = "0.1.4"; // DocsCard + DocHealth tiles added

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
  // Loaded HERE rather than imported at the top: the defaults are ~290KB —
  // 96% of this module's chunk — and are needed only on the rare open that
  // actually heals. A static import shipped them to every user on every
  // load to be thrown away. Vite emits them as their own chunk, fetched
  // only when this line runs.
  const { tiles: svgs } = (await import("../../../tools/tile-defaults.json"))
    .default as { tiles: Record<string, string> };
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
