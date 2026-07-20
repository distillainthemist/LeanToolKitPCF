// Card registry — cardType → mount adapter. Each adapter is the CardHost
// pattern for one editor: parse the stored envelope, mount with the
// slot's config, and save (document + freshest tile svg) through the
// provided callbacks. Actions ride the standard channel: the editor's
// full emitted set goes to onActions (new actions stamped with this
// card's instanceKey), the current set from the central table feeds in.

import { LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { Theme } from "../../shared/tokens";

import { KpiTrendEditor } from "../../controls/KpiTrendCard/editor";
import { parseKpiTrend, serializeKpiTrend } from "../../controls/KpiTrendCard/types";
import { SqdpcEditor } from "../../controls/SqdpcCard/editor";
import { parseSqdpc, serializeSqdpc } from "../../controls/SqdpcCard/types";
import { ConditionsEditor } from "../../controls/ConditionsCard/editor";
import { parseConditions, serializeConditions } from "../../controls/ConditionsCard/types";
import { FiveWhysEditor } from "../../controls/FiveWhys/editor";
import { parseFiveWhys, serializeFiveWhys } from "../../controls/FiveWhys/types";
import { FaultTreeEditor } from "../../controls/FaultTree/editor";
import { parseFaultTree, serializeFaultTree } from "../../controls/FaultTree/types";
import { StatusTileEditor } from "../../controls/StatusTile/editor";
import { parseStates, parseStatusTile, serializeStatusTile } from "../../controls/StatusTile/types";
import { ParetoEditor } from "../../controls/ParetoCard/editor";
import { parsePareto, serializePareto } from "../../controls/ParetoCard/types";
import { BenefitEffortEditor } from "../../controls/BenefitEffort/editor";
import { parseBenefitEffort, serializeBenefitEffort } from "../../controls/BenefitEffort/types";
import { RiskMatrixEditor } from "../../controls/RiskMatrix/editor";
import { parseRiskMatrix, serializeRiskMatrix } from "../../controls/RiskMatrix/types";
import { RaciEditor } from "../../controls/Raci/editor";
import { parseRaci, serializeRaci } from "../../controls/Raci/types";
import { SkillsMatrixEditor } from "../../controls/SkillsMatrix/editor";
import { parseSkills, serializeSkills } from "../../controls/SkillsMatrix/types";
import { AgendaEditor } from "../../controls/AgendaCard/editor";
import { parseAgenda, serializeAgenda } from "../../controls/AgendaCard/types";
import { HeatmapEditor } from "../../controls/HeatmapCard/editor";
import { parseHeatmap, serializeHeatmap } from "../../controls/HeatmapCard/types";
import { CaptureEditor } from "../../controls/CaptureCard/editor";
import {
  parseCapture,
  parseColumns as parseCaptureColumns,
  parseRows as parseCaptureRows,
  serializeCapture,
} from "../../controls/CaptureCard/types";
import { ActionBoardEditor } from "../../controls/ActionBoard/editor";
import { EscalationViewerEditor } from "../../controls/EscalationViewer/editor";
import { parseSources } from "../../controls/EscalationViewer/types";
import { EmbedView } from "../../controls/EmbedCard/editor";
import { FishboneEditor } from "../../controls/Fishbone/editor";
import { FishboneModel } from "../../controls/Fishbone/model";
import {
  parseCategoriesSetting,
  parseFishbone,
  serializeFishbone,
} from "../../controls/Fishbone/types";
import { sanitizeCause } from "../../shared/schema/causes";
import { ProcessMapEditor } from "../../controls/ProcessMap/editor";
import { MapMode, parseProcessMap, serializeProcessMap } from "../../controls/ProcessMap/types";

export interface CardMount {
  host: HTMLElement;
  title: string;
  outputJson: string;
  people: Person[];
  theme: Theme;
  readOnly: boolean;
  /** The slot's settings blob (config, prompts, disableActions…). */
  settings: Record<string, unknown>;
  /** This card's action-channel identity — stamped on new actions. */
  instanceKey: string;
  /** The card's current actions from the central table. */
  actions: LtkAction[];
  /** Board cards offered as escalation sources ({instanceKey, label}). */
  sources: { instanceId: string; label: string }[];
  /** The signed-in viewer (EscalationViewer acknowledgements). */
  viewer: { whoId: string; who: string };
  /** Save the document + the freshest tile svg (debounced by the caller). */
  onSave: (outputJson: string, tileSvg: string) => void;
  /** The full emitted action set on every change (already stamped). */
  onActions: (actions: LtkAction[]) => void;
}

export type CardMounter = (opts: CardMount) => () => void;

// ---- shared plumbing ----

/**
 * Shared save plumbing: latest svg from onPngReady rides every save.
 * Editors snapshot AFTER they emit the change, so a fresh svg arriving
 * once the debounced save has fired would otherwise be lost (the tile
 * stayed one edit behind) — it reschedules a save with the latest
 * document instead.
 */
export function saver(opts: Pick<CardMount, "onSave">) {
  let svg = "";
  let latestJson: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (latestJson !== null) opts.onSave(latestJson, svg);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, 400);
  };
  return {
    onPng: (_uri: string, svgMarkup?: string) => {
      if (svgMarkup && svgMarkup !== svg) {
        svg = svgMarkup;
        if (latestJson !== null) schedule(); // freshest snapshot always lands
      }
    },
    save: (outputJson: string) => {
      latestJson = outputJson;
      schedule();
    },
  };
}

