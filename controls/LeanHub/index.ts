// LeanHub PCF lifecycle — the person's home shell. Everything in is JSON,
// everything out is JSON: tapped occurrences on selectedMeetingJSON (with
// boardId, so the app navigates and deep-links the board's scheduler via
// its selectIso input), action upserts on the standard actions channel,
// preference and protected-time edits on their own outputs for the app to
// persist. No document, no snapshots — a shell, not a board card.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { LeanHubView } from "./editor";
import {
  HubInstance,
  HubPrefs,
  parseHubMeetings,
  parsePrefs,
  parseProtectedTimes,
  ProtectedTime,
  serializePrefs,
  serializeProtectedTimes,
} from "./types";
import { LtkAction, parseActionsJson, serializeActions } from "../../shared/schema/actions";
import { rawOr, readTheme, str } from "../../shared/pcf/standard";
import { nowIso } from "../../shared/schema/id";
import { parseOrgTree } from "../../shared/schema/meeting";
import { parsePeople } from "../../shared/schema/people";

const ASPECT_RATIO = 1.6;
const DEFAULT_WIDTH = 960;

export class LeanHub implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: LeanHubView;
  private notifyOutputChanged!: () => void;

  private selectedJson = "";
  private actionsJson = "";
  private prefsJson = "";
  private protectedJson = "";
  /** Echo guards: skip re-applying inputs that are our own writes come home. */
  private lastActionsInput: string | null = null;
  private lastPrefsInput: string | null = null;
  private lastProtectedInput: string | null = null;

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

    this.view = new LeanHubView(container, {
      onSelectMeeting: (inst: HubInstance) => {
        this.selectedJson = JSON.stringify({ ...inst, selectedAt: nowIso() });
        this.notifyOutputChanged();
      },
      onActions: (actions: LtkAction[]) => {
        this.actionsJson = serializeActions(actions);
        this.notifyOutputChanged();
      },
      onPrefs: (prefs: HubPrefs) => {
        this.prefsJson = serializePrefs(prefs);
        this.notifyOutputChanged();
      },
      onProtected: (times: ProtectedTime[]) => {
        this.protectedJson = serializeProtectedTimes(times);
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
      actionsOutputJSON: this.actionsJson,
      preferencesOutputJSON: this.prefsJson,
      protectedTimesOutputJSON: this.protectedJson,
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
      const width = w > 0 ? w : this.container.clientWidth || DEFAULT_WIDTH;
      this.container.style.height = `${Math.round(width / ASPECT_RATIO)}px`;
    }
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;

    this.applySize(context);
    this.view.setTheme(readTheme(p));
    this.view.setChrome(str(p.cardTitle), rawOr(p.prompts, ""));

    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true);

    this.view.setMeetings(parseHubMeetings(p.meetingsJSON?.raw));
    this.view.setOrgTree(parseOrgTree(p.orgJSON?.raw));
    this.view.setPeople(parsePeople(p.peopleJSON?.raw), str(p.viewerId));
    this.view.setCanEditSite(p.canEditSite?.raw === true);
    this.view.setSourceLabels(parseSourceLabels(p.actionSourcesJSON?.raw));

    // channel inputs with echo guards — a write of ours coming home must
    // not clobber newer local state
    const actionsRaw = p.actionsInputJSON?.raw ?? "";
    if (actionsRaw !== this.lastActionsInput && actionsRaw !== this.actionsJson) {
      this.lastActionsInput = actionsRaw;
      this.view.setActions(parseActionsJson(actionsRaw));
    }
    const prefsRaw = p.preferencesJSON?.raw ?? "";
    if (prefsRaw !== this.lastPrefsInput && prefsRaw !== this.prefsJson) {
      this.lastPrefsInput = prefsRaw;
      this.view.setPrefs(parsePrefs(prefsRaw));
    }
    const protectedRaw = p.protectedTimesJSON?.raw ?? "";
    if (protectedRaw !== this.lastProtectedInput && protectedRaw !== this.protectedJson) {
      this.lastProtectedInput = protectedRaw;
      this.view.setProtectedTimes(parseProtectedTimes(protectedRaw));
    }
  }
}

/** actionSourcesJSON: [{instanceId, label}] → lookup map for grouping. */
function parseSourceLabels(raw: string | null | undefined): Record<string, string> {
  const t = (raw ?? "").trim();
  if (t === "") return {};
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return {};
    const out: Record<string, string> = {};
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = typeof o.instanceId === "string" ? o.instanceId.trim() : "";
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (id !== "" && label !== "") out[id] = label;
    }
    return out;
  } catch {
    return {};
  }
}
