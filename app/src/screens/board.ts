// Board screen — the meeting board proper: left-pane MeetingScheduler
// (record matching, deep-link pre-selection), instance creation with the
// data policies on first open, the BoardGrid tile wall from the store's
// join, and close-meeting (shared-card SVG archive). Hosted-only; the dev
// server shows a banner.

import { BoardGridView } from "../../../controls/BoardGrid/editor";
import { parseColumns } from "../../../controls/BoardGrid/types";
import { MeetingSchedulerView } from "../../../controls/MeetingScheduler/editor";
import {
  generateInstances,
  parseCategory,
  parseColumns as parseMeetingColumns,
  parseCrews,
  parseDaysOfWeek,
  parseDayTopics,
  parseExistingMeetings,
  parseLocalDate,
  parseRosterPattern,
  parseTimeOfDay,
  parseWeekTopics,
  startOfDay,
} from "../../../shared/schema/recurrence";
import { parseMeetingInfo } from "../../../shared/schema/meeting";
import { openDialog } from "../../../shared/ui/dialog";
import { el } from "../../../shared/ui/dom";
import { showLoading } from "../loading";
import { appTheme } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { canViewBoard, getBoard } from "../store/boards";
import { viewerPerson } from "../store/people";
import { BoardSummary, parseManifest } from "../store/mappers";
import { catalogSvgByType } from "../store/catalog";
import { rowsForBoard, toLite } from "../store/cards";
import {
  closeInstance,
  createInstance,
  InstanceSummary,
  listInstances,
} from "../store/instances";
import { joinTiles } from "../store/tiles";

export function mountBoard(
  parent: HTMLElement,
  boardId: string,
  iso: string
): () => void {
  const cleanups: Array<() => void> = [];
  void (async () => {
    // the board + calendar fetches take a moment on cold Dataverse —
    // hold the screen with a spinner and a quote in the meantime
    const stopLoading = showLoading(parent);
    cleanups.push(stopLoading);
    const hosted = await detectHost();
    if (!hosted) {
      stopLoading();
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "The board screen needs the Power Apps host (Dataverse). Open the deployed app."
        )
      );
      return;
    }
    const board = await getBoard(boardId);
    if (!board) {
      stopLoading();
      parent.appendChild(el("p", "app-missing", `Unknown board: ${boardId}`));
      return;
    }
    if (!canViewBoard(board.occurrenceSettingsRaw, currentViewer()?.objectId ?? "")) {
      stopLoading();
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "This meeting is confidential — only its owner and participants can view it."
        )
      );
      return;
    }
    await renderBoard(parent, board, iso, cleanups, stopLoading);
  })();
  return () => cleanups.forEach((fn) => fn());
}

