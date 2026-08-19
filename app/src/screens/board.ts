// Board screen — the meeting board proper: left-pane MeetingScheduler
// (record matching, deep-link pre-selection), instance creation with the
// data policies on first open, the BoardGrid tile wall from the store's
// join, and close-meeting (shared-card SVG archive). Hosted-only; the dev
// server shows a banner.

import { BoardGridView } from "../../../controls/BoardGrid/editor";
import { BoardTile, parseColumns } from "../../../controls/BoardGrid/types";
import { MeetingSchedulerView } from "../../../controls/MeetingScheduler/editor";
import {
  cadenceFromConfig,
  generateInstances,
  parseColumns as parseMeetingColumns,
  parseCrews,
  parseExistingMeetings,
  startOfDay,
  topicForDate,
} from "../../../shared/schema/recurrence";
import { parseMeetingInfo } from "../../../shared/schema/meeting";
import { openDialog } from "../../../shared/ui/dialog";
import { clear, el } from "../../../shared/ui/dom";
import { statusChip } from "../../../shared/ui/format";
import { boardUrl, LATEST, latestInstanceIso } from "../links";
import { bootFail, showLoading } from "../loading";
import { appTheme } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { paletteMap, resolvePaletteColor, titleStripColor } from "../../../shared/palette";
import { canViewBoard, getBoard } from "../store/boards";
import { appPalettes, meetingCategories } from "../store/config";
import {
  markReopenedForEdit,
  relockOnLeave,
  reopenedForEditId,
  STALE_MS,
} from "../relock";
import { viewerPerson } from "../store/people";
import { BoardSummary, parseManifest } from "../store/mappers";
import { catalogSvgByType } from "../store/catalog";
import { rowsForBoard, toLite } from "../store/cards";
import { actionsForBoard } from "../store/actions";
import { mountTile } from "../cardRegistry";
import { acquireFrame, frameKey, parkAllFrames, placeFrame } from "../embedFrames";
import { LtkAction } from "../../../shared/schema/actions";
import {
  closeInstance,
  createInstance,
  InstanceSummary,
  listInstances,
  reopenInstance,
  rescheduleInstance,
  resetInstance,
} from "../store/instances";
import { embedPreloadEnabled, joinTiles, liveTilesEnabled } from "../store/tiles";

/** Remembers the live-tiles comparison toggle per browser. */
const LIVE_TILES_KEY = "ltk.liveTiles";

