// "＋ Add action" in the top bar (Ben, 2026-09-16): capture and assign an
// action from anywhere. The same dialog every card uses; the action ALWAYS
// lives on the viewer's personal channel ("hub:<whoId>", read as
// "Personal" on the hub) — Ben, same day: no linked-card choice here.
// Loaded on demand — the shell stays lean.

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
  // it lives on the viewer's personal channel
  const personal = `hub:${whoId}`;
  const action = newAction({ source: "leanhub", sourceId: "" });
  action.instanceId = personal;
  if (who !== "") action.assignees = [{ whoId, who, done: false }];
  openActionDialog({
    host: dialogHost(),
    action,
    people,
    isNew: true,
    onCommit: () => {
      void (async () => {
        action.instanceId = personal;
        await upsertActions([action]);
        bumpChange("actions");
        window.dispatchEvent(new CustomEvent(ACTIONS_CHANGED_EVENT));
      })();
    },
  });
}
