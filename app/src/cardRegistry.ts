// Card registry — cardType → mount adapter. Each adapter is the CardHost
// pattern for one editor: parse the stored envelope, mount with the
// slot's config, and save (document + freshest tile svg) through the
// provided callbacks. Actions ride the standard channel: the editor's
// full emitted set goes to onActions (new actions stamped with this
// card's instanceKey), the current set from the central table feeds in.

import { LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { openActionManager } from "../../shared/ui/actionUi";
import { Theme } from "../../shared/tokens";
import { saver } from "./saver";

import { KpiTrendEditor } from "../../controls/KpiTrendCard/editor";
import { parseKpiTrend, serializeKpiTrend } from "../../controls/KpiTrendCard/types";
import { SqdpcEditor } from "../../controls/SqdpcCard/editor";
import {
  Granularity as SqdpcGranularity,
  parseDimensions,
  parseSqdpc,
  parseStatusCodes,
  parseSubtitles,
  serializeSqdpc,
} from "../../controls/SqdpcCard/types";
import { ConditionsEditor } from "../../controls/ConditionsCard/editor";
import {
  buildPeriods,
  Granularity as ConditionsGranularity,
  parseAsOf,
  parseConditions,
  parseConditionsInput,
  serializeConditions,
} from "../../controls/ConditionsCard/types";
import { applySeries, hasAnySeries, listSeries } from "./store/series";
import {
  cellsFromPoints,
  cellsFromRatings,
  diffParetoItems,
  diffPoints,
  diffRatings,
  instanceDay,
  monthWindow,
  pointsFromCells,
  ratingsFromCells,
  sumsByKey,
  trailingWindow,
} from "./store/seriesMap";
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
import {
  buildEmbedUrl,
  parseEmbedNotes,
  parseHeadings,
  serializeEmbedNotes,
} from "../../controls/EmbedCard/types";
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
  /** The slot's identity — series cards key their table rows by these. */
  boardId: string;
  cardId: string;
  outputJson: string;
  people: Person[];
  theme: Theme;
  readOnly: boolean;
  /** The slot's settings blob (config, prompts, disableActions…). */
  settings: Record<string, unknown>;
  /** This card's action-channel identity — stamped on new actions. */
  instanceKey: string;
  /** The meeting instance's scheduled datetime ("" = live/template) —
   *  series cards derive their data window from it. */
  instanceWhen: string;
  /** The card's current actions from the central table. */
  actions: LtkAction[];
  /** Board cards offered as escalation sources ({instanceKey, label}). */
  sources: { instanceId: string; label: string }[];
  /** The signed-in viewer (EscalationViewer acknowledgements). */
  viewer: { whoId: string; who: string };
  /** Save the document + the freshest tile svg (debounced by the caller). */
  onSave: (outputJson: string, tileSvg: string) => void;
  /** Every fresh snapshot, even without a document edit — lets the board
   *  editor refresh a card's tile after a settings change. */
  onTile?: (tileSvg: string) => void;
  /** The full emitted action set on every change (already stamped). */
  onActions: (actions: LtkAction[]) => void;
}

export type CardMounter = (opts: CardMount) => () => void;

// ---- shared plumbing ----

function config(opts: CardMount): Record<string, unknown> {
  const c = opts.settings.config;
  return c && typeof c === "object" ? (c as Record<string, unknown>) : {};
}

function cfgStr(opts: CardMount, key: string): string {
  const v = config(opts)[key];
  return typeof v === "string" ? v : "";
}

/**
 * A config value as the raw string the control parsers expect. CardSettings
 * stores list/table fields as ARRAYS and key-value fields as OBJECTS, while
 * chip fields store a joined string — reading those with cfgStr yielded ""
 * and the card silently fell back to its defaults. Every parser accepts the
 * JSON form, so non-strings are stringified here.
 */
