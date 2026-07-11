// EscalationViewer PCF lifecycle — the actions channel IS the data (no
// document). actionsInputJSON carries the escalations (pre-filtered by the
// app from the central actions table); acknowledge/comment/status edits are
// written back on actionsOutputJSON. serializeActions is called WITHOUT an
// instanceId override: every action keeps the source card's instanceId so
// the app's upsert lands on the right rows.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { EscalationViewerEditor } from "./editor";
import { parseSources } from "./types";
import { LoadGate, readTheme, str } from "../../shared/pcf/standard";
import { parseActionsJson, serializeActions } from "../../shared/schema/actions";
import { parsePeople } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class EscalationViewer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: EscalationViewerEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private actionsJson = "";
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

    this.editor = new EscalationViewerEditor(container, {
      onChange: (actions) => {
        // no instanceId override — actions keep their source instance ids
        this.actionsJson = serializeActions(actions);
        this.gate.recordEmitted("", this.actionsJson);
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
      actionsOutputJSON: this.actionsJson,
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
    this.editor.setPeople(parsePeople(p.peopleJSON?.raw));
    this.editor.setViewer({
      whoId: str(p.viewerId),
      who: str(p.viewerName),
    });
    this.editor.setChrome(str(p.cardTitle), p.prompts?.raw ?? "");

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true);
    this.editor.setSources(parseSources(p.sourcesJSON?.raw));

    if (this.gate.shouldReload(p)) {
      const actions = parseActionsJson(p.actionsInputJSON?.raw);
      const acts = serializeActions(actions);
      this.editor.setActions(actions);
      if (acts !== this.actionsJson) {
        this.actionsJson = acts;
        this.gate.recordEmitted("", acts);
        this.notifyOutputChanged();
      }
    }
  }
}
