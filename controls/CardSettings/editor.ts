// The CardSettings editor — the card studio's properties pane: the chosen
// card's settings across a few tabs (Common, Card specific, and Source for a
// linked card). Each field's explanation sits behind an info icon rather
// than printed under the control, so the pane stays scannable.
//
// It still renders the card-type picker when no type is set, for harnesses
// and any caller that has not chosen one — the app picks the type up front.

import {
  defaultPalette as defaultStatePalette,
  defaultTitlePalette,
  PaletteEntry,
} from "../../shared/palette";
import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { checkItem, sectionLabel, selectInput } from "../../shared/ui/dialog";
import {
  CARD_GROUPS,
  CARDS,
  cardSpec,
  COMMON_FIELDS,
  DataPolicy,
  LINK_SOURCE_EXCLUDED,
  policyOnPick,
  THEME_FIELDS,
} from "./registry";
import { renderField, renderPromptsField, FieldHost, labelRow } from "./fields";
import { BoardRef, BoardRefCard, SettingsDraft, ThemeDraft, emptyDraft } from "./types";
import { CARDSETTINGS_CSS } from "./styles";

export interface CardSettingsCallbacks {
  onChange: (draft: SettingsDraft) => void;
  /** Selection bridge, inspector → card: the maker picked a field block
   *  in a layout builder (canvasFields). null = cleared. */
  onSelectField?: (id: string | null) => void;
}

/** What differs between the two rollups' Sources tabs. */
interface RollupKind {
  cardType: string;
  cardLabel: string;
  columnsOf: (card: BoardRefCard) => string[];
  /** Capture only: warn when a source has no ⚑ Flag column. */
  flagWarning: boolean;
}

const CAPTURE_ROLLUP_KIND: RollupKind = {
  cardType: "CaptureCard",
  cardLabel: "capture card",
  columnsOf: (c) => c.captureColumns ?? [],
  flagWarning: true,
};

const CANVAS_ROLLUP_KIND: RollupKind = {
  cardType: "CanvasCard",
  cardLabel: "canvas card",
  columnsOf: (c) => c.canvasFields ?? [],
  flagWarning: false,
};

/** A small heading inside a tab, for a group that is not a tab of its own. */
function subLabel(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "ltk-cs-sublabel";
  h.textContent = text;
  return h;
}

export class CardSettingsEditor {
  private readonly root: HTMLElement;
  private draft: SettingsDraft = emptyDraft();
  private typeLocked = false;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private search = "";
  /** Boards offered as link/rollup sources; null = not in board mode. */
  private boards: BoardRef[] | null = null;
  /** The app state palette (paletteColor selects). */
  private palette: PaletteEntry[] = defaultStatePalette();
  /** The app title-strip palette (the Common section's titleColor select). */
  private titlePalette: PaletteEntry[] = defaultTitlePalette();
  /** Which properties tab is showing. */
  private tab = "Common";
  /** The selected layout field (canvasFields builder) — the selection
   *  bridge's inspector side. null = none. */
  private selectedField: string | null = null;

  constructor(host: HTMLElement, private readonly cb: CardSettingsCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-cardsettings-css", CARDSETTINGS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.render();
  }

