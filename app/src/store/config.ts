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

/** Rename a company: the app-row list plus every site assigned to it. */
export async function renameCompany(oldName: string, newName: string): Promise<void> {
  const list = await companies();
  await saveCompanies(list.map((c) => (c === oldName ? newName : c)));
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  for (const r of rows) {
    if (r.ben_site !== APP_ROW && (r.ben_company ?? "").trim() === oldName) {
      await Ben_ltksitesettingsesService.update(r.ben_ltksitesettingsid, {
        ben_company: newName,
      });
    }
  }
  // the company's owner travels with the rename
  const owners = await companyOwners();
  if (owners[oldName]) {
    const next = { ...owners, [newName]: owners[oldName] };
    delete next[oldName];
    await saveCompanyOwners(next);
  }
}

// ---- org owners (a person responsible for each org level) ----

/** A lightweight person reference — a real Entra identity. */
export interface PersonRef {
  whoId: string;
  who: string;
}

/** Per-site owners: the site itself, departments by name, areas by
 *  "department/area". Company owners live on the APP_ROW. */
export interface SiteOwners {
  site?: PersonRef;
  departments: Record<string, PersonRef>;
  areas: Record<string, PersonRef>;
}

const parseRef = (v: unknown): PersonRef | undefined => {
  const o = v as { whoId?: unknown; who?: unknown } | null;
  return o && typeof o.whoId === "string" && o.whoId !== ""
    ? { whoId: o.whoId, who: typeof o.who === "string" ? o.who : "" }
    : undefined;
};

function parseSiteOwners(raw: string): SiteOwners {
  const out: SiteOwners = { departments: {}, areas: {} };
  if (!raw.trim().startsWith("{")) return out;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    out.site = parseRef(o.site);
    for (const [k, v] of Object.entries((o.departments as object) ?? {})) {
      const ref = parseRef(v);
      if (ref) out.departments[k] = ref;
    }
    for (const [k, v] of Object.entries((o.areas as object) ?? {})) {
      const ref = parseRef(v);
      if (ref) out.areas[k] = ref;
    }
  } catch {
    /* fresh */
  }
  return out;
}

export async function siteOwners(site: string): Promise<SiteOwners> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", site));
  return parseSiteOwners(rows[0]?.ben_orgowners ?? "");
}

/** Owners for every real site in one read (the org tree needs them all). */
export async function allSiteOwners(): Promise<Record<string, SiteOwners>> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  const out: Record<string, SiteOwners> = {};
  for (const r of rows) {
    if (r.ben_site && r.ben_site !== APP_ROW) {
      out[r.ben_site] = parseSiteOwners(r.ben_orgowners ?? "");
    }
  }
  return out;
}

export async function saveSiteOwners(site: string, owners: SiteOwners): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: site, ben_name: site, ben_orgowners: JSON.stringify(owners) }
  );
}

/** Company owners, keyed by company name (stored on the APP_ROW). */
export async function companyOwners(): Promise<Record<string, PersonRef>> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", APP_ROW));
  const out: Record<string, PersonRef> = {};
  const raw = rows[0]?.ben_orgowners ?? "";
  if (!raw.trim().startsWith("{")) return out;
  try {
    const o = JSON.parse(raw) as { companies?: Record<string, unknown> };
    for (const [k, v] of Object.entries(o.companies ?? {})) {
      const ref = parseRef(v);
      if (ref) out[k] = ref;
    }
  } catch {
    /* fresh */
  }
  return out;
}

export async function saveCompanyOwners(map: Record<string, PersonRef>): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", APP_ROW),
    (row) => row.ben_ltksitesettingsid,
    {
      ben_site: APP_ROW,
      ben_name: "App branding",
      ben_orgowners: JSON.stringify({ companies: map }),
    }
  );
}

/** Rename the site's settings row (key column + display name). */
export async function renameSiteRow(oldSite: string, newSite: string): Promise<void> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", oldSite));
  if (rows[0]) {
    await Ben_ltksitesettingsesService.update(rows[0].ben_ltksitesettingsid, {
      ben_site: newSite,
      ben_name: newSite,
    });
  }
}

export async function saveSiteCompany(site: string, company: string): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", site),
    (row) => row.ben_ltksitesettingsid,
    { ben_site: site, ben_name: site, ben_company: company }
  );
}

/** A ritual (meeting) category; colour codes it across calendar/lists. */
export interface RitualCategory {
  name: string;
  color: string; // "#rrggbb" or "" (no colour)
}

export async function meetingCategories(): Promise<RitualCategory[]> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll, eq("ben_site", APP_ROW));
  try {
    const arr = JSON.parse(rows[0]?.ben_meetingcategories ?? "[]");
    if (!Array.isArray(arr)) return [];
    const out: RitualCategory[] = [];
    for (const item of arr) {
      // pre-colour rows stored plain strings
      if (typeof item === "string" && item !== "") out.push({ name: item, color: "" });
      else if (item && typeof item === "object" && typeof item.name === "string" && item.name !== "") {
        out.push({ name: item.name, color: typeof item.color === "string" ? item.color : "" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function saveMeetingCategories(categories: RitualCategory[]): Promise<void> {
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

export interface SiteRosterPattern {
  name: string;
  pattern: string;
  baseDate: string; // "" when the site admin hasn't set one
  crews: string[];
  dayStart: string;
}

/** Named roster patterns for every real site, with their full setup. */
export async function rosterPatternLibrary(): Promise<
  Record<string, SiteRosterPattern[]>
> {
  const rows = await allWhere(Ben_ltksitesettingsesService.getAll);
  const out: Record<string, SiteRosterPattern[]> = {};
  for (const r of rows) {
    if (r.ben_site === APP_ROW || !r.ben_site) continue;
    try {
      const arr = JSON.parse(r.ben_rosterpatterns ?? "[]");
      if (Array.isArray(arr) && arr.length > 0) {
        out[r.ben_site] = arr
          .filter((x) => x && typeof x.name === "string" && typeof x.pattern === "string")
          .map((x) => ({
            name: x.name,
            pattern: x.pattern,
            baseDate: typeof x.baseDate === "string" ? x.baseDate : "",
            crews: Array.isArray(x.crews) ? x.crews.map(String) : [],
            dayStart: typeof x.dayStart === "string" ? x.dayStart : "",
          }));
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
