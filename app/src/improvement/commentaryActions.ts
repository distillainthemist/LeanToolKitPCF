// Initiative commentary — the two writes (2026-09-29), shared by the
// initiative board and the priority popup's Commentary tab.

import { nowIso } from "../../../shared/schema/id";
import { appendInitiativeEvent, saveInitiative, updateInitiativeEventDetail } from "../store/initiatives";
import { editedDetail, trimFields, Update, UpdateFields } from "./commentaryModel";
import type { Initiative } from "./initiativeModel";

type Actor = { whoId: string; who: string };

/** A new update; optionally raises the ⚐ Needs support flag with it. */
export async function addUpdate(i: Initiative, fields: UpdateFields, raiseFlag: boolean, actor: Actor): Promise<void> {
  await appendInitiativeEvent(i, "comment", { ...trimFields(fields) }, actor);
  if (raiseFlag && i.flag === "") {
    i.flag = "flag";
    await saveInitiative(i);
    await appendInitiativeEvent(i, "flag", { flag: "flag" }, actor);
  }
}

/** Rewrite an update in place: stamped, the earlier wording kept. */
export async function editUpdate(u: Update, fields: UpdateFields, actor: Actor): Promise<void> {
  await updateInitiativeEventDetail(u.id, editedDetail(u, fields, actor.who, nowIso()));
}