function cfgRaw(opts: CardMount, key: string): string {
  const v = config(opts)[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

/** A numeric config value; null when unset or unusable (the "number" field
 *  kind stores a real number, and blank clears the key entirely). */
function cfgNum(opts: CardMount, key: string): number | null {
  const v = config(opts)[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
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

/**
 * Per-element action management for the SVG editors (Fishbone causes,
 * Process-map nodes) — the manage/raise dialog reached through their
 * onManageActions callback, plus a live open-action badge count. Actions
 * persist through onActions and the editor's badges refresh via `refresh`.
 */
function elementActions(
  opts: CardMount,
  source: string,
  host: HTMLElement,
  refresh: () => void
) {
  const actions = opts.actions.slice();
  const doneColor = opts.theme.legend[1] ?? "#107c10";
  const commit = () => {
    opts.onActions(stamped(opts, actions));
    refresh();
  };
  return {
    badge: (sourceId: string) =>
      actions.filter(
        (a) =>
          a.context.sourceId === sourceId &&
          a.status !== "cancelled" &&
          a.status !== "done"
      ).length,
    manage: (sourceId: string, label: string) =>
      openActionManager({
        host,
        actions,
        source,
        sourceId,
        seedIssue: label,
        hint: source === "processmap" ? "kaizen" : undefined,
        people: opts.people,
        doneColor,
        readOnly: opts.readOnly,
        canRaise: !actionsOff(opts),
        onChanged: commit,
      }),
  };
}

const REGISTRY: Record<string, CardMounter> = {
  // ---- envelope + actions cards ----
  // Series card: ratings live in the Card Series table; the month shown is
  // the MEETING's month (fixes month-rollover), the document only carries
  // the tile svg + one-time migration source.
  SqdpcCard: (opts) => {
    const s = saver(opts);
    const day = instanceDay(opts.instanceWhen);
    const window = monthWindow(day);
    let lastMap: Record<string, string> = {};
    let edited = false;
    const env = parseSqdpc("").envelope;
    env.data.month = day.slice(0, 7);
    const editor = new SqdpcEditor(opts.host, {
      onChange: (env2, actions) => {
        edited = true;
        const { put, del } = diffRatings(lastMap, env2.data.ratings);
        lastMap = { ...env2.data.ratings };
        void applySeries(opts.boardId, opts.cardId, put, del).catch((err) =>
          console.warn("sqdpc series save failed", err)
        );
        s.save(serializeSqdpc({ ...env2, data: { ...env2.data, ratings: {} } }));
        opts.onActions(stamped(opts, actions));
      },
      onSnapshot: s.onSnapshot,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    const sqGranRaw = cfgStr(opts, "granularity");
    const sqDims = parseDimensions(cfgRaw(opts, "dimensions"));
    editor.setOptions({
      granularity: (["day", "weekday", "shift2"] as const).includes(sqGranRaw as never)
        ? (sqGranRaw as SqdpcGranularity)
        : "day",
      dimensions: sqDims,
      subtitles: parseSubtitles(cfgRaw(opts, "subtitles"), sqDims),
      codes: parseStatusCodes(cfgRaw(opts, "statusCodes")),
      disableActions: actionsOff(opts),
    });
    editor.setEnvelope(env, opts.actions);
    void (async () => {
      try {
        let cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
        if (cells.length === 0 && !(await hasAnySeries(opts.boardId, opts.cardId))) {
          const legacy = parseSqdpc(opts.outputJson).envelope.data.ratings;
          const seed = cellsFromRatings(legacy);
          if (seed.length > 0) {
            await applySeries(opts.boardId, opts.cardId, seed);
            cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
          }
        }
        if (edited) return; // never overwrite an edit that beat the load
        lastMap = ratingsFromCells(cells);
        env.data.ratings = { ...lastMap };
        editor.setEnvelope(env, opts.actions);
      } catch (err) {
        console.warn("sqdpc series load failed", err);
      }
    })();
    return () => opts.host.replaceChildren();
  },
  // Series card: ratings live in the Card Series table, windowed to the
  // meeting instance's date. The document is kept only as the tile-svg
  // carrier (and the one-time migration source); ratings no longer grow it.
  ConditionsCard: (opts) => {
    const s = saver(opts);
    const granRaw = cfgStr(opts, "granularity");
    const gran: ConditionsGranularity = (
      ["day", "weekday", "week", "shift"] as const
    ).includes(granRaw as never)
      ? (granRaw as ConditionsGranularity)
      : "day";
    const conditions = parseConditionsInput(cfgRaw(opts, "conditions"));
    // the window ends on the meeting's own date; a configured as-of date
    // overrides it (the maker pinning the card to a period for review)
    const asOf =
      parseAsOf(cfgStr(opts, "asOfDate")) ?? parseAsOf(instanceDay(opts.instanceWhen));
    const periods = buildPeriods(gran, asOf);
    const window = { from: periods[0].key, to: periods[periods.length - 1].key };
    let lastMap: Record<string, string> = {};
    let edited = false;
    const env = parseConditions("").envelope;
    const editor = new ConditionsEditor(opts.host, {
      onChange: (env2, actions) => {
        edited = true;
        const { put, del } = diffRatings(lastMap, env2.data.ratings as Record<string, string>);
        lastMap = { ...(env2.data.ratings as Record<string, string>) };
        void applySeries(opts.boardId, opts.cardId, put, del).catch((err) =>
          console.warn("conditions series save failed", err)
        );
        // tiny doc save carries the fresh tile svg; ratings stay in rows
        s.save(serializeConditions({ ...env2, data: { ratings: {} } }));
        opts.onActions(stamped(opts, actions));
      },
      onSnapshot: s.onSnapshot,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people); // the action assignee roster
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(actionsOff(opts));
    editor.setOptions({ granularity: gran, conditions, asOf });
    editor.setEnvelope(env, opts.actions);
    void (async () => {
      try {
        let cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
        if (cells.length === 0 && !(await hasAnySeries(opts.boardId, opts.cardId))) {
          // one-time migration: decompose the legacy document into rows
          const legacy = parseConditions(opts.outputJson).envelope.data.ratings;
          const seed = cellsFromRatings(legacy as Record<string, string>);
          if (seed.length > 0) {
            await applySeries(opts.boardId, opts.cardId, seed);
            cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
          }
        }
        if (edited) return; // never overwrite an edit that beat the load
        lastMap = ratingsFromCells(cells);
        (env.data as { ratings: Record<string, string> }).ratings = { ...lastMap };
        editor.setEnvelope(env, opts.actions);
      } catch (err) {
        console.warn("conditions series load failed", err);
      }
    })();
    return () => opts.host.replaceChildren();
  },
  FiveWhys: (opts) => {
    const s = saver(opts);
    const editor = new FiveWhysEditor(opts.host, {
      onChange: (env, actions) => {
        s.save(serializeFiveWhys(env));
        opts.onActions(stamped(opts, actions));
      },
      onSnapshot: s.onSnapshot,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setPeople(opts.people); // the action assignee roster
    editor.setReadOnly(opts.readOnly);
    editor.setOptions({
      showStatus: config(opts).showStatus === true,
      disableActions: actionsOff(opts),
    });
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
      onSnapshot: s.onSnapshot,
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
  // Series card: readings live in the Card Series table keyed by point id
  // (per-reading actions keep their linkage), windowed to the trailing
  // kpiWindowDays ending on the meeting's date. Target/spec/unit stay in
  // the document, which also carries the tile svg.
  KpiTrendCard: (opts) => {
    const s = saver(opts);
    const day = instanceDay(opts.instanceWhen);
    const cfgDays = Math.round(Number(cfgStr(opts, "kpiWindowDays")));
    const window = trailingWindow(
      day,
      Number.isFinite(cfgDays) && cfgDays >= 7 && cfgDays <= 1000 ? cfgDays : 91
    );
    const env = parseKpiTrend(opts.outputJson).envelope; // target/usl/lsl/unit
    // baseline [] — an edit that beats the row load then writes EVERY point,
    // which is itself the migration; the load guard below won't clobber it
    let lastPoints: typeof env.data.points = [];
    let edited = false;
    const editor = new KpiTrendEditor(opts.host, {
      onChange: (env2) => {
        edited = true;
        const { put, del } = diffPoints(lastPoints, env2.data.points);
        lastPoints = env2.data.points.map((p) => ({ ...p }));
        void applySeries(opts.boardId, opts.cardId, put, del).catch((err) =>
          console.warn("kpi series save failed", err)
        );
        // the doc keeps target/spec/unit + tile svg; points live in rows
        s.save(serializeKpiTrend({ ...env2, data: { ...env2.data, points: [] } }));
      },
      onSnapshot: s.onSnapshot,
      onActions: (actions) => opts.onActions(stamped(opts, actions)),
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setPeople(opts.people);
    editor.setActions(opts.actions);
    editor.setCanRaise(!actionsOff(opts));
    // target / limits / unit live in card settings (the kebab dialog was
    // easy to miss, especially in the focused view); a blank field falls
    // back to whatever the card's own document already held
    editor.setSpec({
      target: cfgNum(opts, "target"),
      usl: cfgNum(opts, "usl"),
      lsl: cfgNum(opts, "lsl"),
      unit: cfgStr(opts, "unit"),
    });
    editor.setEnvelope(env);
    void (async () => {
      try {
        let cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
        if (cells.length === 0 && !(await hasAnySeries(opts.boardId, opts.cardId))) {
          const seed = cellsFromPoints(env.data.points);
          if (seed.length > 0) {
            await applySeries(opts.boardId, opts.cardId, seed);
            cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
          }
        }
        if (edited) return; // never overwrite an edit that beat the load
        const points = pointsFromCells(cells);
        lastPoints = points.map((p) => ({ ...p }));
        env.data.points = points;
        editor.setEnvelope(env);
      } catch (err) {
        console.warn("kpi series load failed", err);
      }
    })();
    return () => opts.host.replaceChildren();
  },
  StatusTile: (opts) => {
    const s = saver(opts);
    const states = parseStates(cfgRaw(opts, "states"));
    const parsed = parseStatusTile(opts.outputJson).envelope;
    // additive status log: every state change also upserts a day-grain
    // series row (key "state", the meeting's day, value = the label) so
    // status-over-time is reportable. The card's own behaviour — document
    // state + reason, carry/shared snapshots — is unchanged.
    let lastStateIndex = parsed.data.stateIndex;
    const editor = new StatusTileEditor(opts.host, {
      onChange: (env) => {
        if (env.data.stateIndex !== lastStateIndex) {
          lastStateIndex = env.data.stateIndex;
          const label = states[env.data.stateIndex] ?? String(env.data.stateIndex);
          void applySeries(opts.boardId, opts.cardId, [
            { key: "state", date: instanceDay(opts.instanceWhen), shift: "-", value: label },
          ]).catch((err) => console.warn("status log failed", err));
        }
        s.save(serializeStatusTile(env));
      },
      onSnapshot: s.onSnapshot,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setStates(states);
    editor.setEnvelope(parsed);
    return () => opts.host.replaceChildren();
  },
  // Series card: the bars sum each category's DAILY count rows over the
  // trailing paretoWindowDays ending on the meeting's date. Category
  // definitions stay in the document (counts stored as 0 there); a ＋1 or
  // an edited total lands as a delta on the meeting-day row.
  ParetoCard: (opts) => {
    const s = saver(opts);
    const day = instanceDay(opts.instanceWhen);
    const cfgDays = Math.round(Number(cfgStr(opts, "paretoWindowDays")));
    const window = trailingWindow(
      day,
      Number.isFinite(cfgDays) && cfgDays >= 1 && cfgDays <= 1000 ? cfgDays : 30
    );
    const env = parsePareto(opts.outputJson).envelope; // definitions + unit
    let lastItems: typeof env.data.items = [];
    let edited = false;
    // the meeting-day row per category (deltas apply against these)
    const todayValue: Record<string, number> = {};
    const editor = new ParetoEditor(opts.host, {
      onChange: (env2) => {
        edited = true;
        const { deltas } = diffParetoItems(lastItems, env2.data.items);
        lastItems = env2.data.items.map((i) => ({ ...i }));
        const put = Object.entries(deltas).map(([id, delta]) => {
          const next = Math.max(0, (todayValue[id] ?? 0) + delta);
          todayValue[id] = next;
          return { key: id, date: day, shift: "-", value: String(next) };
        });
        if (put.length > 0) {
          void applySeries(opts.boardId, opts.cardId, put).catch((err) =>
            console.warn("pareto series save failed", err)
          );
        }
        // the doc keeps definitions (counts zeroed) + unit + tile svg
        s.save(
          serializePareto({
            ...env2,
            data: {
              ...env2.data,
              items: env2.data.items.map((i) => ({ ...i, count: 0 })),
            },
          })
        );
      },
      onSnapshot: s.onSnapshot,
      onActions: (actions) => opts.onActions(stamped(opts, actions)),
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    editor.setPeople(opts.people);
    editor.setActions(opts.actions);
    editor.setCanRaise(!actionsOff(opts));
    editor.setCountNote(
      `Count = the ${window.from} – ${window.to} total; a change lands on ${day}.`
    );
    editor.setEnvelope(env);
    void (async () => {
      try {
        let cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
        if (cells.length === 0 && !(await hasAnySeries(opts.boardId, opts.cardId))) {
          // one-time migration: legacy totals become the meeting day's rows
          const seed = env.data.items
            .filter((i) => i.count > 0)
            .map((i) => ({ key: i.id, date: day, shift: "-", value: String(i.count) }));
          if (seed.length > 0) {
            await applySeries(opts.boardId, opts.cardId, seed);
            cells = await listSeries(opts.boardId, opts.cardId, window.from, window.to);
          }
        }
        if (edited) return; // never overwrite an edit that beat the load
        const sums = sumsByKey(cells);
        for (const c of cells) {
          if (c.date === day) todayValue[c.key] = Number(c.value) || 0;
        }
        env.data.items = env.data.items.map((i) => ({ ...i, count: sums[i.id] ?? 0 }));
        lastItems = env.data.items.map((i) => ({ ...i }));
        editor.setEnvelope(env);
      } catch (err) {
        console.warn("pareto series load failed", err);
      }
    })();
    return () => opts.host.replaceChildren();
  },
  CaptureCard: (opts) => {
    const s = saver(opts);
    const editor = new CaptureEditor(opts.host, {
      onChange: (env) => s.save(serializeCapture(env)),
      onSnapshot: s.onSnapshot,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, promptsRaw(opts));
    editor.setReadOnly(opts.readOnly);
    const rows = parseCaptureRows(cfgRaw(opts, "rowsJSON"));
    editor.setConfig(
      parseCaptureColumns(cfgRaw(opts, "columnsJSON")),
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
      parseCategoriesSetting(cfgRaw(opts, "categories"))
    );
    const env = parsed.envelope;
    // the model handed to the editor, rebuilt to refresh cause badges
    const modelOf = (): FishboneModel => ({
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
    const mgr = elementActions(opts, "fishbone", opts.host, () =>
      editor.setModel(modelOf())
    );
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
      onSnapshot: s.onSnapshot,
      // raise / manage actions on a cause (the editor's cause dialog)
      onManageActions: (causeId) =>
        mgr.manage(
          causeId,
          env.data.causes.find((c) => c.id === causeId)?.text ?? ""
        ),
      getActionBadge: mgr.badge,
    });
    // a closed meeting locks the diagram itself, not just its actions
    editor.setReadOnly(opts.readOnly);
    editor.setDisableActions(opts.readOnly || actionsOff(opts));
    editor.setModel(modelOf());
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
    const mgr = elementActions(opts, "processmap", opts.host, () =>
      editor.setModel(env.data)
    );
    const editor = new ProcessMapEditor(opts.host as HTMLDivElement, {
      onChange: (model) => {
        env.data = model;
        env.meta.updated = new Date().toISOString();
        s.save(serializeProcessMap(env));
      },
      onSnapshot: s.onSnapshot,
      dialogHost: opts.host,
      // raise / manage actions on a kaizen node
      onManageActions: (nodeId) =>
        mgr.manage(
          nodeId,
          env.data.nodes.find((n) => n.id === nodeId)?.label ?? ""
        ),
      getActionBadge: mgr.badge,
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
    // an explicitly configured source list wins; otherwise roll up this
    // board's own cards (the default that makes the card work unconfigured)
    const configured = parseSources(cfgRaw(opts, "sourcesJSON"));
    editor.setSources(
      configured.length > 0 ? configured : parseSources(JSON.stringify(opts.sources))
    );
    editor.setViewer({ whoId: opts.viewer.whoId, who: opts.viewer.who });
    editor.setActions(opts.actions.filter((a) => a.escalated));
    return () => opts.host.replaceChildren();
  },

  // ---- display-only ----
  EmbedCard: (opts) => {
    const s = saver(opts);
    // the commentary document (heading → rich-text note); "" parses to an
    // empty envelope, so pre-commentary cards need no migration
    const env = parseEmbedNotes(opts.outputJson).envelope;
    const view = new EmbedView(opts.host, {
      onNotes: (notes) => {
        env.data.notes = notes;
        env.meta.updated = new Date().toISOString();
        s.save(serializeEmbedNotes(env));
      },
      onActions: (actions) => opts.onActions(stamped(opts, actions)),
    });
    view.setTheme(opts.theme);
    view.setChrome(opts.title, promptsRaw(opts));
    view.setReadOnly(opts.readOnly);
    view.setPeople(opts.people);
    view.setActions(opts.actions);
    view.setCanRaise(!actionsOff(opts));
    view.setCommentary(parseHeadings(cfgStr(opts, "commentaryHeadings")));
    view.setNotes(env.data.notes);
    // the settings key is "embedUrl" (see CardSettings/registry.ts); route
    // through buildEmbedUrl so it is normalised and the Power BI pane
    // toggles / page selection are applied
    view.setUrl(
      buildEmbedUrl({
        url: cfgStr(opts, "embedUrl"),
        hideFilterPane: config(opts).hideFilterPane === true,
        hidePageNav: config(opts).hidePageNav === true,
        pageName: cfgStr(opts, "pageName"),
      })
    );
    return () => opts.host.replaceChildren();
  },
};

export function cardMounter(cardType: string): CardMounter | null {
  return REGISTRY[cardType] ?? null;
}

export function supportedCardTypes(): string[] {
  return Object.keys(REGISTRY);
}
