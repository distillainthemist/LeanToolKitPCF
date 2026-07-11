// Data model for the process map — ported from ProcessMapPCF into the
// LeanToolKit envelope (ltk/processmap@1). The whole diagram (map type,
// nodes, connectors, swimlane titles) is the envelope's data. Legacy
// ProcessMapPCF documents ({mode,nodes,edges} with no wrapper) migrate in
// via the shared bare-document path in parseEnvelope.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/processmap@1";

export type MapMode = "simple" | "swimlane" | "sipoc" | "vsm";

export const MODES: { mode: MapMode; title: string }[] = [
  { mode: "simple", title: "Simple process map" },
  { mode: "swimlane", title: "Swimlane map" },
  { mode: "sipoc", title: "SIPOC" },
  { mode: "vsm", title: "Value stream map" },
];

export const DEFAULT_SWIMLANES = ["Customer", "Operations", "Support"];

export type NodeKind =
  // simple flowchart
  | "start"
  | "process"
  | "decision"
  | "data"
  | "document"
  | "end"
  // SIPOC
  | "card"
  // value stream map
  | "outside"
  | "vsmProcess"
  | "inventory"
  | "truck"
  | "kaizen"
  // free-floating annotation, available on every map type
  | "note";

export type EdgeKind = "flow" | "info" | "electronic";

export const EDGE_KINDS: { kind: EdgeKind; title: string }[] = [
  { kind: "flow", title: "Material / process flow" },
  { kind: "info", title: "Manual information" },
  { kind: "electronic", title: "Electronic information" },
];

/** Free-text metric fields shown in VSM data boxes. */
export interface PmMetrics {
  ct?: string; // cycle / process time
  co?: string; // changeover time
  uptime?: string;
  operators?: string;
  wait?: string; // inventory quantity / waiting time
}

export interface PmNode {
  id: string;
  kind: NodeKind;
  label: string;
  detail?: string; // secondary line (owner, system, notes)
  color?: string; // fill colour override (colour coding); empty = default
  x: number;
  y: number;
  lane?: number; // SIPOC column index 0..4, or swimlane row index
  metrics?: PmMetrics;
}

export interface PmEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string; // e.g. Yes / No on decision branches
}

/** The in-memory model the editor works on (also the envelope's data). */
export interface PmModel {
  mode: MapMode;
  nodes: PmNode[];
  edges: PmEdge[];
  showTimeline: boolean; // VSM lead-time ladder
  lanes: string[]; // swimlane row titles (used in swimlane mode)
}

export const SIPOC_LANES = ["Suppliers", "Inputs", "Process", "Outputs", "Customers"];

/** Preset fills for colour coding (pale so labels stay readable). */
export const COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "Default", value: "" },
  { name: "Red", value: "#fbd0d4" },
  { name: "Orange", value: "#ffe3c7" },
  { name: "Yellow", value: "#fff2b8" },
  { name: "Green", value: "#d3f0d1" },
  { name: "Teal", value: "#c9ecec" },
  { name: "Blue", value: "#cfe4f7" },
  { name: "Purple", value: "#e6dcf5" },
  { name: "Grey", value: "#e2e2e2" },
];

export function emptyModel(mode: MapMode = "simple"): PmModel {
  return {
    mode,
    nodes: [],
    edges: [],
    showTimeline: false,
    lanes: DEFAULT_SWIMLANES.slice(),
  };
}

export function newId(prefix = "n"): string {
  return prefix + Math.random().toString(36).slice(2, 9);
}

const NODE_KINDS: NodeKind[] = [
  "start",
  "process",
  "decision",
  "data",
  "document",
  "end",
  "card",
  "outside",
  "vsmProcess",
  "inventory",
  "truck",
  "kaizen",
  "note",
];

function isMode(v: unknown): v is MapMode {
  return v === "simple" || v === "swimlane" || v === "sipoc" || v === "vsm";
}

function isNodeKind(v: unknown): v is NodeKind {
  return typeof v === "string" && (NODE_KINDS as string[]).indexOf(v) >= 0;
}

