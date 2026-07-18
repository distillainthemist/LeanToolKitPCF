// People IO — the curated LTK People roster (the operative people list),
// plus the Entra ID search seam. Entra search runs through the Office 365
// Users connector once its connection exists in the environment; until
// then searchEntra reports unavailable and People admin degrades to
// manual entry (the table design is identical either way).

import { Ben_ltkpeoplesService } from "../generated/services/Ben_ltkpeoplesService";
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
}

/**
 * Search Entra ID via the Office 365 Users connector. Requires a
 * connection in the environment (make.powerapps.com → Connections → New →
 * Office 365 Users) and the connector added as a data source
 * (`pac code add-data-source -a shared_office365users -c <connectionId>`),
 * which generates its typed client. Until both exist this throws, and the
 * People admin screen offers manual entry instead.
 */
export async function searchEntra(_query: string): Promise<EntraHit[]> {
  throw new Error(
    "Entra search not wired yet: create an Office 365 Users connection, add it with pac code add-data-source, then implement this call with the generated client."
  );
}

/** The viewer's roster row, matched by Entra object id (whoId). */
export async function viewerPerson(entraObjectId: string): Promise<RosterPerson | null> {
  const rows = await allWhere(Ben_ltkpeoplesService.getAll, eq("ben_whoid", entraObjectId));
  return rows.length ? personFromRow(rows[0]) : null;
}
