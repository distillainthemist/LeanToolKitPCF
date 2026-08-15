// Board setup (composer) screen — BoardGrid in edit mode, full width: add /
// drag / resize / nav order / column headings. Tapping a tile opens the CARD
// STUDIO (screens/cardStudio.ts), which owns everything about one card —
// its live standard content, its properties, and its Cancel/Save.
//
// The composer used to carry a settings pane on the right and launch a
// separate standard-content screen; both are now the studio's two panes
// (docs/leanboard-card-studio-plan.md).
//
// Two targets share this editor: the board's own manifest (board setup) and
// one instance's override manifest (adjust this meeting).

import { BoardGridView } from "../../../controls/BoardGrid/editor";
import { BoardTile, parseColumns } from "../../../controls/BoardGrid/types";
import { BoardRef, canvasCardMeta, captureCardMeta } from "../../../controls/CardSettings/types";
import { policyOnPick } from "../../../controls/CardSettings/registry";
import { paletteMap, titleStripColor } from "../../../shared/palette";
import { el } from "../../../shared/ui/dom";
import { appTheme } from "../cardHost";
import { bootFail } from "../loading";
import { detectHost } from "../runtime";
import { getBoard, listBoards, saveManifest } from "../store/boards";
import { appPalettes } from "../store/config";
import { rowsForBoard } from "../store/cards";
import { catalogSvgByType } from "../store/catalog";
import { mountTile } from "../cardRegistry";
import { getInstance, saveInstanceManifest } from "../store/instances";
import { effectivelyClosed, relockOnLeave } from "../relock";
import { openCardPicker } from "./cardPicker";
import { openCardStudio } from "./cardStudio";
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
  /** Instance mode: that meeting's record, so the studio previews its content. */
  instanceGuid?: string;
}

