// Board setup (composer) screen — BoardGrid in edit mode on the left
// (add / drag / resize / nav order / column headings), CardSettings on
// the right for the selected slot. Two targets share the editor: the
// board's own manifest (board setup) and one instance's override
// manifest (adjust this meeting — gated by the wizard's toggle).

import { BoardGridView } from "../../../controls/BoardGrid/editor";
import { BoardTile, parseColumns } from "../../../controls/BoardGrid/types";
import { CardSettingsEditor } from "../../../controls/CardSettings/editor";
import {
  BoardRef,
  SettingsDraft,
  parseDraft,
  serializeDraft,
} from "../../../controls/CardSettings/types";
import { clear, el } from "../../../shared/ui/dom";
import { appTheme } from "../cardHost";
import { detectHost } from "../runtime";
import { getBoard, listBoards, saveManifest } from "../store/boards";
import { catalogSvgByType } from "../store/catalog";
import { getInstance, saveInstanceManifest } from "../store/instances";
import {
  BoardManifest,
  BoardSummary,
  ManifestSlot,
  parseManifest,
  serializeManifest,
} from "../store/mappers";

/** What the composer edits and where its changes go. */
interface ComposerTarget {
  title: string;
  manifest: BoardManifest;
  doneHref: string;
  persist: (manifest: BoardManifest) => Promise<void>;
  /** Instance mode only: drop the override and return to the board. */
  onReset?: () => Promise<void>;
  removeLabel: string;
}

function mintCardId(cardType: string, taken: Set<string>): string {
  const stem = cardType.replace(/Card$/, "").toLowerCase() || "card";
  for (;;) {
    const id = `${stem}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(id)) return id;
  }
}

/** The slot's settings blob as a CardSettings draft (title/type included). */
function draftFromSlot(slot: ManifestSlot): SettingsDraft {
  return parseDraft(
    JSON.stringify({ ...slot.settings, cardType: slot.cardType, title: slot.title })
  );
}

/** Fold an edited draft back into its slot (settings stay sparse). */
function applyDraft(slot: ManifestSlot, draft: SettingsDraft): void {
  slot.cardType = draft.cardType;
  slot.title = draft.title.trim();
  const raw = serializeDraft(draft);
  slot.settings = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
}

export function mountComposer(
  parent: HTMLElement,
  boardId: string,
  freshFromWizard = false
): () => void {
  const cleanups: Array<() => void> = [];
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "The meeting board editor needs the Power Apps host (Dataverse). Open the deployed app."
        )
      );
      return;
    }
    const board = await getBoard(boardId);
    if (!board) {
      parent.appendChild(el("p", "app-missing", `Unknown board: ${boardId}`));
      return;
    }
    if (freshFromWizard) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "Step 2 of 2 — the meeting is saved. Shape its board: Agenda and Actions are already in place; add or arrange cards, then press Done."
        )
      );
    }
    await renderComposer(
      parent,
      board,
      {
        title: `${board.name} — meeting board`,
        manifest: parseManifest(board.manifestRaw),
        doneHref: `#/board/${board.boardId}`,
        persist: (m) => saveManifest(board.id, m),
        removeLabel: "Remove from board",
      },
      cleanups
    );
  })();
  return () => cleanups.forEach((fn) => fn());
}

/**
 * Adjust one meeting's board without touching the template: edits land
 * in the instance's override manifest (`ben_manifestjson`), which the
 * board screen prefers over the board's own when present.
 */
