// Home screen — LeanHub. Hosted: everything from the Dataverse store
// (meetings join, viewer action rollup, org tree, prefs, protected
// times), with the viewer self-registering into LTK People on first
// visit. Dev server (no host): demo data, writes logged.

import { LeanHubView } from "../../../controls/LeanHub/editor";
import {
  parseHubMeetings,
  parsePrefs,
  parseProtectedTimes,
} from "../../../controls/LeanHub/types";
import { LtkAction, parseActionsJson } from "../../../shared/schema/actions";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { parsePeople } from "../../../shared/schema/people";
import { appTheme, editorHost } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { actionsForViewer, upsertActions } from "../store/actions";
import { listBoards } from "../store/boards";
import { selfHealCatalog } from "../store/catalog";
import {
  protectedTimesJson,
  orgJson,
  saveProtectedTimes,
  saveUserPrefs,
  userPrefsJson,
} from "../store/config";
import { parseManifest } from "../store/mappers";
import { listPeople, upsertPerson, viewerPerson } from "../store/people";
import {
  ACTIONS,
  ACTION_SOURCES,
  BOARDS,
  ORG_TREE,
  PEOPLE,
  PROTECTED_TIMES,
  VIEWER_ID,
} from "../demoData";
import { el } from "../../../shared/ui/dom";

export function mountHub(parent: HTMLElement): () => void {
  const host = editorHost(parent);
  const note = el("div", "app-board-note", "Loading…");
  parent.prepend(note);
  let view: LeanHubView | null = null;

  void (async () => {
    const hosted = await detectHost();

    let meetingsRaw: string;
    let peopleRaw: string;
    let orgRaw: string;
    let protectedRaw: string;
    let prefsRaw = "";
    let actions: LtkAction[];
    let sourceLabels: Record<string, string> = {};
    let viewerId: string;
    let site = "";

    if (hosted) {
      const viewer = currentViewer()!;
      viewerId = viewer.objectId;
      await selfHealCatalog();
      // self-register the viewer into the roster on first visit
      let me = await viewerPerson(viewerId);
      if (!me) {
        me = {
          whoId: viewerId,
          who: viewer.name,
          email: viewer.email,
          site: "",
          department: "",
          area: "",
          role: "user",
          active: true,
        };
        await upsertPerson(me);
      }
      site = me.site;

      const boards = await listBoards();
      meetingsRaw = JSON.stringify(
        boards
          .filter((b) => b.kind === "meeting" && b.occurrenceSettingsRaw.trim() !== "")
          .map((b) => ({ boardId: b.boardId, settingsJSON: b.occurrenceSettingsRaw }))
      );
      for (const b of boards) {
        for (const slot of parseManifest(b.manifestRaw).slots) {
          // actions carry instanceId = boardId:cardId (the app's action key)
          sourceLabels[`${b.boardId}:${slot.cardId}`] =
            `${b.name} · ${slot.title || slot.cardType}`;
        }
      }
      const roster = await listPeople();
      peopleRaw = JSON.stringify(
        roster.map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
      );
      actions = await actionsForViewer(viewerId);
      orgRaw = await orgJson();
      protectedRaw = site !== "" ? await protectedTimesJson(site) : "[]";
      prefsRaw = await userPrefsJson(viewerId);
      note.remove();
    } else {
      viewerId = VIEWER_ID;
      meetingsRaw = JSON.stringify(BOARDS);
      peopleRaw = JSON.stringify(PEOPLE);
      orgRaw = JSON.stringify(ORG_TREE);
      protectedRaw = JSON.stringify(PROTECTED_TIMES);
      actions = parseActionsJson(JSON.stringify(ACTIONS));
      sourceLabels = Object.fromEntries(ACTION_SOURCES.map((s) => [s.instanceId, s.label]));
      note.textContent = "Demo mode — no Power Apps host; writes are logged, not saved.";
    }

    view = new LeanHubView(host, {
      onSelectMeeting: (inst) => {
        window.location.hash = `#/board/${inst.boardId}/${encodeURIComponent(inst.iso)}`;
      },
      onActions: (all) =>
        hosted ? void upsertActions(all) : console.log("demo: actions", all),
      onPrefs: (prefs) =>
        hosted
          ? void saveUserPrefs(viewerId, JSON.stringify(prefs))
          : console.log("demo: prefs", prefs),
      onProtected: (times) =>
        hosted && site !== ""
          ? void saveProtectedTimes(site, JSON.stringify(times))
          : console.log("demo: protected", times),
    });
    view.setTheme(appTheme());
    view.setChrome("My day", "");
    view.setMeetings(parseHubMeetings(meetingsRaw));
    view.setOrgTree(parseOrgTree(orgRaw));
    view.setPeople(parsePeople(peopleRaw), viewerId);
    view.setProtectedTimes(parseProtectedTimes(protectedRaw));
    view.setActions(actions);
    view.setSourceLabels(sourceLabels);
    view.setCanEditSite(true);
    view.setPrefs(parsePrefs(prefsRaw));
    view.setHideSettingsTab(true); // settings live behind the header cog now
    if (hosted) {
      const { meetingCategories } = await import("../store/config");
      const cats = await meetingCategories();
      const colorByCategory = Object.fromEntries(
        cats.filter((c) => c.color !== "").map((c) => [c.name, c.color])
      );
      const allBoards = await listBoards();
      const dir = allBoards.map((b) => ({
        boardId: b.boardId,
        name: b.name,
        meta: [b.category, b.site, b.department].filter(Boolean).join(" \u00b7 "),
      }));
      view.setBoards(
        dir,
        (boardId) => {
          window.location.hash = `#/board/${boardId}`;
        },
        "Rituals"
      );
      // ritual-category colours code the calendar chips + directory rows
      view.setBoardColors(
        Object.fromEntries(
          allBoards
            .filter((b) => (colorByCategory[b.category] ?? "") !== "")
            .map((b) => [b.boardId, colorByCategory[b.category]])
        )
      );
      // first access: prompt the viewer to place themselves in the org
      // (site drives meetings, actions and protected times). Modal on
      // first visit; a lighter banner remains if they skip.
      const meNow = await viewerPerson(viewerId);
      if (meNow && meNow.site === "") {
        const { promptForSite } = await import("./sitePrompt");
        const saved = await promptForSite(meNow);
        if (saved) {
          // re-run the router so meetings/protected times pick up the site
          window.dispatchEvent(new Event("hashchange"));
          return;
        }
        const note = el("div", "app-board-note");
        note.append(
          "Set your site and department in ",
          Object.assign(el("a", "", "Settings \u2192 My profile"), { href: "#/settings" }),
          " so your meetings and actions find you."
        );
        parent.prepend(note);
      }
    }
  })();

  return () => view?.destroy();
}
