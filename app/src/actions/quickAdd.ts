// "＋ Add action" in the top bar (Ben, 2026-09-16): capture and assign an
// action from anywhere. The same dialog every card uses. The action goes
// to the viewer's personal channel ("hub:<whoId>", read as "Personal" on
// the hub) — or, when a board is open, to that board by default (Ben,
// 2026-09-24: actions raised while looking at an initiative were landing
// as personal ones). A "Goes to" select offers both; an Initiative select
// links a personal or meeting-board action to an initiative outright.
// Loaded on demand — the shell stays lean.

import { el, ensureStylesheet } from "../../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../../shared/ui/baseCss";
import { openActionDialog } from "../../../shared/ui/actionUi";
import { selectInput } from "../../../shared/ui/dialog";
import { boardChannelKey, InitiativeTarget, newAction } from "../../../shared/schema/actions";
import { assigneePeople } from "../../../shared/schema/people";
import { currentViewer } from "../runtime";
import { listPeople, viewerPerson } from "../store/people";
import { upsertActions } from "../store/actions";
import { getBoard } from "../store/boards";
import { listInitiatives } from "../store/initiatives";
import { bumpChange } from "../store/changes";
import { openBoardId } from "./openBoard";

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
  const personal = `hub:${whoId}`;
  const action = newAction({ source: "leanhub", sourceId: "" });
  action.instanceId = personal;
  if (who !== "") action.assignees = [{ whoId, who, done: false }];

  // the open board (initiative or meeting) is the default destination
  const boardId = openBoardId(window.location.hash);
  const board = boardId !== null ? await getBoard(boardId).catch(() => null) : null;
  const dest = board ? selectInput(board.boardId, [{ value: board.boardId, label: board.name }, { value: "", label: "Personal" }]) : null;
  // on an initiative board the destination IS the link; elsewhere the
  // dialog's Initiative select links a personal / meeting-board action
  const initBoard = board !== null && board.boardId.startsWith("init-");
  const initiatives: InitiativeTarget[] = initBoard
    ? []
    : (await listInitiatives().catch(() => []))
        .filter((i) => i.status === "active")
        .map((i) => ({ id: i.id, title: i.title, boardId: i.boardId }))
        .sort((a, b) => a.title.localeCompare(b.title));
  openActionDialog({
    host: dialogHost(),
    action,
    people,
    isNew: true,
    extraFields: dest ? [{ label: "Goes to", control: dest }] : [],
    initiatives,
    personalWho: whoId,
    onCommit: () => {
      void (async () => {
        const toBoard = dest !== null && dest.value !== "";
        if (toBoard) {
          // the board's own channel; the store stamps the initiative id
          // for an initiative board
          action.instanceId = boardChannelKey(dest.value);
          await upsertActions([action], dest.value);
        } else {
          // personal, unless the dialog linked it to an initiative (the
          // relink moved it onto that initiative board's channel)
          await upsertActions([action]);
        }
        bumpChange("actions");
        window.dispatchEvent(new CustomEvent(ACTIONS_CHANGED_EVENT));
      })();
    },
  });
}