  /** Load a draft (edit mode) — `typeLocked` pins the card type input. */
  setDraft(draft: SettingsDraft, typeLocked: boolean): void {
    this.draft = draft;
    this.typeLocked = typeLocked;
    this.render();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  /**
   * Selection bridge, card → inspector: a field was picked on the canvas.
   * Switches to the tab holding the layout builder, repaints with that
   * field's block marked, and scrolls it into view. null clears.
   */
  setSelection(id: string | null): void {
    if (id === this.selectedField) return;
    this.selectedField = id;
    if (id !== null) {
      // the layout builder lives on the card-specific tab
      const spec = cardSpec(this.draft.cardType);
      if (spec?.config.some((f) => f.kind === "canvasFields")) this.tab = "Card specific";
    }
    this.render();
    if (id !== null) {
      const block = this.root.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
      block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /** Boards manifest (board-composer mode); null switches the section off. */
  setBoards(boards: BoardRef[] | null): void {
    if (JSON.stringify(boards) === JSON.stringify(this.boards)) return;
    this.boards = boards;
    this.render();
  }

  /** The app palettes: states (paletteColor fields) + title strips
   *  (the Common tab's titleColor select). */
  setPalettes(palette: PaletteEntry[], titlePalette: PaletteEntry[]): void {
    if (
      JSON.stringify(palette) === JSON.stringify(this.palette) &&
      JSON.stringify(titlePalette) === JSON.stringify(this.titlePalette)
    ) {
      return;
    }
    this.palette = palette;
    this.titlePalette = titlePalette;
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  private commit(): void {
    this.cb.onChange(this.draft);
  }

  // ---- rendering ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);

    const body = el("div", "ltk-cs-body");
    this.root.appendChild(body);

    if (this.draft.cardType === "" || cardSpec(this.draft.cardType) === undefined) {
      this.renderPicker(body);
    } else {
      this.renderForm(body);
    }
  }

  /** Searchable grid of the toolkit's cards. */
  private renderPicker(body: HTMLElement): void {
    body.appendChild(sectionLabel("Card type"));

    const search = el("input", "ltk-cs-search") as HTMLInputElement;
    search.type = "text";
    search.placeholder = "Search cards…";
    search.value = this.search;
    search.disabled = this.readOnly;
    body.appendChild(search);

    const grid = el("div", "ltk-cs-picker");
    body.appendChild(grid);

    const fill = () => {
      clear(grid);
      const q = this.search.trim().toLowerCase();
      const hits = CARDS.filter(
        (c) =>
          !c.hidden &&
          (q === "" ||
            c.label.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.type.toLowerCase().includes(q) ||
            c.group.toLowerCase().includes(q))
      );
      if (hits.length === 0) {
        grid.appendChild(el("div", "ltk-cs-empty", "No cards match."));
        return;
      }
      // grouped sections in canonical order; a group only shows when the
      // search leaves it something to offer
      const groups = [
        ...CARD_GROUPS,
        ...hits.map((c) => c.group).filter((g) => !CARD_GROUPS.includes(g)),
      ];
      for (const group of groups) {
        const inGroup = hits.filter((c) => c.group === group);
        if (inGroup.length === 0) continue;
        grid.appendChild(el("div", "ltk-cs-group", group));
        for (const card of inGroup) {
          const opt = el("button", "ltk-cs-cardopt");
          opt.type = "button";
          opt.disabled = this.readOnly;
          opt.appendChild(el("span", "ltk-cs-cardopt-label", card.label));
          opt.appendChild(el("span", "ltk-cs-cardopt-desc", card.description));
          opt.addEventListener("click", () => {
            this.draft.cardType = card.type;
            // board mode: stamp the type's default policy on new slots (or
            // when the current policy isn't offered by the new type) — the
            // runtime default for old unset slots stays carry
            if (this.boards !== null) {
              this.draft.board.policy = policyOnPick(
                card.type,
                this.draft.board.policy
              ) as SettingsDraft["board"]["policy"];
            }
            this.commit();
            this.render();
          });
          grid.appendChild(opt);
        }
      }
    };
    search.addEventListener("input", () => {
      this.search = search.value;
      fill();
    });
    fill();
    if (this.search !== "") search.focus();
  }

  /** The chosen card's settings form. */
  private renderForm(body: HTMLElement): void {
    const spec = cardSpec(this.draft.cardType);
    if (!spec) return;

    // A card's TYPE is chosen once, when it is added, and never changes: the
    // config keys and the document schema are both type-specific, so
    // switching would strip the configuration and orphan the content. The
    // studio's own header names the card, so this pane does not repeat it.

    const host: FieldHost = {
      readOnly: this.readOnly,
      palette: this.palette,
      titlePalette: this.titlePalette,
      onChanged: () => this.commit(),
      // the selection bridge, both directions, for layout builders
      selectedField: this.selectedField,
      onSelectField: (id) => {
        if (id === this.selectedField) return;
        this.selectedField = id;
        this.cb.onSelectField?.(id);
        // no full render — the builder marks its own blocks; a render here
        // would steal focus from the input the maker just clicked into
        this.root
          .querySelectorAll<HTMLElement>("[data-field-id]")
          .forEach((b) => b.classList.toggle("ltk-cs-col-selected", b.dataset.fieldId === id));
      },
    };

    // ---- the tabs' contents ----

    /** Common: identity and presentation, plus what each new meeting starts
     *  from (the data policy) — the settings every card shares. */
    const fillCommon = (sec: HTMLElement): void => {
      const [titleSpec, promptsSpec, roSpec] = COMMON_FIELDS;
      const grid = el("div", "ltk-cs-grid");
      grid.appendChild(
        renderField(
          titleSpec,
          () => this.draft.title,
          (v) => {
            this.draft.title = typeof v === "string" ? v : "";
          },
          host
        )
      );
      // the title strip sits beside the title it colours
      for (const f of THEME_FIELDS) {
        const key = f.key as keyof ThemeDraft;
        grid.appendChild(
          renderField(
            f,
            () => this.draft.theme[key],
            (v) => {
              this.draft.theme[key] = typeof v === "string" ? v : "";
            },
            host
          )
        );
      }
      grid.appendChild(
        renderPromptsField(
          promptsSpec,
          () => this.draft.prompts,
          (v) => {
            this.draft.prompts = v;
          },
          host
        )
      );
      grid.appendChild(
        renderField(
          roSpec,
          () => this.draft.readOnly,
          (v) => {
            this.draft.readOnly = v === true;
          },
          host
        )
      );
      sec.appendChild(grid);
      // the per-card data policy lives here too (composer mode only) —
      // but only when this card HAS a choice to make: a series card, an
      // action surface or a linked card would otherwise show a heading over
      // a paragraph explaining why there is nothing to set
      if (this.boards !== null && this.boardSectionKind() !== "none") {
        sec.appendChild(subLabel("New meeting instance"));
        this.renderBoardSection(sec);
      }
    };

    /** Card specific: the keys only this card type understands. */
    const fillConfig = (sec: HTMLElement): void => {
      if (spec.config.length === 0) {
        sec.appendChild(
          el("div", "ltk-cs-note", "This card has no settings of its own.")
        );
        return;
      }
      const cfgGrid = el("div", "ltk-cs-grid");
      for (const f of spec.config) {
        cfgGrid.appendChild(
          renderField(
            f,
            () => this.draft.config[f.key],
            (v) => {
              if (v === undefined) delete this.draft.config[f.key];
              else this.draft.config[f.key] = v;
            },
            host
          )
        );
      }
      sec.appendChild(cfgGrid);
    };

    // ---- the tab bar ----
    const tabs: { name: string; fill: (sec: HTMLElement) => void }[] = [
      { name: "Common", fill: fillCommon },
      { name: "Card specific", fill: fillConfig },
    ];
    // LinkCard (composer mode only): which board's card this one mirrors
    if (this.boards !== null && this.draft.cardType === "LinkCard") {
      tabs.push({ name: "Source", fill: (sec) => this.renderLinkSourceSection(sec) });
    }
    // Rollups (composer mode only): the linked source cards + columns
    if (this.boards !== null && this.draft.cardType === "CaptureRollup") {
      tabs.push({
        name: "Sources",
        fill: (sec) => this.renderRollupSourcesSection(sec, CAPTURE_ROLLUP_KIND),
      });
    }
    if (this.boards !== null && this.draft.cardType === "CanvasRollup") {
      tabs.push({
        name: "Sources",
        fill: (sec) => this.renderRollupSourcesSection(sec, CANVAS_ROLLUP_KIND),
      });
    }
    if (!tabs.some((t) => t.name === this.tab)) this.tab = tabs[0].name;

    const bar = el("div", "ltk-cs-tabs");
    const pane = el("div", "ltk-cs-tabbody");
    for (const t of tabs) {
      const btn = el(
        "button",
        "ltk-cs-tab" + (t.name === this.tab ? " ltk-cs-tab-on" : ""),
        t.name
      ) as HTMLButtonElement;
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (this.tab === t.name) return;
        this.tab = t.name;
        this.render();
      });
      bar.appendChild(btn);
    }
    body.append(bar, pane);
    tabs.find((t) => t.name === this.tab)!.fill(pane);
  }

  /**
   * What, if anything, the "New meeting instance" group has to offer:
   *
   *   "policy"  a real choice of what each meeting starts from
   *   "source"  an action surface's roll-up board picker
   *   "none"    nothing — a series card, or a card with no document of its
   *             own. The group is then hidden entirely rather than shown as
   *             a heading over a paragraph explaining why it is empty.
   */
  private boardSectionKind(): "policy" | "source" | "none" {
    if (
      this.draft.cardType === "ActionBoard" ||
      this.draft.cardType === "EscalationViewer"
    ) {
      return "source";
    }
    const spec = cardSpec(this.draft.cardType);
    if (spec?.seriesBacked) return "none";
    if (spec && spec.policies !== undefined && spec.policies.length === 0) return "none";
    return "policy";
  }

  /** One labelled control in the pane's own field styling, explanation on ⓘ. */
  private field(label: string, control: HTMLElement, help?: string): HTMLElement {
    const field = el("div", "ltk-cs-field");
    field.append(labelRow(label, help), control);
    return field;
  }

  /**
   * The "New meeting instance" group (composer mode only): edits the blob's
   * `board` key — read by the BOARD APP at instance creation, ignored by the
   * cards themselves. Only rendered when boardSectionKind() is not "none".
   */
  private renderBoardSection(body: HTMLElement): void {
    const boards = this.boards ?? [];
    const b = this.draft.board;
    const grid = el("div", "ltk-cs-grid");
    body.appendChild(grid);

    const boardOptions = (emptyLabel: string) => [
      { value: "", label: emptyLabel },
      ...boards.map((ref) => ({ value: ref.boardId, label: ref.name })),
    ];

    if (this.boardSectionKind() === "source") {
      const src = selectInput(b.sourceBoardId, boardOptions("This board"));
      src.disabled = this.readOnly;
      src.addEventListener("change", () => {
        b.sourceBoardId = src.value;
        b.sourceCardId = "";
        b.policy = "";
        this.commit();
      });
      grid.appendChild(
        this.field(
          "Actions from board",
          src,
          "Rolls up every action on the chosen board. Leave it on This board to show only this board's own actions."
        )
      );
      return;
    }

    const spec = cardSpec(this.draft.cardType);
    const POLICY_LABELS: Record<string, string> = {
      clear: "Clear — start each instance from the standard content",
      carry: "Carry — copy the previous instance",
      shared: "Shared — one live document across instances",
      link: "Link — show a card from another board",
    };
    const offered: DataPolicy[] = spec?.policies ?? ["clear", "carry", "shared"];
    const options = [
      { value: "", label: "Default (carry from previous)" },
      ...offered.map((p) => ({ value: p, label: POLICY_LABELS[p] })),
    ];
    // a stored policy this card no longer offers (e.g. legacy link) still
    // shows, flagged — never silently changed out from under the maker
    if (b.policy !== "" && !offered.includes(b.policy as DataPolicy)) {
      options.push({
        value: b.policy,
        label: `${POLICY_LABELS[b.policy] ?? b.policy} (no longer offered for this card)`,
      });
    }
    const policy = selectInput(b.policy, options);
    policy.disabled = this.readOnly;
    policy.addEventListener("change", () => {
      b.policy = policy.value as SettingsDraft["board"]["policy"];
      this.commit();
    });
    grid.appendChild(
      this.field(
        "Each new meeting",
        policy,
        "What this card starts from when a meeting is created. Carry keeps a " +
          "snapshot per meeting; Shared edits one running document, and every " +
          "meeting still archives a picture of it at close."
      )
    );
  }

  /**
   * LinkCard's Source section (board mode only): which board's card this
   * one mirrors. Stored in config.sourceBoardId / config.sourceCardId —
   * genuine card configuration, unlike the retired link POLICY it replaced.
   */
  private renderLinkSourceSection(body: HTMLElement): void {
    const boards = this.boards ?? [];
    const cfg = this.draft.config;
    // the collapsible section wrapper supplies the heading
    const grid = el("div", "ltk-cs-grid");
    body.appendChild(grid);

    const curBoard = typeof cfg.sourceBoardId === "string" ? cfg.sourceBoardId : "";
    const curCard = typeof cfg.sourceCardId === "string" ? cfg.sourceCardId : "";

    const srcBoard = selectInput(curBoard, [
      { value: "", label: "Choose a board…" },
      ...boards.map((ref) => ({ value: ref.boardId, label: ref.name })),
    ]);
    srcBoard.disabled = this.readOnly;
    srcBoard.addEventListener("change", () => {
      cfg.sourceBoardId = srcBoard.value;
      delete cfg.sourceCardId;
      this.commit();
      this.render(); // repopulate the card picker
    });
    grid.appendChild(
      this.field("Source board", srcBoard, "The board holding the card to show.")
    );

    const chosen = boards.find((ref) => ref.boardId === curBoard);
    const linkable = (chosen?.cards ?? []).filter(
      (c) => !LINK_SOURCE_EXCLUDED.has(c.cardType)
    );
    const srcCard = selectInput(curCard, [
      { value: "", label: chosen ? "Choose a card…" : "Choose a board first" },
      ...linkable.map((c) => ({
        value: c.cardId,
        label: c.title !== "" ? `${c.title} (${c.cardType})` : c.cardId,
      })),
    ]);
    srcCard.disabled = this.readOnly || !chosen;
    srcCard.addEventListener("change", () => {
      cfg.sourceCardId = srcCard.value;
      this.commit();
    });
    grid.appendChild(
      this.field(
        "Source card",
        srcCard,
        "Shown live and read-only, with the source card's own settings. " +
          "Embeds, action boards and other linked cards cannot be sources."
      )
    );
  }

  /**
   * The rollups' Sources tab (board mode only): the linked source cards
   * (config.sourcesJSON) and the display-column picker (config.columns —
   * names matched across sources BY LABEL). Warnings ride the pickers: a
   * capture source without a ⚑ Flag column, a column missing from some
   * sources, a stale selection no source offers any more. `kind` is what
   * differs between the capture and canvas rollups.
   */
  private renderRollupSourcesSection(body: HTMLElement, kind: RollupKind): void {
    const boards = this.boards ?? [];
    const cfg = this.draft.config;

    const readSources = (): { boardId: string; cardId: string }[] => {
      const v = cfg.sourcesJSON;
      if (!Array.isArray(v)) return [];
      return v
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({
          boardId: typeof x.boardId === "string" ? x.boardId : "",
          cardId: typeof x.cardId === "string" ? x.cardId : "",
        }));
    };
    const writeSources = (list: { boardId: string; cardId: string }[]): void => {
      if (list.length === 0) delete cfg.sourcesJSON;
      else cfg.sourcesJSON = list;
      this.commit();
      this.render();
    };
    const readColumns = (): string[] => {
      const v = cfg.columns;
      if (!Array.isArray(v)) return [];
      return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    };
    const writeColumns = (names: string[]): void => {
      if (names.length === 0) delete cfg.columns;
      else cfg.columns = names;
      this.commit();
      this.render();
    };

    const sources = readSources();
    const grid = el("div", "ltk-cs-grid");
    body.appendChild(grid);
    grid.appendChild(subLabel(`Linked ${kind.cardLabel}s`));

    const sourceCardsOf = (boardId: string) =>
      (boards.find((ref) => ref.boardId === boardId)?.cards ?? []).filter(
        (c) => c.cardType === kind.cardType
      );
    const cardOf = (src: { boardId: string; cardId: string }) =>
      sourceCardsOf(src.boardId).find((c) => c.cardId === src.cardId);

    sources.forEach((src, i) => {
      const row = el("div", "ltk-cs-rollup-source");
      const brd = selectInput(src.boardId, [
        { value: "", label: "Choose a board…" },
        ...boards.map((ref) => ({ value: ref.boardId, label: ref.name })),
      ]);
      brd.disabled = this.readOnly;
      brd.addEventListener("change", () => {
        const next = sources.slice();
        next[i] = { boardId: brd.value, cardId: "" };
        writeSources(next);
      });
      const cards = sourceCardsOf(src.boardId);
      const crd = selectInput(src.cardId, [
        {
          value: "",
          label:
            src.boardId === ""
              ? "Choose a board first"
              : cards.length === 0
                ? `No ${kind.cardLabel}s on that board`
                : `Choose a ${kind.cardLabel}…`,
        },
        ...cards.map((c) => ({ value: c.cardId, label: c.title !== "" ? c.title : c.cardId })),
      ]);
      crd.disabled = this.readOnly || src.boardId === "";
      crd.addEventListener("change", () => {
        const next = sources.slice();
        next[i] = { boardId: src.boardId, cardId: crd.value };
        writeSources(next);
      });
      const remove = el("button", "ltk-cs-rollup-remove", "✕") as HTMLButtonElement;
      remove.type = "button";
      remove.title = "Remove this source";
      remove.disabled = this.readOnly;
      remove.addEventListener("click", () => {
        writeSources(sources.filter((_, j) => j !== i));
      });
      row.append(brd, crd, remove);
      grid.appendChild(row);

      const card = cardOf(src);
      if (src.cardId !== "" && !card) {
        grid.appendChild(
          el("div", "ltk-cs-rollup-warn", "⚠ This card was not found on its board any more.")
        );
      } else if (card && kind.flagWarning && card.hasFlag !== true) {
        grid.appendChild(
          el(
            "div",
            "ltk-cs-rollup-warn",
            "⚠ No ⚑ Flag column — this card shows nothing while “Only show flagged items” is on."
          )
        );
      }
    });

    if (!this.readOnly) {
      const add = el("button", "ltk-cs-rollup-add", `＋ Add ${kind.cardLabel}`) as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", () => {
        writeSources([...sources, { boardId: "", cardId: "" }]);
      });
      grid.appendChild(add);
    }

    // ---- the display-column picker ----
    grid.appendChild(subLabel("Columns shown"));
    const chosenCards = sources
      .map(cardOf)
      .filter((c): c is BoardRefCard => c !== undefined);
    if (chosenCards.length === 0) {
      grid.appendChild(
        el("div", "ltk-cs-note", `Link a ${kind.cardLabel} above to choose its columns.`)
      );
      return;
    }

    const selected = readColumns();
    const lower = (s: string) => s.trim().toLowerCase();
    // the union of the sources' labels, in source-then-column order
    const union: string[] = [];
    for (const card of chosenCards) {
      if (!card) continue;
      for (const name of kind.columnsOf(card)) {
        if (!union.some((u) => lower(u) === lower(name))) union.push(name);
      }
    }
    const inAll = (name: string) =>
      chosenCards.every((c) => kind.columnsOf(c).some((n) => lower(n) === lower(name)));
    // stale selections first-class: still listed, so they can be unticked
    const stale = selected.filter((name) => !union.some((u) => lower(u) === lower(name)));

    const toggle = (name: string, on: boolean) => {
      const without = selected.filter((n) => lower(n) !== lower(name));
      writeColumns(on ? [...without, name] : without);
    };
    for (const name of [...union, ...stale]) {
      const isStale = stale.includes(name);
      const on = selected.some((n) => lower(n) === lower(name));
      const chk = checkItem(name);
      chk.box.checked = on;
      chk.wrap.classList.toggle("ltk-check-on", on);
      chk.box.disabled = this.readOnly;
      chk.box.addEventListener("change", () => toggle(name, chk.box.checked));
      const line = el("div", "ltk-cs-rollup-col");
      line.appendChild(chk.wrap);
      if (isStale) {
        line.appendChild(el("span", "ltk-cs-rollup-warn", "⚠ no linked card has this column"));
      } else if (!inAll(name)) {
        line.appendChild(el("span", "ltk-cs-rollup-mark", "not in all sources"));
      }
      grid.appendChild(line);
    }
    grid.appendChild(
      el(
        "div",
        "ltk-cs-note",
        "Columns are matched across the linked cards by name. The order picked is the order shown."
      )
    );
  }
}
