// Card editor screen — one card mounted full-screen by type from the
// registry, bound to its policy's row (shared → the live document,
// otherwise this instance's row), with the save loop patching document +
// freshest tile svg. Actions ride the standard channel: the card's set
// feeds in from the central table, emitted sets upsert back (keyed
// boardId:cardId). Action surfaces (ActionBoard / EscalationViewer) have
// no document row — the actions table IS their data.

import { cardLabel } from "../../../controls/CardSettings/registry";
import { assigneePeople } from "../../../shared/schema/people";
import { parseMeetingInfo } from "../../../shared/schema/meeting";
import {
  generateInstances,
  parseCategory,
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
import { textOn } from "../../../shared/tokens";
import { el } from "../../../shared/ui/dom";
import { cardMounter, supportedCardTypes } from "../cardRegistry";
import { appTheme, editorHost } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { actionsForBoard, actionsForInstance, upsertActions } from "../store/actions";
import { canViewBoard, getBoard } from "../store/boards";
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
    const s = (k: string) => String(config[k] ?? "");
    const anchor = startOfDay(day);
    const rows = generateInstances(
      {
        finalDate: anchor,
        daysPrior: 1,
        category: parseCategory(s("category")),
        daysOfWeek: parseDaysOfWeek(s("daysOfWeek")),
        timeOfDay: parseTimeOfDay(s("timeOfDay")),
        crews: parseCrews(s("crewList")),
        roster: parseRosterPattern(s("rosterPattern")),
        baseStart: parseLocalDate(s("baseStartDate")) ?? anchor,
        weekTopics: parseWeekTopics(
          Array.isArray(config.weekTopics) ? JSON.stringify(config.weekTopics) : s("weekTopics")
        ),
        dayTopics: parseDayTopics(
          config.dayTopics && typeof config.dayTopics === "object"
            ? JSON.stringify(config.dayTopics)
            : s("dayTopics")
        ),
      },
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

export function mountCardEditor(
  parent: HTMLElement,
  boardId: string,
  instanceGuid: string,
  cardId: string,
  onClose?: () => void
): () => void {
  const cleanups: Array<() => void> = [];
  // before any await — route() drains cleanups synchronously, so a
  // mid-load departure must still re-lock a reopened meeting
  if (instanceGuid !== "live") cleanups.push(() => relockOnLeave(boardId));
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(
        el("div", "app-board-note", "The card editor needs the Power Apps host.")
      );
      return;
    }
    // "live" = the card's standard content (template document), edited
    // from the board designer rather than a meeting record
    const isLive = instanceGuid === "live";
    const [board, instance] = await Promise.all([
      getBoard(boardId),
      isLive ? Promise.resolve(null) : getInstance(instanceGuid),
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
      parent.appendChild(el("p", "app-missing", `Unknown card ${cardId} on ${boardId}`));
      return;
    }
    // meeting-record cards of a confidential meeting are for its owner and
    // participants only (live/template editing stays with the designer)
    if (
      !isLive &&
      !canViewBoard(board.occurrenceSettingsRaw, currentViewer()?.objectId ?? "")
    ) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "This meeting is confidential — only its owner and participants can view it."
        )
      );
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
    const slotBar = (s: (typeof sequence)[number]): string => {
      const theme = (s.settings.theme ?? {}) as Record<string, unknown>;
      return typeof theme.titlebar === "string" && theme.titlebar !== ""
        ? theme.titlebar
        : appTheme().titleBar;
    };
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
      parent.appendChild(bar);
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
        parent.appendChild(
          el("p", "app-missing", "No data row for this card yet — open the meeting first.")
        );
        return;
      }
    }

    const mounter = cardMounter(slot.cardType);
    if (!mounter) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          `The ${slot.cardType} editor is not registered in the app yet ` +
            `(currently: ${supportedCardTypes().join(", ")}).`
        )
      );
      return;
    }

    const [roster, actions] = await Promise.all([
      listPeople(),
      surface ? actionsForBoard(sourceBoardId) : actionsForInstance(instanceKey),
    ]);
    const viewer = currentViewer();

    const theme = appTheme();
    const themeCfg = (slot.settings.theme ?? {}) as Record<string, unknown>;
    if (typeof themeCfg.titlebar === "string") theme.titleBar = themeCfg.titlebar;

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
      parent.appendChild(walkRow);
      const rail = (slot: (typeof sequence)[number] | null, dir: "prev" | "next") => {
        const arrow = el(
          "a",
          `app-card-arrow`,
          dir === "prev" ? "‹" : "›"
        ) as HTMLAnchorElement;
        if (slot) {
          arrow.href = editHref(slot);
          arrow.title = slot.title || cardLabel(slot.cardType);
        } else {
          arrow.classList.add("app-card-arrow-off");
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
      sequence.forEach((s, i) => {
        const wide = i >= start && i < end;
        const label = s.title || cardLabel(s.cardType);
        const tab = el(
          "a",
          "app-card-tab",
          wide ? label : String(i + 1)
        ) as HTMLAnchorElement;
        const bg = slotBar(s);
        tab.style.background = bg;
        tab.style.color = textOn(bg);
        tab.href = editHref(s);
        tab.title = `${i + 1} · ${label}`;
        if (!wide) tab.classList.add("app-card-tab-thin");
        if (s.cardId === cardId) tab.classList.add("app-card-tab-on");
        strip.appendChild(tab);
      });
      const backBtn = el("a", "app-btn app-card-back", "‹ Back") as HTMLAnchorElement;
      backBtn.href = backHref;
      backBtn.title = "Back to the board";

      // title line above the tabs: meeting name + occurrence details on
      // the left, saved status and Back on the right
      const titleRow = el("div", "app-card-titlerow");
      titleRow.appendChild(el("span", "app-card-meeting", board.name));
      let meta = occurrenceMeta(board, instance);
      if (instance && effectivelyClosed(instance)) {
        meta = meta === "" ? "closed" : `${meta} · closed`;
      }
      if (meta !== "") titleRow.appendChild(el("span", "app-card-meta", meta));
      titleRow.append(el("span", "app-bar-gap"), saved, backBtn);
      parent.insertBefore(titleRow, walkRow);

      head.appendChild(strip);
      // header above the rails; padding keeps it aligned with the editor
      parent.insertBefore(head, walkRow);
      walkRow.appendChild(rail(seqIdx > 0 ? sequence[seqIdx - 1] : null, "prev"));
      host = editorHost(walkRow);
      walkRow.appendChild(
        rail(seqIdx >= 0 && seqIdx < sequence.length - 1 ? sequence[seqIdx + 1] : null, "next")
      );
    } else {
      host = editorHost(parent);
    }
    const rowGuid = row?.id ?? "";
    cleanups.push(
      mounter({
        host,
        title: slot.title || cardLabel(slot.cardType),
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
        // a closed meeting presents its saved state — every card
        // read-only. Effective-closed also covers a >24h meeting whose
        // board nobody has visited (status still "open", never swept).
        readOnly: instance ? effectivelyClosed(instance) : false,
        settings: slot.settings,
        instanceKey,
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
      })
    );
  })();
  return () => cleanups.forEach((fn) => fn());
}
