// ActionBoard PCF lifecycle. The actions channel is the primary (and only)
// data: actionsInputJSON preloads, resetTrigger reloads on value change,
// actionsOutputJSON carries the edited set (debounced). Same LoadGate echo
// guard as every LeanToolKit control.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ActionBoardEditor, BoardView, KanbanGroupBy } from "./editor";
import { LoadGate, readTheme, str } from "../../shared/pcf/standard";
import {
  parseActionsJson,
  serializeActions,
} from "../../shared/schema/actions";
import { parsePeople } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class ActionBoard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private editor!: ActionBoardEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private actionsJson = "";
  private instanceId = "";
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

    this.editor = new ActionBoardEditor(container, {
      onChange: (actions) => {
        this.actionsJson = serializeActions(actions, this.instanceId);
        this.gate.recordEmitted("", this.actionsJson);
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.outputTimer = setTimeout(
          () => this.notifyOutputChanged(),
          OUTPUT_DEBOUNCE_MS
        );
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
    this.instanceId = str(p.instanceId);
    this.editor.setTheme(readTheme(p));
    const viewRaw = p.view?.raw as BoardView;
    this.editor.setOptions({
      view: viewRaw === "kanban" || viewRaw === "gantt" ? viewRaw : "list",
      groupBy:
        (p.kanbanGroupBy?.raw as KanbanGroupBy) === "issue" ? "issue" : "status",
    });
    this.editor.setPeople(parsePeople(p.peopleJSON?.raw));
    this.editor.setChrome(str(p.cardTitle), p.prompts?.raw ?? "");

    const disabled = context.mode.isControlDisabled === true;
    this.editor.setReadOnly(disabled || p.readOnly?.raw === true);

    if (this.gate.shouldReload(p)) {
      const actions = parseActionsJson(p.actionsInputJSON?.raw);
      const acts = serializeActions(actions, this.instanceId);
      if (acts !== this.actionsJson) {
        this.actionsJson = acts;
        this.gate.recordEmitted("", acts);
        this.editor.setActions(actions);
        this.notifyOutputChanged();
      }
    }
  }
}
