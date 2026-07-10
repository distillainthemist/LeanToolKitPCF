// LeanToolKit design tokens and colour engine.
//
// Every control reads the same four theme inputs (background / foreground /
// accent / legend colours + font) and derives all other shades from them, so
// the whole board restyles from a handful of app-level variables.

export interface Theme {
  background: string;
  foreground: string;
  accent: string;
  /** Semantic slots, meaning defined per control (status colours, lanes…). */
  legend: string[];
  fontFamily: string;
}

export function defaultTheme(): Theme {
  return {
    background: "#ffffff",
    foreground: "#141414",
    accent: "#141414",
    legend: [],
    fontFamily: "Segoe UI, system-ui, sans-serif",
  };
}

/**
 * Toolkit-wide semantic status colours (overridable per control via
 * legendColors): open amber, in-progress blue, done green, blocked red.
 */
export const STATUS_PALETTE = {
  open: "#f2c811",
  inProgress: "#2b88d8",
  done: "#107c10",
  blocked: "#d13438",
};

/** Spacing grid (px). All layout should use multiples of GRID. */
export const GRID = 4;

/** Type ramp (px): title / heading / body / caption. */
export const TYPE = { title: 20, heading: 16, body: 14, caption: 12 };

/** Corner radii (px): cards/chips and pills. */
export const RADIUS = { card: 6, pill: 999 };

// ---------------------------------------------------------------------------
// Colour maths — hex in, hex out; forgiving of named/short CSS colours by
// falling back to a neutral when a value cannot be parsed.
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#d13438",
  green: "#107c10",
  blue: "#2b88d8",
  yellow: "#f2c811",
  orange: "#ca5010",
  purple: "#8764b8",
  teal: "#038387",
  grey: "#808080",
  gray: "#808080",
};

export function parseColor(input: string | null | undefined): Rgb | null {
  let s = (input ?? "").trim().toLowerCase();
  if (s === "") return null;
  if (NAMED[s]) s = NAMED[s];
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m3) {
    return {
      r: parseInt(m3[1] + m3[1], 16),
      g: parseInt(m3[2] + m3[2], 16),
      b: parseInt(m3[3] + m3[3], 16),
    };
  }
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(s);
  if (m6) {
    return {
      r: parseInt(m6[1], 16),
      g: parseInt(m6[2], 16),
      b: parseInt(m6[3], 16),
    };
  }
  const mRgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (mRgb) {
    return { r: +mRgb[1], g: +mRgb[2], b: +mRgb[3] };
  }
  return null;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function toHex(c: Rgb): string {
  const h = (v: number) => clamp255(v).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

/** Mix `color` towards `into` by `amount` (0..1). Unparseable → `color` as-is. */
export function mix(color: string, into: string, amount: number): string {
  const a = parseColor(color);
  const b = parseColor(into);
  if (!a || !b) return color;
  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** Lighten towards white — 10 % tints are the toolkit's flat fill. */
export function tint(color: string, amount: number): string {
  return mix(color, "#ffffff", amount);
}

/** Darken towards black. */
export function shade(color: string, amount: number): string {
  return mix(color, "#000000", amount);
}

/** WCAG-ish relative luminance (0 dark .. 1 light). */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Readable text colour (near-black or white) for the given fill. */
export function textOn(fill: string): string {
  return luminance(fill) > 0.45 ? "#141414" : "#ffffff";
}

/**
 * A readable *coloured* text shade derived from a status colour — dark enough
 * to pass on a 10 % tint of itself (the Fishbone chip trick, generalised).
 */
export function readableShade(color: string): string {
  let out = color;
  for (let i = 0; i < 6 && luminance(out) > 0.3; i++) {
    out = shade(out, 0.25);
  }
  return out;
}

/** Hairline colour: foreground at ~8 % over the background. */
export function hairline(theme: Theme): string {
  return mix(theme.background, theme.foreground, 0.12);
}

/** Muted text: foreground at ~55 %. */
export function muted(theme: Theme): string {
  return mix(theme.background, theme.foreground, 0.55);
}

/**
 * Parse the legendColors input: JSON array preferred, CSV accepted
 * (forgiving for canvas makers, same contract as Fishbone's categories).
 */
export function parseLegend(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) {
        return arr.map((v) => String(v).trim()).filter((v) => v !== "");
      }
    } catch {
      /* fall through to CSV */
    }
  }
  return t
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * Apply a theme to a container as CSS custom properties, so control
 * stylesheets are written once against var(--ltk-*).
 */
export function applyThemeVars(el: HTMLElement, theme: Theme): void {
  el.style.setProperty("--ltk-bg", theme.background);
  el.style.setProperty("--ltk-fg", theme.foreground);
  el.style.setProperty("--ltk-accent", theme.accent);
  el.style.setProperty("--ltk-hairline", hairline(theme));
  el.style.setProperty("--ltk-muted", muted(theme));
  el.style.setProperty("--ltk-font", theme.fontFamily);
}
