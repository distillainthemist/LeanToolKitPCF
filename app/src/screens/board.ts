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
import { el } from "../../../shared/ui/dom";
import { appTheme } from "../cardHost";
import { detectHost } from "../runtime";
import { getBoard } from "../store/boards";
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
    const hosted = await detectHost();
    if (!hosted) {
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
      parent.appendChild(el("p", "app-missing", `Unknown board: ${boardId}`));
      return;
    }
    await renderBoard(parent, board, iso, cleanups);
  })();
  return () => cleanups.forEach((fn) => fn());
}

async function renderBoard(
  parent: HTMLElement,
  board: BoardSummary,
  deepLinkIso: string,
  cleanups: Array<() => void>
): Promise<void> {
  const manifest = parseManifest(board.manifestRaw);
  const catalogSvg = await catalogSvgByType();
  let instances = await listInstances(board.boardId);
  let cardRows = await rowsForBoard(board.boardId);
  let current: InstanceSummary | null = null;

  // layout: toolbar + (scheduler pane | tile grid)
  const bar = el("div", "app-board-toolbar");
  const title = el("span", "app-board-title", board.name);
  const status = el("span", "app-board-status", "");
  const setupBtn = el("a", "app-btn", "Board setup") as HTMLAnchorElement;
  setupBtn.href = `#/setup/${board.boardId}`;
  const closeBtn = el("button", "app-btn", "Close meeting") as HTMLButtonElement;
  closeBtn.style.display = "none";
  bar.append(title, status, el("span", "app-bar-gap"), setupBtn, closeBtn);
  parent.appendChild(bar);

  const split = el("div", "app-board-split");
  parent.appendChild(split);
  const leftHost = el("div", "app-board-left");
  const rightHost = el("div", "app-board-right");
  split.append(leftHost, rightHost);

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
    const tiles = joinTiles(manifest.slots, current.id, toLite(cardRows), catalogSvg);
    gridView.setColumnTitles(manifest.columnTitles);
    gridView.setTiles(tiles, parseColumns(manifest.grid, tiles));
    status.textContent = `${current.when.slice(0, 16).replace("T", " ")} — ${current.status}`;
    closeBtn.style.display = current.status === "open" ? "" : "none";
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

  // keep the selected occurrence in the URL (replaceState fires no
  // hashchange, so no remount) — card-editor back and browser back both
  // land on a deep link that reselects it
  const rememberSelection = () => {
    if (!current) return;
    const iso = encodeURIComponent(current.when.slice(0, 16));
    window.history.replaceState(null, "", `#/board/${board.boardId}/${iso}`);
  };

  const schedulerView = new MeetingSchedulerView(leftHost, {
    onSelect: (inst) => {
      void (async () => {
        const existing = instances.find((i) => i.when.startsWith(inst.iso));
        if (existing) {
          current = existing;
        } else {
          current = await createInstance(board.boardId, `${inst.iso}:00Z`);
          instances = await listInstances(board.boardId);
          cardRows = await rowsForBoard(board.boardId);
          refreshScheduler();
        }
        rememberSelection();
        renderTiles();
      })();
    },
  });
  cleanups.push(() => schedulerView.destroy());

  const refreshScheduler = () => {
    const existingJson = JSON.stringify(
      instances.map((i) => ({ date: i.when, recordId: i.id }))
    );
    schedulerView.setInstances(
      generateInstances(
        {
          finalDate: today,
          daysPrior: Number(config.daysPrior ?? 14),
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

  schedulerView.setTheme({
    ...appTheme(),
    titleBar:
      String(((blob.theme ?? {}) as Record<string, unknown>).titlebar ?? "") || "#8b1e1e",
  });
  schedulerView.setChrome(String(blob.title ?? board.name), "");
  schedulerView.setMeetingInfo(parseMeetingInfo(blobRaw));
  schedulerView.setColumns(parseMeetingColumns(s("columns")));
  refreshScheduler();
  if (deepLinkIso !== "") schedulerView.selectByIso(deepLinkIso);
}
