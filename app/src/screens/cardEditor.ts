// Card editor screen — one card mounted full-screen by type from the
// registry, bound to its policy's row (shared → the live document,
// otherwise this instance's row), with the save loop patching document +
// freshest tile svg. Actions ride the standard channel: the card's set
// feeds in from the central table, emitted sets upsert back (keyed
// boardId:cardId). Action surfaces (ActionBoard / EscalationViewer) have
// no document row — the actions table IS their data.

import { cardLabel } from "../../../controls/CardSettings/registry";
import { paletteMap, titleStripColor } from "../../../shared/palette";
import { assigneePeople } from "../../../shared/schema/people";
import { parseMeetingInfo } from "../../../shared/schema/meeting";
import {
  cadenceFromConfig,
  generateInstances,
  parseExistingMeetings,
  startOfDay,
  topicForDate,
} from "../../../shared/schema/recurrence";
import { readableShade, textOn } from "../../../shared/tokens";
import { openActionManager } from "../../../shared/ui/actionUi";
import { setTitleBarExtras } from "../../../shared/ui/chrome";
import { el } from "../../../shared/ui/dom";
import { statusChip } from "../../../shared/ui/format";
import { cardMounter, supportedCardTypes } from "../cardRegistry";
import { appTheme, editorHost } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { actionsForBoard, actionsForInstance, upsertActions } from "../store/actions";
import { canViewBoard, getBoard } from "../store/boards";
import { appPalettes } from "../store/config";
import { effectivelyClosed, relockOnLeave } from "../relock";
import {
  createInstanceRow,
  ensureLiveRow,
  instanceRow,
  liveRow,
  saveCard,
} from "../store/cards";
import { getInstance } from "../store/instances";
import { parseManifest, slotLinkSource, slotPolicy } from "../store/mappers";
import { listPeople } from "../store/people";
import { isActionSurface } from "../store/policies";
import { showLoading } from "../loading";
import { acquireFrame, frameKey, placeFrame } from "../embedFrames";

/**
 * "Tuesday 21 July · 06:00 · Day shift · Crew A" for the walk header —
 * the shift/crew come from running the recurrence engine over just this
 * occurrence. Decorative: any parse failure returns what it has.
 */
function occurrenceMeta(
  board: { occurrenceSettingsRaw: string },
  instance: { id: string; when: string; isAdhoc: boolean } | null
): string {
  if (!instance || instance.when === "") return "";
  const parts: string[] = [];
  const day = new Date(`${instance.when.slice(0, 10)}T00:00:00`);
  parts.push(
    `${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · ${instance.when.slice(11, 16)}`
  );
  try {
    const blobRaw = board.occurrenceSettingsRaw;
    const blob = blobRaw.trim().startsWith("{")
      ? (JSON.parse(blobRaw) as Record<string, unknown>)
      : {};
    const config = (blob.config ?? {}) as Record<string, unknown>;
    const anchor = startOfDay(day);
    const rows = generateInstances(
      { ...cadenceFromConfig(config, anchor), finalDate: anchor, daysPrior: 1 },
      parseExistingMeetings(
        JSON.stringify([{ date: instance.when, recordId: instance.id, adhoc: instance.isAdhoc }])
      ),
      new Date()
    );
    const mine = rows.find((r) => r.recordId === instance.id);
    if (mine) {
      if (mine.shift !== "") parts.push(mine.shift === "day" ? "Day shift" : "Night shift");
      if (mine.crew !== "") parts.push(`Crew ${mine.crew}`);
    }
  } catch {
    /* meta is decorative */
  }
  if (instance.isAdhoc) parts.push("ad hoc");
  return parts.join(" · ");
}

/**
 * Short-lived memo for the meeting walk (design review follow-up): a
 * card-to-card hop is a full route remount, and refetching the SAME
 * board, instance, roster and palettes on every hop is what blanked the
 * screen between cards. 60s bounds staleness; the card's own row and
 * actions are always fetched fresh — they are the live data being
 * edited, the memo covers only the walk's chrome.
 */
