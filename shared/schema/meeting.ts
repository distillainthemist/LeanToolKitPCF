// The `meeting` section of a MeetingScheduler settingsJSON — who a meeting
// is for and why it exists, distinct from the cadence config that generates
// its instances. Written by MeetingWizard, displayed by MeetingScheduler,
// preserved verbatim by CardSettings (an unrecognised top-level key).
//
//   "meeting": {
//     "purpose": "…",
//     "owner": { "whoId": "…", "who": "…" },
//     "org": { "site": "…", "department": "…", "area": "…" },
//     "participants": [{ "whoId": "…", "who": "…", "crew": "A" }]
//   }

export interface MeetingPerson {
  whoId: string;
  who: string;
  /** Links the person to a roster crew; "" = always attends. */
  crew: string;
}

export interface MeetingOrg {
  site: string;
  department: string;
  area: string;
}

export interface MeetingInfo {
  purpose: string;
  owner: MeetingPerson | null;
  /** The PRIMARY organisation — the ritual's owner org (site column,
   *  protected times, admin scope). */
  org: MeetingOrg;
  /** Further organisations the ritual is ALSO shown in (their Cadence
   *  view) — Ben, 2026-09-08. Never the primary. */
  alsoOrgs: MeetingOrg[];
  participants: MeetingPerson[];
}

export function orgKey(o: MeetingOrg): string {
  return `${o.site}|${o.department}|${o.area}`;
}

export function orgLabel(o: MeetingOrg): string {
  return [o.site, o.department, o.area].filter((v) => v !== "").join(" / ");
}

/**
 * The org picklist tree supplied to MeetingWizard via orgJSON:
 * [{site, departments:[{department, areas:[…]}]}]. Areas may be empty
 * (area optional for that department).
 */
export interface OrgSite {
  site: string;
  departments: { department: string; areas: string[] }[];
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asPerson(v: unknown): MeetingPerson | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const who = asStr(o.who);
  if (who === "") return null;
  const whoId = asStr(o.whoId);
  return {
    whoId: whoId !== "" ? whoId : who.toLowerCase().replace(/\s+/g, "-"),
    who,
    crew: asStr(o.crew),
  };
}

/**
 * Extract the meeting section from a raw settingsJSON string. Returns null
 * when there is none (or nothing usable in it). Defensive; never throws.
 */
export function parseMeetingInfo(raw: string | null | undefined): MeetingInfo | null {
  const t = (raw ?? "").trim();
  if (t === "" || !t.startsWith("{")) return null;
  let m: Record<string, unknown>;
  try {
    const doc = JSON.parse(t) as Record<string, unknown>;
    if (!doc.meeting || typeof doc.meeting !== "object") return null;
    m = doc.meeting as Record<string, unknown>;
  } catch {
    return null;
  }
  const org = (m.org ?? {}) as Record<string, unknown>;
  const asOrg = (v: unknown): MeetingOrg => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { site: asStr(o.site), department: asStr(o.department), area: asStr(o.area) };
  };
  const primary = asOrg(org);
  const alsoOrgs: MeetingOrg[] = [];
  if (Array.isArray(m.alsoOrgs)) {
    for (const item of m.alsoOrgs) {
      const o = asOrg(item);
      if (o.site === "" || orgKey(o) === orgKey(primary) || alsoOrgs.some((x) => orgKey(x) === orgKey(o))) continue;
      alsoOrgs.push(o);
    }
  }
  const participants: MeetingPerson[] = [];
  if (Array.isArray(m.participants)) {
    for (const item of m.participants) {
      const p = asPerson(item);
      if (p) participants.push(p);
    }
  }
  const info: MeetingInfo = {
    purpose: asStr(m.purpose),
    owner: asPerson(m.owner),
    org: primary,
    alsoOrgs,
    participants,
  };
  const empty =
    info.purpose === "" &&
    info.owner === null &&
    info.org.site === "" &&
    info.org.department === "" &&
    info.org.area === "" &&
    info.alsoOrgs.length === 0 &&
    info.participants.length === 0;
  return empty ? null : info;
}

/**
 * The meeting section as a SPARSE plain object for serialization — only
 * set values are emitted, so stored blobs keep inheriting defaults.
 * Returns null when nothing is set.
 */
/** Does a ritual belong to an org scope — through its primary org OR one
 *  of the orgs it is also shown in? Each set level narrows; "" = all. */
export function meetingInOrg(info: Pick<MeetingInfo, "org" | "alsoOrgs"> | null, scope: MeetingOrg): boolean {
  const hit = (org: MeetingOrg | undefined): boolean => {
    if (scope.site !== "" && org?.site !== scope.site) return false;
    if (scope.department !== "" && org?.department !== scope.department) return false;
    if (scope.area !== "" && org?.area !== scope.area) return false;
    return true;
  };
  if (hit(info?.org)) return true;
  return (info?.alsoOrgs ?? []).some((o) => hit(o));
}

export function buildMeetingSection(info: MeetingInfo): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (info.purpose !== "") out.purpose = info.purpose;
  if (info.owner) {
    out.owner = { whoId: info.owner.whoId, who: info.owner.who };
  }
  const org: Record<string, string> = {};
  if (info.org.site !== "") org.site = info.org.site;
  if (info.org.department !== "") org.department = info.org.department;
  if (info.org.area !== "") org.area = info.org.area;
  if (Object.keys(org).length > 0) out.org = org;
  const also = (info.alsoOrgs ?? [])
    .filter((o) => o.site !== "" && orgKey(o) !== orgKey(info.org))
    .map((o) => {
      const r: Record<string, string> = { site: o.site };
      if (o.department !== "") r.department = o.department;
      if (o.area !== "") r.area = o.area;
      return r;
    });
  if (also.length > 0) out.alsoOrgs = also;
  if (info.participants.length > 0) {
    out.participants = info.participants.map((p) =>
      p.crew !== "" ? { whoId: p.whoId, who: p.who, crew: p.crew } : { whoId: p.whoId, who: p.who }
    );
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse the orgJSON picklist tree defensively; never throws. */
export function parseOrgTree(raw: string | null | undefined): OrgSite[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: OrgSite[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const site = asStr(s.site);
      if (site === "") continue;
      const departments: OrgSite["departments"] = [];
      if (Array.isArray(s.departments)) {
        for (const d of s.departments) {
          if (!d || typeof d !== "object") continue;
          const dep = d as Record<string, unknown>;
          const department = asStr(dep.department);
          if (department === "") continue;
          const areas = Array.isArray(dep.areas)
            ? dep.areas.map((a) => asStr(a)).filter((a) => a !== "")
            : [];
          departments.push({ department, areas });
        }
      }
      out.push({ site, departments });
    }
    return out;
  } catch {
    return [];
  }
}
