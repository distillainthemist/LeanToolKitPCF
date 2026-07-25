// Tile-defaults generator — the empty-state SVG for every card type, which
// selfHealCatalog() writes into the LTK Card Catalog as each type's default
// tile (what a never-opened card shows on a board, and the composer's
// picker art).
//
// Runs in the browser, from app/tile-defaults.html on the dev server: the
// snapshot pipeline serialises live DOM, so it needs real layout — jsdom
// reports clientWidth 0 and the serialiser refuses zero-sized roots.
//
// This replaces a generator that drove the PCF bundles through a faked
// ComponentFramework context; the wrappers retired, so it now constructs
// the editor classes directly (docs/leanboard-pcf-retirement-plan.md).
//
// The card list comes from CardSettings' registry rather than a hard-coded
// array, so a newly registered card type cannot be silently missed — it
// shows up as a MISSING report instead.

import { buildCatalogJson } from "../../../controls/CardSettings/registry";
import { defaultTheme } from "../../../shared/tokens";

import { ActionBoardEditor } from "../../../controls/ActionBoard/editor";
import { AgendaEditor } from "../../../controls/AgendaCard/editor";
import { parseAgenda } from "../../../controls/AgendaCard/types";
import { BenefitEffortEditor } from "../../../controls/BenefitEffort/editor";
import { parseBenefitEffort } from "../../../controls/BenefitEffort/types";
import { CaptureEditor } from "../../../controls/CaptureCard/editor";
import { parseCapture, parseColumns, parseRows } from "../../../controls/CaptureCard/types";
import { ConditionsEditor } from "../../../controls/ConditionsCard/editor";
import { parseConditions, parseConditionsInput } from "../../../controls/ConditionsCard/types";
import { EscalationViewerEditor } from "../../../controls/EscalationViewer/editor";
import { parseSources } from "../../../controls/EscalationViewer/types";
import { FaultTreeEditor } from "../../../controls/FaultTree/editor";
import { parseFaultTree } from "../../../controls/FaultTree/types";
import { FishboneEditor } from "../../../controls/Fishbone/editor";
import { parseCategoriesSetting, parseFishbone } from "../../../controls/Fishbone/types";
import { FiveWhysEditor } from "../../../controls/FiveWhys/editor";
import { parseFiveWhys } from "../../../controls/FiveWhys/types";
import { HeatmapEditor } from "../../../controls/HeatmapCard/editor";
import { parseHeatmap } from "../../../controls/HeatmapCard/types";
import { KpiTrendEditor } from "../../../controls/KpiTrendCard/editor";
import { parseKpiTrend } from "../../../controls/KpiTrendCard/types";
import { ParetoEditor } from "../../../controls/ParetoCard/editor";
import { parsePareto } from "../../../controls/ParetoCard/types";
import { ProcessMapEditor } from "../../../controls/ProcessMap/editor";
import { parseProcessMap } from "../../../controls/ProcessMap/types";
import { RaciEditor } from "../../../controls/Raci/editor";
import { parseRaci } from "../../../controls/Raci/types";
import { RiskMatrixEditor } from "../../../controls/RiskMatrix/editor";
import { parseRiskMatrix } from "../../../controls/RiskMatrix/types";
import { SkillsMatrixEditor } from "../../../controls/SkillsMatrix/editor";
import { parseSkills } from "../../../controls/SkillsMatrix/types";
import { SqdpcEditor } from "../../../controls/SqdpcCard/editor";
import {
  parseDimensions,
  parseSqdpc,
  parseStatusCodes,
  parseSubtitles,
} from "../../../controls/SqdpcCard/types";
import { StatusTileEditor } from "../../../controls/StatusTile/editor";
import { parseStates, parseStatusTile } from "../../../controls/StatusTile/types";

/** Tile aspect: BoardGrid scales to fit, so this only sets the proportions. */
const WIDTH = 640;
const HEIGHT = 420;

/** Longest a card gets to produce its snapshot (the debounce is 400ms). */
const TIMEOUT_MS = 5000;

const theme = defaultTheme();
const noop = (): void => undefined;

