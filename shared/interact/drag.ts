// Unified pointer interaction: one code path for mouse, touch and pen via
// Pointer Events. Drag starts only after a small movement threshold so taps
// stay taps; long-press is exposed for touch context menus.

export interface DragCallbacks {
  /** Fired once the movement threshold is crossed. */
  onStart?: (e: PointerEvent) => void;
  onMove?: (e: PointerEvent, dx: number, dy: number) => void;
  /** Fired on release after a drag started. */
  onEnd?: (e: PointerEvent, dx: number, dy: number) => void;
  /** Fired on release when the threshold was never crossed (a tap/click). */
  onTap?: (e: PointerEvent) => void;
  /** Fired when the pointer stays down without moving for `longPressMs`. */
  onLongPress?: (e: PointerEvent) => void;
  threshold?: number; // px, default 6
  longPressMs?: number; // default 500
}

export function makeInteractive(el: HTMLElement | SVGElement, cb: DragCallbacks): void {
  const threshold = cb.threshold ?? 6;
  const longPressMs = cb.longPressMs ?? 500;
  // the union of element types defeats the typed addEventListener overloads
  const target = el as HTMLElement;

  target.addEventListener("pointerdown", (down: PointerEvent) => {
    if (down.button !== 0 && down.pointerType === "mouse") return;
    // Ignore presses that start on an embedded control (a button, link, form
    // field, or an element opting out via [data-ltk-stop]) inside the target:
    // those handle their own clicks, so the tap/drag must not also fire.
    const origin = down.target as Element | null;
    const inner =
      origin && origin.closest
        ? origin.closest("button, a, input, select, textarea, [data-ltk-stop]")
        : null;
    if (inner && inner !== target && target.contains(inner)) return;
    let dragging = false;
    let longPressed = false;
    const startX = down.clientX;
    const startY = down.clientY;

    const timer = cb.onLongPress
      ? setTimeout(() => {
          if (!dragging) {
            longPressed = true;
            cb.onLongPress!(down);
          }
        }, longPressMs)
      : null;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) >= threshold) {
        dragging = true;
        if (timer) clearTimeout(timer);
        try {
          target.setPointerCapture(down.pointerId);
        } catch {
          /* capture unavailable — drag still works via document listeners */
        }
        if (cb.onStart) cb.onStart(e);
      }
      if (dragging && cb.onMove) cb.onMove(e, dx, dy);
    };

    const onUp = (e: PointerEvent) => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (dragging) {
        if (cb.onEnd) cb.onEnd(e, e.clientX - startX, e.clientY - startY);
      } else if (!longPressed && cb.onTap && e.type === "pointerup") {
        cb.onTap(e);
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
}
