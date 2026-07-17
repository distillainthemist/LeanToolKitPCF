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
  parseColumns,
  parseCrews,
  parseDaysOfWeek,
  parseExistingMeetings,
  parseLocalDate,
  parseRosterPattern,
  parseTimeOfDay,
  SchedulerConfig,
  startOfDay,
} from "./types";
import { cfg, enumOr, LtkSettings, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";
import { nowIso } from "../../shared/schema/id";
import { parseMeetingInfo } from "../../shared/schema/meeting";
import { parsePeople, Person } from "../../shared/schema/people";

export class MeetingScheduler implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: MeetingSchedulerView;
  private notifyOutputChanged!: () => void;

  private selectedJson = "";
  private attendeesJson = "";
  private people: Person[] = [];

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
      onSelect: (instance: MeetingInstance, values: Record<string, string>) => {
        this.selectedJson = JSON.stringify({ ...instance, values, selectedAt: nowIso() });
        this.attendeesJson = this.buildAttendeesJson(instance.crew);
        this.notifyOutputChanged();
      },
    });

    this.applyAll(context);
  }

  /**
   * Expected attendees of the selected instance: people whose crew matches
   * the instance's on-shift crew, plus everyone without a crew (they always
   * attend). No crew on the instance (no roster) = the whole people list.
   */
  private buildAttendeesJson(instanceCrew: string): string {
    if (this.people.length === 0) return "";
    const crew = instanceCrew.trim().toLowerCase();
    const attendees =
      crew === ""
        ? this.people
        : this.people.filter(
            (p) => p.crew === undefined || p.crew.toLowerCase() === crew
          );
    return JSON.stringify(
      attendees.map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
    );
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.applyAll(context);
  }

  public getOutputs(): IOutputs {
    return {
      selectedMeetingJSON: this.selectedJson,
      attendeesJSON: this.attendeesJson,
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

  private readConfig(
    context: ComponentFramework.Context<IInputs>,
    s: LtkSettings
  ): SchedulerConfig {
    const p = context.parameters;
    const today = startOfDay(new Date());
    // daysPrior is a whole-number input: a non-null discrete value wins
    const dpRaw = p.daysPrior?.raw;
    const daysPrior = Number(dpRaw ?? cfg(s, "daysPrior"));
    return {
      finalDate: parseLocalDate(rawOr(p.finalDate, cfg(s, "finalDate"))) ?? today,
      daysPrior:
        Number.isFinite(daysPrior) && daysPrior >= 0
          ? Math.min(400, Math.round(daysPrior))
          : 14,
      category: parseCategory(enumOr(cfg(s, "category"), p.category)),
      daysOfWeek: parseDaysOfWeek(rawOr(p.daysOfWeek, cfg(s, "daysOfWeek"))),
      timeOfDay: parseTimeOfDay(rawOr(p.timeOfDay, cfg(s, "timeOfDay"))),
      crews: parseCrews(rawOr(p.crewList, cfg(s, "crewList"))),
      roster: parseRosterPattern(rawOr(p.rosterPattern, cfg(s, "rosterPattern"))),
      baseStart: parseLocalDate(rawOr(p.baseStartDate, cfg(s, "baseStartDate"))) ?? today,
    };
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const s = parseSettings(p.settingsJSON?.raw);

    this.applySize(context);
    this.view.setTheme(readTheme(p, s));
    this.view.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));

    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);

    this.view.setMeetingInfo(parseMeetingInfo(p.settingsJSON?.raw));
    this.view.setColumns(parseColumns(rawOr(p.columns, cfg(s, "columns"))));
    this.people = parsePeople(rawOr(p.peopleJSON, cfg(s, "peopleJSON")));

    const config = this.readConfig(context, s);
    const existing = parseExistingMeetings(
      rawOr(p.existingMeetingsJSON, cfg(s, "existingMeetingsJSON"))
    );
    this.view.setInstances(generateInstances(config, existing, new Date()), config.crews);
  }
}
