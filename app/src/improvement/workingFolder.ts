// The initiative's working folder (docs/initiative-links-proposal-2026-10.md
// §2, built 2026-10-08): a BUILT-IN standard header field of kind url —
// no column, it lives in the initiative's fieldValues like every header
// field — surfaced wherever an initiative is looked at. Pure helpers:
// the field's definition, what counts as a usable link, and how a long
// SharePoint / Teams URL reads as text.

import type { TemplateField } from "./templateModel";

export const WORKING_FOLDER_KEY = "workingFolder";

export const WORKING_FOLDER_FIELD: TemplateField = {
  key: WORKING_FOLDER_KEY,
  label: "Working folder",
  kind: "url",
  options: [],
  required: false,
};

/** A usable working-folder link: https only, trimmed; "" otherwise. */
export function workingFolderUrl(values: Record<string, string> | undefined): string {
  const raw = (values?.[WORKING_FOLDER_KEY] ?? "").trim();
  return /^https:\/\/\S+$/i.test(raw) ? raw : "";
}

/** "host › last › segments" for a link — a SharePoint folder URL is
 *  long and opaque; its host and the last two path segments say where
 *  it goes ("contoso.sharepoint.com › Shared Documents › Line 2"). */
export function linkDisplayText(url: string, segments = 2): string {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split("/")
      .filter((p) => p !== "" && !/\.aspx$/i.test(p) && !/^:[a-z]:$/i.test(p) && p !== "r" && p !== "sites" && p !== "teams")
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    // a SharePoint "AllItems.aspx?id=<path>" link names the folder in `id`
    const idParam = u.searchParams.get("id");
    const tail = idParam ? idParam.split("/").filter((p) => p !== "").slice(-segments) : parts.slice(-segments);
    return [u.host, ...tail].join(" › ");
  } catch {
    return url;
  }
}

/** Which service a link points at — the card's glyph picks on it. */
export function linkHostKind(url: string): "sharepoint" | "teams" | "onedrive" | "web" {
  try {
    const h = new URL(url).host.toLowerCase();
    if (h.endsWith("sharepoint.com")) return h.includes("-my.") ? "onedrive" : "sharepoint";
    if (h === "teams.microsoft.com" || h.endsWith(".teams.microsoft.com")) return "teams";
    return "web";
  } catch {
    return "web";
  }
}
