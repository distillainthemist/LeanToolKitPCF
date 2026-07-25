// The site state palette (card-settings plan, phase 3): named colours a
// site defines once, which cards SELECT rather than storing freeform hex.
// Stored per site as ben_statepalette JSON; "" = the toolkit defaults.
//
// Resolution accepts three shapes so nothing legacy breaks: a palette key
// ("good"), a freeform colour ("#18cdf2" — PCF-era blobs), or "" (the
// caller's fallback, usually a per-slot toolkit default).

import { parseColor, STATUS_PALETTE } from "./tokens";

export interface PaletteEntry {
  /** Stable slug stored in card settings ("good"). Never renamed. */
  key: string;
  /** Display name, freely editable per site ("Good"). */
  label: string;
  /** CSS colour. */
  color: string;
}

/** The starter set — used whenever a site has no stored palette. */
export function defaultPalette(): PaletteEntry[] {
  return [
    { key: "good", label: "Good", color: STATUS_PALETTE.done },
    { key: "issue", label: "Issue", color: STATUS_PALETTE.blocked },
    { key: "atrisk", label: "At risk", color: STATUS_PALETTE.open },
    { key: "info", label: "Info", color: STATUS_PALETTE.inProgress },
    { key: "neutral", label: "Neutral", color: "#808080" },
  ];
}

/** Parse a stored palette; "" or garbage → the defaults. Never throws. */
export function parsePalette(raw: string | null | undefined): PaletteEntry[] {
  const t = (raw ?? "").trim();
  if (t === "") return defaultPalette();
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return defaultPalette();
    const out: PaletteEntry[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key.trim() : "";
      const color = typeof o.color === "string" ? o.color.trim() : "";
      if (key === "" || color === "" || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label: typeof o.label === "string" && o.label.trim() !== "" ? o.label.trim() : key,
        color,
      });
    }
    return out.length > 0 ? out : defaultPalette();
  } catch {
    return defaultPalette();
  }
}

export function serializePalette(entries: PaletteEntry[]): string {
  return JSON.stringify(entries);
}

/** key → colour, the shape mounters resolve against. */
export function paletteMap(entries: PaletteEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of entries) map[e.key] = e.color;
  return map;
}

/** Slug a new entry's label into an unused stable key. */
export function mintPaletteKey(label: string, taken: Set<string>): string {
  const stem =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "colour";
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  }
}

/**
 * A stored selection → a concrete colour. Palette keys win (so a site key
 * named like a CSS colour still resolves to the site's choice), then any
 * parseable freeform colour passes through (legacy hex), then `fallback`
 * ("" selections and keys deleted from the palette both land there).
 */
export function resolvePaletteColor(
  palette: Record<string, string>,
  value: string | null | undefined,
  fallback: string
): string {
  const v = (value ?? "").trim();
  if (v === "") return fallback;
  if (palette[v] !== undefined) return palette[v];
  if (parseColor(v) !== null) return v;
  return fallback;
}