async function renderBoard(
  parent: HTMLElement,
  board: BoardSummary,
  deepLinkIso: string,
  cleanups: Array<() => void>,
  stopLoading: () => void
): Promise<void> {
  const boardManifest = parseManifest(board.manifestRaw);
  const catalogSvg = await catalogSvgByType();
  let instances = await listInstances(board.boardId);
  let cardRows = await rowsForBoard(board.boardId);
  stopLoading(); // data is in — the layout below builds synchronously
  let current: InstanceSummary | null = null;

  // an adjusted meeting renders its own override manifest instead
  const activeManifest = () =>
    current && current.manifestRaw.trim().startsWith("{")
      ? parseManifest(current.manifestRaw)
      : boardManifest;

  // layout: toolbar + (scheduler pane | tile grid)
  const bar = el("div", "app-board-toolbar");
  const title = el("span", "app-board-title", board.name);
  const status = el("span", "app-board-status", "");
  const scheduleBtn = el("button", "app-btn", "Hide schedule") as HTMLButtonElement;
  // standard-board design lives in Settings → Rituals / the wizard's
  // step 2; the operational board only offers per-meeting adjustment
  // (and only when the ritual's toggle allows it)
  const adjustBtn = el("a", "app-btn", "Adjust this meeting") as HTMLAnchorElement;
  adjustBtn.style.display = "none";
  const closeBtn = el("button", "app-btn", "Close meeting") as HTMLButtonElement;
  closeBtn.style.display = "none";
  bar.append(title, status, el("span", "app-bar-gap"), scheduleBtn, adjustBtn, closeBtn);
  parent.appendChild(bar);

  const split = el("div", "app-board-split");
  parent.appendChild(split);
  const leftHost = el("div", "app-board-left");
  const rightHost = el("div", "app-board-right");
  split.append(leftHost, rightHost);

  // collapse the scheduler so the board takes the full width (starts
  // visible each mount — it is the only way to pick an occurrence)
  let scheduleHidden = false;
  scheduleBtn.addEventListener("click", () => {
    scheduleHidden = !scheduleHidden;
    split.classList.toggle("app-board-solo", scheduleHidden);
    scheduleBtn.textContent = scheduleHidden ? "Show schedule" : "Hide schedule";
  });

  const gridView = new BoardGridView(rightHost, {
    onSelect: (e) => {
      if (e.action === "open" && current) {
        window.location.hash = `#/edit/${board.boardId}/${current.id}/${e.cardId}`;
      }
    },
    onLayout: () => undefined, // edit mode arrives with the composer slice
  });
  gridView.setTheme(appTheme());
  cleanups.push(() => gridView.destroy());

  const renderTiles = () => {
    if (!current) return;
    const m = activeManifest();
    const adjusted = m !== boardManifest;
    const tiles = joinTiles(m.slots, current.id, toLite(cardRows), catalogSvg);
    gridView.setColumnTitles(m.columnTitles);
    gridView.setTiles(tiles, parseColumns(m.grid, tiles));
    status.textContent =
      `${current.when.slice(0, 16).replace("T", " ")} — ${current.status}` +
      (adjusted ? " · adjusted layout" : "");
    closeBtn.style.display = current.status === "open" ? "" : "none";
    const canAdjust = instancesAdjustable && current.status === "open";
    adjustBtn.style.display = canAdjust ? "" : "none";
    adjustBtn.href = `#/adjust/${board.boardId}/${current.id}`;
  };

  closeBtn.addEventListener("click", () => {
    if (!current) return;
    void (async () => {
      await closeInstance(current!);
      current = { ...current!, status: "closed" };
      cardRows = await rowsForBoard(board.boardId); // archive svgs landed
      renderTiles();
    })();
  });

  // ---- scheduler pane ----
  const blobRaw = board.occurrenceSettingsRaw;
  const blob = blobRaw.trim().startsWith("{")
    ? (JSON.parse(blobRaw) as Record<string, unknown>)
    : {};
  const config = (blob.config ?? {}) as Record<string, unknown>;
  const s = (k: string) => String(config[k] ?? "");
  const today = startOfDay(new Date());
  // wizard toggle: participants may adjust a single meeting's board
  const instancesAdjustable = blob.instancesAdjustable === true;

  /** "Tuesday 21 July at 06:00" from a scheduler iso. */
  const friendlyWhen = (iso: string): string => {
    const day = new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const hhmm = iso.slice(11, 16);
    return hhmm === "" ? day : `${day} at ${hhmm}`;
  };

  // keep the selected occurrence in the URL (replaceState fires no
  // hashchange, so no remount) — card-editor back and browser back both
  // land on a deep link that reselects it
  const rememberSelection = () => {
    if (!current) return;
    const iso = encodeURIComponent(current.when.slice(0, 16));
    window.history.replaceState(null, "", `#/board/${board.boardId}/${iso}`);
  };

  const createAndSelect = async (whenIso: string, adhoc = false) => {
    // creating the record (plus its data-policy card rows) takes a
    // moment — overlay the whole split with the spinner + quote
    const stop = showLoading(split, true);
    try {
      current = await createInstance(board.boardId, whenIso, adhoc);
      instances = await listInstances(board.boardId);
      cardRows = await rowsForBoard(board.boardId);
      refreshScheduler();
      rememberSelection();
      renderTiles();
    } finally {
      stop();
    }
  };

  const schedulerView = new MeetingSchedulerView(leftHost, {
    onAddAdhoc: (iso) => {
      void createAndSelect(`${iso}:00Z`, true);
    },
    onSelect: (inst) => {
      const existing = instances.find((i) => i.when.startsWith(inst.iso));
      if (existing) {
        current = existing;
        rememberSelection();
        renderTiles();
        return;
      }
      // no record yet: confirm before creating (accidental taps were a
      // real source of stray instances in the pilot). Host the dialog
      // inside the scheduler's themed root so the toolkit styles apply.
      const dlg = openDialog({
        host: (leftHost.querySelector(".ltk-root") as HTMLElement) ?? leftHost,
        title: "Start this meeting?",
        buttons: [
          { label: "Not now", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "Create record",
            kind: "primary",
            onClick: () => {
              dlg.close();
              void createAndSelect(`${inst.iso}:00Z`);
            },
          },
        ],
      });
      dlg.body.appendChild(
        el(
          "p",
          "",
          `This meeting hasn't been opened yet. Create the record for ` +
            `${friendlyWhen(inst.iso)} and the board will be ready to run.`
        )
      );
    },
  });
  cleanups.push(() => schedulerView.destroy());

  const refreshScheduler = () => {
    const existingJson = JSON.stringify(
      instances.map((i) => ({ date: i.when, recordId: i.id, adhoc: i.isAdhoc }))
    );
    // the window runs [today − daysPrior, today + daysAhead]: the engine
    // counts daysPrior back from finalDate, so the span widens by ahead
    const ahead = Math.max(0, Math.round(Number(config.daysAhead ?? 0)) || 0);
    schedulerView.setInstances(
      generateInstances(
        {
          finalDate: new Date(today.getTime() + ahead * 86_400_000),
          daysPrior: Number(config.daysPrior ?? 14) + ahead,
          category: parseCategory(s("category")),
          daysOfWeek: parseDaysOfWeek(s("daysOfWeek")),
          timeOfDay: parseTimeOfDay(s("timeOfDay")),
          crews: parseCrews(s("crewList")),
          roster: parseRosterPattern(s("rosterPattern")),
          baseStart: parseLocalDate(s("baseStartDate")) ?? today,
          weekTopics: parseWeekTopics(
            Array.isArray(config.weekTopics)
              ? JSON.stringify(config.weekTopics)
              : s("weekTopics")
          ),
          dayTopics: parseDayTopics(
            config.dayTopics && typeof config.dayTopics === "object"
              ? JSON.stringify(config.dayTopics)
              : s("dayTopics")
          ),
        },
        parseExistingMeetings(existingJson),
        new Date()
      ),
      parseCrews(s("crewList"))
    );
  };

  // the app accent is the default; a blob theme (if the board carries
  // one) still wins so per-board colouring stays possible
  const blobTitleBar = String(
    ((blob.theme ?? {}) as Record<string, unknown>).titlebar ?? ""
  ).trim();
  const schedulerTheme = appTheme();
  if (blobTitleBar !== "") schedulerTheme.titleBar = blobTitleBar;
  schedulerView.setTheme(schedulerTheme);
  schedulerView.setChrome(String(blob.title ?? board.name), "");
  schedulerView.setMeetingInfo(parseMeetingInfo(blobRaw));
  schedulerView.setColumns(parseMeetingColumns(s("columns")));
  // the viewer's roster crew defaults the schedule to their own meetings
  const viewerRow = await viewerPerson(currentViewer()?.objectId ?? "");
  schedulerView.setViewerCrew(viewerRow?.crew ?? "");
  refreshScheduler();
  if (deepLinkIso !== "") schedulerView.selectByIso(deepLinkIso);
}
