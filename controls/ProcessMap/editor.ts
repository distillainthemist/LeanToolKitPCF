// Self-contained SVG process-map editor: palette, drag-drop, connect,
// pan/zoom, SIPOC columns, swimlane rows, VSM data boxes + timeline.
// Ported from ProcessMapPCF; restyled onto the toolkit tokens. No runtime
// dependencies. Kaizen bursts surface action hooks (badge + manage) that the
// toolkit wrapper connects to the shared action UI.

import {
  PmModel,
  PmNode,
  PmEdge,
  MapMode,
  MODES,
  NodeKind,
  EdgeKind,
  EDGE_KINDS,
  PmMetrics,
  DEFAULT_SWIMLANES,
  emptyModel,
  newId,
  paletteFor,
  SIPOC_LANES,
  COLOR_PRESETS,
} from "./types";
import { SVG_NS, nodeBox, buildSymbol, buildLabel } from "./shapes";
import { textOn } from "../../shared/tokens";
import { PROCESS_MAP_CSS } from "./styles";

interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

interface Selection {
  type: "node" | "edge";
  id: string;
}

export interface StyleConfig {
  fontFamily: string;
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
}

export function defaultStyle(): StyleConfig {
  return {
    fontFamily: "Segoe UI, system-ui, sans-serif",
    backgroundColor: "#ffffff",
    foregroundColor: "#141414",
    accentColor: "#141414",
  };
}

export interface EditorOptions {
  onChange: (model: PmModel) => void;
  onPngReady?: (dataUri: string) => void;
  /** Open the actions dialog for a kaizen burst (wrapper supplies the UI). */
  onManageActions?: (nodeId: string) => void;
  /** Open-action count shown as a badge on kaizen bursts. */
  getActionBadge?: (nodeId: string) => number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const GRID = 10;

// SIPOC lane geometry (world units)
const LANE_W = 230;
const LANE_HEAD_H = 44;
const LANE_STACK_TOP = 64;
const LANE_GAP = 14;
const LANE_MIN_H = 560;

// Swimlane geometry (world units): horizontal rows with a header band left
const SWIM_LANE_H = 170;
const SWIM_HEAD_W = 40;
const SWIM_MIN_W = 900;

export class ProcessMapEditor {
  private root: HTMLDivElement;
  private palette!: HTMLDivElement;
  private toolbar!: HTMLDivElement;
  private modeSelect!: HTMLSelectElement;
  private timelineBtn!: HTMLButtonElement;
  private addLaneBtn!: HTMLButtonElement;
  private rmLaneBtn!: HTMLButtonElement;
  private stage!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private defs!: SVGDefsElement;
  private world!: SVGGElement;
  private laneLayer!: SVGGElement;
  private edgeLayer!: SVGGElement;
  private nodeLayer!: SVGGElement;
  private timelineLayer!: SVGGElement;
  private overlay!: SVGGElement;
  private hint!: HTMLDivElement;
  private roBadge!: HTMLDivElement;

  // properties panel
  private props!: HTMLDivElement;
  private propKind!: HTMLSpanElement;
  private propLabel!: HTMLInputElement;
  private propDetailRow!: HTMLDivElement;
  private propDetail!: HTMLInputElement;
  private propTypeRow!: HTMLDivElement;
  private propType!: HTMLSelectElement;
  private propColorRow!: HTMLDivElement;
  private propSwatches!: HTMLDivElement;
  private propCustomColor!: HTMLInputElement;
  private propActionsBtn!: HTMLButtonElement;
  private metricRows: { key: keyof PmMetrics; row: HTMLDivElement; input: HTMLInputElement }[] = [];

  private model: PmModel = emptyModel();
  private view: Viewport = { tx: 60, ty: 40, scale: 1 };
  private selected: Selection | null = null;
  private readOnly = false;
  private style: StyleConfig = defaultStyle();
  private onChange: (model: PmModel) => void;
  private onPngReady?: (dataUri: string) => void;
  private onManageActions?: (nodeId: string) => void;
  private getActionBadge?: (nodeId: string) => number;
  private pngTimer: ReturnType<typeof setTimeout> | null = null;
  private uid = newId("pm");

  // interaction state
  private dragNode: { id: string; offX: number; offY: number; moved: boolean } | null = null;
  private panning: { sx: number; sy: number; tx: number; ty: number } | null = null;
  private connecting: { from: string; line: SVGLineElement } | null = null;
  private spawning: { kind: NodeKind; defaultLabel: string; ghost: HTMLDivElement } | null = null;
  private labelInput: HTMLInputElement | null = null;

  // bound handlers so we can remove them on destroy
  private onWinMove = (e: PointerEvent) => this.handleWindowMove(e);
  private onWinUp = (e: PointerEvent) => this.handleWindowUp(e);
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLDivElement, opts: EditorOptions) {
    this.onChange = opts.onChange;
    this.onPngReady = opts.onPngReady;
    this.onManageActions = opts.onManageActions;
    this.getActionBadge = opts.getActionBadge;
    this.root = document.createElement("div");
    this.root.className = "pm-root";
    const styleEl = document.createElement("style");
    styleEl.textContent = PROCESS_MAP_CSS;
    this.root.appendChild(styleEl);
    container.appendChild(this.root);
    this.buildChrome();
    this.attachGlobalHandlers();
    this.render();
  }

  // ---------- public API ----------

  setModel(model: PmModel): void {
    this.model = model;
    if (this.selected && !this.selectionExists(this.selected)) this.selected = null;
    if (model.mode === "sipoc") this.relayoutSipoc();
    if (model.mode === "swimlane") this.ensureSwimlanes();
    this.syncModeUi();
    this.render();
    this.schedulePng();
  }