export function mountBoard(
  parent: HTMLElement,
  boardId: string,
  iso: string
): () => void {
  const cleanups: Array<() => void> = [];
  // registered BEFORE any await: route() drains cleanups synchronously,
  // so a hook pushed after the data loads is skipped when the user
  // navigates away mid-load — the re-lock must never be
  cleanups.push(() => relockOnLeave(boardId));
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
  })().catch(bootFail(parent, "The board"));
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
  // the app palettes — live tiles resolve state colours through the state
  // palette; title strips resolve through the title palette
  const palettes = await appPalettes();
  const paletteColors = paletteMap(palettes.states);
  const titleColors = paletteMap(palettes.titles);
  let instances = await listInstances(board.boardId);
  // meetings auto-close once STALE_MS past — SVGs archive, cards go
  // read-only. A meeting reopened for editing this session is spared so
  // walking its cards and returning doesn't re-lock it mid-edit.
  const reopened = reopenedForEditId();
  const stale = instances.filter(
    (i) =>
      i.status === "open" &&
      Date.parse(i.when) < Date.now() - STALE_MS &&
      i.id !== reopened
  );
  for (const s of stale) await closeInstance(s);
  if (stale.length > 0) instances = await listInstances(board.boardId);
  // "#/board/<id>/latest" — a shared link resolves to the ritual's most
  // recent meeting here, at open time, so the link never goes stale
  const selectIso =
    deepLinkIso === LATEST ? latestInstanceIso(instances) : deepLinkIso;
  let cardRows = await rowsForBoard(board.boardId);
  stopLoading(); // data is in — the layout below builds synchronously
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
  // Live vs stored tiles. Live is the default; the toggle stays so a stored
  // wall is one click away if a card ever misbehaves, and so a closed
  // meeting can show that it is rendering its archive.
  const liveBtn = el("button", "app-btn app-btn-mode", "") as HTMLButtonElement;
  const liveDot = el("span", "app-mode-dot");
  const liveLabel = el("span", "app-mode-label");
  liveBtn.append(liveDot, liveLabel);
  bar.append(title, status, el("span", "app-bar-gap"), liveBtn, scheduleBtn);
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
  let scheduleHidden = selectIso !== "";
  // a meeting created because the viewer arrived on a link to it returns
  // them to the board alone — the schedule was only opened to confirm
  let reHideAfterCreate = false;
  const setScheduleHidden = (on: boolean) => {
    scheduleHidden = on;
    split.classList.toggle("app-board-solo", on);
    scheduleBtn.textContent = on
      ? "Show details & schedule"
      : "Hide details & schedule";
  };
  setScheduleHidden(scheduleHidden);
  scheduleBtn.addEventListener("click", () => {
    reHideAfterCreate = false; // the viewer is driving the pane now
    setScheduleHidden(!scheduleHidden);
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
  cleanups.push(() => {
    gridView.destroy();
    // hide, do not destroy: the card editor may be about to adopt one
    parkAllFrames();
  });

  // ---- live tiles (see docs/leanboard-live-tiles-plan.md) ----
  // Mount the real card, display-only, instead of painting its stored svg.
  // Everything it needs comes from data the board already has: the manifest
  // slot for settings, the joined card row for the document. Actions are the
  // one extra read, and only when live is on — phase 3 batches it.
  let boardActions: LtkAction[] = [];
  const liveRenderer = (host: HTMLElement, tile: BoardTile): (() => void) => {
    const slot = activeManifest().slots.find((s) => s.cardId === tile.cardId);
    if (!slot) return () => undefined;
    const instanceKey = `${board.boardId}:${tile.cardId}`;
    const row =
      cardRows.find((r) => r.cardId === tile.cardId && r.instanceId === current?.id) ??
      cardRows.find((r) => r.cardId === tile.cardId && r.instanceId === "");
    const theme = appTheme();
    const strip = titleStripColor(slot.settings, titleColors);
    if (strip !== "") theme.titleBar = strip;
    const preload = embedPreloadEnabled(slot.settings);
    // BoardGrid re-renders often; each render re-runs this, so the tile's own
    // teardown must drop its observer or they accumulate one per render
    let unwatch: (() => void) | null = null;
    const teardown = mountTile(tile.cardType, {
      host,
      title: slot.title,
      boardId: board.boardId,
      cardId: tile.cardId,
      outputJson: row?.outputJson ?? "",
      theme,
      palette: paletteColors,
      settings: slot.settings,
      instanceKey,
      instanceWhen: current?.when ?? "",
      instanceTopic: current ? topicForDate(board.occurrenceSettingsRaw, current.when) : "",
      actions: boardActions.filter((a) => a.instanceId === instanceKey),
      // an embed tile uses the persistent frame, so opening the card is
      // instant instead of a cold cross-origin load mid-meeting
      embedPreload: preload,
      onEmbedFrame: (slotEl, url) => {
        if (!preload) return; // the card is showing its ghost instead
        unwatch = watchTileForPreload(
          frameKey(board.boardId, tile.cardId),
          slotEl,
          url
        );
      },
    });
    return () => {
      unwatch?.();
      unwatch = null;
      teardown?.();
    };
  };

  // live is the DEFAULT — only an explicit opt-out turns it off
  // Preloading, bounded but GUARANTEED.
  //
  // The first cut loaded an embed only once its tile intersected the
  // viewport. That read well and was wrong in practice: the tile wall
  // scrolls (.ltk-bg-body is overflow:auto), and nobody scrolls a meeting
  // board — they open the card. Any embed below the fold therefore never
  // preloaded at all, which is precisely the cold load this was meant to
  // remove.
  //
  // So: tiles on screen load at once, and the rest are warmed in the
  // background one at a time. A wall of sign-in-protected reports still
  // does not fire every prompt simultaneously on board open, but every
  // embed does end up loaded.
  // Tiles mount only after the board's own data has loaded, so there is
  // nothing left to yield to — waiting merely shortened the head start.
  // Just enough delay to let the wall paint first.
  const PRELOAD_SETTLE_MS = 150;
  const PRELOAD_GAP_MS = 600;
  const pendingPreloads = new Map<string, () => void>();
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;

  const drainPreloads = (): void => {
    const next = pendingPreloads.keys().next();
    if (next.done) {
      preloadTimer = null;
      return;
    }
    const run = pendingPreloads.get(next.value);
    pendingPreloads.delete(next.value);
    run?.();
    preloadTimer = setTimeout(drainPreloads, PRELOAD_GAP_MS);
  };

  function watchTileForPreload(
    key: string,
    slotEl: HTMLElement,
    url: string
  ): () => void {
    const load = () => {
      pendingPreloads.delete(key);
      acquireFrame(key, url);
      placeFrame(key, slotEl, true); // display-only on the wall
    };
    // queued from the start, so an embed the meeting never scrolls to still
    // ends up loaded; intersecting just promotes it to the front
    pendingPreloads.set(key, load);
    if (preloadTimer === null) preloadTimer = setTimeout(drainPreloads, PRELOAD_SETTLE_MS);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) load();
          else placeFrame(key, null);
        }
      },
      { rootMargin: "200px" } // start just before it scrolls into view
    );
    io.observe(slotEl);
    return () => {
      io.disconnect();
      pendingPreloads.delete(key);
    };
  }
  cleanups.push(() => {
    if (preloadTimer !== null) clearTimeout(preloadTimer);
    preloadTimer = null;
    pendingPreloads.clear();
  });

  const liveOn = () => localStorage.getItem(LIVE_TILES_KEY) !== "0";
  const applyLiveMode = () => {
    const wanted = liveOn();
    const on = liveTilesEnabled(wanted, current?.status);
    // a closed meeting always renders its stamped archive, flag or not —
    // saying so on the button, rather than silently ignoring the toggle
    const archived = wanted && current?.status === "closed";
    liveLabel.textContent = on ? "Live board" : archived ? "Archived board" : "Stored board";
    liveBtn.classList.toggle("app-mode-on", on);
    liveBtn.title = archived
      ? "This meeting is closed — the board shows the snapshots stamped when it closed"
      : on
        ? "Cards are rendering live. Click to show stored snapshots instead."
        : "Showing stored snapshots. Click to render cards live.";
    gridView.setLiveRenderer(on ? liveRenderer : null);
  };
  liveBtn.addEventListener("click", () => {
    localStorage.setItem(LIVE_TILES_KEY, liveOn() ? "0" : "1");
    void refreshBoardActions().then(applyLiveMode);
  });

  async function refreshBoardActions(): Promise<void> {
    if (!liveOn()) return;
    try {
      boardActions = await actionsForBoard(board.boardId);
    } catch (err) {
      console.warn("live tiles: board actions unavailable", err);
      boardActions = [];
    }
  }

  // BEFORE any tile is drawn: the live renderer reads boardActions as it
  // mounts, and setLiveRenderer is a no-op when the renderer is unchanged —
  // so actions arriving later would not re-render, and every live tile would
  // sit there showing none.
  await refreshBoardActions();

  const renderTiles = () => {
    if (!current) return;
    const m = activeManifest();
    const adjusted = m !== boardManifest;
    // card title bars carry their theme colour; cards without one fall
    // back to the meeting/app accent (same rule as the walk view's tabs)
    const fallbackBar =
      resolvePaletteColor(
        titleColors,
        String(((blob.theme ?? {}) as Record<string, unknown>).titlebar ?? "").trim(),
        ""
      ) || appTheme().titleBar;
    const tiles = joinTiles(
      m.slots,
      current.id,
      toLite(cardRows),
      catalogSvg,
      titleColors
    ).map((t) => (t.barColor === "" ? { ...t, barColor: fallbackBar } : t));
    gridView.setColumnTitles(m.columnTitles);
    gridView.setTiles(tiles, parseColumns(m.grid, tiles));
    // a friendly date + chips, never "2026-07-31T07:00 — closed"
    // (design review Phase 2.1)
    clear(status);
    status.appendChild(document.createTextNode(friendlyWhen(current.when)));
    if (current.status === "closed") {
      status.appendChild(statusChip("🔒 Closed — archived snapshots", "neutral"));
    }
    if (adjusted) status.appendChild(statusChip("Adjusted layout", "neutral"));
    // whether the RITUAL allows per-meeting divergence; the scheduler adds
    // the per-meeting rule (created, and never for a closed one)
    schedulerView.setCanAdjustLayout(instancesAdjustable);
    // the selected meeting decides live vs archive, so re-evaluate here
    applyLiveMode();
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
    // the pane menu's copy-link follows the selection
    schedulerView.setMeetingLink(boardUrl(board.boardId, current.when.slice(0, 16)));
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
      if (reHideAfterCreate) {
        reHideAfterCreate = false;
        setScheduleHidden(true);
      }
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
      if (action === "adjust") {
        // the scheduler only offers this for an open, created meeting
        window.location.hash = `#/adjust/${board.boardId}/${rec.id}`;
        return;
      }
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
                  const newIso = when.value.slice(0, 16);
                  await rescheduleInstance(rec, `${newIso}:00Z`);
                  instances = await listInstances(board.boardId);
                  if (current?.id === rec.id) {
                    current = instances.find((i) => i.id === rec.id) ?? current;
                    rememberSelection();
                    renderTiles();
                  }
                  refreshScheduler();
                  // the vacated cadence slot regenerates with the OLD iso,
                  // so the stale highlight must move to the record's new
                  // home (one tap on the old slot would otherwise offer to
                  // create a duplicate record)
                  schedulerView.clearSelection();
                  schedulerView.selectByIso(newIso);
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
      if (scheduleHidden) {
        setScheduleHidden(false);
        reHideAfterCreate = true; // opened only to confirm the creation
      }
      const dlg = openDialog({
        host: (leftHost.querySelector(".ltk-root") as HTMLElement) ?? leftHost,
        title: "Start this meeting?",
        buttons: [
          {
            label: "Not now",
            kind: "secondary",
            onClick: () => {
              reHideAfterCreate = false; // they stay with the schedule up
              dlg.close();
            },
          },
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
          ...cadenceFromConfig(config, today),
          finalDate: new Date(today.getTime() + ahead * 86_400_000),
          daysPrior: Number(config.daysPrior ?? 14) + ahead,
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
  // the pane header stays WHITE — the category speaks through a 4px top
  // border and a labelled chip, not a filled strip fighting the board's
  // card titlebars for attention (design review Phase 2.4)
  const schedulerTheme = appTheme();
  schedulerTheme.titleBar = "#ffffff";
  schedulerView.setTheme(schedulerTheme);
  schedulerView.setChrome("Details & schedule", "");
  if (catColor !== "") {
    rightHost.style.borderTop = `4px solid ${catColor}`;
    const catRow = el("div", "app-pane-cat");
    const dot = el("span", "app-pane-catdot");
    dot.style.background = catColor;
    catRow.append(dot, el("span", "app-pane-catname", board.category));
    rightHost.prepend(catRow);
  }
  // no selection yet: the pane menu offers the ritual's own link
  schedulerView.setMeetingLink(boardUrl(board.boardId));
  schedulerView.setMeetingInfo(parseMeetingInfo(blobRaw));
  schedulerView.setColumns(parseMeetingColumns(s("columns")));
  // the viewer's roster crew defaults the schedule to their own meetings
  const viewerRow = await viewerPerson(currentViewer()?.objectId ?? "");
  schedulerView.setViewerCrew(viewerRow?.crew ?? "");
  refreshScheduler();
  if (selectIso !== "") {
    schedulerView.selectByIso(selectIso);
    // a meeting older than the schedule window has no row to select — show
    // the schedule rather than leaving the viewer on an empty board
    if (!current) setScheduleHidden(false);
  }
  applyLiveMode(); // covers the no-instance-selected case
}
