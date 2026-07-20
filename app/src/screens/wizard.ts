// New meeting screen — MeetingWizard mounted against the store: org tree
// + roster in, and Create meeting saves the board (build-kit §6b) and
// opens it.

import { MeetingWizardView } from "../../../controls/MeetingWizard/editor";
import {
  parseWizardDraft,
  serializeWizardDraft,
} from "../../../controls/MeetingWizard/types";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { parsePeople } from "../../../shared/schema/people";
import { el } from "../../../shared/ui/dom";
import { appTheme, editorHost } from "../cardHost";
import { detectHost } from "../runtime";
import { saveMeetingBoard } from "../store/boards";
import { meetingCategories, orgJson, rosterPatternLibrary } from "../store/config";
import { listPeople, viewerPerson } from "../store/people";
import { currentViewer } from "../runtime";
import { effectivePerson } from "../viewAs";
import { getBoard } from "../store/boards";

function mintBoardId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `board-${slug || "meeting"}-${Math.random().toString(36).slice(2, 6)}`;
}

export function mountWizard(parent: HTMLElement, editBoardId = ""): () => void {
  const host = editorHost(parent);
  let view: MeetingWizardView | null = null;
  void (async () => {
    const hosted = await detectHost();
    // creation is admin-gated; editing is open to admins AND the owner
    let editRaw = "";
    if (hosted) {
      const viewer = currentViewer()!;
      const stored = await viewerPerson(viewer.objectId);
      const me = stored ? effectivePerson(stored) : null; // honour view-as
      const isAdmin = me?.role === "superadmin" || me?.role === "siteadmin";
      if (editBoardId !== "") {
        const board = await getBoard(editBoardId);
        if (!board) {
          parent.appendChild(el("p", "app-missing", `Unknown board: ${editBoardId}`));
          return;
        }
        editRaw = board.occurrenceSettingsRaw;
        let ownerId = "";
        try {
          const blob = JSON.parse(editRaw) as { meeting?: { owner?: { whoId?: string } } };
          ownerId = blob.meeting?.owner?.whoId ?? "";
        } catch { /* no owner */ }
        if (!isAdmin && ownerId !== viewer.objectId) {
          parent.appendChild(
            el("div", "app-board-note", "Only admins or the meeting owner can edit this meeting.")
          );
          return;
        }
      } else if (!isAdmin) {
        parent.appendChild(
          el("div", "app-board-note", "Creating meetings is for site and super admins — ask yours, or request a role in Settings.")
        );
        return;
      }
    }
    const org = hosted ? await orgJson() : "[]";
    const peopleRaw = hosted
      ? JSON.stringify(
          (await listPeople()).map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
        )
      : "[]";

    let outputJson = "";
    view = new MeetingWizardView(host, {
      onChange: (draft) => {
        outputJson = serializeWizardDraft(draft);
      },
      onSubmit: () => {
        if (!hosted) {
          console.log("demo: create meeting", outputJson);
          return;
        }
        void (async () => {
          const blob = JSON.parse(outputJson) as { title?: string };
          const boardId =
            editBoardId !== "" ? editBoardId : mintBoardId(blob.title ?? "meeting");
          await saveMeetingBoard(boardId, outputJson);
          window.location.hash = `#/board/${boardId}`;
        })();
      },
    });
    view.setTheme(appTheme());
    view.setChrome("New meeting", "");
    view.setOrgTree(parseOrgTree(org));
    if (hosted) {
      view.setRosterPatterns(await rosterPatternLibrary());
      view.setMeetingCategories((await meetingCategories()).map((c) => c.name));
    }
    view.setPeople(parsePeople(peopleRaw));
    view.setDraft(parseWizardDraft(editRaw));
    if (editBoardId !== "") view.setChrome("Edit meeting", "");
    if (!hosted) {
      parent.prepend(
        el("div", "app-board-note", "Demo mode — Create meeting logs instead of saving.")
      );
    }
  })();
  return () => view?.destroy();
}
