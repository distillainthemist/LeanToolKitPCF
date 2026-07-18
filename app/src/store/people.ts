// People IO — the curated LTK People roster (the operative people list),
// plus Entra ID search through the Office 365 Users connector (the
// shared_office365users connection added via pac code add-data-source).

import { Ben_ltkpeoplesService } from "../generated/services/Ben_ltkpeoplesService";
import { Office365UsersService } from "../generated/services/Office365UsersService";
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

export async function upsertPerson(person: RosterPerson): Promise<void> {
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
      ben_active: person.active,
    }
  );
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

/** The viewer's roster row, matched by Entra object id (whoId). */
export async function viewerPerson(entraObjectId: string): Promise<RosterPerson | null> {
  const rows = await allWhere(Ben_ltkpeoplesService.getAll, eq("ben_whoid", entraObjectId));
  return rows.length ? personFromRow(rows[0]) : null;
}
