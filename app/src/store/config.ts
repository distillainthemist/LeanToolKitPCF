// Site settings + user prefs IO — org tree assembly (per-site subtree
// rows → the orgJSON the wizard and hub share), protected times, and
// per-user preferences.

import { Ben_ltksitesettingsesService } from "../generated/services/Ben_ltksitesettingsesService";
import { Ben_ltkuserprefsesService } from "../generated/services/Ben_ltkuserprefsesService";
import { allWhere, eq, upsertWhere } from "./dv";
import { orgTreeFromRows, protectedTimesForSite } from "./mappers";

export async function orgJson(): Promise<string> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  return JSON.stringify(orgTreeFromRows(rows));
}

export async function protectedTimesJson(site: string): Promise<string> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", site));
  return protectedTimesForSite(rows, site);
}

export async function saveProtectedTimes(site: string, timesJson: string): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: site, ben_name: site, ben_protectedtimes: timesJson }
  );
}

export async function saveSiteDepartments(site: string, departmentsJson: string): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: site, ben_name: site, ben_departments: departmentsJson }
  );
}

export async function userPrefsJson(whoId: string): Promise<string> {
  const rows = await allWhere(Ben_ltkuserprefsesService.getAll, eq("ben_userid", whoId));
  return rows[0]?.ben_preferences ?? "";
}

export async function saveUserPrefs(whoId: string, prefsJson: string): Promise<void> {
  await upsertWhere(
    Ben_ltkuserprefsesService,
    eq("ben_userid", whoId),
    (row) => row.ben_ltkuserprefsid,
    { ben_userid: whoId, ben_name: whoId, ben_preferences: prefsJson }
  );
}
