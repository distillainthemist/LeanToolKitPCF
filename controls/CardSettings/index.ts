// CardSettings PCF lifecycle — a settings COMPOSER for the other toolkit
// cards. The blob being edited rides the standard document channel: an
// existing settingsJSON comes in on inputJSON (edit mode; empty = compose
// new), and the composed blob is emitted on outputJSON, stamped with
// cardType, plus a discrete selectedCardType output for easy column binding.
// The optional cardType INPUT preselects and locks the card type (e.g. a
// board app editing a known card's row). No PNG/SVG export — it is a form.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { CardSettingsEditor } from "./editor";
import { parseDraft, serializeDraft, SettingsDraft } from "./types";
import { LoadGate, rawOr, readTheme, str } from "../../shared/pcf/standard";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.4;
const DEFAULT_WIDTH = 560;

export class CardSettings implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: CardSettingsEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private outputJson = "";
  private cardType = "";
  private outputTimer: ReturnType<typeof setTimeout> | null = null;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this.container = container;
    this.notifyOutputChanged = notifyOutputChanged;

    if (context.mode.trackContainerResize) {
      context.mode.trackContainerResize(true);
    }

    this.editor = new CardSettingsEditor(container, {
      onChange: (draft: SettingsDraft) => {
        this.outputJson = serializeDraft(draft);
        this.cardType = draft.cardType;
        this.gate.recordEmitted(this.outputJson, "");
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.outputTimer = setTimeout(
          () => this.notifyOutputChanged(),
          OUTPUT_DEBOUNCE_MS
        );
      },
    });

    this.applyAll(context);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.applyAll(context);
  }

  public getOutputs(): IOutputs {
    return {
      outputJSON: this.outputJson,
      selectedCardType: this.cardType,
    };
  }

  public destroy(): void {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    if (this.editor) this.editor.destroy();
  }

  private applySize(context: ComponentFramework.Context<IInputs>): void {
    const w = context.mode.allocatedWidth;
    const h = context.mode.allocatedHeight;
    if (w > 0) this.container.style.width = `${w}px`;
    if (h > 0) {
      this.container.style.height = `${h}px`;
    } else {
      const width = w > 0 ? w : this.container.clientWidth || DEFAULT_WIDTH;
      this.container.style.height = `${Math.round(width / ASPECT_RATIO)}px`;
    }
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;

    this.applySize(context);
    this.editor.setTheme(readTheme(p));
    this.editor.setChrome(str(p.cardTitle), rawOr(p.prompts, ""));

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true);

    if (this.gate.shouldReload(p)) {
      const draft = parseDraft(p.inputJSON?.raw);
      // a non-empty cardType input pins the type (the app is editing a known
      // card's row) — it wins over whatever the blob says
      const pinned = str(p.cardType).trim();
      if (pinned !== "") draft.cardType = pinned;

      const doc = serializeDraft(draft);
      if (doc !== this.outputJson || draft.cardType !== this.cardType) {
        this.outputJson = doc;
        this.cardType = draft.cardType;
        this.gate.recordEmitted(doc, "");
        this.editor.setDraft(draft, pinned !== "");
        this.notifyOutputChanged();
      }
    }
  }
}
