// EmbedCard url machinery — a generic https embed (any framable page) with
// Power BI niceties: when the link is a Power BI embed url, the filter and
// page-navigation panes can be hidden and a report page pre-selected via
// query parameters.
//
// The card's document is the optional commentary pane (ltk/embednotes@1):
// rich-text notes keyed by the configured headings. With no headings
// configured there is no pane and nothing is edited. There are still no
// snapshot outputs — a cross-origin iframe cannot be captured, and a blank
// rectangle would be a decoy.

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export interface EmbedOptions {
  url: string;
  /** Power BI links only: hide the filter pane. */
  hideFilterPane: boolean;
  /** Power BI links only: hide the page-navigation pane. */
  hidePageNav: boolean;
  /** Power BI links only: open on this report section (pageName). */
  pageName: string;
}

/** Decode the few HTML entities that appear inside an iframe `src`
 *  attribute — every Embed button encodes `&` as `&amp;`. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/g, '"');
}

/**
 * Pull the `src` out of a pasted `<iframe …>` snippet. The official
 * "Embed" button on SharePoint, Office, Power BI and Power Apps all hand
 * back a full iframe tag, and pasting the whole thing is the natural
 * thing to do — so accept it and lift out the url. Anything that isn't an
 * iframe snippet is returned unchanged.
 */
export function extractIframeSrc(raw: string): string {
  const t = raw.trim();
  if (!/^<iframe[\s>]/i.test(t)) return raw;
  const m = t.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : raw;
}

/**
 * Normalise an embed url: lifts the src out of a pasted iframe snippet,
 * trims, requires http(s) — anything without a scheme is treated as
 * https, anything with another scheme (e.g. javascript:) is rejected.
 * Returns "" when unusable.
 */
export function safeEmbedUrl(raw: string): string {
  const t = extractIframeSrc(raw).trim();
  if (t === "") return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ""; // some other scheme — reject
  return `https://${t}`;
}

/** True when the url points at SharePoint Online / OneDrive for Business
 *  (any national cloud). */
export function isSharePointUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith(".sharepoint.com") ||
      host.endsWith(".sharepoint.cn") ||
      host.endsWith(".sharepoint.us") ||
      host.endsWith(".sharepoint-mil.us")
    );
  } catch {
    return false;
  }
}

/**
 * A SharePoint/OneDrive document link in its read-only embed form. Only
 * the classic `…/Doc.aspx?sourcedoc={id}` link is rewritten (its `action`
 * becomes `embedview`); an already-embed `embed.aspx` url and the modern
 * short share links (`/:x:/r/…`) pass through untouched — the latter can't
 * be converted client-side (the embed form needs a UniqueId the link
 * doesn't carry; use the file's File → Share → Embed snippet instead).
 */
export function sharePointEmbedUrl(base: string): string {
  try {
    const u = new URL(base);
    if (/\/embed\.aspx$/i.test(u.pathname)) return base;
    if (/\/doc\.aspx$/i.test(u.pathname) && u.searchParams.has("sourcedoc")) {
      u.searchParams.set("action", "embedview");
      return u.toString();
    }
    return base;
  } catch {
    return base;
  }
}

/** True when the url points at the Power BI service (any national cloud). */
export function isPowerBiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "powerbi.com" ||
      host.endsWith(".powerbi.com") ||
      host.endsWith(".powerbi.cn") ||
      host.endsWith(".powerbigov.us")
    );
  } catch {
    return false;
  }
}

/**
 * The url the iframe actually loads. Power BI links gain the pane toggles /
 * page selection as query parameters (existing parameters in the pasted link
 * are respected — these only overwrite their own keys). Non-Power-BI links
 * pass through untouched. Returns "" for an empty or unsafe url.
 */
export function buildEmbedUrl(opts: EmbedOptions): string {
  const base = safeEmbedUrl(opts.url);
  if (base === "") return "";
  if (isSharePointUrl(base)) return sharePointEmbedUrl(base);
  if (!isPowerBiUrl(base)) return base;
  if (!opts.hideFilterPane && !opts.hidePageNav && opts.pageName.trim() === "") {
    return base;
  }
  try {
    const u = new URL(base);
    if (opts.hideFilterPane) u.searchParams.set("filterPaneEnabled", "false");
    if (opts.hidePageNav) u.searchParams.set("navContentPaneEnabled", "false");
    if (opts.pageName.trim() !== "") {
      u.searchParams.set("pageName", opts.pageName.trim());
    }
    return u.toString();
  } catch {
    return base;
  }
}

// ---- the commentary document ----

export const NOTES_SCHEMA_ID = "ltk/embednotes@1";

export interface EmbedNotesData {
  /** Sanitized rich-text html, keyed by heading. Keys for headings no
   *  longer configured are kept — renaming a heading back restores its
   *  note instead of silently losing it. */
  notes: Record<string, string>;
}

export type EmbedNotesEnvelope = Envelope<EmbedNotesData>;

function parseNotesData(data: unknown): EmbedNotesData {
  if (!data || typeof data !== "object") return { notes: {} };
  const d = data as { notes?: unknown };
  const notes: Record<string, string> = {};
  if (d.notes && typeof d.notes === "object") {
    for (const [k, v] of Object.entries(d.notes as Record<string, unknown>)) {
      if (typeof v === "string" && k.trim() !== "") {
        notes[k] = sanitizeRichHtml(v);
      }
    }
  }
  return { notes };
}

export function parseEmbedNotes(
  raw: string | null | undefined
): ParsedEnvelope<EmbedNotesData> {
  return parseEnvelope(raw, NOTES_SCHEMA_ID, parseNotesData);
}

export function serializeEmbedNotes(env: EmbedNotesEnvelope): string {
  return serializeEnvelope(env);
}

/** The configured commentary headings: one per line, trimmed, deduped.
 *  An empty result means the pane is off. */
export function parseHeadings(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const h = line.trim();
    if (h === "" || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    out.push(h);
  }
  return out;
}

// Tags the note editor's own toolbar produces (plus the wrapping the
// browser inserts on Enter). Nothing else survives, and no attributes ever
// do — pasted markup collapses to plain text with basic emphasis.
const RICH_TAGS = new Set([
  "b", "strong", "i", "em", "u", "ul", "ol", "li", "br", "p", "div",
]);

/**
 * Sanitize rich-text html to the whitelist above: allowed tags are re-emitted
 * bare (attributes dropped), everything else is stripped (its text content
 * remains). Applied on both save and render, so a stored document can never
 * inject markup.
 */
export function sanitizeRichHtml(html: string): string {
  return html.replace(/<[^>]*>?/g, (tag) => {
    const m = tag.match(/^<(\/?)([a-zA-Z0-9]+)/);
    if (!m) return ""; // malformed / comment / stray "<"
    const name = m[2].toLowerCase();
    if (!RICH_TAGS.has(name)) return "";
    return name === "br" && m[1] === "" ? "<br>" : `<${m[1]}${name}>`;
  });
}
