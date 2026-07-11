// MeetingScheduler PCF lifecycle — standard envelope pattern (no actions
// channel; this card configures cadence rather than raising work). Alongside
// outputJSON (the config document), the control emits occurrencesJSON: the
// generated, dated meeting occurrences over the horizon, with crew + shift —
// the piece apps and Flows actually consume (next-meeting countdowns,
// reminders, attendance).

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MeetingSchedulerEditor } from "./editor";
import { generateOccurrences, parseMeeting, serializeMeeting } from "./types";
import { LoadGate, readTheme, str } from "../../shared/pcf/standard";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 720;

export class MeetingScheduler implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: MeetingSchedulerEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private outputJson = "";
  private occurrencesJson = "";
  private pngDataUri = "";
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

    this.editor = new MeetingSchedulerEditor(container, {
      onChange: (env) => {
        this.outputJson = serializeMeeting(env);
        this.occurrencesJson = JSON.stringify(generateOccurrences(env.data));
        this.gate.recordEmitted(this.outputJson, "");
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.outputTimer = setTimeout(() => this.notifyOutputChanged(), OUTPUT_DEBOUNCE_MS);
      },
      onPngReady: (dataUri) => {
        this.pngDataUri = dataUri;
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
      occurrencesJSON: this.occurrencesJson,
      pngExport: this.pngDataUri,
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
    this.editor.setChrome(str(p.cardTitle), p.prompts?.raw ?? "");

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true);

    if (this.gate.shouldReload(p)) {
      const { envelope } = parseMeeting(p.inputJSON?.raw);
      const doc = serializeMeeting(envelope);
      if (doc !== this.outputJson) {
        this.outputJson = doc;
        this.occurrencesJson = JSON.stringify(generateOccurrences(envelope.data));
        this.gate.recordEmitted(doc, "");
        this.editor.setEnvelope(envelope);
        this.notifyOutputChanged();
      }
    }
  }
}
