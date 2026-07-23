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
import { meetingCategories } from "../store/config";
import { markReopenedForEdit, relockOnLeave, reopenedForEditId } from "../relock";
import { viewerPerson } from "../store/people";
import { BoardSummary, parseManifest } from "../store/mappers";
import { catalogSvgByType } from "../store/catalog";
import { rowsForBoard, toLite } from "../store/cards";
import {
  closeInstance,
  createInstance,
  InstanceSummary,
  listInstances,
  reopenInstance,
  rescheduleInstance,
  resetInstance,
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
  // meetings auto-close once 24 hours past — SVGs archive, cards go
  // read-only. A meeting reopened for editing this session is spared so
  // walking its cards and returning doesn't re-lock it mid-edit.
  const stale = instances.filter(
    (i) =>
      i.status === "open" &&
      Date.parse(i.when) < Date.now() - 24 * 3_600_000 &&
      i.id !== reopenedForEditId()
  );
  for (const s of stale) await closeInstance(s);
  if (stale.length > 0) instances = await listInstances(board.boardId);
  let cardRows = await rowsForBoard(board.boardId);
  stopLoading(); // data is in — the layout below builds synchronously
  // leaving the meeting's screens re-locks a meeting opened for editing
  cleanups.push(() => relockOnLeave(board.boardId));
  let current: InstanceSummary | null = null;

  // an adjusted meeting renders its own override manifest instead
  const activeManifest = () =>
    current && current.manifestRaw.trim().startsWith("{")
      ? parseManifest(current.manifestRaw)
      : boardManifest;

  // layout: title line + (tile grid | details & schedule pane)
  const bar = el("div", "app-board-toolbar");
  const title = el("span", "app-board-title", board.name);
  const status = el("span", "app-board-status", "");
  const scheduleBtn = el("button", "app-btn", "Hide details & schedule") as HTMLButtonElement;
  // standard-board design lives in Settings → Rituals / the wizard's
  // step 2; the operational board only offers per-meeting adjustment
  // (and only when the ritual's toggle allows it)
  const adjustBtn = el("a", "app-btn", "Adjust this meeting") as HTMLAnchorElement;
  adjustBtn.style.display = "none";
  bar.append(title, status, el("span", "app-bar-gap"), scheduleBtn, adjustBtn);
  parent.appendChild(bar);

  const split = el("div", "app-board-split");
  parent.appendChild(split);
  const leftHost = el("div", "app-board-left");
  const rightHost = el("div", "app-board-right");
  // board first, the details & schedule pane on the right
  split.append(rightHost, leftHost);

  // collapse the scheduler so the board takes the full width. Arriving
  // with a pre-selected occurrence (My day / Cadence deep link) starts
  // collapsed — the meeting is the focus; otherwise it starts visible,
  // as it is the only way to pick an occurrence.
  let scheduleHidden = deepLinkIso !== "";
  const setScheduleHidden = (on: boolean) => {
    scheduleHidden = on;
    split.classList.toggle("app-board-solo", on);
    scheduleBtn.textContent = on
      ? "Show details & schedule"
      : "Hide details & schedule";
  };
  setScheduleHidden(scheduleHidden);
  scheduleBtn.addEventListener("click", () => setScheduleHidden(!scheduleHidden));

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
    // card title bars carry their theme colour; cards without one fall
    // back to the meeting/app accent (same rule as the walk view's tabs)
    const fallbackBar =
      String(((blob.theme ?? {}) as Record<string, unknown>).titlebar ?? "").trim() ||
      appTheme().titleBar;
    const tiles = joinTiles(m.slots, current.id, toLite(cardRows), catalogSvg).map(
      (t) => (t.barColor === "" ? { ...t, barColor: fallbackBar } : t)
    );
    gridView.setColumnTitles(m.columnTitles);
    gridView.setTiles(tiles, parseColumns(m.grid, tiles));
    status.textContent =
      `${current.when.slice(0, 16).replace("T", " ")} — ${current.status}` +
      (adjusted ? " · adjusted layout" : "");
    const canAdjust = instancesAdjustable && current.status === "open";
    adjustBtn.style.display = canAdjust ? "" : "none";
    adjustBtn.href = `#/adjust/${board.boardId}/${current.id}`;
  };

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
    // the explicit + on an uncreated row — no confirmation needed
    onCreate: (inst) => {
      void createAndSelect(`${inst.iso}:00Z`);
    },
    onMenu: (inst, action) => {
      const rec = instances.find((i) => i.id === inst.recordId);
      if (!rec) return;
      const dlgHost = (leftHost.querySelector(".ltk-root") as HTMLElement) ?? leftHost;
      if (action === "edit") {
        // a closed meeting reopens for editing; leaving this meeting's
        // screens (Home, Settings, another board) locks it again
        void (async () => {
          await reopenInstance(rec.id);
          markReopenedForEdit(rec.id);
          instances = await listInstances(board.boardId);
          if (current?.id === rec.id) {
            current = instances.find((i) => i.id === rec.id) ?? current;
          }
          refreshScheduler();
          renderTiles();
        })();
      } else if (action === "reset") {
        const dlg = openDialog({
          host: dlgHost,
          title: "Reset this meeting?",
          buttons: [
            { label: "Keep as is", kind: "secondary", onClick: () => dlg.close() },
            {
              label: "Reset meeting",
              kind: "primary",
              onClick: () => {
                dlg.close();
                void (async () => {
                  const stop = showLoading(split, true);
                  try {
                    await resetInstance(rec);
                    instances = await listInstances(board.boardId);
                    cardRows = await rowsForBoard(board.boardId);
                    if (current?.id === rec.id) {
                      current = instances.find((i) => i.id === rec.id) ?? current;
                    }
                    refreshScheduler();
                    renderTiles();
                  } finally {
                    stop();
                  }
                })();
              },
            },
          ],
        });
        dlg.body.appendChild(
          el(
            "p",
            "",
            "All edits on this meeting's cards go back to the newly created state — standard content and carried items are reseeded."
          )
        );
      } else {
        const when = el("input", "ltk-ms-adhocfield") as HTMLInputElement;
        when.type = "datetime-local";
        when.value = inst.iso;
        const dlg = openDialog({
          host: dlgHost,
          title: "Change date & time",
          buttons: [
            { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
            {
              label: "Move meeting",
              kind: "primary",
              onClick: () => {
                if (when.value === "") return;
                dlg.close();
                void (async () => {
                  await rescheduleInstance(rec, `${when.value.slice(0, 16)}:00Z`);
                  instances = await listInstances(board.boardId);
                  if (current?.id === rec.id) {
                    current = instances.find((i) => i.id === rec.id) ?? current;
                    rememberSelection();
                    renderTiles();
                  }
                  refreshScheduler();
                })();
              },
            },
          ],
        });
        dlg.body.appendChild(
          el("p", "", "Pick the new date and time for this meeting record.")
        );
        dlg.body.appendChild(when);
      }
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
      // inside the scheduler's themed root so the toolkit styles apply —
      // which must be visible (a hidden pane would swallow the dialog)
      if (scheduleHidden) setScheduleHidden(false);
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
      instances.map((i) => ({
        date: i.when,
        recordId: i.id,
        adhoc: i.isAdhoc,
        closed: i.status === "closed",
      }))
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

  // the pane's title bar takes the ritual-category colour; a meeting
  // without a category stays white (the card's own background)
  const cats = await meetingCategories();
  const catColor = cats.find((c) => c.name === board.category)?.color ?? "";
  const schedulerTheme = appTheme();
  schedulerTheme.titleBar = catColor !== "" ? catColor : "#ffffff";
  schedulerView.setTheme(schedulerTheme);
  schedulerView.setChrome("Details & schedule", "");
  schedulerView.setMeetingInfo(parseMeetingInfo(blobRaw));
  schedulerView.setColumns(parseMeetingColumns(s("columns")));
  // the viewer's roster crew defaults the schedule to their own meetings
  const viewerRow = await viewerPerson(currentViewer()?.objectId ?? "");
  schedulerView.setViewerCrew(viewerRow?.crew ?? "");
  refreshScheduler();
  if (deepLinkIso !== "") schedulerView.selectByIso(deepLinkIso);
}
