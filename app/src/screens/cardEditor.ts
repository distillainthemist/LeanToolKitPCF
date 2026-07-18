// Card editor screen — one card mounted full-screen by type from the
// registry, bound to its policy's row (shared → the live document,
// otherwise this instance's row), with the save loop patching document +
// freshest tile svg. Unregistered card types get an honest banner.

import { initialsFor } from "../../../shared/schema/people";
import { el } from "../../../shared/ui/dom";
import { cardMounter, supportedCardTypes } from "../cardRegistry";
import { appTheme, editorHost } from "../cardHost";
import { detectHost } from "../runtime";
import { getBoard } from "../store/boards";
import { instanceRow, liveRow, saveCard } from "../store/cards";
import { parseManifest, slotPolicy } from "../store/mappers";
import { listPeople } from "../store/people";

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
    const board = await getBoard(boardId);
    const slot = board
      ? parseManifest(board.manifestRaw).slots.find((x) => x.cardId === cardId)
      : undefined;
    if (!board || !slot) {
      parent.appendChild(el("p", "app-missing", `Unknown card ${cardId} on ${boardId}`));
      return;
    }

    const bar = el("div", "app-board-toolbar");
    const back = el("a", "app-btn", "‹ Board") as HTMLAnchorElement;
    back.href = `#/board/${boardId}`;
    const saved = el("span", "app-board-status", "");
    bar.append(back, el("span", "app-board-title", slot.title || slot.cardType), saved);
    parent.appendChild(bar);

    const policy = slotPolicy(slot);
    const row =
      policy === "shared"
        ? await liveRow(boardId, cardId)
        : await instanceRow(instanceGuid, cardId);
    if (!row) {
      parent.appendChild(
        el("p", "app-missing", "No data row for this card yet — open the meeting first.")
      );
      return;
    }

    const mounter = cardMounter(slot.cardType);
    if (!mounter) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          `The ${slot.cardType} editor is not registered in the app yet ` +
            `(currently: ${supportedCardTypes().join(", ")}). Its adapter is a ~25-line addition.`
        )
      );
      return;
    }

    const roster = await listPeople();
    const theme = appTheme();
    const themeCfg = (slot.settings.theme ?? {}) as Record<string, unknown>;
    if (typeof themeCfg.titlebar === "string") theme.titleBar = themeCfg.titlebar;

    const host = editorHost(parent);
    cleanups.push(
      mounter({
        host,
        title: slot.title || slot.cardType,
        outputJson: row.outputJson,
        people: roster.map((p) => ({
          whoId: p.whoId,
          who: p.who,
          initials: initialsFor(p.who),
          crew: p.crew,
        })),
        theme,
        readOnly: false,
        onSave: (outputJson, tileSvg) => {
          void saveCard(row.id, outputJson, tileSvg).then(() => {
            saved.textContent = `saved ${new Date().toLocaleTimeString()}`;
          });
        },
      })
    );
  })();
  return () => cleanups.forEach((fn) => fn());
}
