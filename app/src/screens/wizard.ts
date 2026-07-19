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
import { orgJson, rosterPatternLibrary } from "../store/config";
import { listPeople } from "../store/people";

function mintBoardId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `board-${slug || "meeting"}-${Math.random().toString(36).slice(2, 6)}`;
}

export function mountWizard(parent: HTMLElement): () => void {
  const host = editorHost(parent);
  let view: MeetingWizardView | null = null;
  void (async () => {
    const hosted = await detectHost();
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
          const boardId = mintBoardId(blob.title ?? "meeting");
          await saveMeetingBoard(boardId, outputJson);
          window.location.hash = `#/board/${boardId}`;
        })();
      },
    });
    view.setTheme(appTheme());
    view.setChrome("New meeting", "");
    view.setOrgTree(parseOrgTree(org));
    if (hosted) view.setRosterPatterns(await rosterPatternLibrary());
    view.setPeople(parsePeople(peopleRaw));
    view.setDraft(parseWizardDraft(""));
    if (!hosted) {
      parent.prepend(
        el("div", "app-board-note", "Demo mode — Create meeting logs instead of saving.")
      );
    }
  })();
  return () => view?.destroy();
}
