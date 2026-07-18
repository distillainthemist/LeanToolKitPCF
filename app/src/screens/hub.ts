// Home screen — LeanHub mounted via CardHost. The store callbacks are
// console stubs until Phase 3; the meeting tap drives real navigation to
// the board screen (the selectIso deep-link handshake).

import { LeanHubView } from "../../../controls/LeanHub/editor";
import {
  parseHubMeetings,
  parsePrefs,
  parseProtectedTimes,
} from "../../../controls/LeanHub/types";
import { parseActionsJson } from "../../../shared/schema/actions";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { parsePeople } from "../../../shared/schema/people";
import { appTheme, editorHost } from "../cardHost";
import {
  ACTIONS,
  ACTION_SOURCES,
  BOARDS,
  ORG_TREE,
  PEOPLE,
  PROTECTED_TIMES,
  VIEWER_ID,
} from "../demoData";

export function mountHub(parent: HTMLElement): () => void {
  const host = editorHost(parent);
  const view = new LeanHubView(host, {
    onSelectMeeting: (inst) => {
      window.location.hash = `#/board/${inst.boardId}/${encodeURIComponent(inst.iso)}`;
    },
    onActions: (actions) => console.log("store: upsert actions", actions),
    onPrefs: (prefs) => console.log("store: save prefs", prefs),
    onProtected: (times) => console.log("store: save protected times", times),
  });

  view.setTheme(appTheme());
  view.setChrome("My day", "");
  view.setMeetings(parseHubMeetings(JSON.stringify(BOARDS)));
  view.setOrgTree(parseOrgTree(JSON.stringify(ORG_TREE)));
  view.setPeople(parsePeople(JSON.stringify(PEOPLE)), VIEWER_ID);
  view.setProtectedTimes(parseProtectedTimes(JSON.stringify(PROTECTED_TIMES)));
  view.setActions(parseActionsJson(JSON.stringify(ACTIONS)));
  view.setSourceLabels(
    Object.fromEntries(ACTION_SOURCES.map((s) => [s.instanceId, s.label]))
  );
  view.setCanEditSite(true);
  view.setPrefs(parsePrefs(""));

  return () => view.destroy();
}
