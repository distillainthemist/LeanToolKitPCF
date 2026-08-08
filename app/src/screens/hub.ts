// Home screen — LeanHub. Hosted: everything from the Dataverse store
// (meetings join, viewer action rollup, org tree, prefs, protected
// times), with the viewer self-registering into LTK People on first
// visit. Dev server (no host): demo data, writes logged.

import { cardLabel } from "../../../controls/CardSettings/registry";
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
import { boardHash, boardUrl, hasPendingDocView, hasPendingWorkDoc } from "../links";
import { currentViewer, detectHost } from "../runtime";
import { readTaskCount } from "../taskBadge";
import { actionsForViewer, upsertActions } from "../store/actions";
import { canViewBoard, listBoards } from "../store/boards";
import { selfHealCatalog } from "../store/catalog";
import {
  meetingCategories,
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
import { bootFail, showLoading } from "../loading";

/** Everything one hub paint needs — the result of one boot round. */
interface HubData {
  viewerId: string;
  site: string;
  meetingsRaw: string;
  peopleRaw: string;
  orgRaw: string;
  protectedRaw: string;
  prefsRaw: string;
  actions: LtkAction[];
  sourceLabels: Record<string, string>;
  visibleBoards: Awaited<ReturnType<typeof listBoards>>;
  categories: Awaited<ReturnType<typeof meetingCategories>>;
  me: Awaited<ReturnType<typeof viewerPerson>>;
}

/** The last boot round, kept for the session. Returning to the hub
 *  paints from this INSTANTLY (the "coming back from a board feels
 *  slow" complaint was a full ~8-query round on every return); a fresh
 *  round always runs in the background and re-feeds the view's setters
 *  — stale for a beat, never wrong for long. */
let hubCache: HubData | null = null;

async function fetchHubData(viewer: {
  objectId: string;
  name: string;
  email: string;
}): Promise<HubData> {
  const viewerId = viewer.objectId;
  // ONE parallel round for every independent read — this chain used
  // to run serially, and ~ten connector round trips in a row were
  // the visible seconds before My day painted
  const [, meFirst, allBoards, roster, myActions, org, prefs, cats] = await Promise.all([
    selfHealCatalog(),
    viewerPerson(viewerId),
    listBoards(),
    listPeople(),
    actionsForViewer(viewerId),
    orgJson(),
    userPrefsJson(viewerId),
    meetingCategories(),
  ]);
  // self-register the viewer into the roster on first visit
  let me = meFirst;
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
    // upsertPerson also fire-and-forgets the access-group sync (the
    // viewer is rarely a group owner; admins reconcile via Sync now)
    await upsertPerson(me);
  }
  const site = me.site;

  // confidential meetings exist only for their owner + participants
  const boards = allBoards.filter((b) => canViewBoard(b.occurrenceSettingsRaw, viewerId));
  const sourceLabels: Record<string, string> = {};
  for (const b of boards) {
    for (const slot of parseManifest(b.manifestRaw).slots) {
      // actions carry instanceId = boardId:cardId (the app's action key)
      sourceLabels[`${b.boardId}:${slot.cardId}`] =
        `${b.name} · ${slot.title || cardLabel(slot.cardType)}`;
    }
  }
  return {
    viewerId,
    site,
    meetingsRaw: JSON.stringify(
      boards
        .filter((b) => b.kind === "meeting" && b.occurrenceSettingsRaw.trim() !== "")
        .map((b) => ({ boardId: b.boardId, settingsJSON: b.occurrenceSettingsRaw }))
    ),
    peopleRaw: JSON.stringify(
      roster.map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
    ),
    orgRaw: org,
    // the one read that depends on another (the viewer's site)
    protectedRaw: site !== "" ? await protectedTimesJson(site) : "[]",
    prefsRaw: prefs,
    actions: myActions,
    sourceLabels,
    visibleBoards: boards,
    categories: cats,
    me,
  };
}