/**
 * Mount one card in its EMPTY state with DEFAULT settings — every parse
 * helper is fed "" so it yields the card's own defaults, exactly as an
 * unconfigured card would render. No I/O: series-backed cards (SQDPC,
 * Conditions, KPI, Pareto, StatusTile) show their empty grid, which is the
 * point — the default tile is what a card looks like before anyone uses it.
 */
type Mounter = (host: HTMLElement, onSnapshot: (svg: string) => void) => void;

const MOUNTERS: Record<string, Mounter> = {
  FiveWhys: (host, onSnapshot) => {
    const ed = new FiveWhysEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseFiveWhys("").envelope, []);
  },

  Fishbone: (host, onSnapshot) => {
    const ed = new FishboneEditor(host as HTMLDivElement, { onChange: noop, onSnapshot });
    ed.setModel(parseFishbone("", parseCategoriesSetting("")).envelope.data);
  },

  FaultTree: (host, onSnapshot) => {
    const ed = new FaultTreeEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseFaultTree("").envelope, []);
  },

  ActionBoard: (host, onSnapshot) => {
    const ed = new ActionBoardEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setOptions({ view: "list", groupBy: "status" });
    ed.setActions([]);
  },

  SqdpcCard: (host, onSnapshot) => {
    const dims = parseDimensions("");
    const ed = new SqdpcEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setOptions({
      granularity: "day",
      dimensions: dims,
      subtitles: parseSubtitles("", dims),
      codes: parseStatusCodes(""),
      disableActions: false,
    });
    ed.setEnvelope(parseSqdpc("").envelope, []);
  },

  ConditionsCard: (host, onSnapshot) => {
    const ed = new ConditionsEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setOptions({
      granularity: "day",
      conditions: parseConditionsInput(""),
      asOf: undefined,
    });
    ed.setEnvelope(parseConditions("").envelope, []);
  },

  StatusTile: (host, onSnapshot) => {
    const ed = new StatusTileEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setStates(parseStates(""));
    ed.setEnvelope(parseStatusTile("").envelope);
  },

  KpiTrendCard: (host, onSnapshot) => {
    const ed = new KpiTrendEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setSpec({ target: null, usl: null, lsl: null, unit: "" });
    ed.setEnvelope(parseKpiTrend("").envelope);
  },

  ParetoCard: (host, onSnapshot) => {
    const ed = new ParetoEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parsePareto("").envelope);
  },

  BenefitEffort: (host, onSnapshot) => {
    const ed = new BenefitEffortEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseBenefitEffort("").envelope, []);
  },

  RiskMatrix: (host, onSnapshot) => {
    const ed = new RiskMatrixEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseRiskMatrix("").envelope, []);
  },

  Raci: (host, onSnapshot) => {
    const ed = new RaciEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseRaci("").envelope, []);
  },

  SkillsMatrix: (host, onSnapshot) => {
    const ed = new SkillsMatrixEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseSkills("").envelope, []);
  },

  ProcessMap: (host, onSnapshot) => {
    // an EMPTY map deliberately emits no snapshot (nodes.length check), so
    // its default tile is seeded with a minimal representative flow
    const seed = JSON.stringify({
      schema: "ltk/processmap@1",
      meta: { title: "", updated: "2026-01-01T00:00:00.000Z" },
      data: {
        mode: "simple",
        nodes: [
          { id: "n1", kind: "start", label: "Start", x: 60, y: 160 },
          { id: "n2", kind: "process", label: "Step", x: 260, y: 160 },
          { id: "n3", kind: "process", label: "Step", x: 460, y: 160 },
        ],
        edges: [
          { id: "e1", from: "n1", to: "n2", kind: "flow" },
          { id: "e2", from: "n2", to: "n3", kind: "flow" },
        ],
      },
    });
    const ed = new ProcessMapEditor(host as HTMLDivElement, { onChange: noop, onSnapshot });
    ed.setModel(parseProcessMap(seed).envelope.data, true);
  },

  CaptureCard: (host, onSnapshot) => {
    const rows = parseRows("");
    const ed = new CaptureEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setConfig(parseColumns(""), rows.headers, rows.titled);
    ed.setEnvelope(parseCapture("").envelope);
  },

  HeatmapCard: (host, onSnapshot) => {
    const ed = new HeatmapEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setImage(""); // no backdrop configured — the ghost state
    ed.setEnvelope(parseHeatmap("").envelope, []);
  },

  AgendaCard: (host, onSnapshot) => {
    const ed = new AgendaEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setEnvelope(parseAgenda("").envelope, []);
  },

  EscalationViewer: (host, onSnapshot) => {
    const ed = new EscalationViewerEditor(host, { onChange: noop, onSnapshot });
    ed.setTheme(theme);
    ed.setSources(parseSources(""));
    ed.setViewer({ whoId: "", who: "" });
    ed.setActions([]);
  },
};

