// The CardSettings editor: pick a card type (searchable grid of the toolkit's
// cards), then edit its settings in sections — Common, Theme, Configuration.
// This shell renders the picker and the chosen-card frame; the typed field
// editors populate the sections (step 3).

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { sectionLabel } from "../../shared/ui/dialog";
import { CARDS, cardSpec, COMMON_FIELDS, THEME_FIELDS } from "./registry";
import { renderField, renderPromptsField, FieldHost } from "./fields";
import { SettingsDraft, ThemeDraft, emptyDraft } from "./types";
import { CARDSETTINGS_CSS } from "./styles";

export interface CardSettingsCallbacks {
  onChange: (draft: SettingsDraft) => void;
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
          q === "" ||
          c.label.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q)
      );
      if (hits.length === 0) {
        grid.appendChild(el("div", "ltk-cs-empty", "No cards match."));
        return;
      }
      for (const card of hits) {
        const opt = el("button", "ltk-cs-cardopt");
        opt.type = "button";
        opt.disabled = this.readOnly;
        opt.appendChild(el("span", "ltk-cs-cardopt-label", card.label));
        opt.appendChild(el("span", "ltk-cs-cardopt-desc", card.description));
        opt.addEventListener("click", () => {
          this.draft.cardType = card.type;
          this.commit();
          this.render();
        });
        grid.appendChild(opt);
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

    const head = el("div", "ltk-cs-chosen");
    head.appendChild(el("span", "ltk-cs-chosen-label", spec.label));
    head.appendChild(el("span", "ltk-cs-chosen-desc", spec.description));
    if (!this.typeLocked && !this.readOnly) {
      const change = el("button", "ltk-cs-change", "Change card type");
      change.type = "button";
      change.title =
        "Title, prompts and theme carry over; card-specific configuration does not.";
      change.addEventListener("click", () => {
        this.draft.cardType = "";
        this.draft.config = {}; // config keys don't transfer between cards
        this.search = "";
        this.commit();
        this.render();
      });
      head.appendChild(change);
    }
    body.appendChild(head);

    const host: FieldHost = {
      readOnly: this.readOnly,
      onChanged: () => this.commit(),
    };

    // Common: title, prompts, read-only
    body.appendChild(sectionLabel("Common"));
    const common = el("div", "ltk-cs-grid");
    const [titleSpec, promptsSpec, roSpec] = COMMON_FIELDS;
    common.appendChild(
      renderField(
        titleSpec,
        () => this.draft.title,
        (v) => {
          this.draft.title = typeof v === "string" ? v : "";
        },
        host
      )
    );
    common.appendChild(
      renderPromptsField(
        promptsSpec,
        () => this.draft.prompts,
        (v) => {
          this.draft.prompts = v;
        },
        host
      )
    );
    common.appendChild(
      renderField(
        roSpec,
        () => this.draft.readOnly,
        (v) => {
          this.draft.readOnly = v === true;
        },
        host
      )
    );
    body.appendChild(common);

    // Theme (empty = inherit the card's defaults)
    body.appendChild(sectionLabel("Theme"));
    const themeGrid = el("div", "ltk-cs-grid");
    for (const f of THEME_FIELDS) {
      const key = f.key as keyof ThemeDraft;
      themeGrid.appendChild(
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
    body.appendChild(themeGrid);

    // Card-specific configuration
    body.appendChild(sectionLabel("Configuration"));
    if (spec.config.length === 0) {
      body.appendChild(
        el(
          "div",
          "ltk-cs-note",
          spec.configNote ?? "This card has no card-specific settings."
        )
      );
    } else {
      if (spec.configNote) {
        body.appendChild(el("div", "ltk-cs-note", spec.configNote));
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
      body.appendChild(cfgGrid);
    }
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
}