export function mountHub(parent: HTMLElement): () => void {
  const host = editorHost(parent);
  // the My-day rollup pulls boards, roster, actions, org and prefs —
  // hold the card with the spinner + quote until it's all in
  const stopLoading = showLoading(host);
  let view: LeanHubView | null = null;
  let dead = false;
  // extra-tab content (the Documents area) registers its teardown here
  const cleanups: (() => void)[] = [];

  const boot = async () => {
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
    let me: Awaited<ReturnType<typeof viewerPerson>> = null;
    let visibleBoards: Awaited<ReturnType<typeof listBoards>> = [];
    let categories: Awaited<ReturnType<typeof meetingCategories>> = [];
    /** Set when this paint came from the session cache — a fresh round
     *  is then already running to re-feed the view. */
    let paintedFromCache = false;

    if (hosted) {
      const viewer = currentViewer()!;
      let data: HubData;
      if (hubCache !== null && hubCache.viewerId === viewer.objectId) {
        data = hubCache;
        paintedFromCache = true;
      } else {
        data = await fetchHubData(viewer);
        hubCache = data;
      }
      ({
        viewerId,
        site,
        meetingsRaw,
        peopleRaw,
        orgRaw,
        protectedRaw,
        prefsRaw,
        actions,
        sourceLabels,
        visibleBoards,
        categories,
        me,
      } = data);
    } else {
      viewerId = VIEWER_ID;
      meetingsRaw = JSON.stringify(BOARDS);
      peopleRaw = JSON.stringify(PEOPLE);
      orgRaw = JSON.stringify(ORG_TREE);
      protectedRaw = JSON.stringify(PROTECTED_TIMES);
      actions = parseActionsJson(JSON.stringify(ACTIONS));
      sourceLabels = Object.fromEntries(ACTION_SOURCES.map((s) => [s.instanceId, s.label]));
      parent.prepend(
        el(
          "div",
          "app-board-note",
          "Demo mode — no Power Apps host; writes are logged, not saved."
        )
      );
    }
    stopLoading();

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
    // no title bar — the tabs are the hub's top edge
    view.setChrome("", "");
    view.setMeetings(parseHubMeetings(meetingsRaw));
    view.setOrgTree(parseOrgTree(orgRaw));
    view.setPeople(parsePeople(peopleRaw), viewerId);
    view.setProtectedTimes(parseProtectedTimes(protectedRaw));
    view.setActions(actions);
    view.setSourceLabels(sourceLabels);
    view.setCanEditSite(true);
    view.setPrefs(parsePrefs(prefsRaw));
    view.setHideSettingsTab(true); // settings live behind the header cog now
    // Standard Documents rides as a hub tab. DYNAMIC import only — the
    // import gate fails the build if the hub (a board-path entry) ever
    // reaches src/docs/ statically; the area loads on first tab open.
    // …and the tab carries what is waiting for you there ("Documents ·
    // 3"), from the number the Documents screen itself last published —
    // never a second count of its own (R7: two counters drift).
    const whoId = currentViewer()?.objectId ?? "";
    let docsTaskCount = readTaskCount(whoId);
    const mountDocsTab = (_key: string, tabHost: HTMLElement) => {
      void import("../docs/docsScreen").then(({ mountDocs }) => {
        cleanups.push(
          mountDocs(tabHost, "", {
            embedded: true,
            onTaskCount: (n) => {
              if (n === docsTaskCount || view === null) return;
              docsTaskCount = n;
              // re-labels in place: the control keeps its extra-tab host,
              // so the mounted register is NOT torn down (verified in
              // LeanHub.render — a cached host only mounts once)
              view.setExtraTabs(
                [{ key: "documents", label: "Documents", count: n }],
                mountDocsTab
              );
            },
          })
        );
      });
    };
    view.setExtraTabs(
      [{ key: "documents", label: "Documents", count: docsTaskCount }],
      mountDocsTab
    );
    // a shared Documents link launched the app (or an old #/docs
    // bookmark landed here), or a notification's WORK link named a
    // document (N1): front the tab — its mount consumes any pending
    // payload
    if (
      hasPendingDocView() ||
      hasPendingWorkDoc() ||
      window.location.hash.startsWith("#/docs")
    ) {
      view.selectTab("documents");
    }
    if (hosted) {
      // categories and boards came in with the boot round — no re-query
      const colorByCategory = Object.fromEntries(
        categories.filter((c) => c.color !== "").map((c) => [c.name, c.color])
      );
      const allBoards = visibleBoards;
      const dir = allBoards.map((b) => ({
        boardId: b.boardId,
        name: b.name,
        meta: [b.category, b.site, b.department].filter(Boolean).join(" \u00b7 "),
      }));
      view.setBoards(
        dir,
        (boardId) => {
          window.location.hash = boardHash(boardId);
        },
        "Rituals"
      );
      // each ritual carries a shareable link to its latest meeting
      view.setBoardLink((boardId) => boardUrl(boardId));
      // ritual-category colours code the calendar chips + directory rows
      view.setBoardColors(
        Object.fromEntries(
          allBoards
            .filter((b) => (colorByCategory[b.category] ?? "") !== "")
            .map((b) => [b.boardId, colorByCategory[b.category]])
        )
      );
      if (paintedFromCache) {
        // the instant paint showed the LAST round's data — always refresh
        // in the background and re-feed the setters (they diff, so an
        // unchanged round repaints nothing)
        void fetchHubData(currentViewer()!)
          .then((fresh) => {
            hubCache = fresh;
            if (dead || view === null) return;
            site = fresh.site; // onProtected closes over this
            view.setMeetings(parseHubMeetings(fresh.meetingsRaw));
            view.setOrgTree(parseOrgTree(fresh.orgRaw));
            view.setPeople(parsePeople(fresh.peopleRaw), fresh.viewerId);
            view.setProtectedTimes(parseProtectedTimes(fresh.protectedRaw));
            view.setActions(fresh.actions);
            view.setSourceLabels(fresh.sourceLabels);
            view.setPrefs(parsePrefs(fresh.prefsRaw));
            const freshColors = Object.fromEntries(
              fresh.categories.filter((c) => c.color !== "").map((c) => [c.name, c.color])
            );
            view.setBoards(
              fresh.visibleBoards.map((b) => ({
                boardId: b.boardId,
                name: b.name,
                meta: [b.category, b.site, b.department].filter(Boolean).join(" · "),
              })),
              (boardId) => {
                window.location.hash = boardHash(boardId);
              },
              "Rituals"
            );
            view.setBoardColors(
              Object.fromEntries(
                fresh.visibleBoards
                  .filter((b) => (freshColors[b.category] ?? "") !== "")
                  .map((b) => [b.boardId, freshColors[b.category]])
              )
            );
          })
          .catch(() => undefined); // a failed refresh keeps the stale paint
      }
      // first access: prompt the viewer to place themselves in the org
      // (site drives meetings, actions and protected times). Modal on
      // first visit; a lighter banner remains if they skip. `me` is the
      // boot-round person (self-registered above if new).
      const meNow = me;
      if (meNow && meNow.site === "") {
        const { promptForSite } = await import("./sitePrompt");
        const saved = await promptForSite(meNow);
        if (saved) {
          // the cached round still has the empty site — drop it, or the
          // remount would repaint stale and prompt again
          hubCache = null;
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
  };
  // a refused Dataverse call now surfaces as an error (dv.ts settle) —
  // without this catch it would strand the loading spinner forever
  void boot().catch(bootFail(host, "The hub"));

  return () => {
    dead = true;
    for (const fn of cleanups.splice(0)) fn();
    view?.destroy();
  };
}
