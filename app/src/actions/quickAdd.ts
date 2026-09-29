// "＋ Add action" in the top bar (Ben, 2026-09-16): capture and assign an
// action from anywhere. The same dialog every card uses. The action starts
// linked to the board on screen — a ritual or an initiative (Ben,
// 2026-09-24: actions raised while looking at an initiative were landing
// as personal ones) — and personal everywhere else; the dialog's "Linked
// to" field changes either. Loaded on demand — the shell stays lean.

import { el, ensureStylesheet } from "../../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../../shared/ui/baseCss";
import { openActionDialog } from "../../../shared/ui/actionUi";
import { newAction } from "../../../shared/schema/actions";
import { assigneePeople } from "../../../shared/schema/people";
import { currentViewer } from "../runtime";
import { listPeople, viewerPerson } from "../store/people";
import { upsertActions } from "../store/actions";
import { bumpChange } from "../store/changes";

export const ACTIONS_CHANGED_EVENT = "ltk-actions-changed";

let host: HTMLElement | null = null;
function dialogHost(): HTMLElement {
  if (host && host.isConnected) return host;
  ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
  host = el("div", "app-dlghost ltk-root app-quickadd-host");
  document.body.appendChild(host);
  return host;
}

export async function openQuickAction(): Promise<void> {
  const viewer = currentViewer();
  const whoId = viewer?.objectId ?? "";
  const [me, roster] = await Promise.all([
    whoId !== "" ? viewerPerson(whoId).catch(() => null) : Promise.resolve(null),
    listPeople().catch(() => []),
  ]);
  const who = me?.who ?? viewer?.name ?? "";
  // the viewer first, then the roster behind the search
  const people = assigneePeople(who !== "" ? [{ whoId, who }] : [], roster);
  // personal until the dialog links it (the open board, by default)
  const action = newAction({ source: "leanhub", sourceId: "" });
  action.instanceId = `hub:${whoId}`;
  if (who !== "") action.assignees = [{ whoId, who, done: false }];
  openActionDialog({
    host: dialogHost(),
    action,
    people,
    isNew: true,
    linkToOpenBoard: true,
    onCommit: () => {
      void (async () => {
        // the store stamps the board (and the initiative, for an
        // initiative board) from the key the link left
        await upsertActions([action]);
        bumpChange("actions");
        window.dispatchEvent(new CustomEvent(ACTIONS_CHANGED_EVENT));
      })();
    },
  });
}
