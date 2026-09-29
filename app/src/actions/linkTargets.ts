// What an action may be linked to, as the VIEWER may see it. Every list
// handed to the action dialog comes through here, so confidentiality is
// applied once: a confidential initiative reaches only its role-holders,
// the owners of its organisations and admins (2026-09-29 — the first
// Initiative select listed every active one by title).

import { currentViewer } from "../runtime";
import { canSee, ImprovementViewer, Initiative } from "../improvement/initiativeModel";
import { orgOwnersMap } from "../store/config";
import { listInitiatives } from "../store/initiatives";
import { viewerPerson } from "../store/people";

/** The viewer as the improvement rules know them. */
export async function improvementViewer(): Promise<ImprovementViewer> {
  const whoId = currentViewer()?.objectId ?? "";
  if (whoId === "") return { whoId, ownedOrgKeys: [], isAdmin: false };
  const [me, owners] = await Promise.all([viewerPerson(whoId).catch(() => null), orgOwnersMap().catch(() => ({}) as Awaited<ReturnType<typeof orgOwnersMap>>)]);
  return {
    whoId,
    ownedOrgKeys: Object.entries(owners)
      .filter(([, people]) => people.some((p) => p.whoId === whoId))
      .map(([key]) => key),
    isAdmin: me?.role === "superadmin" || me?.role === "siteadmin",
  };
}

/** Active initiatives the viewer may see, by title. */
export async function visibleInitiatives(): Promise<Initiative[]> {
  const [list, viewer] = await Promise.all([listInitiatives().catch(() => []), improvementViewer()]);
  return list.filter((i) => i.status === "active" && canSee(i, viewer)).sort((a, b) => a.title.localeCompare(b.title));
}
