// Fishbone PCF — the original Fishbone editor (SVG, proven in production)
// wrapped in the LeanToolKit standard surface: envelope document + actions
// channel + theme tokens + card chrome. The editor keeps its own model shape
// (model.ts); this wrapper maps it onto the shared CauseNode document and
// hosts the shared action UI (badges on chips, manage/raise dialogs).

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { FishboneEditor } from "./editor";
import { FishboneModel, StyleConfig } from "./model";
import {
  FishboneData,
  FishboneEnvelope,
  parseCategoriesSetting,
  parseFishbone,
  SCHEMA_ID,
  serializeFishbone,
} from "./types";
import { LoadGate, cfg, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";
import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { el } from "../../shared/ui/dom";
import { ensureStylesheet } from "../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { openDialog, sectionLabel } from "../../shared/ui/dialog";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { hintFor, parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import {
  LtkAction,
  newAction,
  parseActionsJson,
  serializeActions,
} from "../../shared/schema/actions";
import { CauseNode, sanitizeCause } from "../../shared/schema/causes";
import { nowIso } from "../../shared/schema/id";
import { saveSvg } from "../../shared/export/png";
import { parsePeople, Person } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 880;

export class Fishbone implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private root!: HTMLElement;
  private editorHost!: HTMLDivElement;
  private editor!: FishboneEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private env: FishboneEnvelope = {
    schema: SCHEMA_ID,
    meta: { title: "", updated: "" },
    data: { problem: "", categories: [], causes: [] },
  };
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private prompts: Prompts = { general: [], fields: {} };
  private cardTitle = "";
  private lastChromeKey = "";
  private readOnly = false;
  private disableActions = false;

  private outputJson = "";
  private actionsJson = "";
  private instanceId = "";
  private lastProblemInput: string | null = null;
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

    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    this.root = el("div", "ltk-root");
    container.appendChild(this.root);
    this.editorHost = el("div") as HTMLDivElement;
    this.editorHost.style.cssText =
      "flex:1 1 auto; min-height:0; position:relative;";

    this.editor = new FishboneEditor(this.editorHost, {
      onChange: (model) => this.absorbModel(model),
      onPngReady: (dataUri, svgMarkup) => {
        this.pngDataUri = dataUri;
        this.svgMarkup = svgMarkup ?? "";
        this.notifyOutputChanged();
      },
      onManageActions: (causeId) => this.manageActions(causeId),
      getActionBadge: (causeId) =>
        this.actions.filter(
          (a) =>
            a.context.sourceId === causeId &&
            a.status !== "cancelled" &&
            a.status !== "done"
        ).length,
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

  // ---- chrome ----

  /** Rebuild the title bar + kebab around the (persistent) editor host. */
  private renderChrome(): void {
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => saveSvg(this.svgMarkup, "fishbone.svg") },
      ]);
    }
    this.root.appendChild(this.editorHost);
  }

  private downloadPng(): void {
    if (this.pngDataUri === "") return;
    const link = document.createElement("a");
    link.href = this.pngDataUri;
    link.download = "fishbone.png";
    link.click();
  }

  // ---- model <-> envelope mapping ----

  private toModel(data: FishboneData): FishboneModel {
    return {
      problem: data.problem,
      categories: data.categories.slice(),
      causes: data.causes.map((c) => ({
        id: c.id,
        category: c.category !== "" ? c.category : data.categories[0] ?? "",
        text: c.text,
        votes: c.votes,
        status: c.status,
      })),
    };
  }

  /**
   * Fold the editor's model back into the envelope, preserving shared-model
   * fields (isRoot, parentId) on surviving causes. Causes deleted in the
   * editor get their open actions CANCELLED (never removed).
   */
  private absorbModel(model: FishboneModel): void {
    const byId = new Map(this.env.data.causes.map((c) => [c.id, c]));
    const next: CauseNode[] = model.causes.map((mc) => {
      const existing = byId.get(mc.id);
      if (existing) {
        existing.text = mc.text;
        existing.category = mc.category;
        existing.votes = mc.votes;
        existing.status = mc.status;
        return existing;
      }
      return sanitizeCause({
        id: mc.id,
        text: mc.text,
        category: mc.category,
        votes: mc.votes,
        status: mc.status,
        parentId: null,
      });
    });
    const nextIds = new Set(next.map((c) => c.id));
    let actionsTouched = false;
    for (const old of this.env.data.causes) {
      if (!nextIds.has(old.id)) {
        for (const a of this.actions) {
          if (a.context.sourceId === old.id && a.status !== "done") {
            a.status = "cancelled";
            actionsTouched = true;
          }
        }
      }
    }
    this.env.data.problem = model.problem;
    this.env.data.categories = model.categories.slice();
    this.env.data.causes = next;
    this.env.meta.updated = nowIso();
    this.emit(actionsTouched);
  }

  private emit(refreshEditor = false): void {
    this.outputJson = serializeFishbone(this.env);
    this.actionsJson = serializeActions(this.actions, this.instanceId);
    this.gate.recordEmitted(this.outputJson, this.actionsJson);
    if (refreshEditor) {
      this.editor.setModel(this.toModel(this.env.data));
    }
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = setTimeout(
      () => this.notifyOutputChanged(),
      OUTPUT_DEBOUNCE_MS
    );
  }

  /** An actions-only change: document (and its timestamp) untouched. */
  private commitActions(): void {
    this.emit(true); // re-render so chip badges refresh
  }

  // ---- action management (shared UI over the SVG editor) ----

  private manageActions(causeId: string): void {
    const cause = this.env.data.causes.find((c) => c.id === causeId);
    if (!cause) return;
    const existing = this.actions.filter(
      (a) => a.context.sourceId === causeId && a.status !== "cancelled"
    );
    if (existing.length === 0) {
      this.raiseAction(cause); // no-ops when actions are disabled
      return;
    }
    const dlg = openDialog({
      host: this.root,
      title: "Actions",
      buttons: this.disableActions
        ? [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }]
        : [
            { label: "Close", kind: "secondary", onClick: () => dlg.close() },
            {
              label: "＋ Raise action",
              kind: "primary",
              onClick: () => {
                dlg.close();
                this.raiseAction(cause);
              },
            },
          ],
    });
    dlg.body.appendChild(sectionLabel(`Actions (${existing.length})`));
    for (const a of existing) {
      dlg.body.appendChild(
        actionRow(a, {
          doneColor: this.theme.legend[1] ?? "#107c10",
          onChanged: () => this.commitActions(),
          onEdit: (act) =>
            openActionDialog({
              host: this.root,
              action: act,
              people: this.people,
              isNew: false,
              onCommit: () => this.commitActions(),
            }),
        })
      );
    }
  }

  private raiseAction(cause: CauseNode): void {
    if (this.disableActions) return;
    const action = newAction({ source: "fishbone", sourceId: cause.id });
    action.issue = cause.text;
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: true,
      onCommit: () => {
        this.actions.push(action);
        this.commitActions();
      },
    });
  }

  // ---- lifecycle plumbing ----

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
    // the editor sizes to its host explicitly
    this.editor.resize(this.editorHost.clientWidth, this.editorHost.clientHeight);
  }

  private toStyle(): StyleConfig {
    return {
      fontFamily: this.theme.fontFamily,
      diagramColor: this.theme.foreground,
      backgroundColor: this.theme.background,
      accentColor: this.theme.accent,
      effectLabel: hintFor(this.prompts, "effectLabel", "Problem"),
      statusColors: {
        Hypothesis: this.theme.legend[0] ?? "#f2c811",
        Confirmed: this.theme.legend[1] ?? "#107c10",
        Rejected: this.theme.legend[2] ?? "#d13438",
      },
    };
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const s = parseSettings(p.settingsJSON?.raw);

    this.instanceId = str(p.instanceId, cfg(s, "instanceId"));
    this.theme = readTheme(p, s);
    this.people = parsePeople(rawOr(p.peopleJSON, cfg(s, "peopleJSON")));

    const chromeKey =
      str(p.cardTitle, s.title) + " " + (rawOr(p.prompts, s.promptsRaw)) + " " +
      String(p.readOnly?.raw === true || s.readOnly) + " " + JSON.stringify(this.theme);
    if (chromeKey !== this.lastChromeKey) {
      this.lastChromeKey = chromeKey;
      this.cardTitle = str(p.cardTitle, s.title);
      this.prompts = parsePrompts(rawOr(p.prompts, s.promptsRaw));
      this.readOnly =
        context.mode.isControlDisabled === true || p.readOnly?.raw === true || s.readOnly;
      this.renderChrome();
    }

    this.editor.setStyle(this.toStyle());
    this.editor.setReadOnly(this.readOnly);
    this.editor.setDisableActions(
      p.disableActions?.raw === true || s.config.disableActions === true
    );
    this.applySize(context);

    // Optional discrete problem input: when non-empty it seeds/overrides the
    // document problem (the fish head), matching the "discrete overrides" rule.
    const problemIn = str(p.problem);
    const problemChanged = problemIn !== (this.lastProblemInput ?? "");

    if (this.gate.shouldReload(p)) {
      // the `categories` setting names the bones for a NEW/empty document;
      // a document that already carries categories keeps its own
      const defaultCats = parseCategoriesSetting(cfg(s, "categories"));
      const { envelope, embeddedActions } = parseFishbone(p.inputJSON?.raw, defaultCats);
      if (problemIn !== "") envelope.data.problem = problemIn; // seed/override on load
      const external = parseActionsJson(p.actionsInputJSON?.raw);
      const actions = external.length > 0 ? external : embeddedActions;

      const doc = serializeFishbone(envelope);
      const acts = serializeActions(actions, this.instanceId);
      if (doc !== this.outputJson || acts !== this.actionsJson) {
        this.env = envelope;
        this.actions = actions;
        this.outputJson = doc;
        this.actionsJson = acts;
        this.gate.recordEmitted(doc, acts);
        this.editor.setModel(this.toModel(envelope.data));
        this.notifyOutputChanged();
      }
    } else if (problemChanged && problemIn !== "" && this.env.data.problem !== problemIn) {
      // the problem input changed on its own (no document reload): override it
      // on the current document so in-card cause edits are preserved
      this.env.data.problem = problemIn;
      this.env.meta.updated = nowIso();
      this.outputJson = serializeFishbone(this.env);
      this.gate.recordEmitted(this.outputJson, this.actionsJson);
      this.editor.setModel(this.toModel(this.env.data));
      this.notifyOutputChanged();
    }
    this.lastProblemInput = problemIn;
  }
}