const WALK_TTL_MS = 60_000;
const walkMemo = new Map<string, { at: number; value: Promise<unknown> }>();
function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = walkMemo.get(key);
  if (hit && Date.now() - hit.at < WALK_TTL_MS) return hit.value as Promise<T>;
  const value = fn();
  walkMemo.set(key, { at: Date.now(), value });
  value.catch(() => walkMemo.delete(key)); // a failure must not stick
  return value;
}

export function mountCardEditor(
  parent: HTMLElement,
  boardId: string,
  instanceGuid: string,
  initialCardId: string,
  onClose?: () => void
): () => void {
  const routeCleanups: Array<() => void> = [];
  // before any await — route() drains cleanups synchronously, so a
  // mid-load departure must still re-lock a reopened meeting
  if (instanceGuid !== "live") routeCleanups.push(() => relockOnLeave(boardId));
  // the CURRENT card's teardown + DOM — swapped on every in-place hop
  // (a walk hop never routes: the old card holds the screen under a
  // light overlay until the next one is built, then they swap — Ben's
  // "hold until the new one is ready")
  let innerCleanups: Array<() => void> = [];
  routeCleanups.push(() => {
    for (const fn of innerCleanups) fn();
  });
  let currentWrap: HTMLElement | null = null;
  // two quick hops can resolve out of order (a memo-warm target beats a
  // cold one) — only the LATEST show may take the screen
  let showGen = 0;

  const show = (cardId: string, initial: boolean): void => {
    const gen = ++showGen;
    const cleanups: Array<() => void> = [];
    const wrap = el("div", "app-screen-root"); // layout-transparent wrapper
    if (!initial) wrap.style.display = "none"; // built offstage, swapped when ready
    parent.appendChild(wrap);
    // hops: a small spinner OVER the old card, not a fresh quote screen
    let holdOverlay: HTMLElement | null = null;
    if (!initial && currentWrap) {
      const oldRow = currentWrap.querySelector<HTMLElement>(".app-card-row");
      if (oldRow) {
        oldRow.style.position = "relative";
        holdOverlay = el("div", "app-hold-overlay");
        holdOverlay.appendChild(el("div", "app-loading-spinner"));
        oldRow.appendChild(holdOverlay);
      }
    }
    /** Reveal this card: tear down + remove the previous one, take over. */
    const finish = () => {
      holdOverlay?.remove();
      if (gen !== showGen) {
        // superseded by a newer hop — discard quietly, touch nothing live
        for (const fn of cleanups) fn();
        wrap.remove();
        return;
      }
      if (!initial) {
        for (const fn of innerCleanups) fn();
        currentWrap?.remove();
        wrap.style.display = "";
      }
      currentWrap = wrap;
      innerCleanups = cleanups;
    };
    /** In-place hop to another card of the SAME walk: URL updates via
     *  pushState (Back still walks history through the router), no
     *  route remount, no flash. Modified clicks keep browser behaviour. */
    const hop = (targetCardId: string, href: string) => (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.history.pushState(null, "", href);
      show(targetCardId, false);
    };
  // first entry paints the standard loading state; hops keep the old
  // card visible instead
  let stopLoading: () => void = () => undefined;
  void (async () => {
    if (initial) stopLoading = showLoading(wrap);
    const hosted = await detectHost();
    if (!hosted) {
      stopLoading();
      wrap.appendChild(
        el("div", "app-board-note", "The card editor needs the Power Apps host.")
      );
      finish();
      return;
    }
    // "live" = the card's standard content (template document), edited
    // from the board designer rather than a meeting record
    const isLive = instanceGuid === "live";
    const [board, instance] = await Promise.all([
      memo(`board|${boardId}`, () => getBoard(boardId)),
      isLive
        ? Promise.resolve(null)
        : memo(`inst|${instanceGuid}`, () => getInstance(instanceGuid)),
    ]);
    // an adjusted meeting's cards live in its override manifest, not
    // (necessarily) the board's own
    const manifest = board
      ? instance && instance.manifestRaw.trim().startsWith("{")
        ? parseManifest(instance.manifestRaw)
        : parseManifest(board.manifestRaw)
      : null;
    const slot = manifest?.slots.find((x) => x.cardId === cardId);
    if (!board || !manifest || !slot) {
      stopLoading();
      wrap.appendChild(el("p", "app-missing", `Unknown card ${cardId} on ${boardId}`));
      finish();
      return;
    }
    // meeting-record cards of a confidential meeting are for its owner and
    // participants only (live/template editing stays with the designer)
    if (
      !isLive &&
      !canViewBoard(board.occurrenceSettingsRaw, currentViewer()?.objectId ?? "")
    ) {
      stopLoading();
      wrap.appendChild(
        el(
          "div",
          "app-board-note",
          "This meeting is confidential — only its owner and participants can view it."
        )
      );
      finish();
      return;
    }

    // ---- meeting walk: rails to the top, tabs + Back inline ----
    // the sequence follows the board's nav order (unset cards trail in
    // layout order), so the tabs read as the meeting's running order
    const sequence = [...manifest.slots].sort((a, b) => {
      const ka = a.nav > 0 ? a.nav : 1000 + a.pos;
      const kb = b.nav > 0 ? b.nav : 1000 + b.pos;
      return ka - kb;
    });
    const seqIdx = sequence.findIndex((s) => s.cardId === cardId);
    const walk = !isLive && sequence.length > 1;
    const slotBar = (s: (typeof sequence)[number]): string =>
      titleStripColor(s.settings, titleColors) || appTheme().titleBar;
    const editHref = (s: (typeof sequence)[number]) =>
      `#/edit/${boardId}/${instanceGuid}/${s.cardId}`;

    const saved = el("span", "app-board-status", "");
    const backHref =
      instance && instance.when !== ""
        ? `#/board/${boardId}/${encodeURIComponent(instance.when.slice(0, 16))}`
        : `#/board/${boardId}`;

    // non-walk flavours (standard content, overlay, single-card board)
    // keep the classic toolbar; the walk view has no redundant top bar
    if (!walk) {
      const bar = el("div", "app-board-toolbar");
      const back = el("a", "app-btn", onClose ? "‹ Done" : "‹ Back") as HTMLAnchorElement;
      back.href = backHref;
      const heading =
        (slot.title || cardLabel(slot.cardType)) + (isLive ? " — standard content" : "");
      bar.append(back, el("span", "app-board-title", heading), saved);
      if (isLive) {
        bar.appendChild(
          el(
            "span",
            "app-settings-note",
            "New meetings start from this unless they carry a previous meeting."
          )
        );
        back.addEventListener("click", (e) => {
          e.preventDefault();
          // overlay host closes in place; the route flavour walks back
          if (onClose) onClose();
          else window.history.back();
        });
      }
      wrap.appendChild(bar);
    }

    const surface = isActionSurface(slot);
    // rollup scope: an action surface reads its configured source board
    // (empty = the board it sits on); a normal card reads its own actions
    const sourceBoardId = surface
      ? slotLinkSource(slot).boardId || boardId
      : boardId;
    const instanceKey = `${boardId}:${cardId}`;

    let row = null;
    if (!surface) {
      const policy = slotPolicy(slot);
      // live mode and shared cards both bind the instance-less row
      const bindLive = isLive || policy === "shared";
      row = bindLive
        ? await liveRow(boardId, cardId)
        : await instanceRow(instanceGuid, cardId);
      if (!row) {
        // no row yet (template never authored, or a card added to just
        // this meeting) — create its blank document on first open
        if (bindLive) {
          await ensureLiveRow(boardId, cardId, slot.cardType);
          row = await liveRow(boardId, cardId);
        } else {
          await createInstanceRow(instanceGuid, boardId, cardId, slot.cardType, "", "");
          row = await instanceRow(instanceGuid, cardId);
        }
      }
      if (!row) {
        stopLoading();
        wrap.appendChild(
          el("p", "app-missing", "No data row for this card yet — open the meeting first.")
        );
        finish();
        return;
      }
    }

    const mounter = cardMounter(slot.cardType);
    if (!mounter) {
      stopLoading();
      wrap.appendChild(
        el(
          "div",
          "app-board-note",
          `The ${slot.cardType} editor is not registered in the app yet ` +
            `(currently: ${supportedCardTypes().join(", ")}).`
        )
      );
      return;
    }

    const [roster, actions, palettes] = await Promise.all([
      memo("roster", () => listPeople()),
      surface ? actionsForBoard(sourceBoardId) : actionsForInstance(instanceKey),
      memo("palettes", () => appPalettes()),
    ]);
    stopLoading(); // everything below builds synchronously
    const viewer = currentViewer();
    const palette = paletteMap(palettes.states);
    const titleColors = paletteMap(palettes.titles);

    const theme = appTheme();
    const strip = titleStripColor(slot.settings, titleColors);
    if (strip !== "") theme.titleBar = strip;

    // action upserts are debounced per emitted set; the LAST set wins
    // (controls emit the full set every time, upsert is by action id)
    let actionsTimer: ReturnType<typeof setTimeout> | null = null;
    cleanups.push(() => {
      if (actionsTimer !== null) clearTimeout(actionsTimer);
    });
    const pushActions = (set: typeof actions) => {
      if (actionsTimer !== null) clearTimeout(actionsTimer);
      actionsTimer = setTimeout(() => {
        void upsertActions(set, sourceBoardId).then(() => {
          saved.textContent = `saved ${new Date().toLocaleTimeString()}`;
        });
      }, 500);
    };

    // full-height rails either side (stretching past the tabs to the
    // top); between them a column of [tabs … saved · Back] + the editor
    let host: HTMLElement;
    if (walk) {
      const walkRow = el("div", "app-card-row");
      wrap.appendChild(walkRow);
      const rail = (slot: (typeof sequence)[number] | null, dir: "prev" | "next") => {
        // glyph + caption + aria — never a bare chevron (review Phase 3.5)
        const arrow = el("a", `app-card-arrow`) as HTMLAnchorElement;
        arrow.appendChild(el("span", "app-card-arrow-glyph", dir === "prev" ? "‹" : "›"));
        arrow.appendChild(el("span", "app-card-arrow-cap", dir === "prev" ? "PREV" : "NEXT"));
        if (slot) {
          const label = slot.title || cardLabel(slot.cardType);
          arrow.href = editHref(slot);
          arrow.title = label;
          arrow.setAttribute(
            "aria-label",
            `${dir === "prev" ? "Previous" : "Next"} card: ${label}`
          );
          arrow.addEventListener("click", hop(slot.cardId, editHref(slot)));
        } else {
          arrow.classList.add("app-card-arrow-off");
          arrow.setAttribute("aria-hidden", "true");
        }
        return arrow;
      };
      const head = el("div", "app-card-head");
      const strip = el("div", "app-card-tabs");
      // windowed, never scrolling: on big boards the cards around the
      // current one (± 3) show their titles; the rest compress to their
      // order number (still clickable, full title on hover)
      const WINDOW = 3;
      let start = 0;
      let end = sequence.length;
      if (sequence.length > 2 * WINDOW + 1) {
        start = Math.max(0, seqIdx - WINDOW);
        end = Math.min(sequence.length, start + 2 * WINDOW + 1);
        start = Math.max(0, end - (2 * WINDOW + 1));
      }
      // in-window tabs by name; the remainder behind ONE labelled menu
      // (review Phase 3.1/3.2 — no number stubs, no opacity-as-selection)
      sequence.forEach((s, i) => {
        if (i < start || i >= end) return;
        const label = `${i + 1} · ${s.title || cardLabel(s.cardType)}`;
        const tab = el("a", "app-card-tab", label) as HTMLAnchorElement;
        const bg = slotBar(s);
        if (s.cardId === cardId) {
          tab.style.background = bg;
          tab.style.color = textOn(bg);
          tab.classList.add("app-card-tab-on");
        } else {
          // inactive = a tint of its own strip colour, readable text
          tab.style.background = `color-mix(in srgb, ${bg} 13%, #fff)`;
          tab.style.color = readableShade(bg);
        }
        tab.href = editHref(s);
        tab.title = label;
        if (s.cardId !== cardId) {
          tab.addEventListener("click", hop(s.cardId, editHref(s)));
        }
        strip.appendChild(tab);
      });
      const hiddenSlots = sequence
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => i < start || i >= end);
      if (hiddenSlots.length > 0) {
        const more = el(
          "button",
          "app-btn app-card-tabmore",
          `＋ ${hiddenSlots.length} more ▾`
        ) as HTMLButtonElement;
        more.type = "button";
        more.setAttribute("aria-haspopup", "menu");
        more.setAttribute("aria-expanded", "false");
        // the menu lives on document.body with FIXED positioning — the
        // tabs strip clips its own overflow (that is the windowing), so
        // an absolute child there would open invisibly
        const menu = el("div", "app-menu");
        menu.style.position = "fixed";
        for (const { s, i } of hiddenSlots) {
          const item = el(
            "a",
            "app-menuitem",
            `${i + 1} · ${s.title || cardLabel(s.cardType)}`
          ) as HTMLAnchorElement;
          item.href = editHref(s);
          const go = hop(s.cardId, editHref(s));
          item.addEventListener("click", (e) => {
            closeMenu();
            go(e);
          });
          menu.appendChild(item);
        }
        const closeMenu = () => {
          menu.remove();
          more.setAttribute("aria-expanded", "false");
        };
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          if (menu.isConnected) {
            closeMenu();
            return;
          }
          const r = more.getBoundingClientRect();
          menu.style.top = `${r.bottom + 4}px`;
          menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
          document.body.appendChild(menu);
          more.setAttribute("aria-expanded", "true");
        });
        const closeOnOutside = (e: PointerEvent) => {
          if (menu.isConnected && !menu.contains(e.target as Node) && e.target !== more) {
            closeMenu();
          }
        };
        document.addEventListener("pointerdown", closeOnOutside);
        cleanups.push(() => {
          document.removeEventListener("pointerdown", closeOnOutside);
          menu.remove();
        });
        strip.appendChild(more);
      }
      const backBtn = el("a", "app-btn app-card-back", "‹ Back to board") as HTMLAnchorElement;
      backBtn.href = backHref;
      backBtn.title = "Back to the board";

      // title line above the tabs: meeting name + occurrence details on
      // the left (closed = a chip with the word, review Phase 3.3),
      // walk position, then saved status and Back on the right
      const titleRow = el("div", "app-card-titlerow");
      titleRow.appendChild(el("span", "app-card-meeting", board.name));
      const meta = occurrenceMeta(board, instance);
      if (meta !== "") titleRow.appendChild(el("span", "app-card-meta", meta));
      if (instance && effectivelyClosed(instance)) {
        titleRow.appendChild(statusChip("🔒 Closed", "neutral"));
      }
      if (seqIdx >= 0 && sequence.length > 1) {
        titleRow.appendChild(statusChip(`Card ${seqIdx + 1} of ${sequence.length}`, "neutral"));
      }
      titleRow.append(el("span", "app-bar-gap"), saved, backBtn);
      wrap.insertBefore(titleRow, walkRow);

      head.appendChild(strip);
      // header above the rails; padding keeps it aligned with the editor
      wrap.insertBefore(head, walkRow);
      walkRow.appendChild(rail(seqIdx > 0 ? sequence[seqIdx - 1] : null, "prev"));
      host = editorHost(walkRow);
      walkRow.appendChild(
        rail(seqIdx >= 0 && seqIdx < sequence.length - 1 ? sequence[seqIdx + 1] : null, "next")
      );
    } else {
      host = editorHost(wrap);
    }
    const rowGuid = row?.id ?? "";

    // The universal "＋ Action" button — a card-LEVEL linked action from
    // every card's title bar (in addition to whatever a card raises from
    // its own elements). Registered as a title-bar extra so it survives
    // the editors' re-renders. Not on action surfaces (they ARE the
    // actions), not on the template's live row (a template must not
    // accumulate meeting actions), not when the card disables actions.
    const actionsDisabled =
      ((slot.settings.config ?? {}) as Record<string, unknown>).disableActions === true;
    const closedNow = instance ? effectivelyClosed(instance) : false;
    if (!surface && !isLive && !actionsDisabled) {
      const dlgHost = el("div", "app-dlghost");
      host.appendChild(dlgHost);
      setTitleBarExtras(host, () => {
        const btn = el("button", "ltk-titlebar-btn", "＋ Action") as HTMLButtonElement;
        btn.type = "button";
        btn.title = "Raise or manage an action linked to this card";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openActionManager({
            host: dlgHost,
            actions,
            source: "card",
            sourceId: cardId,
            seedIssue: slot.title || cardLabel(slot.cardType),
            people: assigneePeople(
              (() => {
                const info = parseMeetingInfo(board.occurrenceSettingsRaw);
                return [...(info?.owner ? [info.owner] : []), ...(info?.participants ?? [])];
              })(),
              roster
            ),
            doneColor: theme.legend[1] ?? "#107c10",
            readOnly: closedNow,
            canRaise: !closedNow,
            onChanged: () =>
              pushActions(
                actions.map((a) => (a.instanceId === "" ? { ...a, instanceId: instanceKey } : a))
              ),
          });
        });
        return [btn];
      });
      cleanups.push(() => setTitleBarExtras(host, null));
    }

    cleanups.push(
      mounter({
        host,
        title: slot.title || cardLabel(slot.cardType),
        boardId,
        cardId,
        outputJson: row?.outputJson ?? "",
        // assignee chips: the meeting's own people (owner + participants)
        // up front, the rest of the roster behind the search box. A board
        // with no meeting section keeps the full roster as chips.
        people: assigneePeople(
          (() => {
            const info = parseMeetingInfo(board.occurrenceSettingsRaw);
            return [
              ...(info?.owner ? [info.owner] : []),
              ...(info?.participants ?? []),
            ];
          })(),
          roster
        ),
        theme,
        palette,
        // a closed meeting presents its saved state — every card
        // read-only. Effective-closed also covers a >24h meeting whose
        // board nobody has visited (status still "open", never swept).
        readOnly: instance ? effectivelyClosed(instance) : false,
        settings: slot.settings,
        instanceKey,
        instanceWhen: instance?.when ?? "",
        instanceTopic: instance ? topicForDate(board.occurrenceSettingsRaw, instance.when) : "",
        actions,
        sources: manifest.slots
          .filter((s) => !isActionSurface(s))
          .map((s) => ({
            instanceId: `${boardId}:${s.cardId}`,
            label: s.title || cardLabel(s.cardType),
          })),
        viewer: {
          whoId: viewer?.objectId ?? "",
          who: viewer?.name ?? "",
        },
        onSave: (outputJson, tileSvg) => {
          if (rowGuid === "") return; // action surfaces have no document row
          void saveCard(rowGuid, outputJson, tileSvg).then(() => {
            saved.textContent = `saved ${new Date().toLocaleTimeString()}`;
          });
        },
        onActions: pushActions,
        // Adopt the frame the board already loaded rather than building our
        // own: the same element keeps its document, so opening an embed
        // costs nothing — no reload, and no repeat of the Power BI autoAuth
        // handshake. If the board never loaded one (a deep link straight to
        // the card), acquireFrame creates it here instead.
        onEmbedFrame: (slot, url) => {
          const key = frameKey(boardId, cardId);
          acquireFrame(key, url);
          placeFrame(key, slot);
        },
      })
    );
    // Park THIS card's frame on teardown — not every frame. A walk hop
    // mounts the next card BEFORE tearing the old one down (hold-until-
    // ready), so parkAllFrames() here hid the frame the incoming Embed
    // card had just placed: hop away from a Power BI embed and back, and
    // it stayed blank (Ben, 2026-08-17). Only the current card's frame is
    // ever placed in the editor, so its own key is the whole job.
    cleanups.push(() => placeFrame(frameKey(boardId, cardId), null));
    stopLoading();
    finish();
  })().catch((err) => {
    // a failed load must never strand the hold overlay or a hidden wrap
    stopLoading();
    wrap.appendChild(
      el(
        "div",
        "app-board-note",
        `The card could not load: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    finish();
  });
  };

  show(initialCardId, true);
  return () => routeCleanups.forEach((fn) => fn());
}