export function mountInstanceComposer(
  parent: HTMLElement,
  boardId: string,
  instanceGuid: string
): () => void {
  const cleanups: Array<() => void> = [];
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "Board setup needs the Power Apps host (Dataverse). Open the deployed app."
        )
      );
      return;
    }
    const board = await getBoard(boardId);
    const instance = await getInstance(instanceGuid);
    if (!board || !instance) {
      parent.appendChild(el("p", "app-missing", `Unknown board or meeting record.`));
      return;
    }
    const doneHref = `#/board/${board.boardId}/${encodeURIComponent(
      instance.when.slice(0, 16)
    )}`;
    await renderComposer(
      parent,
      board,
      {
        title: `${board.name} — this meeting only`,
        // start from the override if one exists, else a copy of the board
        manifest: instance.manifestRaw.trim().startsWith("{")
          ? parseManifest(instance.manifestRaw)
          : parseManifest(board.manifestRaw),
        doneHref,
        persist: (m) => saveInstanceManifest(instanceGuid, serializeManifest(m)),
        onReset: async () => {
          await saveInstanceManifest(instanceGuid, "");
          window.location.hash = doneHref;
        },
        removeLabel: "Remove from this meeting",
      },
      cleanups
    );
  })();
  return () => cleanups.forEach((fn) => fn());
}

