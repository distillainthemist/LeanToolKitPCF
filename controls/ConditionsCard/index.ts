// ConditionsCard PCF lifecycle — the LeanToolKit standard pattern:
//   inputJSON  (input)  preloads the envelope
//   resetTrigger (input) reloads from inputJSON when its VALUE changes
//   outputJSON (output) carries the edited envelope, debounced
// Internal edits never re-enter through updateView (LoadGate only reacts to
// genuine input changes), so there is no echo loop.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ConditionsEditor } from "./editor";
import {
  Granularity,
  parseAsOf,
  parseConditions,
  parseConditionsInput,
  serializeConditions,
} from "./types";
import { LoadGate, cfg, enumOr, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";
import {
  parseActionsJson,
  serializeActions,
} from "../../shared/schema/actions";
import { parsePeople } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;

/** Standard component proportion when the host doesn't allocate a height. */
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class ConditionsCard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: ConditionsEditor;
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

    this.editor = new ConditionsEditor(container, {
      onChange: (env, actions) => {
        this.outputJson = serializeConditions(env);
        this.actionsJson = serializeActions(actions, this.instanceId);
        // what we emit coming back through the inputs is an echo, not new data
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

  /**
   * Respect the host-allocated size; when the host doesn't provide a height
   * (the test harness, or an unset canvas size), default to the toolkit's
   * standard 1.77:1 viewport proportion so the card never renders collapsed.
   */
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
    const gRaw = enumOr(cfg(s, "granularity"), p.granularity) as Granularity;
    const granularity: Granularity =
      gRaw === "weekday" || gRaw === "week" || gRaw === "shift" ? gRaw : "day";
    this.editor.setOptions({
      granularity,
      conditions: parseConditionsInput(rawOr(p.conditions, cfg(s, "conditions"))),
      asOf: parseAsOf(rawOr(p.asOfDate, cfg(s, "asOfDate"))),
    });
    this.editor.setPeople(parsePeople(rawOr(p.peopleJSON, cfg(s, "peopleJSON"))));
    this.editor.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);

    if (this.gate.shouldReload(p)) {
      const { envelope, embeddedActions } = parseConditions(p.inputJSON?.raw);
      // actions channel is authoritative; a legacy combined document's
      // embedded actions migrate in only when the channel is empty
      const external = parseActionsJson(p.actionsInputJSON?.raw);
      const actions = external.length > 0 ? external : embeddedActions;

      const doc = serializeConditions(envelope);
      const acts = serializeActions(actions, this.instanceId);
      // only adopt + notify when the loaded state actually differs from what
      // we already hold — the other half of the echo-loop guard
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
