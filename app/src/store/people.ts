// People IO — the curated LTK People roster (the operative people list),
// plus Entra ID search through the Office 365 Users connector (the
// shared_office365users connection added via pac code add-data-source).

import { Ben_ltkpeoplesService } from "../generated/services/Ben_ltkpeoplesService";
import { Office365UsersService } from "../generated/services/Office365UsersService";
import { currentViewer } from "../runtime";
import { syncPersonAccess } from "./accessGroup";
import { allWhere, eq, upsertWhere } from "./dv";
import { personFromRow, RosterPerson } from "./mappers";

export async function listPeople(includeInactive = false): Promise<RosterPerson[]> {
  const rows = await allWhere(
    Ben_ltkpeoplesService.getAll,
    includeInactive ? undefined : "ben_active ne false",
    undefined,
    ["ben_name asc"]
  );
  return rows.map(personFromRow);
}

/**
 * Write a roster row. Access-group membership follows EVERY roster
 * write from here (not from individual call sites, which drift): the
 * sync is fire-and-forget and can never fail the roster edit — pass
 * `onAccessSyncError` where the UI should surface a failure.
 */
export async function upsertPerson(
  person: RosterPerson,
  onAccessSyncError?: (err: unknown) => void
): Promise<void> {
  await upsertWhere(
    Ben_ltkpeoplesService,
    eq("ben_whoid", person.whoId),
    (row) => row.ben_ltkpeopleid,
    {
      ben_whoid: person.whoId,
      ben_name: person.who,
      ben_email: person.email,
      ben_crew: person.crew ?? "",
      ben_site: person.site,
      ben_department: person.department,
      ben_area: person.area,
      ben_role: person.role === "user" ? "" : person.role,
      ben_active: person.active,
    }
  );
  void syncPersonAccess(person, currentViewer()?.objectId ?? "").catch((err) => {
    console.warn("access-group sync failed", err);
    onAccessSyncError?.(err);
  });
}

export interface EntraHit {
  objectId: string;
  displayName: string;
  mail: string;
  department: string;
}

/** Search Entra ID (Office 365 Users connector, SearchUserV2). */
export async function searchEntra(query: string): Promise<EntraHit[]> {
  const q = query.trim();
  if (q === "") return [];
  const result = await Office365UsersService.SearchUserV2(q, 15, true);
  return (result.data?.value ?? [])
    .filter((u) => u.Id)
    .map((u) => ({
      objectId: u.Id,
      displayName: u.DisplayName ?? u.UserPrincipalName ?? u.Id,
      mail: u.Mail ?? u.UserPrincipalName ?? "",
      department: u.Department ?? "",
    }));
}

export interface DirectoryProfile {
  jobTitle: string;
  /** true if the Entra account is enabled; false if disabled/revoked. */
  accountEnabled: boolean;
  /** false if the directory has no such account (deleted/unknown). */
  found: boolean;
}

/**
 * Live directory read for one person (Office 365 Users, UserProfile V2 by
 * object id). Surfaces job title and whether the Entra account still
 * exists and is enabled — a disabled/missing account is a "revoked" user.
 * Never throws: a missing account resolves to found:false.
 */
export async function directoryProfile(whoId: string): Promise<DirectoryProfile> {
  const absent = { jobTitle: "", accountEnabled: false, found: false };
  if (whoId.trim() === "") return absent;
  try {
    const res = await Office365UsersService.UserProfile_V2(
      whoId,
      "jobTitle,accountEnabled,displayName"
    );
    const u = res.data;
    if (!u) return absent;
    return {
      jobTitle: u.jobTitle ?? "",
      accountEnabled: u.accountEnabled !== false,
      found: true,
    };
  } catch {
    return absent;
  }
}

/** The viewer's roster row, matched by Entra object id (whoId). */
export async function viewerPerson(entraObjectId: string): Promise<RosterPerson | null> {
  const rows = await allWhere(Ben_ltkpeoplesService.getAll, eq("ben_whoid", entraObjectId));
  return rows.length ? personFromRow(rows[0]) : null;
}

/** "user" | "siteadmin" | "superadmin" for the signed-in viewer. */
export async function viewerRole(entraObjectId: string): Promise<string> {
  const me = await viewerPerson(entraObjectId);
  return me?.role ?? "user";
}

/** True once any super admin exists — closes the bootstrap-code window. */
export async function superAdminExists(): Promise<boolean> {
  const rows = await allWhere(
    Ben_ltkpeoplesService.getAll,
    eq("ben_role", "superadmin"),
    ["ben_whoid"]
  );
  return rows.length > 0;
}
