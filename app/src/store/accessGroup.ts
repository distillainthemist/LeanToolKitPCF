// Access-control group — a Microsoft Entra group (security or
// security-enabled M365), owned by the configuring super admin, that
// gates who can open the app. The roster drives membership: everyone
// active is a member; super/site admins are members AND owners. All
// group operations run through the Office 365 Groups connector's Graph
// passthrough under the signed-in admin's delegated permissions — a
// group OWNER may manage membership with no directory role needed.

import { Ben_ltksitesettingsesService } from "../generated/services/Ben_ltksitesettingsesService";
import { Office365GroupsService } from "../generated/services/Office365GroupsService";
import { allWhere, eq, upsertWhere } from "./dv";
import type { RosterPerson } from "./mappers";
import { APP_ROW } from "./config";

export interface AccessGroup {
  id: string;
  name: string;
}

export interface CandidateGroup {
  id: string;
  name: string;
}

// ---- configuration (stored on the app settings row) ----

// cached: the value only changes through saveAccessGroup, and the sync
// hook on every roster write would otherwise re-query the settings row
// each time (usually just to learn no group is configured)
let cachedGroup: Promise<AccessGroup | null> | null = null;

export function accessGroup(): Promise<AccessGroup | null> {
  cachedGroup ??= (async () => {
    const rows = await allWhere(
      Ben_ltksitesettingsesService.getAll,
      eq("ben_site", APP_ROW)
    );
    const raw = (rows[0]?.ben_accessgroup ?? "").trim();
    if (!raw.startsWith("{")) return null;
    try {
      const o = JSON.parse(raw) as { id?: string; name?: string };
      return o.id ? { id: o.id, name: o.name ?? "" } : null;
    } catch {
      return null;
    }
  })();
  // a failed read must not stick as the cached answer
  cachedGroup.catch(() => (cachedGroup = null));
  return cachedGroup;
}

export async function saveAccessGroup(group: AccessGroup | null): Promise<void> {
  await upsertWhere(
    Ben_ltksitesettingsesService,
    eq("ben_site", APP_ROW),
    (row) => row.ben_ltksitesettingsid,
    {
      ben_site: APP_ROW,
      ben_name: "App branding",
      ben_accessgroup: group ? JSON.stringify(group) : "",
    }
  );
  cachedGroup = Promise.resolve(group);
}

// ---- Graph passthrough ----

class GraphError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const toB64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function graph(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const uri = `https://graph.microsoft.com/v1.0${path}`;
  // The connector declares Body as `format: binary`. The SDK's executor
  // base64-DECODES any STRING value to raw bytes and ships it as
  // octet-stream — which mangles JSON. A non-string value skips that
  // branch and is JSON.stringify'd verbatim, exactly what Graph needs —
  // so the body object is passed through un-stringified (cast past the
  // generated string signature). Base64 stays as a defensive fallback.
  const attempt = (content: unknown) =>
    Office365GroupsService.HttpRequestV2(
      uri,
      method,
      content as string | undefined,
      body === undefined ? undefined : "application/json"
    );
  let res = await attempt(body);
  if (
    !res.success &&
    body !== undefined &&
    (res.error?.message ?? "").includes("Empty Payload")
  ) {
    res = await attempt(toB64(JSON.stringify(body)));
  }
  if (!res.success) {
    const msg = res.error?.message ?? "Graph request failed";
    // the SDK's PowerDataRuntimeHttpError carries the real HTTP status
    // when the runtime surfaces one (optional) — never scrape the text
    const status = (res.error as { status?: number } | undefined)?.status ?? 0;
    throw new GraphError(msg, status);
  }
  return res.data;
}

/**
 * "Already there" (adds) / "not there" (removes) are fine outcomes for
 * sync operations. Matched on the SDK's HTTP status when present, else
 * Graph's stable error codes/text. Remove-side tolerance additionally
 * requires that the missing resource is NOT the group itself — a stale
 * or deleted group id must fail loudly, not report success.
 */
