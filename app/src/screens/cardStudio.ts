// The card studio (docs/leanboard-card-studio-plan.md) — one overlay per
// card, replacing the composer's side pane AND the separate standard-content
// screen: the live card fills the left pane and is directly editable (that IS
// setting standard content), its properties sit on the right, and Cancel /
// Save complete the edit.
//
// Everything is BUFFERED so Cancel means something. Today's composer autosaves
// settings (600ms) and the card's own saver autosaves its document (400ms);
// here both are held in memory and written once, on Save:
//
//   settings → the draft, applied to the slot only on save
//   document → onSave captured to `pendingDoc`, written to the live row on save
//   tile svg → the freshest onTile snapshot, saved with the document (so the
//              composer no longer needs its offscreen re-render)
//
// Writes that would ESCAPE that buffer are prevented rather than undone:
// `designTime: true` stops mounters writing to the store themselves (series
// rows, the StatusTile status log) and hides action raising, and cards with no
// authorable standard content render read-only (CardSpec.standardContent).

import { CardSettingsEditor } from "../../../controls/CardSettings/editor";
import { cardLabel, cardSpec } from "../../../controls/CardSettings/registry";
import {
  BoardRef,
  parseDraft,
  SettingsDraft,
  serializeDraft,
} from "../../../controls/CardSettings/types";
import { paletteMap, titleStripColor } from "../../../shared/palette";
import { assigneePeople } from "../../../shared/schema/people";
import { clear, el } from "../../../shared/ui/dom";
import { cardMounter } from "../cardRegistry";
import { appTheme } from "../cardHost";
import { markDialog, trapFocus } from "../focusTrap";
import { promptUnsaved } from "../prompts";
import { ensureLiveRow, liveRow, saveCard } from "../store/cards";
import { appPalettes } from "../store/config";
import { ManifestSlot } from "../store/mappers";
import { listPeople } from "../store/people";

export type StudioResult = "saved" | "cancelled" | "archived" | "duplicated";

export interface StudioOptions {
  boardId: string;
  /** The slot being edited. Mutated ONLY on save. */
  slot: ManifestSlot;
  /** Boards offered to the source pickers (LinkCard, action surfaces). */
  boards: BoardRef[];
  /** Just added: Cancel then drops the slot, since nothing was committed. */
  isNew?: boolean;
  /**
   * "board" edits the board template (standard content editable, Archive
   * offered). "instance" adjusts one meeting: the left pane previews THAT
   * meeting's content read-only — standard content is a template concept —
   * and there is no Archive.
   */
  mode?: "board" | "instance";
  /** Instance mode: that meeting's stored document, for the preview. */
  instanceDoc?: string;
  /**
   * The card's standard-content document, when the caller already has it —
   * the composer does, for every card, to draw its previews. Supplying it
   * skips a read and lets the pane open editable immediately; without it
   * the studio fetches, and the pane stays READ-ONLY until it arrives so an
   * edit can never be saved over content that had not loaded yet.
   */
  standardDoc?: string;
  /**
   * `standardDoc` is NEW content that has never been stored — a copied card's
   * starting point. It must be written on Save even if the maker never
   * touches the card, so it counts as pending from the outset.
   */
  seedDoc?: boolean;
  /** Persist the manifest. Called after the slot is updated, before close. */
  persist: (slot: ManifestSlot) => Promise<void>;
  /** Board mode only: move this card to the manifest's archive. */
  onArchive?: () => Promise<void>;
  /** Board mode only: offer "Duplicate" (the caller makes the copy). */
  canDuplicate?: boolean;
}

/** How long the settings pane must be quiet before the preview re-mounts.
 *  Longer than the card saver's 400ms debounce, so an in-card edit made just
 *  before a settings change has already landed in `pendingDoc`. */
const REMOUNT_QUIET_MS = 600;

/** The slot's settings as a draft (title/type folded in, as CardSettings wants). */
function draftFromSlot(slot: ManifestSlot): SettingsDraft {
  return parseDraft(
    JSON.stringify({ ...slot.settings, cardType: slot.cardType, title: slot.title })
  );
}

/** Fold an edited draft back into a slot (settings stay sparse). */
function applyDraft(slot: ManifestSlot, draft: SettingsDraft): void {
  slot.title = draft.title.trim();
  const raw = serializeDraft(draft);
  slot.settings = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
}

/**
 * Open the studio. Resolves once the overlay closes, with what happened —
 * the composer repaints on "saved" and drops a new slot on "cancelled".
 */
