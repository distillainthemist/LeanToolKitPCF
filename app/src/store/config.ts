// Site settings + user prefs IO — org tree assembly (per-site subtree
// rows → the orgJSON the wizard and hub share), protected times, and
// per-user preferences.

import { Ben_ltksitesettingsesService } from "../generated/services/Ben_ltksitesettingsesService";
import { Ben_ltkuserprefsesService } from "../generated/services/Ben_ltkuserprefsesService";
import { allWhere, eq, upsertWhere } from "./dv";
import { orgTreeFromRows, protectedTimesForSite } from "./mappers";

/** Reserved sitesettings row that carries app-level branding. */
export const APP_ROW = "__app__";

export async function orgJson(): Promise<string> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  return JSON.stringify(orgTreeFromRows(rows.filter((r) => r.ben_site !== APP_ROW)));
}

export interface Branding {
  appName: string;
  logo: string; // data URI or ""
  accent: string;
}

export async function branding(): Promise<Branding> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", APP_ROW));
  const r = rows[0];
  return {
    appName: r?.ben_appname ?? "",
    logo: r?.ben_logo ?? "",
    accent: r?.ben_accent ?? "",
  };
}

export async function saveBranding(b: Branding): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", APP_ROW),
    (row) => row.ben_ltksitesettingsid,
    {
      ben_site: APP_ROW,
      ben_name: "App branding",
      ben_appname: b.appName,
      ben_logo: b.logo,
      ben_accent: b.accent,
    }
  );
}

/**
 * The company level above sites (multi-site businesses). The canonical
 * list lives on the app row; each site row carries its ben_company. A
 * company mentioned on a site but missing from the list still shows.
 */
export async function companies(): Promise<string[]> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  const listed: string[] = (() => {
    try {
      const arr = JSON.parse(
        rows.find((r) => r.ben_site === APP_ROW)?.ben_companies ?? "[]"
      );
      return Array.isArray(arr) ? arr.filter((v) => typeof v === "string" && v !== "") : [];
    } catch {
      return [];
    }
  })();
  for (const r of rows) {
    const c = (r.ben_company ?? "").trim();
    if (r.ben_site !== APP_ROW && c !== "" && !listed.includes(c)) listed.push(c);
  }
  return listed;
}

export async function saveCompanies(list: string[]): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", APP_ROW),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: APP_ROW, ben_name: "App branding", ben_companies: JSON.stringify(list) }
  );
}

/** {site → company} for every real site row. */
export async function siteCompanies(): Promise<Record<string, string>> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.ben_site && r.ben_site !== APP_ROW) out[r.ben_site] = (r.ben_company ?? "").trim();
  }
  return out;
}

export async function saveSiteCompany(site: string, company: string): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: site, ben_name: site, ben_company: company }
  );
}

export async function meetingCategories(): Promise<string[]> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", APP_ROW));
  try {
    const arr = JSON.parse(rows[0]?.ben_meetingcategories ?? "[]");
    return Array.isArray(arr) ? arr.filter((v) => typeof v === "string" && v !== "") : [];
  } catch {
    return [];
  }
}

export async function saveMeetingCategories(categories: string[]): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", APP_ROW),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: APP_ROW, ben_name: "App branding", ben_meetingcategories: JSON.stringify(categories) }
  );
}

export interface SiteSettings {
  timezone: string;
  accent: string;
  /** [{name, pattern}] */
  rosterPatternsJson: string;
}

export async function siteSettings(site: string): Promise<SiteSettings> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", site));
  const r = rows[0];
  return {
    timezone: r?.ben_timezone ?? "",
    accent: r?.ben_accent ?? "",
    rosterPatternsJson: r?.ben_rosterpatterns ?? "",
  };
}

export async function saveSiteSettings(site: string, s: SiteSettings): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    {
      ben_site: site,
      ben_name: site,
      ben_timezone: s.timezone,
      ben_accent: s.accent,
      ben_rosterpatterns: s.rosterPatternsJson,
    }
  );
}

/** Named roster patterns for every real site: {site: [{name, pattern}]}. */
export async function rosterPatternLibrary(): Promise<
  Record<string, { name: string; pattern: string }[]>
> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  const out: Record<string, { name: string; pattern: string }[]> = {};
  for (const r of rows) {
    if (r.ben_site === APP_ROW || !r.ben_site) continue;
    try {
      const arr = JSON.parse(r.ben_rosterpatterns ?? "[]");
      if (Array.isArray(arr) && arr.length > 0) {
        out[r.ben_site] = arr
          .filter((x) => x && typeof x.name === "string" && typeof x.pattern === "string")
          .map((x) => ({ name: x.name, pattern: x.pattern }));
      }
    } catch {
      /* ignore malformed */
    }
  }
  return out;
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
