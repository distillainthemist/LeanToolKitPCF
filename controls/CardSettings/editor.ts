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
import { fieldRow, sectionLabel, selectInput } from "../../shared/ui/dialog";
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
import { renderField, renderPromptsField, FieldHost } from "./fields";
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
      // the per-card data policy lives here too (composer mode only)
      if (this.boards !== null) {
        sec.appendChild(subLabel("New meeting instance"));
        this.renderBoardSection(sec);
      }
    };

    /** Card specific: the keys only this card type understands. */
    const fillConfig = (sec: HTMLElement): void => {
      if (spec.config.length === 0) {
        sec.appendChild(
          el(
            "div",
            "ltk-cs-note",
            spec.configNote ?? "This card has no card-specific settings."
          )
        );
        return;
      }
      if (spec.configNote) sec.appendChild(el("div", "ltk-cs-note", spec.configNote));
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

    if (spec.appBound.length > 0) {
      body.appendChild(
        el(
          "div",
          "ltk-cs-appbound",
          `Bound by the app at runtime (not set here): ${spec.appBound.join(", ")}.`
        )
      );
    }
  }

  /**
   * The Board section (only when a boards manifest is supplied): edits the
   * blob's `board` key — read by the BOARD APP at instance creation, ignored
   * by the cards themselves. Action surfaces (ActionBoard/EscalationViewer)
   * have no document to seed, so they get a rollup-source picker instead of
   * a data policy.
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

    const isActionSurface =
      this.draft.cardType === "ActionBoard" ||
      this.draft.cardType === "EscalationViewer";

    if (isActionSurface) {
      const src = selectInput(b.sourceBoardId, boardOptions("This board"));
      src.disabled = this.readOnly;
      src.addEventListener("change", () => {
        b.sourceBoardId = src.value;
        b.sourceCardId = "";
        b.policy = "";
        this.commit();
      });
      grid.appendChild(fieldRow("Actions from board", src));
      body.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "Rolls up every action on the chosen board (empty = the board this card sits on)."
        )
      );
      return;
    }

    const spec = cardSpec(this.draft.cardType);
    if (spec?.seriesBacked) {
      body.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "No choice needed — this card's data is a dated series: every " +
            "meeting shows its own window of the same data, and closing a " +
            "meeting archives the card's image."
        )
      );
      return;
    }
    // a no-document card (LinkCard): nothing to seed, nothing to choose
    if (spec && spec.policies !== undefined && spec.policies.length === 0) {
      body.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "No choice needed — this card has no content of its own. Closing a " +
            "meeting archives an image of what the linked card showed."
        )
      );
      return;
    }

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
    grid.appendChild(fieldRow("This card, each new instance", policy));
    body.appendChild(
      el(
        "div",
        "ltk-cs-note",
        "Per card, applied when a meeting instance is created. Carry keeps a snapshot per meeting; " +
          "Shared edits one running document (each meeting still archives its tile image at close)."
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
    grid.appendChild(fieldRow("Source board", srcBoard));

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
    grid.appendChild(fieldRow("Source card", srcCard));
    body.appendChild(
      el(
        "div",
        "ltk-cs-note",
        "Embeds, action boards and other linked cards can't be sources. The card renders with the source's own settings."
      )
    );
  }
}