function tolerate(err: unknown, alreadyOk: boolean, groupId: string): void {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const status = err instanceof GraphError ? err.status : 0;
  if (alreadyOk) {
    if (status === 409 || msg.includes("already exist")) return;
    throw err;
  }
  const notFound =
    status === 404 ||
    msg.includes("does not exist") ||
    msg.includes("resourcenotfound") ||
    msg.includes("not found");
  // Graph's Request_ResourceNotFound names the missing object's id — if
  // the GROUP id is what's missing, this is a configuration fault
  if (notFound && !msg.includes(groupId.toLowerCase())) return;
  throw err;
}

// ---- group discovery ----

/**
 * Candidate access groups: pure SECURITY groups only (M365 groups don't
 * work for app sharing). The connector's Graph passthrough only accepts
 * /groups… paths (not /me/ownedObjects), so ownership cannot be
 * pre-filtered here — every security group in the tenant lists, and
 * ownership is verified when one is picked (isGroupOwner —
 * /groups/{id}/owners IS an allowed path).
 */
export async function listCandidateGroups(): Promise<CandidateGroup[]> {
  const out: CandidateGroup[] = [];
  let path =
    "/groups?$select=id,displayName,securityEnabled,groupTypes&$filter=securityEnabled eq true&$top=999";
  while (path) {
    const data = (await graph("GET", path)) as {
      value?: {
        id?: string;
        displayName?: string;
        groupTypes?: string[];
      }[];
      "@odata.nextLink"?: string;
    };
    for (const g of data.value ?? []) {
      // groupTypes "Unified" = an M365 group, even when security-enabled
      if (!g.id || (g.groupTypes ?? []).includes("Unified")) continue;
      out.push({ id: g.id, name: g.displayName ?? g.id });
    }
    const next = data["@odata.nextLink"];
    path = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Exact ownership check, run when a group is picked. */
export async function isGroupOwner(groupId: string, viewerId: string): Promise<boolean> {
  return (await idSet(groupId, "owners")).has(viewerId);
}

// ---- membership operations (all tolerate already/absent states) ----

export async function addMember(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("POST", `/groups/${groupId}/members/$ref`, {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${entraId}`,
    });
  } catch (err) {
    tolerate(err, true, groupId);
  }
}

export async function addOwner(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("POST", `/groups/${groupId}/owners/$ref`, {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${entraId}`,
    });
  } catch (err) {
    tolerate(err, true, groupId);
  }
}

export async function removeMember(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("DELETE", `/groups/${groupId}/members/${entraId}/$ref`);
  } catch (err) {
    tolerate(err, false, groupId);
  }
}

export async function removeOwner(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("DELETE", `/groups/${groupId}/owners/${entraId}/$ref`);
  } catch (err) {
    tolerate(err, false, groupId);
  }
}

