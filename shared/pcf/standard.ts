// Helpers for the standard LeanToolKit property surface. Controls differ in
// their generated IInputs types, so these helpers work off the structural
// shape of the standard parameters that every manifest declares.

import { defaultTheme, parseColor, parseLegend, Theme } from "../tokens";

interface StringProp {
  raw?: string | null;
}
interface BoolProp {
  raw?: boolean | null;
}

/** The standard parameters every LeanToolKit manifest declares. */
export interface StandardParams {
  inputJSON?: StringProp;
  settingsJSON?: StringProp;
  actionsInputJSON?: StringProp;
  instanceId?: StringProp;
  resetTrigger?: StringProp;
  peopleJSON?: StringProp;
  cardTitle?: StringProp;
  prompts?: StringProp;
  backgroundColor?: StringProp;
  foregroundColor?: StringProp;
  accentColor?: StringProp;
  titleBarColor?: StringProp;
  legendColors?: StringProp;
  fontFamily?: StringProp;
  readOnly?: BoolProp;
}

export function str(p: StringProp | undefined, fallback = ""): string {
  const v = (p?.raw ?? "").trim();
  return v !== "" ? v : fallback;
}

/**
 * A colour input over a base, validated: the discrete value wins only when it
 * is a parseable CSS colour (guards against the harness "val" placeholder and
 * maker typos, which would otherwise poison the theme with an invalid CSS
 * custom property). Falls through discrete → settings base → default.
 */
export function colorOr(p: StringProp | undefined, base: string, def: string): string {
  const v = (p?.raw ?? "").trim();
  if (v !== "" && parseColor(v) !== null) return v;
  if (base !== "" && parseColor(base) !== null) return base;
  return def;
}

/** A value looks like a font stack (has a space/comma, or is a CSS generic). */
function isFontLike(v: string): boolean {
  if (v === "") return false;
  if (/[\s,]/.test(v)) return true;
  return ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy"].includes(
    v.toLowerCase()
  );
}

/** A font input over a base, guarded against the "val" placeholder / stray words. */
export function fontOr(p: StringProp | undefined, base: string, def: string): string {
  const v = (p?.raw ?? "").trim();
  if (isFontLike(v)) return v;
  if (isFontLike(base)) return base;
  return def;
}

// ---- settingsJSON (the consolidated configuration input) ----
//
// One JSON blob that can carry the whole configuration surface, so a board
// template binds any card type through identical columns:
//   {"title": "...", "prompts": ..., "readOnly": false,
//    "theme": {"background","foreground","accent","titlebar","legend","font"},
//    "config": { ...card-specific keys, named after the discrete inputs... }}
//
// Precedence: settingsJSON is the BASE; a NON-EMPTY discrete text input
// overrides its key (hand-placed cards keep the friendly property panel).
// Enum and boolean inputs can never be blank, so for those the settings key
// wins when present (readOnly merges with OR — either side can force it).

export interface LtkSettings {
  title: string;
  promptsRaw: string;
  theme: {
    background: string;
    foreground: string;
    accent: string;
    titlebar: string;
    legend: string;
    font: string;
  };
  readOnly: boolean;
  config: Record<string, unknown>;
}

function asRaw(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Parse settingsJSON defensively; never throws. */
export function parseSettings(raw: string | null | undefined): LtkSettings {
  const empty: LtkSettings = {
    title: "",
    promptsRaw: "",
    theme: { background: "", foreground: "", accent: "", titlebar: "", legend: "", font: "" },
    readOnly: false,
    config: {},
  };
  const t = (raw ?? "").trim();
  if (t === "" || !t.startsWith("{")) return empty;
  try {
    const d = JSON.parse(t) as Record<string, unknown>;
    const themeRaw = (d.theme ?? {}) as Record<string, unknown>;
    const config =
      d.config && typeof d.config === "object" && !Array.isArray(d.config)
        ? (d.config as Record<string, unknown>)
        : {};
    return {
      title: asRaw(d.title),
      promptsRaw: asRaw(d.prompts),
      theme: {
        background: asRaw(themeRaw.background),
        foreground: asRaw(themeRaw.foreground),
        accent: asRaw(themeRaw.accent),
        titlebar: asRaw(themeRaw.titlebar),
        legend: asRaw(themeRaw.legend),
        font: asRaw(themeRaw.font),
      },
      readOnly: d.readOnly === true,
      config,
    };
  } catch {
    return empty;
  }
}

/** A card-specific settings.config value, as a raw input string. */
export function cfg(s: LtkSettings, key: string): string {
  return asRaw(s.config[key]);
}

/** Discrete-over-settings merge for text inputs: non-empty discrete wins. */
export function rawOr(p: StringProp | undefined, settingsValue: string): string {
  const v = (p?.raw ?? "").trim();
  return v !== "" ? v : settingsValue;
}

/**
 * Settings-over-discrete merge for ENUM inputs (they can never be blank, so
 * a discrete value can't signal "unset" — the settings key wins if present).
 */
export function enumOr(settingsValue: string, p: StringProp | undefined): string {
  return settingsValue !== "" ? settingsValue : (p?.raw ?? "").trim();
}

/** Build a Theme from the standard styling inputs over the settings base. */
export function readTheme(params: StandardParams, s?: LtkSettings): Theme {
  const d = defaultTheme();
  const t = s?.theme;
  return {
    background: colorOr(params.backgroundColor, t?.background ?? "", d.background),
    foreground: colorOr(params.foregroundColor, t?.foreground ?? "", d.foreground),
    accent: colorOr(params.accentColor, t?.accent ?? "", d.accent),
    legend: parseLegend(rawOr(params.legendColors, t?.legend ?? "")),
    fontFamily: fontOr(params.fontFamily, t?.font ?? "", d.fontFamily),
    titleBar: colorOr(params.titleBarColor, t?.titlebar ?? "", d.titleBar),
  };
}

/**
 * Tracks the load-gating inputs: inputJSON, actionsInputJSON and
 * resetTrigger. Reload fires on the first sight of the inputs, whenever
 * resetTrigger changes value (the maker's "reset to loaded data" signal —
 * change-of-value, not boolean, so it can fire any number of times), and
 * whenever either input genuinely changes.
 *
 * Echo guard: apps commonly wire OnChange to Patch the table / set the
 * variable that feeds the inputs back in. An input change that exactly
 * matches what this control last emitted is that write coming home, not new
 * data — it must not trigger a reload, or Patch → reload → OnChange → Patch
 * loops. Call recordEmitted() with every emission.
 */
export class LoadGate {
  private lastInput: string | null = null;
  private lastActionsInput: string | null = null;
  private lastReset: string | null = null;
  private emittedDoc = "";
  private emittedActions = "";

  recordEmitted(doc: string, actions: string): void {
    this.emittedDoc = doc;
    this.emittedActions = actions;
  }

  shouldReload(params: StandardParams): boolean {
    const input = params.inputJSON?.raw ?? "";
    const actionsInput = params.actionsInputJSON?.raw ?? "";
    const reset = params.resetTrigger?.raw ?? "";

    const first = this.lastInput === null;
    let reload = first;
    if (!first) {
      if (reset !== this.lastReset) {
        reload = true;
      } else {
        const docChanged =
          input !== this.lastInput && input !== this.emittedDoc;
        const actionsChanged =
          actionsInput !== this.lastActionsInput &&
          actionsInput !== this.emittedActions;
        reload = docChanged || actionsChanged;
      }
    }

    this.lastInput = input;
    this.lastActionsInput = actionsInput;
    this.lastReset = reset;
    return reload;
  }
}