/**
 * EmbedCard frames a cross-origin iframe, which can never be captured — a
 * hand-authored placeholder stands in, and the board opens the live embed.
 */
const EMBED_PLACEHOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">' +
  '<rect width="640" height="400" fill="#ffffff"/>' +
  '<rect x="24" y="24" width="592" height="352" rx="10" fill="none" stroke="#c8c4bc" stroke-width="2" stroke-dasharray="10 8"/>' +
  '<g fill="#8a8579" font-family="system-ui, sans-serif" text-anchor="middle">' +
  '<text x="320" y="180" font-size="56">▦</text>' +
  '<text x="320" y="232" font-size="24" font-weight="600">Embedded report</text>' +
  '<text x="320" y="262" font-size="16">Tap to open the live view</text>' +
  "</g></svg>";

const STATIC_TILES: Record<string, string> = { EmbedCard: EMBED_PLACEHOLDER };

/** Card types that are chrome, not display tiles — no default art wanted. */
const NOT_TILES = new Set(["MeetingScheduler", "MeetingWizard", "CardSettings", "BoardGrid", "LeanHub"]);

export interface TileDefaults {
  generated: string;
  format: "svg-markup";
  tiles: Record<string, string>;
}

export interface GenerateResult {
  defaults: TileDefaults;
  errors: string[];
  /** Registered card types with neither a mounter nor a deliberate skip. */
  missing: string[];
}

function harvest(type: string, mount: Mounter, stage: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:relative;background:${theme.background}`;
    stage.appendChild(host);
    let settled = false;
    const done = (svg: string) => {
      if (settled) return;
      settled = true;
      resolve(svg);
    };
    const timer = setTimeout(() => done(""), TIMEOUT_MS);
    try {
      mount(host, (svg) => {
        clearTimeout(timer);
        done(svg);
      });
    } catch (e) {
      clearTimeout(timer);
      done("");
      throw e;
    }
  });
}

/**
 * Render every registered card type and collect its empty-state SVG.
 * `stage` must be in the document and laid out — snapshots serialise live
 * DOM, so an offscreen-but-rendered container is required (position:fixed
 * far off-viewport works; display:none does not).
 */
export async function generateTileDefaults(stage: HTMLElement): Promise<GenerateResult> {
  const registered = (JSON.parse(buildCatalogJson()) as { type: string }[]).map((c) => c.type);
  const tiles: Record<string, string> = {};
  const errors: string[] = [];

  for (const type of registered) {
    if (NOT_TILES.has(type)) continue;
    const staticTile = STATIC_TILES[type];
    if (staticTile !== undefined) {
      tiles[type] = staticTile;
      continue;
    }
    const mount = MOUNTERS[type];
    if (!mount) continue; // reported as missing below
    try {
      const svg = await harvest(type, mount, stage);
      if (svg === "") errors.push(`${type}: no snapshot within ${TIMEOUT_MS}ms`);
      else tiles[type] = svg;
    } catch (e) {
      errors.push(`${type}: ${String(e)}`);
    }
  }

  const missing = registered.filter(
    (t) => !NOT_TILES.has(t) && !MOUNTERS[t] && STATIC_TILES[t] === undefined
  );

  return {
    defaults: {
      // stamped by the caller from a real clock
      generated: new Date().toISOString(),
      format: "svg-markup",
      tiles,
    },
    errors,
    missing,
  };
}