function mintCardId(cardType: string, taken: Set<string>): string {
  const stem = cardType.replace(/Card$/, "").toLowerCase() || "card";
  for (;;) {
    const id = `${stem}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(id)) return id;
  }
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
      },
      cleanups
    );
  })().catch(bootFail(parent, "The composer"));
  return () => cleanups.forEach((fn) => fn());
}

/**
 * Chrome-less board designer for embedding (the wizard's Meeting board
 * step): no title, no Done — the host owns navigation. Edits autosave
 * to the board's manifest exactly like the standalone editor.
 */
export async function mountDesigner(
  host: HTMLElement,
  boardId: string
): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  const board = await getBoard(boardId);
  if (!board) {
    host.appendChild(el("p", "app-missing", `Unknown board: ${boardId}`));
    return () => undefined;
  }
  await renderComposer(
    host,
    board,
    {
      title: "",
      manifest: parseManifest(board.manifestRaw),
      doneHref: "",
      persist: (m) => saveManifest(board.id, m),
    },
    cleanups
  );
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
  // the adjust screen counts as "inside the meeting" for the re-lock
  // rules — registered before any await so a mid-load departure (and a
  // plain adjust → Home) still re-locks a reopened meeting
  cleanups.push(() => relockOnLeave(boardId));
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
    // a closed (or >24h unswept) meeting is immutable — a bookmarked
    // #/adjust URL must not write an override onto the archived record
    if (effectivelyClosed(instance)) {
      parent.appendChild(
        el(
          "div",
          "app-board-note",
          "This meeting is closed — reopen it from the schedule (⋮ → Edit meeting) to adjust it."
        )
      );
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
        instanceGuid,
      },
      cleanups
    );
  })().catch(bootFail(parent, "The composer"));
  return () => cleanups.forEach((fn) => fn());
}

async function renderComposer(
  parent: HTMLElement,
  board: BoardSummary,
  target: ComposerTarget,
  cleanups: Array<() => void>
): Promise<void> {
  const manifest: BoardManifest = target.manifest;
  const instanceMode = target.instanceGuid !== undefined;
  const catalogSvg = await catalogSvgByType();
  const palettes = await appPalettes();
  const paletteColors = paletteMap(palettes.states);
  const titleColors = paletteMap(palettes.titles);

  // Per-card documents and snapshots, from one read of the board's rows:
  //   liveDoc  — the standard-content (template) row, what the studio edits
  //   liveSvg  — its snapshot, the composer's tile fallback
  //   instDoc  — instance mode: that meeting's own content, previewed
  let liveSvg: Record<string, string> = {};
  let liveDoc: Record<string, string> = {};
  let instDoc: Record<string, string> = {};
  const refreshRows = async () => {
    const rows = await rowsForBoard(board.boardId);
    liveSvg = {};
    liveDoc = {};
    instDoc = {};
    for (const r of rows) {
      if (r.instanceId === "") {
        if (r.tileSvg !== "") liveSvg[r.cardId] = r.tileSvg;
        liveDoc[r.cardId] = r.outputJson;
      } else if (r.instanceId === target.instanceGuid) {
        instDoc[r.cardId] = r.outputJson;
      }
    }
  };
  await refreshRows();

  // link/rollup sources: every board's cards, from the boards list. Capture
  // cards carry their column labels + flag marker so the capture-rollup's
  // pickers can warn about non-common columns without extra queries.
  const cardRef = (s: ManifestSlot) => ({
    cardId: s.cardId,
    cardType: s.cardType,
    title: s.title,
    ...(s.cardType === "CaptureCard" ? captureCardMeta(s.settings) : {}),
    ...(s.cardType === "CanvasCard" ? canvasCardMeta(s.settings) : {}),
  });
  const boardRefs: BoardRef[] = (await listBoards()).map((b) => ({
    boardId: b.boardId,
    name: b.name,
    cards:
      b.boardId === board.boardId
        ? [] // filled per open so freshly added cards appear
        : parseManifest(b.manifestRaw).slots.map(cardRef),
  }));
  /** Board refs with THIS board's current cards folded in (minus `exclude`). */
  const sourceRefs = (exclude: string): BoardRef[] =>
    boardRefs.map((ref) =>
      ref.boardId === board.boardId
        ? {
            ...ref,
            cards: manifest.slots.filter((s) => s.cardId !== exclude).map(cardRef),
          }
        : ref
    );

  // ---- chrome (embedded mode: no title, no Done — the wizard hosts) ----
  const bar = el("div", "app-board-toolbar");
  const status = el("span", "app-board-status", "");
  const colsSelect = el("select", "app-input") as HTMLSelectElement;
  for (let n = 1; n <= 6; n++) {
    const opt = el("option", "", `${n} column${n === 1 ? "" : "s"}`) as HTMLOptionElement;
    opt.value = String(n);
    colsSelect.appendChild(opt);
  }
  if (target.title !== "") bar.appendChild(el("span", "app-board-title", target.title));
  // archived cards are only reachable through ＋ Add card, so the count is
  // what tells a maker they are there at all
  const archivedCount = el("span", "app-board-archcount", "");
  const paintArchivedCount = () => {
    const n = instanceMode ? 0 : manifest.archivedSlots.length;
    archivedCount.textContent = n === 0 ? "" : `${n} archived`;
    archivedCount.title =
      n === 0 ? "" : "Put one back from ＋ Add card → Archived";
  };
  bar.append(status, archivedCount, el("span", "app-bar-gap"), colsSelect);
  if (target.onReset) {
    const resetBtn = el("button", "app-btn", "Reset to usual layout");
    resetBtn.addEventListener("click", () => void target.onReset!());
    bar.appendChild(resetBtn);
  }
  if (target.doneHref !== "") {
    const doneBtn = el("a", "app-btn", "Done") as HTMLAnchorElement;
    doneBtn.href = target.doneHref;
    bar.appendChild(doneBtn);
  }
  parent.appendChild(bar);

  const gridHost = el("div", "app-composer-grid");
  parent.appendChild(gridHost);

  // ---- persistence ----
  // Card edits are a transaction now (the studio's Save), so the only thing
  // saved from here is LAYOUT: moves, resizes, nav order, column headings and
  // the column count. Those are immediate — there is nothing to cancel.
  const doSave = async () => {
    await target.persist(manifest);
    status.textContent = `saved ${new Date().toLocaleTimeString()}`;
  };
  const save = () => {
    void doSave().catch((err) => console.warn("composer save failed", err));
  };

  // ---- the grid (edit mode) ----
  const gridView = new BoardGridView(gridHost, {
    onSelect: (e) => {
      if (e.action === "add") void addCard(e.pos);
      else if (e.action === "configure") void editCard(e.cardId);
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
      save();
    },
  });
  gridView.setTheme(appTheme());
  gridView.setEditMode(true);
  // Live previews while designing: the composer shows what each slot will
  // actually look like in current styling, rather than generic catalog art
  // that froze whenever the defaults were last generated. Embeds are left
  // to the stored path — a board being edited should not fire off report
  // loads (and the frames belong to a board being RUN, not designed).
  gridView.setLiveRenderer((host, tile) => {
    if (tile.cardType === "EmbedCard") return () => undefined;
    const slot = manifest.slots.find((sl) => sl.cardId === tile.cardId);
    if (!slot) return () => undefined;
    const theme = appTheme();
    const strip = titleStripColor(slot.settings, titleColors);
    if (strip !== "") theme.titleBar = strip;
    return (
      mountTile(tile.cardType, {
        host,
        title: slot.title,
        boardId: board.boardId,
        cardId: tile.cardId,
        outputJson: (instanceMode ? instDoc[tile.cardId] : undefined) ??
          liveDoc[tile.cardId] ?? "",
        theme,
        palette: paletteColors,
        settings: slot.settings,
        instanceKey: `${board.boardId}:${tile.cardId}`,
        instanceWhen: "",
        actions: [],
      }) ?? (() => undefined)
    );
  });
  cleanups.push(() => gridView.destroy());

  const previewTiles = (): BoardTile[] =>
    manifest.slots.map((slot) => ({
      pos: slot.pos,
      cardId: slot.cardId,
      cardType: slot.cardType,
      title: slot.title,
      svg: liveSvg[slot.cardId] ?? catalogSvg[slot.cardType] ?? "",
      w: slot.w,
      h: slot.h,
      barColor: titleStripColor(slot.settings, titleColors),
      nav: slot.nav,
    }));

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

  // ---- the studio ----

  /**
   * A copy source: its slot (settings to clone) and its standard content.
   * Read on demand — only when a maker actually picks one to copy.
   */
  const loadCopySource = async (
    srcBoardId: string,
    srcCardId: string
  ): Promise<{ slot: ManifestSlot; outputJson: string } | null> => {
    const slot =
      srcBoardId === board.boardId
        ? manifest.slots.find((s) => s.cardId === srcCardId)
        : parseManifest((await getBoard(srcBoardId))?.manifestRaw ?? "").slots.find(
            (s) => s.cardId === srcCardId
          );
    if (!slot) return null;
    const outputJson =
      srcBoardId === board.boardId
        ? (liveDoc[srcCardId] ?? "")
        : ((await rowsForBoard(srcBoardId)).find(
            (r) => r.cardId === srcCardId && r.instanceId === ""
          )?.outputJson ?? "");
    return { slot, outputJson };
  };

  /** Open one card. The studio owns its own Save/Cancel. */
  const openStudio = async (slot: ManifestSlot, isNew: boolean, seedDoc?: string) => {
    const result = await openCardStudio({
      boardId: board.boardId,
      slot,
      boards: sourceRefs(slot.cardId),
      isNew,
      mode: instanceMode ? "instance" : "board",
      // the composer already holds every card's document, so the studio
      // opens on it with no further read; a copy brings its source's
      // content instead, which Save must write even if untouched
      standardDoc: instanceMode ? undefined : (seedDoc ?? liveDoc[slot.cardId] ?? ""),
      seedDoc: seedDoc !== undefined,
      instanceDoc: instanceMode ? (instDoc[slot.cardId] ?? "") : undefined,
      persist: async () => {
        await target.persist(manifest);
        status.textContent = `saved ${new Date().toLocaleTimeString()}`;
      },
      canDuplicate: !instanceMode,
      onArchive: instanceMode
        ? undefined
        : async () => {
            manifest.slots = manifest.slots.filter((s) => s.cardId !== slot.cardId);
            manifest.archivedSlots.push(slot);
            await target.persist(manifest);
            paintArchivedCount();
            status.textContent = `archived ${new Date().toLocaleTimeString()}`;
          },
    });
    if (result === "saved") {
      // the studio wrote this card's document + snapshot; pick them up so
      // the tile reflects the edit
      await refreshRows();
    }
    return result;
  };

  /**
   * Copy `source` into a new independent card — a fresh cardId sharing no
   * data — and open it. `pos` 0 lands it in the next free cell.
   */
  const duplicateCard = async (source: ManifestSlot, pos: number) => {
    const copy: ManifestSlot = {
      pos,
      w: source.w,
      h: source.h,
      nav: 0, // its own place in the meeting flow, set deliberately
      cardId: freshCardId(source.cardType),
      cardType: source.cardType,
      title: source.title !== "" ? `${source.title} (copy)` : "",
      settings: JSON.parse(JSON.stringify(source.settings)) as Record<string, unknown>,
    };
    manifest.slots.push(copy);
    renderGrid();
    const result = await openStudio(copy, true, liveDoc[source.cardId] ?? "");
    if (result === "cancelled") {
      manifest.slots = manifest.slots.filter((s) => s !== copy);
    }
    renderGrid();
    return result;
  };

  const editCard = async (cardId: string) => {
    const slot = manifest.slots.find((s) => s.cardId === cardId);
    if (!slot) return;
    const result = await openStudio(slot, false);
    renderGrid();
    // "Duplicate" in the studio header: another card like this one, in the
    // next free cell, opened so it can be renamed before it is committed
    if (result === "duplicated") await duplicateCard(slot, 0);
  };

  /** A cardId nothing on this board is using, live or archived. */
  const freshCardId = (cardType: string): string =>
    mintCardId(
      cardType,
      new Set([
        ...manifest.slots.map((s) => s.cardId),
        ...manifest.archivedSlots.map((s) => s.cardId),
      ])
    );

  const addCard = async (pos: number) => {
    const picked = await openCardPicker({
      catalogSvg,
      // archive is a board-template concept: adjusting one meeting neither
      // archives nor restores
      archived: instanceMode
        ? []
        : manifest.archivedSlots.map((slot) => ({
            slot,
            svg: liveSvg[slot.cardId] ?? "",
          })),
      copySources: boardRefs.map((ref) =>
        ref.boardId === board.boardId
          ? {
              ...ref,
              cards: manifest.slots.map((s) => ({
                cardId: s.cardId,
                cardType: s.cardType,
                title: s.title,
              })),
            }
          : ref
      ),
      onDeleteArchived: async (cardId) => {
        manifest.archivedSlots = manifest.archivedSlots.filter((s) => s.cardId !== cardId);
        await target.persist(manifest);
        paintArchivedCount();
        status.textContent = `deleted ${new Date().toLocaleTimeString()}`;
      },
    });
    if (!picked) return;

    // --- restore: the slot comes back whole, so there is nothing to configure
    if (picked.kind === "archived") {
      const idx = manifest.archivedSlots.findIndex((s) => s.cardId === picked.cardId);
      if (idx < 0) return;
      const [slot] = manifest.archivedSlots.splice(idx, 1);
      slot.pos = pos;
      manifest.slots.push(slot);
      await target.persist(manifest);
      paintArchivedCount();
      status.textContent = `restored ${new Date().toLocaleTimeString()}`;
      renderGrid();
      return;
    }

    // --- new, or a copy of an existing card ---
    let slot: ManifestSlot;
    let seedDoc: string | undefined;
    if (picked.kind === "copy") {
      const src = await loadCopySource(picked.boardId, picked.cardId);
      if (!src) {
        status.textContent = "that card could not be read";
        return;
      }
      slot = {
        pos,
        w: 1,
        h: 1,
        nav: 0,
        cardId: freshCardId(src.slot.cardType),
        cardType: src.slot.cardType,
        // copying within a board would otherwise produce two identical titles
        title:
          picked.boardId === board.boardId && src.slot.title !== ""
            ? `${src.slot.title} (copy)`
            : src.slot.title,
        settings: JSON.parse(JSON.stringify(src.slot.settings)) as Record<string, unknown>,
      };
      if (picked.withContent) seedDoc = src.outputJson;
    } else {
      slot = {
        pos,
        w: 1,
        h: 1,
        nav: 0,
        cardId: freshCardId(picked.cardType),
        cardType: picked.cardType,
        title: "",
        // the type's default data policy, stamped on creation only — an
        // existing slot with no stored policy keeps the runtime default
        settings: (() => {
          const policy = policyOnPick(picked.cardType, "");
          return policy === "" ? {} : { board: { policy } };
        })(),
      };
    }
    manifest.slots.push(slot);
    renderGrid(); // show it while the studio is open
    const result = await openStudio(slot, true, seedDoc);
    if (result === "cancelled") {
      // nothing was ever persisted — drop it again
      manifest.slots = manifest.slots.filter((s) => s !== slot);
    }
    renderGrid();
  };

  renderGrid();
  paintArchivedCount();
}
