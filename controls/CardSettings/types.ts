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
  titlebar: string; // title strip fill, distinct from the card background
  legend: string; // CSV or JSON-array text, as the controls accept
  font: string;
}

/**
 * The board section of a settings blob — written by the composer in board
 * mode, read by the BOARD APP at instance creation (the cards themselves
 * ignore it). policy: "" = unset (the app defaults to carry).
 */
export interface BoardDraft {
  policy: "" | "clear" | "carry" | "link" | "shared";
  sourceBoardId: string;
  sourceCardId: string;
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
  board: BoardDraft;
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
    theme: { background: "", foreground: "", accent: "", titlebar: "", legend: "", font: "" },
    config: {},
    board: { policy: "", sourceBoardId: "", sourceCardId: "" },
    extraTop: {},
    extraTheme: {},
  };
}

const THEME_KEYS = ["background", "foreground", "accent", "titlebar", "legend", "font"] as const;
const TOP_KEYS = ["cardType", "title", "prompts", "readOnly", "theme", "config", "board"];

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

  if (o.board && typeof o.board === "object" && !Array.isArray(o.board)) {
    const b = o.board as Record<string, unknown>;
    const pol = s(b.policy).trim();
    draft.board.policy =
      pol === "clear" || pol === "carry" || pol === "link" || pol === "shared"
        ? pol
        : "";
    const src = (b.source ?? {}) as Record<string, unknown>;
    draft.board.sourceBoardId = s(src.boardId).trim();
    draft.board.sourceCardId = s(src.cardId).trim();
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

  const board: Record<string, unknown> = {};
  if (draft.board.policy !== "") board.policy = draft.board.policy;
  if (draft.board.sourceBoardId !== "" || draft.board.sourceCardId !== "") {
    const source: Record<string, unknown> = {};
    if (draft.board.sourceBoardId !== "") source.boardId = draft.board.sourceBoardId;
    if (draft.board.sourceCardId !== "") source.cardId = draft.board.sourceCardId;
    board.source = source;
  }
  if (Object.keys(board).length > 0) out.board = board;

  for (const [k, v] of Object.entries(draft.extraTop)) {
    if (!(k in out)) out[k] = v;
  }

  return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}

// ---- boards manifest (the composer's source-picker feed) -------------------

/** One board the composer can offer as a link/rollup source. */
export interface BoardRef {
  boardId: string;
  name: string;
  cards: { cardId: string; cardType: string; title: string }[];
}

/**
 * Parse boardsManifestJSON: [{boardId, name, cards:[{cardId, cardType,
 * title}]}]. Supplying it (even empty "[]") switches the composer into board
 * mode; null means the input was not provided at all.
 */
export function parseBoardsManifest(
  raw: string | null | undefined
): BoardRef[] | null {
  const t = (raw ?? "").trim();
  if (t === "") return null;
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: BoardRef[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const boardId = s(o.boardId).trim();
      if (boardId === "") continue;
      const cards: BoardRef["cards"] = [];
      if (Array.isArray(o.cards)) {
        for (const c of o.cards) {
          if (!c || typeof c !== "object") continue;
          const co = c as Record<string, unknown>;
          const cardId = s(co.cardId).trim();
          if (cardId === "") continue;
          cards.push({
            cardId,
            cardType: s(co.cardType).trim(),
            title: s(co.title).trim(),
          });
        }
      }
      out.push({ boardId, name: s(o.name).trim() || boardId, cards });
    }
    return out;
  } catch {
    return null;
  }
}
