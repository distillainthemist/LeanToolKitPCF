// A small pan / zoom controller for the DOM-tree editors (FaultTree, FiveWhys)
// whose diagrams grow beyond the card as they fill out. It mirrors the
// ProcessMap SVG viewport, but for HTML: a "world" element is translated and
// scaled inside a clipping "viewport", with a floating zoom / fit cluster.
//
// The tree editors fully re-render (rebuilding the viewport + world) on every
// edit, so the view (tx, ty, scale) is kept here and re-applied via mount()
// after each render — the same persistence pattern ProcessMap uses. A pending
// fit (requestFit) is satisfied as soon as the viewport has real dimensions,
// retried through a ResizeObserver for the first-paint / container-resize case.

const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const FIT_PAD = 28;

interface View {
  tx: number;
  ty: number;
  scale: number;
}

export interface PanZoomOptions {
  min?: number;
  max?: number;
  /** Called after the view changes (pan/zoom/fit) — e.g. to reschedule a snapshot. */
  onView?: () => void;
}

export class PanZoom {
  private readonly min: number;
  private readonly max: number;
  private readonly onView?: () => void;

  private view: View = { tx: FIT_PAD, ty: FIT_PAD, scale: 1 };
  private viewport: HTMLElement | null = null;
  private world: HTMLElement | null = null;
  private needsFit = false;
  private ro: ResizeObserver | null = null;
  private pan: { sx: number; sy: number; tx: number; ty: number } | null = null;

  constructor(opts: PanZoomOptions = {}) {
    this.min = opts.min ?? MIN_SCALE;
    this.max = opts.max ?? MAX_SCALE;
    this.onView = opts.onView;
  }

  /**
   * Bind to freshly-rendered elements. `viewport` clips and receives the pan /
   * wheel gestures; `world` holds the diagram and carries the transform. Safe
   * to call on every render — the old elements are discarded by the caller.
   */
  mount(viewport: HTMLElement, world: HTMLElement): void {
    this.viewport = viewport;
    this.world = world;

    viewport.style.position = "relative";
    viewport.style.overflow = "hidden";
    viewport.style.touchAction = "none";
    viewport.style.padding = "0";

    world.style.position = "absolute";
    world.style.top = "0";
    world.style.left = "0";
    world.style.width = "max-content";
    world.style.transformOrigin = "0 0";

    this.apply();

    viewport.addEventListener("pointerdown", this.onDown);
    viewport.addEventListener("wheel", this.onWheel, { passive: false });

    if (this.ro) this.ro.disconnect();
    this.ro = new ResizeObserver(() => {
      if (this.needsFit) this.tryFit();
    });
    this.ro.observe(viewport);

    if (this.needsFit) this.tryFit();
  }

  /** Auto-fit on the next layout (call when a document is (re)loaded). */
  requestFit(): void {
    this.needsFit = true;
    this.tryFit();
  }

  /** The floating zoom / fit cluster — append to the viewport each render. */
  cluster(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ltk-pz-zoom";
    wrap.appendChild(this.btn("＋", "Zoom in", () => this.zoomBy(1.2)));
    wrap.appendChild(this.btn("−", "Zoom out", () => this.zoomBy(1 / 1.2)));
    wrap.appendChild(this.btn("⤢", "Fit to view", () => this.fit()));
    return wrap;
  }

  destroy(): void {
    if (this.ro) this.ro.disconnect();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }

  // ---- internals ----

  private btn(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "ltk-pz-btn";
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    // don't let a press on the cluster start a background pan
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    return b;
  }

  private apply(): void {
    if (this.world) {
      this.world.style.transform =
        `translate(${this.view.tx}px, ${this.view.ty}px) scale(${this.view.scale})`;
    }
  }

  private clamp(s: number): number {
    return Math.max(this.min, Math.min(this.max, s));
  }

  private tryFit(): void {
    const vp = this.viewport;
    const world = this.world;
    if (!vp || !world) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (vw < 40 || vh < 40) return; // not laid out yet — the ResizeObserver retries

    // measure the natural (unscaled) content size
    const prev = world.style.transform;
    world.style.transform = "none";
    const cw = world.offsetWidth;
    const ch = world.offsetHeight;
    world.style.transform = prev;
    if (cw < 1 || ch < 1) return;

    this.needsFit = false;
    // fit shrinks a big tree to the card; it never enlarges a small one past 1:1
    const scale = Math.max(this.min, Math.min(1, (vw - FIT_PAD * 2) / cw, (vh - FIT_PAD * 2) / ch));
    this.view.scale = scale;
    this.view.tx = Math.max(FIT_PAD, (vw - cw * scale) / 2);
    this.view.ty = FIT_PAD;
    this.apply();
    this.onView?.();
  }

  private fit(): void {
    this.needsFit = true;
    this.tryFit();
  }

  private zoomBy(factor: number): void {
    const vp = this.viewport;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const vp = this.viewport;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const next = this.clamp(this.view.scale * factor);
    const k = next / this.view.scale;
    const px = clientX - r.left;
    const py = clientY - r.top;
    this.view.tx = px - k * (px - this.view.tx);
    this.view.ty = py - k * (py - this.view.ty);
    this.view.scale = next;
    this.apply();
    this.onView?.();
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  private readonly onDown = (e: PointerEvent): void => {
    // pan only when grabbing the background — a card / button press must pass
    // through so tap-to-edit and drag-to-reparent still work
    if (e.target !== this.viewport && e.target !== this.world) return;
    this.pan = { sx: e.clientX, sy: e.clientY, tx: this.view.tx, ty: this.view.ty };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pan) return;
    this.view.tx = this.pan.tx + (e.clientX - this.pan.sx);
    this.view.ty = this.pan.ty + (e.clientY - this.pan.sy);
    this.apply();
  };

  private readonly onUp = (): void => {
    if (!this.pan) return;
    this.pan = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.onView?.();
  };
}
