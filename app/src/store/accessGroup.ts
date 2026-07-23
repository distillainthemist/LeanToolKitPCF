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

export async function accessGroup(): Promise<AccessGroup | null> {
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
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const attempt = (content: string | undefined) =>
    Office365GroupsService.HttpRequestV2(
      uri,
      method,
      content,
      payload === undefined ? undefined : "application/json"
    );
  let res = await attempt(payload);
  // the connector declares Body as a BINARY string — some hosts deliver
  // a raw string as an empty payload; base64 is the binary wire format
  if (
    !res.success &&
    payload !== undefined &&
    (res.error?.message ?? "").includes("Empty Payload")
  ) {
    res = await attempt(toB64(payload));
  }
  if (!res.success) {
    const msg = res.error?.message ?? "Graph request failed";
    const m = /\b(\d{3})\b/.exec(msg);
    throw new GraphError(msg, m ? Number(m[1]) : 0);
  }
  return res.data;
}

/** "Already there" / "not there" are fine outcomes for sync operations. */
function tolerate(err: unknown, alreadyOk: boolean): void {
  if (err instanceof GraphError) {
    const msg = err.message.toLowerCase();
    if (alreadyOk && (err.status === 400 || err.status === 409) && msg.includes("already exist")) return;
    if (!alreadyOk && err.status === 404) return;
  }
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
    tolerate(err, true);
  }
}

export async function addOwner(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("POST", `/groups/${groupId}/owners/$ref`, {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${entraId}`,
    });
  } catch (err) {
    tolerate(err, true);
  }
}

export async function removeMember(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("DELETE", `/groups/${groupId}/members/${entraId}/$ref`);
  } catch (err) {
    tolerate(err, false);
  }
}

export async function removeOwner(groupId: string, entraId: string): Promise<void> {
  try {
    await graph("DELETE", `/groups/${groupId}/owners/${entraId}/$ref`);
  } catch (err) {
    tolerate(err, false);
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
    if (p.whoId !== viewerId) await removeOwner(group.id, p.whoId);
    await removeMember(group.id, p.whoId);
    return;
  }
  await addMember(group.id, p.whoId);
  if (isAdmin(p)) {
    await addOwner(group.id, p.whoId);
  } else if (p.whoId !== viewerId) {
    // demoted from admin: ownership goes, membership stays
    await removeOwner(group.id, p.whoId);
  }
}

export interface SyncReport {
  membersAdded: number;
  ownersAdded: number;
  membersRemoved: number;
  ownersRemoved: number;
}

/**
 * Reconcile the whole roster against the group (the Sync now button,
 * and the adoption path when a group is first configured). Only rows
 * with real Entra ids sync; the signed-in admin's ownership and the
 * last owner are never removed.
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
  };
  const members = await idSet(group.id, "members");
  const owners = await idSet(group.id, "owners");
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
