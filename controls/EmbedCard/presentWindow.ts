// "Present in window": the embed opens in its OWN top-level window instead
// of a frame. A top-level browsing context sits outside the player → code
// app → card frame chain, so nothing that depends on frame-chain
// permission delegation (Chromium Local Network Access × Windows
// work-account SSO, 2026-08-18) can block it — the report signs in exactly
// as it would in a tab. One window per card key, reused and focused rather
// than re-opened; module-level so it survives screen changes.

const windows = new Map<string, Window>();

function alive(key: string): Window | null {
  const w = windows.get(key);
  if (!w) return null;
  try {
    if (w.closed) {
      windows.delete(key);
      return null;
    }
  } catch {
    windows.delete(key);
    return null;
  }
  return w;
}

export function isPresenting(key: string): boolean {
  return alive(key) !== null;
}

/**
 * Open (or bring to front) the presentation window. MUST be called from a
 * user gesture — popup blockers refuse otherwise. Sized to most of the
 * screen, centred: a meeting-room display shows the report large; a
 * laptop keeps the board visible behind. Returns false when the browser
 * refused to open one.
 */
export function present(key: string, url: string): boolean {
  const existing = alive(key);
  if (existing) {
    // a different url on the same card navigates the same window
    try {
      if (existing.location.href !== url) existing.location.href = url;
    } catch {
      /* cross-origin once loaded — the report is already showing */
    }
    existing.focus();
    return true;
  }
  const sw = window.screen?.availWidth ?? 1280;
  const sh = window.screen?.availHeight ?? 800;
  const w = Math.max(800, Math.round(sw * 0.86));
  const h = Math.max(560, Math.round(sh * 0.86));
  const left = Math.max(0, Math.round((sw - w) / 2));
  const top = Math.max(0, Math.round((sh - h) / 2));
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener=no`;
  const opened = window.open(url, `ltk-present-${key}`, features);
  if (!opened) return false;
  windows.set(key, opened);
  return true;
}

export function closePresentation(key: string): void {
  const w = alive(key);
  if (!w) return;
  try {
    w.close();
  } catch {
    /* already gone */
  }
  windows.delete(key);
}