export function openCardStudio(opts: StudioOptions): Promise<StudioResult> {
  return new Promise<StudioResult>((resolve) => {
    const mode = opts.mode ?? "board";
    const spec = cardSpec(opts.slot.cardType);
    /** Does this card have standard content a maker can author at all? */
    const authorable = mode === "board" && (spec?.standardContent ?? "edit") === "edit";
    /** …and has that content actually loaded? Editing before it lands could
     *  save an empty document over the real one. */
    let docReady = opts.standardDoc !== undefined || mode === "instance";
    const editable = () => authorable && docReady;

    // ---- buffers (nothing here reaches the store until Save) ----
    const draft = draftFromSlot(opts.slot);
    // null = the document was never edited, so Save leaves the row alone
    let pendingDoc: string | null = opts.seedDoc ? (opts.standardDoc ?? "") : null;
    let pendingSvg = "";
    let dirty = false;
    let saving = false;

    // ---- chrome ----
    const overlay = el("div", "app-studio-overlay");
    const panel = el("div", "app-studio-panel");
    overlay.appendChild(panel);

    const head = el("div", "app-studio-head");
    const titleWrap = el("div", "app-studio-titlewrap");
    const titleEl = el("span", "app-studio-title", opts.slot.title || cardLabel(opts.slot.cardType));
    const dot = el("span", "app-studio-dot", "•");
    dot.title = "Unsaved changes";
    dot.style.visibility = "hidden";
    titleWrap.append(titleEl, dot, el("span", "app-studio-type", cardLabel(opts.slot.cardType)));
    head.appendChild(titleWrap);

    const headActions = el("div", "app-studio-headactions");
    if (mode === "board" && opts.canDuplicate) {
      const dup = el("button", "app-btn", "Duplicate") as HTMLButtonElement;
      dup.title = "Add another card set up like this one, with its standard content";
      dup.addEventListener("click", () => {
        void (async () => {
          // duplicating copies what is SAVED, so settle the edit first
          if (dirty) {
            const choice = await promptUnsaved();
            if (choice === "cancel") return;
            if (choice === "save") return void doSave("duplicated");
          }
          close("duplicated");
        })();
      });
      headActions.appendChild(dup);
    }
    if (mode === "board" && opts.onArchive) {
      const archive = el("button", "app-btn", "Archive card") as HTMLButtonElement;
      archive.title = "Take this card off the board, keeping it (and its data) to restore later";
      archive.addEventListener("click", () => {
        void (async () => {
          const ok = window.confirm(
            `Archive "${opts.slot.title || cardLabel(opts.slot.cardType)}"?\n\n` +
              "It comes off the board but keeps its settings and saved content — " +
              "add it back any time from ＋ Add card → Archived."
          );
          if (!ok) return;
          await opts.onArchive!();
          close("archived");
        })();
      });
      headActions.appendChild(archive);
    }
    head.appendChild(headActions);
    panel.appendChild(head);

    const body = el("div", "app-studio-body");
    const leftWrap = el("div", "app-studio-left");
    const leftLabel = el("div", "app-studio-panelabel");
    const leftTitle = el("span", "app-studio-panelabel-t", authorable ? "Standard content" : "Preview");
    const leftSub = el("span", "app-studio-panelabel-s", "");
    const paintLeftLabel = () => {
      leftSub.textContent = authorable
        ? docReady
          ? "what a new meeting starts from"
          : "loading…"
        : mode === "instance"
          ? "this meeting's content — edit it on the board"
          : (spec?.standardContentNote ?? "read-only");
    };
    paintLeftLabel();
    leftLabel.append(leftTitle, leftSub);
    const cardHost = el("div", "app-studio-card");
    leftWrap.append(leftLabel, cardHost);

    const rightWrap = el("div", "app-studio-right");
    const rightLabel = el("div", "app-studio-panelabel");
    rightLabel.append(el("span", "app-studio-panelabel-t", "Properties"));
    const settingsHost = el("div", "app-studio-props");
    rightWrap.append(rightLabel, settingsHost);

    body.append(leftWrap, rightWrap);
    panel.appendChild(body);

    const foot = el("div", "app-studio-foot");
    const status = el("span", "app-studio-status", "");
    const cancelBtn = el("button", "app-btn", "Cancel") as HTMLButtonElement;
    const saveBtn = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
    foot.append(status, el("span", "app-bar-gap"), cancelBtn, saveBtn);
    panel.appendChild(foot);

    document.body.appendChild(overlay);
    markDialog(panel, `${opts.slot.title || cardLabel(opts.slot.cardType)} — card setup`);
    const untrap = trapFocus(panel);

    // ---- lifecycle ----
    let unmountCard: () => void = () => undefined;
    let settings: CardSettingsEditor | null = null;
    let remountTimer: ReturnType<typeof setTimeout> | null = null;

    const close = (result: StudioResult) => {
      if (remountTimer !== null) clearTimeout(remountTimer);
      unmountCard();
      settings?.destroy();
      document.removeEventListener("keydown", onKey, true);
      untrap();
      overlay.remove();
      resolve(result);
    };

    const markDirty = () => {
      dirty = true;
      dot.style.visibility = "visible";
    };

    const tryCancel = () => {
      void (async () => {
        if (!dirty) return close("cancelled");
        const choice = await promptUnsaved();
        if (choice === "cancel") return;
        if (choice === "save") return void doSave();
        close("cancelled");
      })();
    };

    const doSave = async (then: StudioResult = "saved") => {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        applyDraft(opts.slot, draft);
        await opts.persist(opts.slot);
        // the document is written only when this card HAS standard content
        // and the maker actually touched it (a read-only pane never emits)
        if (authorable && pendingDoc !== null) {
          await ensureLiveRow(opts.boardId, opts.slot.cardId, opts.slot.cardType);
          const row = await liveRow(opts.boardId, opts.slot.cardId);
          if (row) await saveCard(row.id, pendingDoc, pendingSvg || row.tileSvg);
        }
        close(then);
      } catch (err) {
        console.warn("card studio save failed", err);
        status.textContent = "Save failed — check the connection and try again.";
        saving = false;
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tryCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void doSave();
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) tryCancel();
    });
    cancelBtn.addEventListener("click", tryCancel);
    saveBtn.addEventListener("click", () => void doSave());

    // ---- the two panes ----
    // Painted SYNCHRONOUSLY with defaults, then upgraded as data lands, so
    // the studio opens instantly instead of staring at a blank overlay while
    // Dataverse answers — and still opens at all if it never does.
    let people = assigneePeople([], []);
    let stateColors: Record<string, string> = {};
    let titleColors: Record<string, string> = {};
    let baseDoc = opts.standardDoc ?? opts.instanceDoc ?? "";

    /** (Re)mount the card with the CURRENT draft settings + buffered doc. */
    const mountCard = () => {
      unmountCard();
      unmountCard = () => undefined;
      clear(cardHost);
      const mounter = cardMounter(opts.slot.cardType);
      if (!mounter) {
        cardHost.appendChild(el("p", "app-missing", `No renderer for ${opts.slot.cardType}.`));
        return;
      }
      // the draft's settings, not the slot's — the pane shows the edit in
      // progress, which is the point of having it beside the properties
      const rawDraft = serializeDraft(draft);
      const pending = rawDraft === "" ? {} : (JSON.parse(rawDraft) as Record<string, unknown>);
      const theme = appTheme();
      const strip = titleStripColor(pending, titleColors);
      if (strip !== "") theme.titleBar = strip;
      unmountCard = mounter({
        host: cardHost,
        title: draft.title.trim() || cardLabel(opts.slot.cardType),
        boardId: opts.boardId,
        cardId: opts.slot.cardId,
        outputJson: pendingDoc ?? baseDoc,
        people,
        theme,
        palette: stateColors,
        readOnly: !editable(),
        settings: pending,
        instanceKey: `${opts.boardId}:${opts.slot.cardId}`,
        instanceWhen: "",
        actions: [],
        sources: [],
        viewer: { whoId: "", who: "" },
        designTime: true,
        // an embed must not fire a report load while its card is being
        // designed (the composer's grid preview already refuses to)
        embedPreload: false,
        onSave: (json, svg) => {
          pendingDoc = json;
          if (svg !== "") pendingSvg = svg;
          markDirty();
        },
        onTile: (svg) => {
          if (svg !== "") pendingSvg = svg;
        },
        onActions: () => undefined,
      });
    };

    const settingsEditor = new CardSettingsEditor(settingsHost, {
      onChange: () => {
        markDirty();
        titleEl.textContent = draft.title.trim() || cardLabel(opts.slot.cardType);
        // re-render the card against the new settings once the pane is quiet
        // — instant feedback that the old "Save card, then look at the tile"
        // loop never gave. The quiet window outlasts the card saver's 400ms
        // debounce, so an in-card edit has landed in pendingDoc by then.
        if (remountTimer !== null) clearTimeout(remountTimer);
        remountTimer = setTimeout(() => {
          remountTimer = null;
          mountCard();
        }, REMOUNT_QUIET_MS);
      },
    });
    settingsEditor.setTheme(appTheme());
    settingsEditor.setChrome("", "");
    settingsEditor.setBoards(opts.boards);
    settingsEditor.setDraft(draft, true); // type is fixed: chosen at add time
    settings = settingsEditor;
    mountCard();
    // a brand-new card opens ready to be named; an existing one must not have
    // its focus stolen from whatever the maker came to change
    if (opts.isNew) {
      settingsHost.querySelector<HTMLInputElement>("input")?.focus();
    }

    void (async () => {
      // roster + palettes are cosmetic (assignee chips, skills columns,
      // state/strip colours): a failure must not stop the card configuring
      const [roster, palettes] = await Promise.all([
        listPeople().catch(() => []),
        appPalettes(),
      ]);
      people = assigneePeople([], roster);
      stateColors = paletteMap(palettes.states);
      titleColors = paletteMap(palettes.titles);
      settings?.setPalettes(palettes.states, palettes.titles);

      // the standard-content document, when the caller did not supply it
      if (opts.standardDoc === undefined && mode === "board") {
        const row = await liveRow(opts.boardId, opts.slot.cardId).catch(() => null);
        if (row) {
          baseDoc = row.outputJson;
          docReady = true;
        } else {
          // never loaded: the pane stays read-only, so nothing can be typed
          // and then written over content that may well exist
          leftSub.textContent = "couldn't load — properties can still be edited";
        }
      }
      if (docReady) paintLeftLabel();
      if (overlay.isConnected) mountCard();
    })();
  });
}