  getModel(): PmModel {
    return this.model;
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly === ro) return;
    this.readOnly = ro;
    this.root.classList.toggle("pm-readonly", ro);
    this.roBadge.style.display = ro ? "block" : "none";
    this.modeSelect.disabled = ro;
    this.render();
  }

  setStyle(style: StyleConfig): void {
    const changed = JSON.stringify(style) !== JSON.stringify(this.style);
    this.style = style;
    this.root.style.fontFamily = style.fontFamily;
    this.stage.style.background = style.backgroundColor;
    // lane bands and badges carry inline theme colours — re-render on change
    if (changed) this.render();
  }

  resize(width: number, height: number): void {
    if (width > 0) this.root.style.width = width + "px";
    if (height > 0) this.root.style.height = height + "px";
  }

  destroy(): void {
    window.removeEventListener("pointermove", this.onWinMove);
    window.removeEventListener("pointerup", this.onWinUp);
    window.removeEventListener("keydown", this.onKey);
    if (this.pngTimer) clearTimeout(this.pngTimer);
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  // ---------- DOM construction ----------

  private buildChrome(): void {
    this.palette = document.createElement("div");
    this.palette.className = "pm-palette";
    this.renderPalette();

    // toolbar
    this.toolbar = document.createElement("div");
    this.toolbar.className = "pm-toolbar";

    this.modeSelect = document.createElement("select");
    this.modeSelect.className = "pm-select pm-mode";
    this.modeSelect.title = "Map type";
    for (const m of MODES) {
      const opt = document.createElement("option");
      opt.value = m.mode;
      opt.textContent = m.title;
      this.modeSelect.appendChild(opt);
    }
    this.modeSelect.addEventListener("change", () => {
      this.setMode(this.modeSelect.value as MapMode);
    });
    this.toolbar.appendChild(this.modeSelect);

    this.toolbar.appendChild(
      this.makeButton("Delete", "Delete selected (Del)", () => this.deleteSelection())
    );
    this.timelineBtn = this.makeButton(
      "Timeline",
      "Toggle the lead-time ladder under the map",
      () => {
        this.model.showTimeline = !this.model.showTimeline;
        this.render();
        this.commit();
      }
    );
    this.toolbar.appendChild(this.timelineBtn);
    this.addLaneBtn = this.makeButton("＋ Lane", "Add a swimlane", () => this.addLane());
    this.rmLaneBtn = this.makeButton("− Lane", "Remove the last (empty) swimlane", () =>
      this.removeLane()
    );
    this.toolbar.appendChild(this.addLaneBtn);
    this.toolbar.appendChild(this.rmLaneBtn);
    this.toolbar.appendChild(this.makeSpacer());
    this.toolbar.appendChild(this.makeButton("Zoom +", "Zoom in", () => this.zoomBy(1.2), true));
    this.toolbar.appendChild(this.makeButton("Zoom −", "Zoom out", () => this.zoomBy(1 / 1.2), true));
    this.toolbar.appendChild(this.makeButton("Fit", "Fit / reset view", () => this.fitView(), true));

    // stage + svg
    this.stage = document.createElement("div");
    this.stage.className = "pm-stage";

    this.svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.svg.setAttribute("class", "pm-svg");
    this.svg.addEventListener("pointerdown", (e) => this.startPanOrDeselect(e));
    this.svg.addEventListener("wheel", (e) => this.handleWheel(e), { passive: false });

    this.defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
    this.defs.appendChild(this.makeArrowMarker(this.arrowId(), "#555"));
    this.defs.appendChild(this.makeArrowMarker(this.arrowId("sel"), "#2b7de9"));
    this.svg.appendChild(this.defs);

    this.world = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.laneLayer = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.edgeLayer = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.timelineLayer = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.nodeLayer = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.overlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.world.appendChild(this.laneLayer);
    this.world.appendChild(this.edgeLayer);
    this.world.appendChild(this.timelineLayer);
    this.world.appendChild(this.nodeLayer);
    this.world.appendChild(this.overlay);
    this.svg.appendChild(this.world);
    this.stage.appendChild(this.svg);

    this.hint = document.createElement("div");
    this.hint.className = "pm-hint";
    this.stage.appendChild(this.hint);

    this.roBadge = document.createElement("div");
    this.roBadge.className = "pm-ro-badge";
    this.roBadge.textContent = "Read-only";
    this.roBadge.style.display = "none";
    this.stage.appendChild(this.roBadge);

    this.buildPropsPanel();

    const main = document.createElement("div");
    main.className = "pm-main";
    main.appendChild(this.toolbar);
    main.appendChild(this.stage);

    this.root.appendChild(this.palette);
    this.root.appendChild(main);
    this.syncModeUi();
  }

  private renderPalette(): void {
    while (this.palette.firstChild) this.palette.removeChild(this.palette.firstChild);
    for (const item of paletteFor(this.model.mode)) {
      const btn = document.createElement("div");
      btn.className = "pm-pal-item";
      btn.title = item.title + " — drag onto the canvas";
      btn.appendChild(this.miniSymbol(item.kind));
      const cap = document.createElement("span");
      cap.className = "pm-pal-cap";
      cap.textContent = item.title;
      btn.appendChild(cap);
      btn.addEventListener("pointerdown", (e) => this.startSpawn(e, item.kind, item.defaultLabel));
      this.palette.appendChild(btn);
    }
  }

  private makeButton(
    text: string,
    title: string,
    onClick: () => void,
    allowReadOnly = false
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "pm-btn" + (allowReadOnly ? "" : " pm-edit-only");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      if (allowReadOnly || !this.readOnly) onClick();
    });
    return b;
  }

  private makeSpacer(): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = "pm-spacer";
    return s;
  }

  private miniSymbol(kind: NodeKind): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("class", "pm-mini");
    const box = nodeBox(kind);
    const pad = 8;
    svg.setAttribute(
      "viewBox",
      `${-box.hw - pad} ${-box.ht - pad} ${box.hw * 2 + pad * 2} ${box.ht * 2 + pad * 2}`
    );
    svg.appendChild(buildSymbol({ kind }));
    return svg;
  }

  private makeArrowMarker(id: string, color: string): SVGMarkerElement {
    const m = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
    m.setAttribute("id", id);
    m.setAttribute("markerWidth", "10");
    m.setAttribute("markerHeight", "8");
    m.setAttribute("refX", "9");
    m.setAttribute("refY", "4");
    m.setAttribute("orient", "auto");
    m.setAttribute("markerUnits", "userSpaceOnUse");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M 0 0 L 10 4 L 0 8 Z");
    p.setAttribute("fill", color);
    m.appendChild(p);
    return m;
  }

  private arrowId(variant = ""): string {
    return `${this.uid}-arrow${variant ? "-" + variant : ""}`;
  }

  private attachGlobalHandlers(): void {
    window.addEventListener("pointermove", this.onWinMove);
    window.addEventListener("pointerup", this.onWinUp);
    window.addEventListener("keydown", this.onKey);
  }

  // ---------- coordinate / lookup helpers ----------

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.view.tx) / this.view.scale,
      y: (clientY - r.top - this.view.ty) / this.view.scale,
    };
  }

  private node(id: string): PmNode | undefined {
    return this.model.nodes.find((n) => n.id === id);
  }

  private edge(id: string): PmEdge | undefined {
    return this.model.edges.find((e) => e.id === id);
  }

  private selectionExists(sel: Selection): boolean {
    return sel.type === "node" ? !!this.node(sel.id) : !!this.edge(sel.id);
  }

  private selectedNode(): PmNode | undefined {
    return this.selected && this.selected.type === "node" ? this.node(this.selected.id) : undefined;
  }

  private selectedEdge(): PmEdge | undefined {
    return this.selected && this.selected.type === "edge" ? this.edge(this.selected.id) : undefined;
  }

  private snap(v: number): number {
    return this.model.mode === "sipoc" ? Math.round(v) : Math.round(v / GRID) * GRID;
  }

  // ---------- mode ----------

  private setMode(mode: MapMode): void {
    if (this.model.mode === mode) return;
    this.model.mode = mode;
    if (mode === "sipoc") {
      this.assignLanesFromPositions();
      this.relayoutSipoc();
    }
    if (mode === "swimlane") {
      this.ensureSwimlanes();
      this.assignSwimlanesFromPositions();
    }
    this.selected = null;
    this.syncModeUi();
    this.render();
    this.commit();
  }

  /** Reflect the current mode in palette, toolbar and hint. */
  private syncModeUi(): void {
    this.modeSelect.value = this.model.mode;
    this.renderPalette();
    this.timelineBtn.style.display = this.model.mode === "vsm" ? "" : "none";
    const swim = this.model.mode === "swimlane";
    this.addLaneBtn.style.display = swim ? "" : "none";
    this.rmLaneBtn.style.display = swim ? "" : "none";
    this.hint.textContent =
      this.model.mode === "sipoc"
        ? "Drag cards from the palette into the SIPOC columns."
        : this.model.mode === "vsm"
          ? "Drag value-stream symbols onto the canvas, then join them with the handles."
          : swim
            ? "Drag shapes into the lanes, join steps with the handles. Double-tap a lane header to rename it."
            : "Drag a shape from the palette onto the canvas, then join steps with the handles.";
  }

  // ---------- swimlanes ----------

  private ensureSwimlanes(): void {
    if (this.model.lanes.length === 0) this.model.lanes = DEFAULT_SWIMLANES.slice();
  }

  private swimLaneFromY(y: number): number {
    return Math.min(this.model.lanes.length - 1, Math.max(0, Math.floor(y / SWIM_LANE_H)));
  }

  /** First entry into swimlane mode: band nodes by y and tuck them inside. */
  private assignSwimlanesFromPositions(): void {
    for (const n of this.model.nodes) {
      const lane = this.swimLaneFromY(n.y);
      n.lane = lane;
      const b = nodeBox(n.kind);
      const top = lane * SWIM_LANE_H + b.ht + 12;
      const bottom = (lane + 1) * SWIM_LANE_H - b.ht - 12;
      n.y = Math.max(top, Math.min(bottom, n.y));
    }
  }

  private swimWidth(): number {
    let max = 0;
    for (const n of this.model.nodes) {
      max = Math.max(max, n.x + nodeBox(n.kind).hw);
    }
    return Math.max(SWIM_MIN_W, max + 80);
  }

  private addLane(): void {
    if (this.model.mode !== "swimlane") return;
    if (this.model.lanes.length >= 12) return;
    this.model.lanes.push(`Lane ${this.model.lanes.length + 1}`);
    this.render();
    this.commit();
  }

  private removeLane(): void {
    if (this.model.mode !== "swimlane") return;
    if (this.model.lanes.length <= 1) return;
    const last = this.model.lanes.length - 1;
    const occupied = this.model.nodes.some(
      (n) => (n.lane ?? this.swimLaneFromY(n.y)) === last
    );
    if (occupied) {
      this.hint.textContent = "Move the shapes out of the last lane before removing it.";
      this.hint.style.display = "block";
      setTimeout(() => this.render(), 1600);
      return;
    }
    this.model.lanes.pop();
    this.render();
    this.commit();
  }

  /** First entry into SIPOC: spread existing nodes over the five columns by x. */
  private assignLanesFromPositions(): void {
    const unassigned = this.model.nodes.filter((n) => n.lane === undefined);
    if (unassigned.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of unassigned) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
    }
    const span = Math.max(1, maxX - minX);
    for (const n of unassigned) {
      n.lane = Math.min(4, Math.floor(((n.x - minX) / span) * 5));
    }
  }

  private laneFromX(x: number): number {
    return Math.min(4, Math.max(0, Math.floor(x / LANE_W)));
  }

  /**
   * Stack every node into its lane, ordered by current y. Writes canonical
   * x/y back onto the nodes so the persisted JSON matches what is drawn.
   */
  private relayoutSipoc(skipId?: string): void {
    for (let lane = 0; lane < 5; lane++) {
      const cards = this.model.nodes
        .filter((n) => (n.lane ?? this.laneFromX(n.x)) === lane && n.id !== skipId)
        .sort((a, b) => a.y - b.y);
      let cursor = LANE_STACK_TOP;
      for (const n of cards) {
        const box = nodeBox(n.kind);
        n.lane = lane;
        n.x = lane * LANE_W + LANE_W / 2;
        n.y = cursor + box.ht;
        cursor += box.ht * 2 + LANE_GAP;
      }
    }
  }

  private laneHeight(): number {
    let max = 0;
    for (const n of this.model.nodes) {
      max = Math.max(max, n.y + nodeBox(n.kind).ht);
    }
    return Math.max(LANE_MIN_H, max + 60);
  }

  // ---------- rendering ----------

  private render(): void {
    this.world.setAttribute(
      "transform",
      `translate(${this.view.tx} ${this.view.ty}) scale(${this.view.scale})`
    );
    this.hint.style.display = this.model.nodes.length === 0 ? "block" : "none";

    this.renderLanes();
    this.renderEdges();
    this.renderNodes();
    this.renderTimeline();
    this.updateProps();
  }

  private clear(layer: SVGGElement): void {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  private renderLanes(): void {
    this.clear(this.laneLayer);
    if (this.model.mode === "sipoc") {
      this.renderSipocLanes();
    } else if (this.model.mode === "swimlane") {
      this.renderSwimlanes();
    }
  }

  private renderSipocLanes(): void {
    const h = this.laneHeight();
    for (let i = 0; i < 5; i++) {
      const x = i * LANE_W;
      const body = document.createElementNS(SVG_NS, "rect");
      body.setAttribute("class", "pm-lane" + (i % 2 === 1 ? " pm-lane-alt" : ""));
      body.setAttribute("x", String(x));
      body.setAttribute("y", "0");
      body.setAttribute("width", String(LANE_W));
      body.setAttribute("height", String(h));
      this.laneLayer.appendChild(body);

      const band = document.createElementNS(SVG_NS, "rect");
      band.setAttribute("class", "pm-lane-head-band");
      band.setAttribute("x", String(x));
      band.setAttribute("y", "0");
      band.setAttribute("width", String(LANE_W));
      band.setAttribute("height", String(LANE_HEAD_H));
      // inline theme colours so the band survives SVG/PNG export (Safari rule)
      band.style.fill = this.style.accentColor;
      this.laneLayer.appendChild(band);

      const head = document.createElementNS(SVG_NS, "text");
      head.setAttribute("class", "pm-lane-head");
      head.setAttribute("x", String(x + LANE_W / 2));
      head.setAttribute("y", String(LANE_HEAD_H / 2 + 5));
      head.style.fill = textOn(this.style.accentColor);
      head.textContent = SIPOC_LANES[i];
      this.laneLayer.appendChild(head);
    }
  }

  /** Horizontal swimlane rows with a rename-able header band on the left. */
  private renderSwimlanes(): void {
    const w = this.swimWidth();
    this.model.lanes.forEach((title, i) => {
      const y = i * SWIM_LANE_H;

      const body = document.createElementNS(SVG_NS, "rect");
      body.setAttribute("class", "pm-lane" + (i % 2 === 1 ? " pm-lane-alt" : ""));
      body.setAttribute("x", "0");
      body.setAttribute("y", String(y));
      body.setAttribute("width", String(w));
      body.setAttribute("height", String(SWIM_LANE_H));
      this.laneLayer.appendChild(body);

      const band = document.createElementNS(SVG_NS, "rect");
      band.setAttribute("class", "pm-swim-head");
      band.setAttribute("x", String(-SWIM_HEAD_W));
      band.setAttribute("y", String(y));
      band.setAttribute("width", String(SWIM_HEAD_W));
      band.setAttribute("height", String(SWIM_LANE_H));
      band.style.fill = this.style.accentColor;
      this.laneLayer.appendChild(band);

      const head = document.createElementNS(SVG_NS, "text");
      head.setAttribute("class", "pm-lane-head pm-swim-head");
      const hx = -SWIM_HEAD_W / 2;
      const hy = y + SWIM_LANE_H / 2;
      head.setAttribute("x", String(hx));
      head.setAttribute("y", String(hy));
      head.setAttribute("transform", `rotate(-90 ${hx} ${hy})`);
      head.setAttribute("dominant-baseline", "middle");
      head.style.fill = textOn(this.style.accentColor);
      head.textContent = title;
      this.laneLayer.appendChild(head);

      if (!this.readOnly) {
        const rename = (ev: Event) => {
          ev.stopPropagation();
          this.beginLaneRename(i, hy);
        };
        band.addEventListener("dblclick", rename);
        head.style.pointerEvents = "auto";
        head.addEventListener("dblclick", rename);
      }
    });
  }

  private beginLaneRename(index: number, worldY: number): void {
    this.showLabelInput(90, worldY, this.model.lanes[index], (value) => {
      const v = value.trim();
      if (v !== "") this.model.lanes[index] = v;
    });
  }

  private renderEdges(): void {
    this.clear(this.edgeLayer);
    if (this.model.mode === "sipoc") return; // SIPOC has no connectors
    for (const e of this.model.edges) {
      const a = this.node(e.from);
      const b = this.node(e.to);
      if (!a || !b) continue;
      const geo = this.edgeGeometry(a, b, e.kind);
      const selected = this.selected?.type === "edge" && this.selected.id === e.id;

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute(
        "class",
        `pm-edge pm-kind-${e.kind}` + (selected ? " pm-edge-selected" : "")
      );
      path.setAttribute("d", geo.d);
      path.setAttribute("marker-end", `url(#${selected ? this.arrowId("sel") : this.arrowId()})`);
      this.edgeLayer.appendChild(path);

      if (e.label) {
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute("class", "pm-edge-label");
        t.setAttribute("x", String(geo.mx));
        t.setAttribute("y", String(geo.my - 6));
        t.textContent = e.label;
        this.edgeLayer.appendChild(t);
      }

      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("class", "pm-edge-hit");
      hit.setAttribute("d", geo.d);
      hit.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        this.select({ type: "edge", id: e.id });
      });
      hit.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        if (!this.readOnly) this.beginEdgeLabelEdit(e.id, geo.mx, geo.my);
      });
      this.edgeLayer.appendChild(hit);
    }
  }

  /** Orthogonal elbow between the nearest sides; electronic info gets a zigzag. */
  private edgeGeometry(
    a: PmNode,
    b: PmNode,
    kind: EdgeKind
  ): { d: string; mx: number; my: number } {
    const ab = nodeBox(a.kind);
    const bb = nodeBox(b.kind);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const x1 = horizontal ? a.x + (dx >= 0 ? ab.hw : -ab.hw) : a.x;
    const y1 = horizontal ? a.y : a.y + (dy >= 0 ? ab.ht : -ab.ht);
    const x2 = horizontal ? b.x + (dx >= 0 ? -bb.hw : bb.hw) : b.x;
    const y2 = horizontal ? b.y : b.y + (dy >= 0 ? -bb.ht : bb.ht);

    if (kind === "electronic") {
      // straight run with a lightning jog in the middle
      const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
      const px = -(y2 - y1) / len;
      const py = (x2 - x1) / len;
      const j1x = x1 + (x2 - x1) * 0.45 + px * 12;
      const j1y = y1 + (y2 - y1) * 0.45 + py * 12;
      const j2x = x1 + (x2 - x1) * 0.55 - px * 12;
      const j2y = y1 + (y2 - y1) * 0.55 - py * 12;
      return {
        d: `M ${x1} ${y1} L ${j1x} ${j1y} L ${j2x} ${j2y} L ${x2} ${y2}`,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2,
      };
    }

    if (horizontal) {
      const mx = (x1 + x2) / 2;
      return {
        d: `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`,
        mx,
        my: (y1 + y2) / 2,
      };
    }
    const my = (y1 + y2) / 2;
    return {
      d: `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`,
      mx: (x1 + x2) / 2,
      my,
    };
  }

  private renderNodes(): void {
    this.clear(this.nodeLayer);
    for (const n of this.model.nodes) {
      this.nodeLayer.appendChild(this.renderNode(n));
    }
  }

  private renderNode(n: PmNode): SVGGElement {
    const box = nodeBox(n.kind);
    const selected = this.selected?.type === "node" && this.selected.id === n.id;
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("class", "pm-node" + (selected ? " pm-selected" : ""));
    g.setAttribute("transform", `translate(${n.x} ${n.y})`);
    (g as unknown as { dataset: DOMStringMap }).dataset.id = n.id;

    if (selected) {
      const halo = document.createElementNS(SVG_NS, "rect");
      halo.setAttribute("class", "pm-halo");
      halo.setAttribute("x", String(-box.hw - 6));
      halo.setAttribute("y", String(-box.ht - 6));
      halo.setAttribute("width", String(box.hw * 2 + 12));
      halo.setAttribute("height", String(box.ht * 2 + 12));
      halo.setAttribute("rx", "6");
      g.appendChild(halo);
    }

    g.appendChild(buildSymbol(n));

    if (n.label || box.labelInside) {
      g.appendChild(buildLabel(n.label || "", box.labelY, box.labelChars));
    }

    // secondary lines: inventory wait/qty, then the free detail text
    const extras: string[] = [];
    if (n.kind === "inventory" && n.metrics?.wait) extras.push(n.metrics.wait);
    if (n.detail) extras.push(n.detail);
    extras.forEach((line, i) => {
      const y = box.labelInside ? box.ht + 12 + i * 11 : box.labelY + 13 + i * 11;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("class", "pm-detail");
      t.setAttribute("x", "0");
      t.setAttribute("y", String(y));
      t.setAttribute("text-anchor", "middle");
      t.textContent = line;
      g.appendChild(t);
    });

    // open-action badge on kaizen bursts (top-right of the starburst)
    if (n.kind === "kaizen" && this.getActionBadge) {
      const count = this.getActionBadge(n.id);
      if (count > 0) {
        const bc = document.createElementNS(SVG_NS, "circle");
        bc.setAttribute("cx", String(box.hw - 6));
        bc.setAttribute("cy", String(-box.ht + 2));
        bc.setAttribute("r", "9");
        bc.style.fill = this.style.accentColor;
        bc.style.stroke = "#ffffff";
        bc.style.strokeWidth = "1.4";
        g.appendChild(bc);
        const bt = document.createElementNS(SVG_NS, "text");
        bt.setAttribute("class", "pm-abadge-text");
        bt.setAttribute("x", String(box.hw - 6));
        bt.setAttribute("y", String(-box.ht + 5.5));
        bt.style.fill = textOn(this.style.accentColor);
        bt.textContent = String(count);
        g.appendChild(bt);
      }
    }

    // connector handles (all four sides) — not in SIPOC mode
    if (!this.readOnly && this.model.mode !== "sipoc") {
      for (const [cx, cy] of [
        [box.hw, 0], // right
        [0, box.ht], // bottom
        [-box.hw, 0], // left
        [0, -box.ht], // top
      ]) {
        const handle = document.createElementNS(SVG_NS, "circle");
        handle.setAttribute("class", "pm-handle");
        handle.setAttribute("cx", String(cx));
        handle.setAttribute("cy", String(cy));
        handle.setAttribute("r", "6");
        handle.addEventListener("pointerdown", (e) => this.startConnect(e, n.id));
        g.appendChild(handle);
      }
    }

    if (!this.readOnly) {
      g.addEventListener("pointerdown", (e) => this.startNodeDrag(e, n.id));
    } else {
      g.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.select({ type: "node", id: n.id });
      });
    }
    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (!this.readOnly) this.beginLabelEdit(n.id);
    });
    return g;
  }

  // ---------- VSM timeline ----------

  private renderTimeline(): void {
    this.clear(this.timelineLayer);
    if (this.model.mode !== "vsm" || !this.model.showTimeline) return;
    const items = this.model.nodes
      .filter((n) => n.kind === "vsmProcess" || n.kind === "inventory")
      .sort((a, b) => a.x - b.x);
    if (items.length === 0) return;

    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of this.model.nodes) {
      const b = nodeBox(n.kind);
      maxY = Math.max(maxY, n.y + b.ht);
      minX = Math.min(minX, n.x - b.hw);
      maxX = Math.max(maxX, n.x + b.hw);
    }
    const hi = maxY + 60; // waiting level (upper rail)
    const lo = hi + 30; // processing level (lower rail)

    let d = "";
    let prevLevel: number | null = null;
    let waitSum = 0;
    let procSum = 0;
    let unparsed = 0;

    for (const n of items) {
      const b = nodeBox(n.kind);
      const level = n.kind === "inventory" ? hi : lo;
      const x1 = n.x - b.hw;
      const x2 = n.x + b.hw;
      if (prevLevel === null) {
        d += `M ${x1} ${level}`;
      } else {
        d += ` L ${x1} ${prevLevel} L ${x1} ${level}`;
      }
      d += ` L ${x2} ${level}`;
      prevLevel = level;

      const raw = n.kind === "inventory" ? n.metrics?.wait : n.metrics?.ct;
      const num = parseLeadingNumber(raw);
      if (num === null) {
        if (raw) unparsed++;
      } else if (n.kind === "inventory") {
        waitSum += num;
      } else {
        procSum += num;
      }
      if (raw) {
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute("class", "pm-tl-text");
        t.setAttribute("x", String(n.x));
        t.setAttribute("y", String(level + (n.kind === "inventory" ? -6 : 14)));
        t.textContent = raw;
        this.timelineLayer.appendChild(t);
      }
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "pm-tl-line");
    path.setAttribute("d", d);
    this.timelineLayer.insertBefore(path, this.timelineLayer.firstChild);

    const totals = [
      `Waiting: ${fmtNum(waitSum)}`,
      `Processing: ${fmtNum(procSum)}`,
      `Lead time: ${fmtNum(waitSum + procSum)}`,
    ].join("   ·   ");
    const tt = document.createElementNS(SVG_NS, "text");
    tt.setAttribute("class", "pm-tl-total");
    tt.setAttribute("x", String((minX + maxX) / 2));
    tt.setAttribute("y", String(lo + 34));
    tt.setAttribute("text-anchor", "middle");
    tt.textContent = totals + (unparsed ? `   (${unparsed} value(s) not numeric)` : "");
    this.timelineLayer.appendChild(tt);
  }

  // ---------- selection ----------

  private select(sel: Selection | null): void {
    const same =
      (sel === null && this.selected === null) ||
      (sel !== null &&
        this.selected !== null &&
        sel.type === this.selected.type &&
        sel.id === this.selected.id);
    if (same) {
      this.updateProps();
      return;
    }
    this.selected = sel;
    this.render();
  }

  // ---------- palette drag (spawn new node) ----------

  private startSpawn(e: PointerEvent, kind: NodeKind, defaultLabel: string): void {
    if (this.readOnly) return;
    e.preventDefault();
    const ghost = document.createElement("div");
    ghost.className = "pm-ghost";
    ghost.appendChild(this.miniSymbol(kind));
    document.body.appendChild(ghost);
    this.spawning = { kind, defaultLabel, ghost };
    this.moveGhost(e.clientX, e.clientY);
  }

  private moveGhost(x: number, y: number): void {
    if (!this.spawning) return;
    this.spawning.ghost.style.left = x + "px";
    this.spawning.ghost.style.top = y + "px";
    const r = this.svg.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    this.spawning.ghost.classList.toggle("pm-ghost-ok", over);
  }

  // ---------- node drag ----------

  private startNodeDrag(e: PointerEvent, id: string): void {
    if (this.readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    this.select({ type: "node", id });
    const n = this.node(id);
    if (!n) return;
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.dragNode = { id, offX: w.x - n.x, offY: w.y - n.y, moved: false };
  }

  // ---------- connect ----------

  private startConnect(e: PointerEvent, fromId: string): void {
    if (this.readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const from = this.node(fromId);
    if (!from) return;
    const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
    line.setAttribute("class", "pm-temp-edge");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(from.x));
    line.setAttribute("y2", String(from.y));
    this.overlay.appendChild(line);
    this.connecting = { from: fromId, line };
  }

  private tryAddEdge(from: string, to: string): void {
    if (from === to) return;
    if (this.model.edges.some((e) => e.from === from && e.to === to)) return;
    const edge: PmEdge = { id: newId("e"), from, to, kind: "flow" };
    this.model.edges.push(edge);
    this.selected = { type: "edge", id: edge.id };
    this.render();
    this.commit();
  }

  // ---------- pan / deselect ----------

  private startPanOrDeselect(e: PointerEvent): void {
    if (
      e.target !== this.svg &&
      e.target !== this.world &&
      (e.target as Element).parentNode !== this.laneLayer
    ) {
      return;
    }
    this.select(null);
    this.panning = { sx: e.clientX, sy: e.clientY, tx: this.view.tx, ty: this.view.ty };
  }

  // ---------- window-level move/up dispatch ----------

  private handleWindowMove(e: PointerEvent): void {
    if (this.spawning) {
      this.moveGhost(e.clientX, e.clientY);
      return;
    }
    if (this.dragNode) {
      const n = this.node(this.dragNode.id);
      if (!n) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      n.x = this.snap(w.x - this.dragNode.offX);
      n.y = this.snap(w.y - this.dragNode.offY);
      this.dragNode.moved = true;
      this.render();
      return;
    }
    if (this.connecting) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.connecting.line.setAttribute("x2", String(w.x));
      this.connecting.line.setAttribute("y2", String(w.y));
      return;
    }
    if (this.panning) {
      this.view.tx = this.panning.tx + (e.clientX - this.panning.sx);
      this.view.ty = this.panning.ty + (e.clientY - this.panning.sy);
      this.world.setAttribute(
        "transform",
        `translate(${this.view.tx} ${this.view.ty}) scale(${this.view.scale})`
      );
      return;
    }
  }

  private handleWindowUp(e: PointerEvent): void {
    if (this.spawning) {
      const r = this.svg.getBoundingClientRect();
      const over =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const { kind, defaultLabel } = this.spawning;
      if (this.spawning.ghost.parentElement) document.body.removeChild(this.spawning.ghost);
      this.spawning = null;
      if (over) {
        const w = this.screenToWorld(e.clientX, e.clientY);
        const node: PmNode = {
          id: newId(),
          kind,
          label: defaultLabel,
          x: this.snap(w.x),
          y: this.snap(w.y),
        };
        if (this.model.mode === "sipoc") node.lane = this.laneFromX(w.x);
        if (this.model.mode === "swimlane") node.lane = this.swimLaneFromY(node.y);
        this.model.nodes.push(node);
        if (this.model.mode === "sipoc") this.relayoutSipoc();
        this.selected = { type: "node", id: node.id };
        this.render();
        this.commit();
      }
      return;
    }

    if (this.dragNode) {
      const { id, moved } = this.dragNode;
      this.dragNode = null;
      if (moved) {
        if (this.model.mode === "sipoc") {
          const n = this.node(id);
          if (n) n.lane = this.laneFromX(n.x);
          this.relayoutSipoc();
          this.render();
        } else if (this.model.mode === "swimlane") {
          const n = this.node(id);
          if (n) {
            n.lane = this.swimLaneFromY(n.y);
            this.render();
          }
        }
        this.commit();
      }
      return;
    }

    if (this.connecting) {
      const target = this.nodeIdAtPoint(e.clientX, e.clientY);
      const fromId = this.connecting.from;
      if (this.connecting.line.parentElement) this.overlay.removeChild(this.connecting.line);
      this.connecting = null;
      if (target && target !== fromId) this.tryAddEdge(fromId, target);
      return;
    }

    if (this.panning) {
      this.panning = null;
      return;
    }
  }

  private nodeIdAtPoint(clientX: number, clientY: number): string | null {
    const elems = document.elementsFromPoint(clientX, clientY);
    for (const el of elems) {
      let cur: Element | null = el;
      while (cur) {
        if (cur instanceof SVGGElement) {
          const id = (cur as unknown as { dataset?: DOMStringMap }).dataset?.id;
          if (id) return id;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  // ---------- delete ----------

  private deleteSelection(): void {
    if (!this.selected) return;
    if (this.selected.type === "node") {
      const id = this.selected.id;
      this.model.nodes = this.model.nodes.filter((n) => n.id !== id);
      this.model.edges = this.model.edges.filter((e) => e.from !== id && e.to !== id);
      if (this.model.mode === "sipoc") this.relayoutSipoc();
    } else {
      const id = this.selected.id;
      this.model.edges = this.model.edges.filter((e) => e.id !== id);
    }
    this.selected = null;
    this.render();
    this.commit();
  }

  // ---------- inline label editing ----------

  private beginLabelEdit(id: string): void {
    const n = this.node(id);
    if (!n) return;
    const box = nodeBox(n.kind);
    const y = n.y + (box.labelInside ? 0 : box.labelY - 6);
    this.showLabelInput(n.x, y, n.label, (value) => {
      n.label = value;
    });
  }

  private beginEdgeLabelEdit(id: string, mx: number, my: number): void {
    const e = this.edge(id);
    if (!e) return;
    this.showLabelInput(mx, my, e.label ?? "", (value) => {
      if (value.trim() === "") delete e.label;
      else e.label = value;
    });
  }

  private showLabelInput(
    worldX: number,
    worldY: number,
    value: string,
    apply: (value: string) => void
  ): void {
    this.endLabelEdit();
    const r = this.svg.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    const screenX = r.left + this.view.tx + worldX * this.view.scale;
    const screenY = r.top + this.view.ty + worldY * this.view.scale;

    const input = document.createElement("input");
    input.className = "pm-label-input";
    input.value = value;
    input.style.left = screenX - stageRect.left - 75 + "px";
    input.style.top = screenY - stageRect.top - 12 + "px";
    this.stage.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      apply(input.value);
      this.endLabelEdit();
      this.render();
      this.commit();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.endLabelEdit();
      }
    });
    input.addEventListener("blur", commit);
    this.labelInput = input;
  }

  private endLabelEdit(): void {
    if (this.labelInput && this.labelInput.parentElement) {
      this.labelInput.parentElement.removeChild(this.labelInput);
    }
    this.labelInput = null;
  }

  // ---------- zoom / view ----------

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(e.clientX, e.clientY, factor);
  }

  private zoomBy(factor: number): void {
    const r = this.svg.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const r = this.svg.getBoundingClientRect();
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.view.scale * factor));
    const f = newScale / this.view.scale;
    const px = clientX - r.left;
    const py = clientY - r.top;
    this.view.tx = px - f * (px - this.view.tx);
    this.view.ty = py - f * (py - this.view.ty);
    this.view.scale = newScale;
    this.render();
  }

  /** Bounds of everything drawn (nodes, SIPOC lanes, timeline). */
  private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of this.model.nodes) {
      const b = nodeBox(n.kind);
      minX = Math.min(minX, n.x - b.hw);
      maxX = Math.max(maxX, n.x + b.hw);
      minY = Math.min(minY, n.y - b.ht);
      maxY = Math.max(maxY, n.y + b.ht + 24); // room for detail lines
    }
    if (this.model.mode === "sipoc") {
      minX = Math.min(Number.isFinite(minX) ? minX : 0, 0);
      minY = Math.min(Number.isFinite(minY) ? minY : 0, 0);
      maxX = Math.max(maxX, LANE_W * 5);
      maxY = Math.max(maxY, this.laneHeight());
    }
    if (this.model.mode === "swimlane") {
      minX = Math.min(Number.isFinite(minX) ? minX : 0, -SWIM_HEAD_W);
      minY = Math.min(Number.isFinite(minY) ? minY : 0, 0);
      maxX = Math.max(Number.isFinite(maxX) ? maxX : 0, this.swimWidth());
      maxY = Math.max(
        Number.isFinite(maxY) ? maxY : 0,
        this.model.lanes.length * SWIM_LANE_H
      );
    }
    if (this.model.mode === "vsm" && this.model.showTimeline && this.model.nodes.length > 0) {
      maxY += 110;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }

  private fitView(): void {
    const b = this.contentBounds();
    if (!b) {
      this.view = { tx: 60, ty: 40, scale: 1 };
      this.render();
      return;
    }
    const r = this.svg.getBoundingClientRect();
    const pad = 40;
    const sx = (r.width - pad * 2) / Math.max(1, b.maxX - b.minX);
    const sy = (r.height - pad * 2) / Math.max(1, b.maxY - b.minY);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
    this.view.scale = scale;
    this.view.tx = pad - b.minX * scale + (r.width - pad * 2 - (b.maxX - b.minX) * scale) / 2;
    this.view.ty = pad - b.minY * scale;
    this.render();
  }

  // ---------- keyboard ----------

  private handleKey(e: KeyboardEvent): void {
    if (this.labelInput) return;
    if (this.readOnly) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
      e.preventDefault();
      this.deleteSelection();
    }
  }

  // ---------- properties panel ----------

  private buildPropsPanel(): void {
    this.props = document.createElement("div");
    this.props.className = "pm-props";

    const head = document.createElement("div");
    head.className = "pm-props-head";
    head.appendChild(document.createTextNode("Properties"));
    this.propKind = document.createElement("span");
    this.propKind.className = "pm-props-kind";
    head.appendChild(this.propKind);
    this.props.appendChild(head);

    // label
    const labelRow = this.makeRow("Label");
    this.propLabel = document.createElement("input");
    this.propLabel.className = "pm-props-input";
    this.propLabel.type = "text";
    this.propLabel.addEventListener("input", () => {
      const n = this.selectedNode();
      const e = this.selectedEdge();
      if (n) n.label = this.propLabel.value;
      else if (e) {
        if (this.propLabel.value.trim() === "") delete e.label;
        else e.label = this.propLabel.value;
      } else return;
      this.softRender();
      this.commit();
    });
    labelRow.appendChild(this.propLabel);
    this.props.appendChild(labelRow);

    // detail
    this.propDetailRow = this.makeRow("Detail");
    this.propDetail = document.createElement("input");
    this.propDetail.className = "pm-props-input";
    this.propDetail.type = "text";
    this.propDetail.placeholder = "owner, system, note…";
    this.propDetail.addEventListener("input", () => {
      const n = this.selectedNode();
      if (!n) return;
      if (this.propDetail.value.trim() === "") delete n.detail;
      else n.detail = this.propDetail.value;
      this.softRender();
      this.commit();
    });
    this.propDetailRow.appendChild(this.propDetail);
    this.props.appendChild(this.propDetailRow);

    // connector type
    this.propTypeRow = this.makeRow("Type");
    this.propType = document.createElement("select");
    this.propType.className = "pm-props-select";
    for (const k of EDGE_KINDS) {
      const opt = document.createElement("option");
      opt.value = k.kind;
      opt.textContent = k.title;
      this.propType.appendChild(opt);
    }
    this.propType.addEventListener("change", () => {
      const e = this.selectedEdge();
      if (!e) return;
      e.kind = this.propType.value as EdgeKind;
      this.softRender();
      this.commit();
    });
    this.propTypeRow.appendChild(this.propType);
    this.props.appendChild(this.propTypeRow);

    // colour coding
    this.propColorRow = document.createElement("div");
    const colorCap = document.createElement("div");
    colorCap.className = "pm-props-row";
    const cl = document.createElement("label");
    cl.textContent = "Colour";
    colorCap.appendChild(cl);
    this.propCustomColor = document.createElement("input");
    this.propCustomColor.type = "color";
    this.propCustomColor.className = "pm-props-input";
    this.propCustomColor.style.padding = "0";
    this.propCustomColor.style.height = "22px";
    this.propCustomColor.title = "Custom colour";
    this.propCustomColor.addEventListener("input", () => {
      const n = this.selectedNode();
      if (!n) return;
      n.color = this.propCustomColor.value;
      this.softRender();
      this.updateSwatches(n);
      this.commit();
    });
    colorCap.appendChild(this.propCustomColor);
    this.propColorRow.appendChild(colorCap);

    this.propSwatches = document.createElement("div");
    this.propSwatches.className = "pm-swatches";
    for (const preset of COLOR_PRESETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pm-swatch";
      b.title = preset.name;
      if (preset.value) b.style.background = preset.value;
      else b.textContent = "×";
      (b as HTMLButtonElement & { dataset: DOMStringMap }).dataset.color = preset.value;
      b.addEventListener("click", () => {
        const n = this.selectedNode();
        if (!n) return;
        if (preset.value) n.color = preset.value;
        else delete n.color;
        this.softRender();
        this.updateSwatches(n);
        this.commit();
      });
      this.propSwatches.appendChild(b);
    }
    this.propColorRow.appendChild(this.propSwatches);
    this.props.appendChild(this.propColorRow);

    // VSM metrics
    const metricDefs: { key: keyof PmMetrics; cap: string; ph: string }[] = [
      { key: "ct", cap: "C/T", ph: "e.g. 45 s" },
      { key: "co", cap: "C/O", ph: "e.g. 10 min" },
      { key: "uptime", cap: "Uptime", ph: "e.g. 95%" },
      { key: "operators", cap: "Ops", ph: "e.g. 2" },
      { key: "wait", cap: "Wait/Qty", ph: "e.g. 2 days" },
    ];
    for (const def of metricDefs) {
      const row = this.makeRow(def.cap);
      const input = document.createElement("input");
      input.className = "pm-props-input";
      input.type = "text";
      input.placeholder = def.ph;
      input.addEventListener("input", () => {
        const n = this.selectedNode();
        if (!n) return;
        if (!n.metrics) n.metrics = {};
        if (input.value.trim() === "") delete n.metrics[def.key];
        else n.metrics[def.key] = input.value;
        this.softRender();
        this.commit();
      });
      row.appendChild(input);
      this.props.appendChild(row);
      this.metricRows.push({ key: def.key, row, input });
    }

    // actions (kaizen bursts — the wrapper opens the shared action UI)
    this.propActionsBtn = document.createElement("button");
    this.propActionsBtn.type = "button";
    this.propActionsBtn.className = "pm-props-actions";
    this.propActionsBtn.textContent = "＋ Add action";
    this.propActionsBtn.addEventListener("click", () => {
      const n = this.selectedNode();
      if (n && this.onManageActions) this.onManageActions(n.id);
    });
    this.props.appendChild(this.propActionsBtn);

    // delete
    const del = document.createElement("button");
    del.type = "button";
    del.className = "pm-props-del";
    del.textContent = "Delete";
    del.addEventListener("click", () => this.deleteSelection());
    this.props.appendChild(del);

    this.stage.appendChild(this.props);
    this.updateProps();
  }

  private makeRow(caption: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "pm-props-row";
    const cap = document.createElement("label");
    cap.textContent = caption;
    row.appendChild(cap);
    return row;
  }

  /** Re-render the drawing without rebuilding the props panel (keeps focus). */
  private softRender(): void {
    this.renderLanes();
    this.renderEdges();
    this.renderNodes();
    this.renderTimeline();
  }

  private updateSwatches(n: PmNode): void {
    const current = n.color ?? "";
    this.propSwatches.querySelectorAll(".pm-swatch").forEach((el) => {
      const sw = el as HTMLButtonElement & { dataset: DOMStringMap };
      sw.classList.toggle("pm-swatch-on", (sw.dataset.color ?? "") === current);
    });
    if (/^#[0-9a-fA-F]{6}$/.test(current)) this.propCustomColor.value = current;
    else this.propCustomColor.value = "#ffffff";
  }

  private updateProps(): void {
    const n = this.selectedNode();
    const e = this.selectedEdge();
    if ((!n && !e) || this.readOnly) {
      this.props.style.display = "none";
      return;
    }
    this.props.style.display = "block";

    if (n) {
      this.propKind.textContent = kindTitle(n.kind);
      if (document.activeElement !== this.propLabel) this.propLabel.value = n.label;
      this.propDetailRow.style.display = "flex";
      if (document.activeElement !== this.propDetail) this.propDetail.value = n.detail ?? "";
      this.propTypeRow.style.display = "none";
      this.propColorRow.style.display = "block";
      this.updateSwatches(n);
      for (const m of this.metricRows) {
        const show =
          (n.kind === "vsmProcess" && m.key !== "wait") ||
          (n.kind === "inventory" && m.key === "wait");
        m.row.style.display = show ? "flex" : "none";
        if (show && document.activeElement !== m.input) {
          m.input.value = (n.metrics && n.metrics[m.key]) ?? "";
        }
      }
      if (n.kind === "kaizen" && this.onManageActions) {
        const count = this.getActionBadge ? this.getActionBadge(n.id) : 0;
        this.propActionsBtn.textContent =
          count > 0 ? `Actions (${count})` : "＋ Add action";
        this.propActionsBtn.style.display = "block";
      } else {
        this.propActionsBtn.style.display = "none";
      }
    } else if (e) {
      this.propKind.textContent = "Connector";
      if (document.activeElement !== this.propLabel) this.propLabel.value = e.label ?? "";
      this.propDetailRow.style.display = "none";
      this.propTypeRow.style.display = "flex";
      if (document.activeElement !== this.propType) this.propType.value = e.kind;
      this.propColorRow.style.display = "none";
      for (const m of this.metricRows) m.row.style.display = "none";
      this.propActionsBtn.style.display = "none";
    }
  }

  // ---------- export ----------

  private buildExportSvg(): { svg: string; width: number; height: number } {
    const b = this.contentBounds() ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const pad = 30;
    const width = Math.ceil(b.maxX - b.minX + pad * 2);
    const height = Math.ceil(b.maxY - b.minY + pad * 2);

    // clone the rendered geometry, strip interaction-only bits
    const clone = this.world.cloneNode(true) as SVGGElement;
    clone.removeAttribute("transform");
    clone
      .querySelectorAll(".pm-handle, .pm-halo, .pm-temp-edge, .pm-edge-hit")
      .forEach((el) => el.remove());
    const serializer = new XMLSerializer();
    const inner = serializer.serializeToString(clone);
    const defs = serializer.serializeToString(this.defs);

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="${b.minX - pad} ${b.minY - pad} ${width} ${height}" ` +
      `font-family="${escapeAttr(this.style.fontFamily)}">` +
      `<style>${exportStyle(this.style)}</style>` +
      defs +
      `<rect x="${b.minX - pad}" y="${b.minY - pad}" width="${width}" height="${height}" ` +
      `fill="${escapeAttr(this.style.backgroundColor)}"/>` +
      inner +
      `</svg>`;
    return { svg, width, height };
  }

  exportSvg(): void {
    const { svg } = this.buildExportSvg();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    this.download(URL.createObjectURL(blob), "process-map.svg", true);
  }

  exportPng(): void {
    this.renderPngDataUri(2, (dataUri) => {
      if (dataUri) this.download(dataUri, "process-map.png", false);
    });
  }

  private renderPngDataUri(scale: number, cb: (dataUri: string | null) => void): void {
    const { svg, width, height } = this.buildExportSvg();
    const img = new Image();
    const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cb(null);
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      try {
        cb(canvas.toDataURL("image/png"));
      } catch {
        cb(null);
      }
    };
    img.onerror = () => cb(null);
    img.src = url;
  }

  private download(href: string, filename: string, revoke: boolean): void {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revoke) setTimeout(() => URL.revokeObjectURL(href), 4000);
  }

  // ---------- persistence ----------

  private commit(): void {
    this.onChange(this.model);
    this.schedulePng();
  }

  private schedulePng(): void {
    if (!this.onPngReady) return;
    if (this.pngTimer) clearTimeout(this.pngTimer);
    this.pngTimer = setTimeout(() => {
      this.pngTimer = null;
      if (this.model.nodes.length === 0) return;
      this.renderPngDataUri(2, (dataUri) => {
        if (dataUri && this.onPngReady) this.onPngReady(dataUri);
      });
    }, 400);
  }
}

function kindTitle(kind: NodeKind): string {
  for (const mode of ["simple", "sipoc", "vsm"] as MapMode[]) {
    const item = paletteFor(mode).find((p) => p.kind === kind);
    if (item) return item.title;
  }
  return kind;
}

function parseLeadingNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /-?\d+(\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Inline stylesheet for exported SVG/PNG — literal theme hexes (CSS vars
 * don't travel with the exported markup). Lane bands and badges already
 * carry inline fills, so only class-driven colours need covering here.
 */
function exportStyle(s: StyleConfig): string {
  const fg = s.foregroundColor;
  const bg = s.backgroundColor;
  return `
.pm-shape{fill:${bg};stroke:${fg};stroke-width:1.6}
.pm-label{fill:${fg};font-size:11px}
.pm-detail{fill:#8a8a8a;font-size:9px}
.kind-start .pm-shape{fill:#dff6dd;stroke:#2e7d32}
.kind-end .pm-shape{fill:#fde7e9;stroke:#b03a44}
.kind-decision .pm-shape{fill:#fffbe6}
.kind-card .pm-shape{fill:#f7f9fc}
.kind-kaizen .pm-shape{fill:#fff2b8;stroke:#b8860b}
.pm-abadge-text{font-size:10px;font-weight:700;text-anchor:middle}
.pm-databox{fill:${bg};stroke:${fg};stroke-width:1.2}
.pm-databox-line{stroke:#d5d5d5;stroke-width:1}
.pm-metric{fill:${fg};font-size:9px}
.pm-inv-i{fill:${fg};font-size:15px;font-weight:700}
.pm-wheel{fill:${bg};stroke:${fg};stroke-width:1.6}
.pm-lane{fill:rgba(0,0,0,0.015);stroke:#dedede;stroke-width:1}
.pm-lane.pm-lane-alt{fill:rgba(0,0,0,0.045)}
.pm-lane-head{font-size:13px;font-weight:600;text-anchor:middle}
.pm-edge{fill:none;stroke:${fg};stroke-width:1.8}
.pm-edge.pm-kind-info{stroke-dasharray:6 4}
.pm-edge-selected{stroke:${fg};stroke-width:1.8}
.pm-edge-label{fill:${fg};font-size:10px;text-anchor:middle;paint-order:stroke;stroke:${bg};stroke-width:4}
.pm-tl-line{fill:none;stroke:#8a6d00;stroke-width:1.8}
.pm-tl-text{fill:#6b5500;font-size:10px;text-anchor:middle}
.pm-tl-total{fill:${fg};font-size:11px;font-weight:600}
`;
}