async function idSet(groupId: string, kind: "members" | "owners"): Promise<Set<string>> {
  const out = new Set<string>();
  let path = `/groups/${groupId}/${kind}?$select=id&$top=999`;
  while (path) {
    const data = (await graph("GET", path)) as {
      value?: { id?: string }[];
      "@odata.nextLink"?: string;
    };
    for (const v of data.value ?? []) if (v.id) out.add(v.id);
    const next = data["@odata.nextLink"];
    path = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return out;
}

export interface GroupMember {
  id: string;
  name: string;
  email: string;
}

/** The group's USER members with identity (the microsoft.graph.user cast
 *  skips nested groups/service principals). */
async function memberProfiles(groupId: string): Promise<GroupMember[]> {
  const out: GroupMember[] = [];
  let path = `/groups/${groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999`;
  while (path) {
    const data = (await graph("GET", path)) as {
      value?: {
        id?: string;
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      }[];
      "@odata.nextLink"?: string;
    };
    for (const v of data.value ?? []) {
      if (!v.id) continue;
      out.push({
        id: v.id,
        name: v.displayName ?? v.userPrincipalName ?? v.id,
        email: v.mail ?? v.userPrincipalName ?? "",
      });
    }
    const next = data["@odata.nextLink"];
    path = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return out;
}

/**
 * Remove ownership with the last-owner guard: a group must never be
 * left ownerless (Graph allows it for pure security groups). Throws a
 * readable error instead, which the roster UI surfaces.
 */
async function removeOwnerGuarded(groupId: string, entraId: string): Promise<void> {
  const owners = await idSet(groupId, "owners");
  if (!owners.has(entraId)) return;
  if (owners.size <= 1) {
    throw new Error(
      "that person is the access group's only owner — add another owner first"
    );
  }
  await removeOwner(groupId, entraId);
}

// ---- roster-driven sync ----

const isAdmin = (p: RosterPerson) => p.role === "superadmin" || p.role === "siteadmin";

/**
 * Bring one person's group state in line with their roster row. Called
 * from roster write paths; quietly a no-op when no group is configured.
 * `viewerId` guards against removing the signed-in admin's own
 * ownership. Throws on Graph failure — callers surface a gentle note
 * rather than failing the roster edit.
 */
export async function syncPersonAccess(
  p: RosterPerson,
  viewerId: string
): Promise<void> {
  const group = await accessGroup();
  if (!group) return;
  if (!p.active) {
    // revoked: out of the group entirely (ownership first)
    if (p.whoId !== viewerId) await removeOwnerGuarded(group.id, p.whoId);
    await removeMember(group.id, p.whoId);
    return;
  }
  await addMember(group.id, p.whoId);
  if (isAdmin(p)) {
    await addOwner(group.id, p.whoId);
  } else if (p.whoId !== viewerId) {
    // demoted from admin: ownership goes, membership stays
    await removeOwnerGuarded(group.id, p.whoId);
  }
}

export interface SyncReport {
  membersAdded: number;
  ownersAdded: number;
  membersRemoved: number;
  ownersRemoved: number;
  /** Group members with no roster row — the caller registers them (the
   *  store stays acyclic: this module must not import people.ts). */
  newcomers: GroupMember[];
}

/**
 * Reconcile the whole roster against the group (the Sync now button,
 * and the adoption path when a group is first configured). Only rows
 * with real Entra ids sync; the signed-in admin's ownership and the
 * last owner are never removed. Sync is two-way for membership: group
 * members added directly in Entra come back as `newcomers` for the
 * caller to bring onto the roster.
 */
export async function syncAllAccess(
  people: RosterPerson[],
  viewerId: string
): Promise<SyncReport> {
  const group = await accessGroup();
  if (!group) throw new Error("no access group configured");
  const report: SyncReport = {
    membersAdded: 0,
    ownersAdded: 0,
    membersRemoved: 0,
    ownersRemoved: 0,
    newcomers: [],
  };
  const [memberList, owners] = await Promise.all([
    memberProfiles(group.id),
    idSet(group.id, "owners"),
  ]);
  const members = new Set(memberList.map((m) => m.id));
  // group members added directly in Entra, unknown to the roster —
  // includes nobody with an existing row (active OR revoked, so a
  // revoked person re-added to the group by hand doesn't resurrect)
  const known = new Set(people.map((p) => p.whoId));
  report.newcomers = memberList.filter((m) => !known.has(m.id));
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rows = people.filter((p) => guid.test(p.whoId));
  const active = rows.filter((p) => p.active);
  const wantOwner = new Set(active.filter(isAdmin).map((p) => p.whoId));

  for (const p of active) {
    if (!members.has(p.whoId)) {
      await addMember(group.id, p.whoId);
      report.membersAdded++;
    }
    if (wantOwner.has(p.whoId) && !owners.has(p.whoId)) {
      await addOwner(group.id, p.whoId);
      owners.add(p.whoId); // keep the set live — the last-owner guard below counts it
      report.ownersAdded++;
    }
  }
  for (const p of rows) {
    const keepOwner = wantOwner.has(p.whoId) || p.whoId === viewerId;
    if (owners.has(p.whoId) && !keepOwner && owners.size > 1) {
      await removeOwner(group.id, p.whoId);
      owners.delete(p.whoId);
      report.ownersRemoved++;
    }
    if (!p.active && members.has(p.whoId)) {
      await removeMember(group.id, p.whoId);
      report.membersRemoved++;
    }
  }
  return report;
}