async function renderComposer(
  parent: HTMLElement,
  board: BoardSummary,
  target: ComposerTarget,
  cleanups: Array<() => void>
): Promise<void> {
  const manifest: BoardManifest = target.manifest;
  const catalogSvg = await catalogSvgByType();

  // link/rollup sources: every board's cards, from the boards list
  const boardRefs: BoardRef[] = (await listBoards()).map((b) => ({
    boardId: b.boardId,
    name: b.name,
    cards:
      b.boardId === board.boardId
        ? [] // filled per render so freshly added cards appear
        : parseManifest(b.manifestRaw).slots.map((s) => ({
            cardId: s.cardId,
            cardType: s.cardType,
            title: s.title,
          })),
  }));

  // ---- chrome ----
  const bar = el("div", "app-board-toolbar");
  const title = el("span", "app-board-title", target.title);
  const status = el("span", "app-board-status", "");
  const colsSelect = el("select", "app-input") as HTMLSelectElement;
  for (let n = 1; n <= 6; n++) {
    const opt = el("option", "", `${n} column${n === 1 ? "" : "s"}`) as HTMLOptionElement;
    opt.value = String(n);
    colsSelect.appendChild(opt);
  }
  const doneBtn = el("a", "app-btn", "Done") as HTMLAnchorElement;
  doneBtn.href = target.doneHref;
  bar.append(title, status, el("span", "app-bar-gap"), colsSelect);
  if (target.onReset) {
    const resetBtn = el("button", "app-btn", "Reset to usual layout");
    resetBtn.addEventListener("click", () => void target.onReset!());
    bar.appendChild(resetBtn);
  }
  bar.appendChild(doneBtn);
  parent.appendChild(bar);

  const split = el("div", "app-board-split app-composer-split");
  parent.appendChild(split);
  const leftHost = el("div", "app-board-left");
  const rightHost = el("div", "app-board-right");
  split.append(leftHost, rightHost);

  const pane = el("div", "app-composer-pane");
  rightHost.appendChild(pane);

  // ---- persistence (debounced; layout events save immediately) ----
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  cleanups.push(() => {
    if (saveTimer !== null) clearTimeout(saveTimer);
  });
  const doSave = async () => {
    await target.persist(manifest);
    status.textContent = `saved ${new Date().toLocaleTimeString()}`;
  };
  const save = (immediate = false) => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    if (immediate) {
      void doSave();
      return;
    }
    saveTimer = setTimeout(() => void doSave(), 600);
  };

  // ---- the grid (edit mode) ----
  let selectedCardId: string | null = null;
  /** Cell chosen via "+ Add card" for the next new slot; 0 = next free. */
  let pendingPos = 0;

  const gridView = new BoardGridView(leftHost, {
    onSelect: (e) => {
      if (e.action === "add") {
        selectedCardId = null;
        pendingPos = e.pos;
        renderPane();
      } else if (e.action === "configure") {
        selectedCardId = e.cardId;
        pendingPos = 0;
        renderPane();
      }
    },
    onLayout: (slots, columnTitles) => {
      for (const placed of slots) {
        const slot = manifest.slots.find((s) => s.cardId === placed.cardId);
        if (!slot) continue;
        slot.pos = placed.pos;
        slot.w = placed.w;
        slot.h = placed.h;
        slot.nav = placed.nav;
      }
      manifest.columnTitles = columnTitles;
      save(true);
    },
  });
  gridView.setTheme(appTheme());
  gridView.setEditMode(true);
  cleanups.push(() => gridView.destroy());

  const previewTiles = (): BoardTile[] =>
    manifest.slots.map((slot) => {
      const theme = (slot.settings.theme ?? {}) as Record<string, unknown>;
      return {
        pos: slot.pos,
        cardId: slot.cardId,
        cardType: slot.cardType,
        title: slot.title,
        svg: catalogSvg[slot.cardType] ?? "",
        w: slot.w,
        h: slot.h,
        barColor: typeof theme.titlebar === "string" ? theme.titlebar : "",
        nav: slot.nav,
      };
    });

  const renderGrid = () => {
    const tiles = previewTiles();
    gridView.setColumnTitles(manifest.columnTitles);
    gridView.setTiles(tiles, parseColumns(manifest.grid, tiles));
  };

  colsSelect.value = /^[1-6]$/.test(manifest.grid) ? manifest.grid : "3";
  colsSelect.addEventListener("change", () => {
    manifest.grid = colsSelect.value;
    renderGrid();
    save();
  });

  // ---- the settings pane ----
  let settings: CardSettingsEditor | null = null;
  cleanups.push(() => settings?.destroy());

  const sourceRefs = (): BoardRef[] =>
    boardRefs.map((ref) =>
      ref.boardId === board.boardId
        ? {
            ...ref,
            cards: manifest.slots
              .filter((s) => s.cardId !== selectedCardId)
              .map((s) => ({ cardId: s.cardId, cardType: s.cardType, title: s.title })),
          }
        : ref
    );

  const renderPane = () => {
    settings?.destroy();
    settings = null;
    clear(pane);

    const slot = manifest.slots.find((s) => s.cardId === selectedCardId) ?? null;
    if (!slot && pendingPos === 0) {
      pane.appendChild(
        el(
          "div",
          "app-composer-hint",
          "Tap ＋ Add card on an empty cell to add a card, or ✎ on a tile to configure it."
        )
      );
      return;
    }

    const head = el("div", "app-composer-panebar");
    head.appendChild(
      el("span", "app-composer-panetitle", slot ? "Configure card" : "Add card")
    );
    if (slot) {
      const remove = el("button", "app-btn app-btn-danger", target.removeLabel);
      remove.addEventListener("click", () => {
        manifest.slots = manifest.slots.filter((s) => s.cardId !== slot.cardId);
        selectedCardId = null;
        renderGrid();
        renderPane();
        save(true);
      });
      head.appendChild(remove);
    }
    pane.appendChild(head);

    const host = el("div", "app-composer-settings");
    pane.appendChild(host);
    const editor = new CardSettingsEditor(host, {
      onChange: (draft) => {
        let target = manifest.slots.find((s) => s.cardId === selectedCardId);
        if (!target) {
          if (draft.cardType === "") return; // still on the picker
          target = {
            pos: pendingPos,
            w: 1,
            h: 1,
            nav: 0,
            cardId: mintCardId(
              draft.cardType,
              new Set(manifest.slots.map((s) => s.cardId))
            ),
            cardType: draft.cardType,
            title: "",
            settings: {},
          };
          manifest.slots.push(target);
          selectedCardId = target.cardId;
          pendingPos = 0;
        }
        applyDraft(target, draft);
        renderGrid();
        save();
      },
    });
    editor.setTheme(appTheme());
    editor.setChrome(slot ? slot.title || slot.cardType : "New card", "");
    editor.setBoards(sourceRefs());
    editor.setDraft(slot ? draftFromSlot(slot) : parseDraft(""), false);
    settings = editor;
  };

  renderGrid();
  renderPane();
}