function isEdgeKind(v: unknown): v is EdgeKind {
  return v === "flow" || v === "info" || v === "electronic";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function sanitizeMetrics(m: unknown): PmMetrics | undefined {
  if (!m || typeof m !== "object") return undefined;
  const src = m as Record<string, unknown>;
  const out: PmMetrics = {};
  let any = false;
  for (const key of ["ct", "co", "uptime", "operators", "wait"] as const) {
    const v = str(src[key]);
    if (v !== undefined) {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

function sanitizeNode(n: Partial<PmNode>): PmNode | null {
  if (!isNodeKind(n.kind)) return null;
  const x = Number(n.x);
  const y = Number(n.y);
  const node: PmNode = {
    id: typeof n.id === "string" && n.id ? n.id : newId(),
    kind: n.kind,
    label: typeof n.label === "string" ? n.label : "",
    x: Number.isFinite(x) ? Math.round(x) : 0,
    y: Number.isFinite(y) ? Math.round(y) : 0,
  };
  const detail = str(n.detail);
  if (detail !== undefined) node.detail = detail;
  const color = str(n.color);
  if (color !== undefined) node.color = color;
  const lane = Number(n.lane);
  // SIPOC uses 0..4; swimlanes may have more rows — clamp generously and let
  // the editor clamp to the actual lane count.
  if (Number.isFinite(lane)) node.lane = Math.min(32, Math.max(0, Math.round(lane)));
  const metrics = sanitizeMetrics(n.metrics);
  if (metrics) node.metrics = metrics;
  return node;
}

/**
 * Sanitize a raw data value (the envelope's data, or a whole legacy
 * ProcessMapPCF document) into a PmModel; never throws.
 */
export function sanitizeModel(data: unknown, fallbackMode: MapMode = "simple"): PmModel {
  const model = emptyModel(fallbackMode);
  if (!data || typeof data !== "object") return model;
  const src = data as {
    mode?: unknown;
    nodes?: unknown;
    edges?: unknown;
    showTimeline?: unknown;
    lanes?: unknown;
  };
  if (isMode(src.mode)) model.mode = src.mode;
  model.showTimeline = src.showTimeline === true;
  if (Array.isArray(src.lanes)) {
    const lanes = src.lanes
      .map((v) => String(v ?? "").trim())
      .filter((v) => v !== "")
      .slice(0, 12);
    if (lanes.length > 0) model.lanes = lanes;
  }

  const seen = new Set<string>();
  if (Array.isArray(src.nodes)) {
    for (const item of src.nodes) {
      if (!item || typeof item !== "object") continue;
      const node = sanitizeNode(item as Partial<PmNode>);
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      model.nodes.push(node);
    }
  }
  if (Array.isArray(src.edges)) {
    for (const item of src.edges) {
      if (!item || typeof item !== "object") continue;
      const e = item as Partial<PmEdge>;
      if (typeof e.from !== "string" || typeof e.to !== "string") continue;
      if (!seen.has(e.from) || !seen.has(e.to) || e.from === e.to) continue;
      if (model.edges.some((x) => x.from === e.from && x.to === e.to)) continue;
      const edge: PmEdge = {
        id: typeof e.id === "string" && e.id ? e.id : newId("e"),
        from: e.from,
        to: e.to,
        kind: isEdgeKind(e.kind) ? e.kind : "flow",
      };
      const label = str(e.label);
      if (label !== undefined) edge.label = label;
      model.edges.push(edge);
    }
  }
  return model;
}

// ---- envelope wrapping (toolkit standard) ----

export type ProcessMapEnvelope = Envelope<PmModel>;

/**
 * Parse an inputJSON document. Handles the toolkit envelope AND bare legacy
 * ProcessMapPCF documents ({mode,nodes,edges}) — parseEnvelope routes a
 * wrapperless document straight into sanitizeModel.
 */
export function parseProcessMap(
  raw: string | null | undefined,
  fallbackMode: MapMode = "simple"
): ParsedEnvelope<PmModel> {
  return parseEnvelope(raw, SCHEMA_ID, (data) => sanitizeModel(data, fallbackMode));
}

export function serializeProcessMap(env: ProcessMapEnvelope): string {
  return serializeEnvelope(env);
}

export interface PaletteItem {
  kind: NodeKind;
  title: string;
  defaultLabel: string;
}

/** The post-it note is available on every map type. */
const NOTE_ITEM: PaletteItem = { kind: "note", title: "Note", defaultLabel: "" };

/** Palette contents per map type. */
export function paletteFor(mode: MapMode): PaletteItem[] {
  switch (mode) {
    case "sipoc":
      return [{ kind: "card", title: "Card", defaultLabel: "New item" }, NOTE_ITEM];
    case "vsm":
      return [
        { kind: "outside", title: "Supplier / Customer", defaultLabel: "Supplier" },
        { kind: "vsmProcess", title: "Process + data box", defaultLabel: "Process" },
        { kind: "inventory", title: "Inventory", defaultLabel: "" },
        { kind: "truck", title: "Shipment", defaultLabel: "Daily" },
        { kind: "kaizen", title: "Kaizen burst", defaultLabel: "Improve" },
        NOTE_ITEM,
      ];
    default:
      return [
        { kind: "start", title: "Start", defaultLabel: "Start" },
        { kind: "process", title: "Process step", defaultLabel: "Step" },
        { kind: "decision", title: "Decision", defaultLabel: "Decision?" },
        { kind: "data", title: "Input / Output", defaultLabel: "Data" },
        { kind: "document", title: "Document", defaultLabel: "Document" },
        { kind: "end", title: "End", defaultLabel: "End" },
        NOTE_ITEM,
      ];
  }
}
