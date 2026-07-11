// ProcessMap PCF — the ported ProcessMapPCF editor (simple / swimlane /
// SIPOC / VSM in one control) wrapped in the LeanToolKit standard surface:
// envelope document + actions channel + theme tokens + card chrome. Kaizen
// bursts capture actions (source "processmap"); deleting a burst cancels its
// open actions. Legacy ProcessMapPCF documents load via the bare-document
// migration path.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ProcessMapEditor, StyleConfig } from "./editor";
import {
  MapMode,
  PmModel,
  ProcessMapEnvelope,
  parseProcessMap,
  SCHEMA_ID,
  sanitizeModel,
  serializeProcessMap,
} from "./types";
import { LoadGate, readTheme, str } from "../../shared/pcf/standard";
import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { el, ensureStylesheet } from "../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { openDialog, sectionLabel } from "../../shared/ui/dialog";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import {
  LtkAction,
  newAction,
  parseActionsJson,
  serializeActions,
} from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { parsePeople, Person } from "../../shared/schema/people";

const OUTPUT_DEBOUNCE_MS = 300;
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 960;

export class ProcessMap implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private root!: HTMLElement;
  private editorHost!: HTMLDivElement;
  private editor!: ProcessMapEditor;
  private notifyOutputChanged!: () => void;
  private readonly gate = new LoadGate();

  private env: ProcessMapEnvelope = {
    schema: SCHEMA_ID,
    meta: { title: "", updated: "" },
    data: sanitizeModel(undefined),
  };
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private prompts: Prompts = { general: [], fields: {} };
  private cardTitle = "";
  private lastChromeKey = "";
  private readOnly = false;

  private outputJson = "";
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

    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    this.root = el("div", "ltk-root");
    container.appendChild(this.root);
    this.editorHost = el("div") as HTMLDivElement;
    this.editorHost.style.cssText = "flex:1 1 auto; min-height:0; position:relative;";

    this.editor = new ProcessMapEditor(this.editorHost, {
      onChange: (model) => this.absorbModel(model),
      onPngReady: (dataUri) => {
        this.pngDataUri = dataUri;
        this.notifyOutputChanged();
      },
      onManageActions: (nodeId) => this.manageActions(nodeId),
      getActionBadge: (nodeId) =>
        this.actions.filter(
          (a) =>
            a.context.sourceId === nodeId &&
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
        { label: "Download PNG", onClick: () => this.editor.exportPng() },
        { label: "Download SVG", onClick: () => this.editor.exportSvg() },
      ]);
    }
    this.root.appendChild(this.editorHost);
  }

  // ---- model absorption ----

  /**
   * Fold the editor's model back into the envelope. Kaizen bursts deleted in
   * the editor get their open actions CANCELLED (never removed).
   */
  private absorbModel(model: PmModel): void {
    const prevIds = new Set(
      this.env.data.nodes.filter((n) => n.kind === "kaizen").map((n) => n.id)
    );
    const nextIds = new Set(model.nodes.map((n) => n.id));
    let actionsTouched = false;
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        for (const a of this.actions) {
          if (a.context.sourceId === id && a.status !== "done") {
            a.status = "cancelled";
            actionsTouched = true;
          }
        }
      }
    }
    this.env.data = model;
    this.env.meta.updated = nowIso();
    this.emit(actionsTouched);
  }

  private emit(refreshEditor = false): void {
    this.outputJson = serializeProcessMap(this.env);
    this.actionsJson = serializeActions(this.actions, this.instanceId);
    this.gate.recordEmitted(this.outputJson, this.actionsJson);
    if (refreshEditor) {
      this.editor.setModel(this.env.data); // refresh kaizen badges
    }
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = setTimeout(
      () => this.notifyOutputChanged(),
      OUTPUT_DEBOUNCE_MS
    );
  }

  /** An actions-only change: document (and its timestamp) untouched. */
  private commitActions(): void {
    this.emit(true);
  }

  // ---- kaizen action management (shared UI over the SVG editor) ----

  private manageActions(nodeId: string): void {
    const node = this.env.data.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const existing = this.actions.filter(
      (a) => a.context.sourceId === nodeId && a.status !== "cancelled"
    );
    if (existing.length === 0) {
      this.raiseAction(nodeId, node.label);
      return;
    }
    const dlg = openDialog({
      host: this.root,
      title: "Actions",
      buttons: [
        { label: "Close", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "＋ Raise action",
          kind: "primary",
          onClick: () => {
            dlg.close();
            this.raiseAction(nodeId, node.label);
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

  private raiseAction(nodeId: string, label: string): void {
    const action = newAction({ source: "processmap", sourceId: nodeId, hint: "kaizen" });
    action.issue = label;
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
    this.editor.resize(this.editorHost.clientWidth, this.editorHost.clientHeight);
  }

  private toStyle(): StyleConfig {
    return {
      fontFamily: this.theme.fontFamily,
      backgroundColor: this.theme.background,
      foregroundColor: this.theme.foreground,
      accentColor: this.theme.accent,
    };
  }

  private defaultMode(context: ComponentFramework.Context<IInputs>): MapMode {
    const raw = context.parameters.defaultMode?.raw;
    return raw === "swimlane" || raw === "sipoc" || raw === "vsm" ? raw : "simple";
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;

    this.instanceId = str(p.instanceId);
    this.theme = readTheme(p);
    this.people = parsePeople(p.peopleJSON?.raw);

    const chromeKey =
      str(p.cardTitle) + " " + (p.prompts?.raw ?? "") + " " +
      String(p.readOnly?.raw === true) + " " + JSON.stringify(this.theme);
    if (chromeKey !== this.lastChromeKey) {
      this.lastChromeKey = chromeKey;
      this.cardTitle = str(p.cardTitle);
      this.prompts = parsePrompts(p.prompts?.raw ?? "");
      this.readOnly =
        context.mode.isControlDisabled === true || p.readOnly?.raw === true;
      this.renderChrome();
    }

    this.editor.setStyle(this.toStyle());
    this.editor.setReadOnly(this.readOnly);
    this.applySize(context);

    if (this.gate.shouldReload(p)) {
      const { envelope, embeddedActions } = parseProcessMap(
        p.inputJSON?.raw,
        this.defaultMode(context)
      );
      const external = parseActionsJson(p.actionsInputJSON?.raw);
      const actions = external.length > 0 ? external : embeddedActions;

      const doc = serializeProcessMap(envelope);
      const acts = serializeActions(actions, this.instanceId);
      if (doc !== this.outputJson || acts !== this.actionsJson) {
        this.env = envelope;
        this.actions = actions;
        this.outputJson = doc;
        this.actionsJson = acts;
        this.gate.recordEmitted(doc, acts);
        this.editor.setModel(envelope.data);
        this.notifyOutputChanged();
      }
    }
  }
}
