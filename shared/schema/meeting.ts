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

export interface MeetingInfo {
  purpose: string;
  owner: MeetingPerson | null;
  org: { site: string; department: string; area: string };
  participants: MeetingPerson[];
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
    org: {
      site: asStr(org.site),
      department: asStr(org.department),
      area: asStr(org.area),
    },
    participants,
  };
  const empty =
    info.purpose === "" &&
    info.owner === null &&
    info.org.site === "" &&
    info.org.department === "" &&
    info.org.area === "" &&
    info.participants.length === 0;
  return empty ? null : info;
}

/**
 * The meeting section as a SPARSE plain object for serialization — only
 * set values are emitted, so stored blobs keep inheriting defaults.
 * Returns null when nothing is set.
 */
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
