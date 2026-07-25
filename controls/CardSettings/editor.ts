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
import { sectionLabel, selectInput } from "../../shared/ui/dialog";
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
import { BoardRef, SettingsDraft, ThemeDraft, emptyDraft } from "./types";
import { CARDSETTINGS_CSS } from "./styles";

export interface CardSettingsCallbacks {
  onChange: (draft: SettingsDraft) => void;
}

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
}
