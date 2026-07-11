// ParetoCard PCF lifecycle — document-only (no actions channel).

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ParetoEditor } from "./editor";
import { parsePareto, serializePareto } from "./types";
import { LoadGate, cfg, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class ParetoCard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: ParetoEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private outputJson = "";
  private pngDataUri = "";
  private svgMarkup = "";
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

    this.editor = new ParetoEditor(container, {
      onChange: (env) => {
        this.outputJson = serializePareto(env);
        this.gate.recordEmitted(this.outputJson, "");
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.outputTimer = setTimeout(
          () => this.notifyOutputChanged(),
          OUTPUT_DEBOUNCE_MS
        );
      },
      onPngReady: (dataUri, svgMarkup) => {
        this.pngDataUri = dataUri;
        this.svgMarkup = svgMarkup ?? "";
        this.notifyOutputChanged();
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
      pngExport: this.pngDataUri,
      svgExport: this.svgMarkup,
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
    const s = parseSettings(p.settingsJSON?.raw);

    this.applySize(context);
    this.editor.setTheme(readTheme(p, s));
    this.editor.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);

    if (this.gate.shouldReload(p)) {
      const { envelope } = parsePareto(p.inputJSON?.raw);
      const doc = serializePareto(envelope);
      if (doc !== this.outputJson) {
        this.outputJson = doc;
        this.gate.recordEmitted(doc, "");
        this.editor.setEnvelope(envelope);
        this.notifyOutputChanged();
      }
    }
  }
}
