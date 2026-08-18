// Persistent embed frames — one long-lived <iframe> per embed card, kept
// alive across screens so opening an embed from the board is instant.
//
// Why it works this way: an iframe reloads whenever it is re-parented, and
// the router does clear(outlet) on every navigation, so ANY frame living
// inside a screen dies with it. Spiked and measured before building:
// re-parenting a frame took its load count 1 → 2, while a host that is only
// repositioned, hidden and scaled stayed at 1.
//
// So each frame lives in a position:fixed host attached to <body>, outside
// the routed DOM. Screens never take the frame; they only say where it
// should appear. The board parks it over a tile (scaled to match), the card
// editor parks it over its frame area at full size, and the same document
// stays loaded throughout.

interface Entry {
  host: HTMLDivElement;
  frame: HTMLIFrameElement;
  url: string;
  /** What it is currently parked over; null = parked nowhere, so hidden. */
  target: HTMLElement | null;
}

const frames = new Map<string, Entry>();
let syncing = false;

/** A frame belongs to a card, not a screen — both screens use this key. */
export function frameKey(boardId: string, cardId: string): string {
  return `${boardId}|${cardId}`;
}

function createEntry(key: string, url: string): Entry {
  const host = document.createElement("div");
  host.className = "app-embed-frame-host";
  host.dataset.frameKey = key;
  const frame = document.createElement("iframe");
  // storage-access: Power BI's secure-embed "Sign in" is a
  // requestStorageAccess() call — under storage partitioning the frame
  // needs the permission delegated down the chain, or the sign-in loops
  // ("Sign in to view this report" after a successful popup, Ben,
  // 2026-08-17). Delegating here can't hurt and removes us as the link
  // that fails to pass it on; a sandbox on the PLAYER's frame is beyond us.
  frame.setAttribute("allow", "fullscreen; storage-access");
  frame.setAttribute("allowfullscreen", "true");
  frame.title = "Embedded content";
  host.appendChild(frame);
  document.body.appendChild(host);
  const entry: Entry = { host, frame, url: "", target: null };
  setUrl(entry, url);
  frames.set(key, entry);
  return entry;
}

function setUrl(entry: Entry, url: string): void {
  if (entry.url === url) return; // navigating to the same url would reload it
  entry.url = url;
  entry.frame.src = url;
}

/**
 * The persistent frame for a card, created and loaded on first use.
 * Calling it again with the same url does NOT reload — that is the point.
 */
export function acquireFrame(key: string, url: string): void {
  const existing = frames.get(key);
  if (existing) {
    setUrl(existing, url);
    return;
  }
  if (url.trim() !== "") createEntry(key, url);
}

/**
 * Park the frame over `target`, or hide it when target is null.
 * `inert` makes it non-interactive — a board tile is display-only, and a
 * click there must open the card rather than land inside the embed.
 */
export function placeFrame(
  key: string,
  target: HTMLElement | null,
  inert = false
): void {
  const entry = frames.get(key);
  if (!entry) return;
  entry.target = target;
  if (inert) entry.host.dataset.tile = "1";
  else delete entry.host.dataset.tile;
  if (!target) {
    entry.host.style.visibility = "hidden";
    return;
  }
  syncOne(entry);
  startSync();
}

function syncOne(entry: Entry): void {
  const target = entry.target;
  if (!target || !target.isConnected) {
    entry.host.style.visibility = "hidden";
    return;
  }
  const r = target.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) {
    entry.host.style.visibility = "hidden";
    return;
  }
  entry.host.style.visibility = "visible";
  // A board tile is a 640×420 card shrunk by a transform, so the slot's
  // LAYOUT size and its on-screen size differ. Sizing the frame to the
  // layout box and scaling by the difference makes the embed shrink exactly
  // like the card around it, instead of reflowing into a phone-width layout.
  // In the card editor the two are equal, so this collapses to scale(1).
  const layoutW = target.offsetWidth || r.width;
  const layoutH = target.offsetHeight || r.height;
  const k = layoutW > 0 ? r.width / layoutW : 1;
  entry.host.style.width = `${layoutW}px`;
  entry.host.style.height = `${layoutH}px`;
  entry.host.style.transformOrigin = "top left";
  entry.host.style.transform = `translate(${r.left}px, ${r.top}px) scale(${k})`;
}

/**
 * Keep parked frames aligned. A fixed host does not move with scrolling or
 * relayout on its own, and there is no event that covers every cause, so
 * this rides the frame loop while anything is parked and stops when nothing
 * is. It costs a getBoundingClientRect per parked frame per tick.
 */
function startSync(): void {
  if (syncing) return;
  syncing = true;
  const tick = (): void => {
    let parked = 0;
    for (const entry of frames.values()) {
      if (!entry.target) continue;
      parked++;
      syncOne(entry);
    }
    if (parked === 0) {
      syncing = false;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Hide every frame — screens call this as they tear down. */
export function parkAllFrames(): void {
  for (const key of frames.keys()) placeFrame(key, null);
}

/**
 * Destroy frames whose card is no longer in play, freeing the loaded
 * document. Called when navigating away from a board: keeping a Power BI
 * report alive forever would be a memory and licensing surprise.
 */
export function releaseFramesExcept(keep: Set<string>): void {
  for (const [key, entry] of [...frames.entries()]) {
    if (keep.has(key)) continue;
    entry.host.remove();
    frames.delete(key);
  }
}

/** Test/diagnostic hook: how many frames are currently alive. */
export function liveFrameCount(): number {
  return frames.size;
}
