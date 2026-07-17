// MeetingWizard PCF lifecycle — a guided SETUP for meetings, not a board
// card. An existing MeetingScheduler settingsJSON comes in on inputJSON
// (edit mode; empty = new meeting) and the composed blob is emitted live on
// outputJSON. The Review step's Create button stamps submittedAt (changes
// every press) so the app's OnChange knows the maker finished — creating
// the board + scheduler slot is the app's job. No snapshots — it is a form.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MeetingWizardView } from "./editor";
import { parseWizardDraft, serializeWizardDraft, WizardDraft } from "./types";
import { LoadGate, rawOr, readTheme, str } from "../../shared/pcf/standard";
import { nowIso } from "../../shared/schema/id";
import { parseOrgTree } from "../../shared/schema/meeting";
import { parsePeople } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.4;
const DEFAULT_WIDTH = 560;

export class MeetingWizard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: MeetingWizardView;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private outputJson = "";
  private submittedAt = "";
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

    this.view = new MeetingWizardView(container, {
      onChange: (draft: WizardDraft) => {
        this.outputJson = serializeWizardDraft(draft);
        this.gate.recordEmitted(this.outputJson, "");
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.outputTimer = setTimeout(
          () => this.notifyOutputChanged(),
          OUTPUT_DEBOUNCE_MS
        );
      },
      onSubmit: () => {
        // Create meeting: flush any pending edit and stamp the moment
        if (this.outputTimer) clearTimeout(this.outputTimer);
        this.submittedAt = nowIso();
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
      submittedAt: this.submittedAt,
    };
  }

  public destroy(): void {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    if (this.view) this.view.destroy();
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
    this.view.setTheme(readTheme(p));
    this.view.setChrome(str(p.cardTitle), rawOr(p.prompts, ""));
    this.view.setOrgTree(parseOrgTree(p.orgJSON?.raw));
    this.view.setPeople(parsePeople(p.peopleJSON?.raw));

    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true);

    if (this.gate.shouldReload(p)) {
      const draft = parseWizardDraft(p.inputJSON?.raw);
      const doc = serializeWizardDraft(draft);
      if (doc !== this.outputJson) {
        this.outputJson = doc;
        this.gate.recordEmitted(doc, "");
        this.view.setDraft(draft);
        this.notifyOutputChanged();
      }
    }
  }
}
