// Card editor screen — one card mounted full-screen by type from the
// registry, bound to its policy's row (shared → the live document,
// otherwise this instance's row), with the save loop patching document +
// freshest tile svg. Actions ride the standard channel: the card's set
// feeds in from the central table, emitted sets upsert back (keyed
// boardId:cardId). Action surfaces (ActionBoard / EscalationViewer) have
// no document row — the actions table IS their data.

import { cardLabel } from "../../../controls/CardSettings/registry";
import { initialsFor } from "../../../shared/schema/people";
import { el } from "../../../shared/ui/dom";
import { cardMounter, supportedCardTypes } from "../cardRegistry";
import { appTheme, editorHost } from "../cardHost";
import { currentViewer, detectHost } from "../runtime";
import { actionsForBoard, actionsForInstance, upsertActions } from "../store/actions";
import { getBoard } from "../store/boards";
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

export function mountCardEditor(
  parent: HTMLElement,
  boardId: string,
  instanceGuid: string,
  cardId: string
): () => void {
  const cleanups: Array<() => void> = [];
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

    const bar = el("div", "app-board-toolbar");
    const back = el("a", "app-btn", "‹ Back") as HTMLAnchorElement;
    back.href = `#/board/${boardId}`;
    const saved = el("span", "app-board-status", "");
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
      // came from a board designer (wizard step or settings) — return there
      back.addEventListener("click", (e) => {
        e.preventDefault();
        window.history.back();
      });
    }
    parent.appendChild(bar);

    // deep-link the back button to this card's occurrence so the board
    // reselects it (and its tiles) instead of remounting unselected
    if (instance && instance.when !== "") {
      back.href = `#/board/${boardId}/${encodeURIComponent(instance.when.slice(0, 16))}`;
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

    const host = editorHost(parent);
    const rowGuid = row?.id ?? "";
    cleanups.push(
      mounter({
        host,
        title: slot.title || cardLabel(slot.cardType),
        outputJson: row?.outputJson ?? "",
        people: roster.map((p) => ({
          whoId: p.whoId,
          who: p.who,
          initials: initialsFor(p.who),
          crew: p.crew,
        })),
        theme,
        readOnly: false,
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
