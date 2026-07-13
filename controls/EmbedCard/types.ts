// EmbedCard url machinery — a generic https embed (any framable page) with
// Power BI niceties: when the link is a Power BI embed url, the filter and
// page-navigation panes can be hidden and a report page pre-selected via
// query parameters.
//
// This card has NO document: nothing is edited, so there is no outputJSON,
// no actions channel and no envelope. It also has no snapshot outputs — a
// cross-origin iframe cannot be captured, and a blank rectangle would be a
// decoy.

export interface EmbedOptions {
  url: string;
  /** Power BI links only: hide the filter pane. */
  hideFilterPane: boolean;
  /** Power BI links only: hide the page-navigation pane. */
  hidePageNav: boolean;
  /** Power BI links only: open on this report section (pageName). */
  pageName: string;
}

/**
 * Normalise an embed url: trims, requires http(s) — anything without a
 * scheme is treated as https, anything with another scheme (e.g.
 * javascript:) is rejected. Returns "" when unusable.
 */
export function safeEmbedUrl(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ""; // some other scheme — reject
  return `https://${t}`;
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
