// MeetingScheduler PCF lifecycle — a selection component. The cadence comes
// entirely from discrete inputs (fed from the meeting definition record);
// there is no document. The control generates the instances in the window,
// matches existingMeetingsJSON, and emits the tapped row on
// selectedMeetingJSON (stamped selectedAt so OnChange fires on every tap,
// even re-selecting the same row).

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MeetingSchedulerView } from "./editor";
import {
  generateInstances,
  MeetingInstance,
  parseCategory,
  parseCrews,
  parseDaysOfWeek,
  parseExistingMeetings,
  parseLocalDate,
  parseRosterPattern,
  parseTimeOfDay,
  SchedulerConfig,
  startOfDay,
} from "./types";
import { readTheme, str } from "../../shared/pcf/standard";
import { nowIso } from "../../shared/schema/id";

export class MeetingScheduler implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: MeetingSchedulerView;
  private notifyOutputChanged!: () => void;

  private selectedJson = "";
  private pngDataUri = "";

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

    this.view = new MeetingSchedulerView(container, {
      onSelect: (instance: MeetingInstance) => {
        this.selectedJson = JSON.stringify({ ...instance, selectedAt: nowIso() });
        this.notifyOutputChanged();
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
      selectedMeetingJSON: this.selectedJson,
      pngExport: this.pngDataUri,
    };
  }

  public destroy(): void {
    if (this.view) this.view.destroy();
  }

  private applySize(context: ComponentFramework.Context<IInputs>): void {
    const w = context.mode.allocatedWidth;
    const h = context.mode.allocatedHeight;
    if (w > 0) this.container.style.width = `${w}px`;
    if (h > 0) {
      this.container.style.height = `${h}px`;
    } else {
      const width = w > 0 ? w : this.container.clientWidth || 640;
      this.container.style.height = `${Math.round(width / 1.77)}px`;
    }
  }

  private readConfig(context: ComponentFramework.Context<IInputs>): SchedulerConfig {
    const p = context.parameters;
    const today = startOfDay(new Date());
    const daysPrior = Number(p.daysPrior?.raw);
    return {
      finalDate: parseLocalDate(p.finalDate?.raw) ?? today,
      daysPrior:
        Number.isFinite(daysPrior) && daysPrior >= 0
          ? Math.min(400, Math.round(daysPrior))
          : 14,
      category: parseCategory(p.category?.raw),
      daysOfWeek: parseDaysOfWeek(p.daysOfWeek?.raw),
      timeOfDay: parseTimeOfDay(p.timeOfDay?.raw),
      crews: parseCrews(p.crewList?.raw),
      roster: parseRosterPattern(p.rosterPattern?.raw),
      baseStart: parseLocalDate(p.baseStartDate?.raw) ?? today,
    };
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;

    this.applySize(context);
    this.view.setTheme(readTheme(p));
    this.view.setChrome(str(p.cardTitle), p.prompts?.raw ?? "");

    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true);

    const cfg = this.readConfig(context);
    const existing = parseExistingMeetings(p.existingMeetingsJSON?.raw);
    this.view.setInstances(generateInstances(cfg, existing, new Date()), cfg.crews);
  }
}