function config(opts: CardMount): Record<string, unknown> {
  const c = opts.settings.config;
  return c && typeof c === "object" ? (c as Record<string, unknown>) : {};
}

function cfgStr(opts: CardMount, key: string): string {
  const v = config(opts)[key];
  return typeof v === "string" ? v : "";
}

/** The slot's prompts as the raw string the editors' setChrome expects. */
function promptsRaw(opts: CardMount): string {
  const p = opts.settings.prompts;
  if (p === undefined || p === null) return "";
  return typeof p === "string" ? p : JSON.stringify(p);
}

function actionsOff(opts: CardMount): boolean {
  return config(opts).disableActions === true;
}

/** New actions get this card's identity; escalated imports keep theirs. */
function stamped(opts: CardMount, actions: LtkAction[]): LtkAction[] {
  return actions.map((a) =>
    a.instanceId === "" ? { ...a, instanceId: opts.instanceKey } : a
  );
}

const REGISTRY: Record<string, CardMounter> = {
  // ---- envelope + actions cards ----
  SqdpcCard: (opts) => {
    const s = saver(opts);
    const editor = new SqdpcEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeSqdpc(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseSqdpc(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  ConditionsCard: (opts) => {
    const s = saver(opts);
    const editor = new ConditionsEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeConditions(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseConditions(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  FiveWhys: (opts) => {
    const s = saver(opts);
    const editor = new FiveWhysEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeFiveWhys(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseFiveWhys(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  FaultTree: (opts) => {
    const s = saver(opts);
    const editor = new FaultTreeEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeFaultTree(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setOptions({
      showStatus: config(opts).showStatus === true,
      disableActions: actionsOff(opts),
    });
    editor.setEnvelope(parseFaultTree(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  BenefitEffort: (opts) => {
    const s = saver(opts);
    const editor = new BenefitEffortEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeBenefitEffort(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setEnvelope(parseBenefitEffort(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  RiskMatrix: (opts) => {
    const s = saver(opts);
    const editor = new RiskMatrixEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeRiskMatrix(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setEnvelope(parseRiskMatrix(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  Raci: (opts) => {
    const s = saver(opts);
    const editor = new RaciEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeRaci(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setEnvelope(parseRaci(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  SkillsMatrix: (opts) => {
    const s = saver(opts);
    const editor = new SkillsMatrixEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeSkills(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setEnvelope(parseSkills(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  AgendaCard: (opts) => {
    const s = saver(opts);
    const editor = new AgendaEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeAgenda(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setEnvelope(parseAgenda(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },
  HeatmapCard: (opts) => {
    const s = saver(opts);
    const editor = new HeatmapEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeHeatmap(env));
        opts.onActions(stamped(opts, actions));
      },
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setImage(cfgStr(opts, "image"));
    editor.setEnvelope(parseHeatmap(opts.outputJson).envelope, opts.actions);
    return () => opts.host.replaceChildren();
  },

  // ---- envelope-only cards ----
  KpiTrendCard: (opts) => {
    const s = saver(opts);
    const editor = new KpiTrendEditor(opts.host, {
      onChange: (env) => s.save(serializeKpiTrend(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseKpiTrend(opts.outputJson).envelope);
    return () => opts.host.replaceChildren();
  },
  StatusTile: (opts) => {
    const s = saver(opts);
    const editor = new StatusTileEditor(opts.host, {
      onChange: (env) => s.save(serializeStatusTile(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setStates(parseStates(cfgStr(opts, "states")));
    editor.setEnvelope(parseStatusTile(opts.outputJson).envelope);
    return () => opts.host.replaceChildren();
  },
  ParetoCard: (opts) => {
    const s = saver(opts);
    const editor = new ParetoEditor(opts.host, {
      onChange: (env) => s.save(serializePareto(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parsePareto(opts.outputJson).envelope);
    return () => opts.host.replaceChildren();
  },
  CaptureCard: (opts) => {
    const s = saver(opts);
    const editor = new CaptureEditor(opts.host, {
      onChange: (env) => s.save(serializeCapture(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    const rows = parseCaptureRows(cfgStr(opts, "rowsJSON"));
    editor.setConfig(
      parseCaptureColumns(cfgStr(opts, "columnsJSON")),
      rows.headers,
      rows.titled
    );
    editor.setEnvelope(parseCapture(opts.outputJson).envelope);
    return () => opts.host.replaceChildren();
  },

  // ---- model-based editors (document only in the app for now — their
  // action affordances live in the PCF wrappers and arrive later) ----
  Fishbone: (opts) => {
    const s = saver(opts);
    const parsed = parseFishbone(
      opts.outputJson,
      parseCategoriesSetting(cfgStr(opts, "categories"))
    );
    const env = parsed.envelope;
    const editor = new FishboneEditor(opts.host as HTMLDivElement, {
      onChange: (model: FishboneModel) => {
        const byId = new Map(env.data.causes.map((c) => [c.id, c]));
        env.data.problem = model.problem;
        env.data.categories = model.categories.slice();
        env.data.causes = model.causes.map((mc) => {
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
        env.meta.updated = new Date().toISOString();
        s.save(serializeFishbone(env));
      },
      onPngReady: s.onPng,
    });
    editor.setDisableActions(true); // raise flow lives in the PCF wrapper
    editor.setModel({
      problem: env.data.problem,
      categories: env.data.categories.slice(),
      causes: env.data.causes.map((c) => ({
        id: c.id,
        category: c.category !== "" ? c.category : env.data.categories[0] ?? "",
        text: c.text,
        votes: c.votes,
        status: c.status,
      })),
    });
    return () => opts.host.replaceChildren();
  },
  ProcessMap: (opts) => {
    const s = saver(opts);
    const mapType = cfgStr(opts, "mapType");
    const mode: MapMode = ["simple", "swimlane", "sipoc", "vsm"].includes(mapType)
      ? (mapType as MapMode)
      : "simple";
    const parsed = parseProcessMap(opts.outputJson, mode);
    const env = parsed.envelope;
    const editor = new ProcessMapEditor(opts.host as HTMLDivElement, {
      onChange: (model) => {
        env.data = model;
        env.meta.updated = new Date().toISOString();
        s.save(serializeProcessMap(env));
      },
      onPngReady: s.onPng,
      dialogHost: opts.host,
    });
    if (mapType !== "") editor.setMode(mode);
    editor.setReadOnly(opts.readOnly);
    editor.setModel(env.data, true);
    return () => opts.host.replaceChildren();
  },

  // ---- action surfaces (the actions table IS the document) ----
  ActionBoard: (opts) => {
    const editor = new ActionBoardEditor(opts.host, {
      onChange: (actions) => opts.onActions(stamped(opts, actions)),
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    const view = cfgStr(opts, "view");
    const groupBy = cfgStr(opts, "kanbanGroupBy");
    editor.setOptions({
      view: (["list", "kanban", "gantt"].includes(view) ? view : "list") as never,
      groupBy: (["status", "assignee", "due"].includes(groupBy)
        ? groupBy
        : "status") as never,
    });
    editor.setActions(opts.actions);
    return () => opts.host.replaceChildren();
  },
  EscalationViewer: (opts) => {
    const editor = new EscalationViewerEditor(opts.host, {
      onChange: (actions) => opts.onActions(actions), // keep source identities
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setSources(parseSources(JSON.stringify(opts.sources)));
    editor.setViewer({ whoId: opts.viewer.whoId, who: opts.viewer.who });
    editor.setActions(opts.actions.filter((a) => a.escalated));
    return () => opts.host.replaceChildren();
  },

  // ---- display-only ----
  EmbedCard: (opts) => {
    const view = new EmbedView(opts.host);
    view.setTheme(opts.theme);
    view.setChrome(opts.title, promptsRaw(opts));
    view.setReadOnly(opts.readOnly);
    view.setUrl(cfgStr(opts, "url"));
    return () => opts.host.replaceChildren();
  },
};

export function cardMounter(cardType: string): CardMounter | null {
  return REGISTRY[cardType] ?? null;
}

export function supportedCardTypes(): string[] {
  return Object.keys(REGISTRY);
}
