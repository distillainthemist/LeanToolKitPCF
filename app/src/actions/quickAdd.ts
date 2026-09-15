// "＋ Add action" in the top bar (Ben, 2026-09-16): capture and assign an
// action from anywhere. The same dialog every card uses; the action lives
// on the viewer's personal channel ("hub:<whoId>", read as "Personal" on
// the hub) unless the maker links it to one of their boards' action cards.
// Loaded on demand — the shell stays lean.

import { el, ensureStylesheet } from "../../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../../shared/ui/baseCss";
import { openActionDialog } from "../../../shared/ui/actionUi";
import { newAction } from "../../../shared/schema/actions";
import { assigneePeople } from "../../../shared/schema/people";
import { currentViewer } from "../runtime";
import { listPeople, viewerPerson } from "../store/people";
import { canViewBoard, listBoards } from "../store/boards";
import { parseManifest } from "../store/mappers";
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
  const [me, roster, boards] = await Promise.all([
    whoId !== "" ? viewerPerson(whoId).catch(() => null) : Promise.resolve(null),
    listPeople().catch(() => []),
    listBoards().catch(() => []),
  ]);
  const who = me?.who ?? viewer?.name ?? "";
  // the viewer first, then the roster behind the search
  const people = assigneePeople(who !== "" ? [{ whoId, who }] : [], roster);
  // where it lives: personal, or a board's action card
  const personal = `hub:${whoId}`;
  const linkTargets: { key: string; label: string }[] = [{ key: personal, label: "My actions (personal)" }];
  for (const b of boards) {
    if (!canViewBoard(b.occurrenceSettingsRaw, whoId)) continue;
    const slot = parseManifest(b.manifestRaw).slots.find((s) => s.cardType === "ActionBoard");
    if (!slot) continue;
    linkTargets.push({ key: `${b.boardId}:${slot.cardId}`, label: `${b.name}${b.kind === "project" ? " · initiative" : ""}` });
  }
  const action = newAction({ source: "leanhub", sourceId: "" });
  action.instanceId = personal;
  if (who !== "") action.assignees = [{ whoId, who, done: false }];
  openActionDialog({
    host: dialogHost(),
    action,
    people,
    isNew: true,
    linkTargets,
    linkTarget: personal,
    onCommit: () => {
      void (async () => {
        const onBoard = action.instanceId !== personal && action.instanceId.includes(":");
        const boardId = onBoard ? action.instanceId.split(":")[0] : undefined;
        if (!onBoard) action.context = { source: "leanhub", sourceId: "" };
        // an initiative board's action card: tie the action to the initiative
        if (boardId && boardId.startsWith("init-")) {
          const { listInitiatives } = await import("../store/initiatives");
          const i = (await listInitiatives().catch(() => [])).find((x) => x.boardId === boardId);
          if (i) action.initiativeId = i.id;
        }
        await upsertActions([action], boardId);
        bumpChange("actions");
        window.dispatchEvent(new CustomEvent(ACTIONS_CHANGED_EVENT));
      })();
    },
  });
}
