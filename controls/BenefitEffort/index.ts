// BenefitEffort PCF lifecycle — envelope document + actions channel (a
// follow-up action taken forward against an idea).

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { BenefitEffortEditor } from "./editor";
import { parseBenefitEffort, serializeBenefitEffort } from "./types";
import { LoadGate, cfg, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";
import { parseActionsJson, serializeActions } from "../../shared/schema/actions";
import { parsePeople } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class BenefitEffort implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: BenefitEffortEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private outputJson = "";
  private actionsJson = "";
  private instanceId = "";
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

    this.editor = new BenefitEffortEditor(container, {
      onChange: (env, actions) => {
        this.outputJson = serializeBenefitEffort(env);
        this.actionsJson = serializeActions(actions, this.instanceId);
        this.gate.recordEmitted(this.outputJson, this.actionsJson);
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
      actionsOutputJSON: this.actionsJson,
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
    this.instanceId = str(p.instanceId, cfg(s, "instanceId"));
    this.editor.setTheme(readTheme(p, s));
    this.editor.setPeople(parsePeople(rawOr(p.peopleJSON, cfg(s, "peopleJSON"))));
    this.editor.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);
    this.editor.setDisableActions(
      p.disableActions?.raw === true || s.config.disableActions === true
    );

    if (this.gate.shouldReload(p)) {
      const { envelope, embeddedActions } = parseBenefitEffort(p.inputJSON?.raw);
      const external = parseActionsJson(p.actionsInputJSON?.raw);
      const actions = external.length > 0 ? external : embeddedActions;

      const doc = serializeBenefitEffort(envelope);
      const acts = serializeActions(actions, this.instanceId);
      if (doc !== this.outputJson || acts !== this.actionsJson) {
        this.outputJson = doc;
        this.actionsJson = acts;
        this.gate.recordEmitted(doc, acts);
        this.editor.setEnvelope(envelope, actions);
        this.notifyOutputChanged();
      }
    }
  }
}
