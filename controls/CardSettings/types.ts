// CardSettings draft model — the working copy of a target card's settingsJSON
// while it is being composed/edited. Parsing is defensive and LOSSLESS: any
// top-level or theme keys we don't recognise are carried in extraTop/extraTheme
// and written back untouched, so editing never strips a working card's config.
// Serialization is SPARSE: only values the maker actually set are emitted, so
// stored blobs keep inheriting future control defaults.

export interface ThemeDraft {
  background: string;
  foreground: string;
  accent: string;
  legend: string; // CSV or JSON-array text, as the controls accept
  font: string;
}

export interface SettingsDraft {
  /** Which card this blob configures (stamped into the JSON). "" = not chosen. */
  cardType: string;
  title: string;
  /** string | string[] | {field,hint}[] | undefined — edited by the editor. */
  prompts: unknown;
  readOnly: boolean;
  theme: ThemeDraft;
  config: Record<string, unknown>;
  /** Unrecognised top-level keys, preserved verbatim on output. */
  extraTop: Record<string, unknown>;
  /** Unrecognised theme keys, preserved verbatim on output. */
  extraTheme: Record<string, unknown>;
}

export function emptyDraft(): SettingsDraft {
  return {
    cardType: "",
    title: "",
    prompts: undefined,
    readOnly: false,
    theme: { background: "", foreground: "", accent: "", legend: "", font: "" },
    config: {},
    extraTop: {},
    extraTheme: {},
  };
}

const THEME_KEYS = ["background", "foreground", "accent", "legend", "font"] as const;
const TOP_KEYS = ["cardType", "title", "prompts", "readOnly", "theme", "config"];

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse an existing settingsJSON into a draft; never throws. */
export function parseDraft(raw: string | null | undefined): SettingsDraft {
  const draft = emptyDraft();
  const t = (raw ?? "").trim();
  if (t === "") return draft;
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return draft;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return draft;
  const o = obj as Record<string, unknown>;

  draft.cardType = s(o.cardType).trim();
  draft.title = s(o.title);
  draft.prompts = o.prompts;
  draft.readOnly = o.readOnly === true;

  if (o.theme && typeof o.theme === "object" && !Array.isArray(o.theme)) {
    const th = o.theme as Record<string, unknown>;
    for (const k of THEME_KEYS) draft.theme[k] = s(th[k]);
    for (const [k, v] of Object.entries(th)) {
      if (!(THEME_KEYS as readonly string[]).includes(k)) draft.extraTheme[k] = v;
    }
  }

  if (o.config && typeof o.config === "object" && !Array.isArray(o.config)) {
    draft.config = { ...(o.config as Record<string, unknown>) };
  }

  for (const [k, v] of Object.entries(o)) {
    if (!TOP_KEYS.includes(k)) draft.extraTop[k] = v;
  }
  return draft;
}

/** Is a config/prompt value "set" (worth emitting)? */
function isSet(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return true; // booleans
}

/**
 * Serialize the draft sparsely. Returns "" when there is nothing at all to
 * say (no card chosen and nothing set), so the output stays clean.
 */
export function serializeDraft(draft: SettingsDraft): string {
  const out: Record<string, unknown> = {};

  if (draft.cardType !== "") out.cardType = draft.cardType;
  if (draft.title.trim() !== "") out.title = draft.title.trim();
  if (isSet(draft.prompts)) out.prompts = draft.prompts;
  if (draft.readOnly) out.readOnly = true;

  const theme: Record<string, unknown> = {};
  for (const k of THEME_KEYS) {
    if (draft.theme[k].trim() !== "") theme[k] = draft.theme[k].trim();
  }
  for (const [k, v] of Object.entries(draft.extraTheme)) theme[k] = v;
  if (Object.keys(theme).length > 0) out.theme = theme;

  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.config)) {
    if (isSet(v)) config[k] = v;
  }
  if (Object.keys(config).length > 0) out.config = config;

  for (const [k, v] of Object.entries(draft.extraTop)) {
    if (!(k in out)) out[k] = v;
  }

  return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}
