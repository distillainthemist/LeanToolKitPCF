// The hub's main tabs — which exist, their default order, and the per-site
// enablement stored on the site-settings row (`ben_hubtabs`, a JSON array
// of keys; blank = every tab). Settings (the in-hub one is hidden; the app
// hosts settings) is not part of this list.

export interface HubTabDef {
  key: string;
  label: string;
}

/** Every main tab, in the DEFAULT order (Priorities sits before Actions
 *  and Documents — Ben, 2026-08-19). */
export const HUB_TABS: HubTabDef[] = [
  { key: "myday", label: "My day" },
  { key: "calendar", label: "Cadence" },
  { key: "priorities", label: "Priorities" },
  { key: "actions", label: "Actions" },
  { key: "documents", label: "Documents" },
];

export const DEFAULT_TAB_ORDER: string[] = HUB_TABS.map((t) => t.key);

/** Parse the stored enablement; null = not set (all tabs). Unknown keys
 *  are dropped; an empty array means "nothing enabled" and is treated as
 *  unset so a site can never lock itself out of the hub. */
export function parseHubTabs(raw: string | null | undefined): string[] | null {
  const t = (raw ?? "").trim();
  if (t === "") return null;
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return null;
    const keys = arr.filter((k): k is string => typeof k === "string" && DEFAULT_TAB_ORDER.includes(k));
    return keys.length > 0 ? [...new Set(keys)] : null;
  } catch {
    return null;
  }
}

/** The tabs to show, in default order, given the enablement. */
export function effectiveTabs(enabled: string[] | null): string[] {
  if (enabled === null) return DEFAULT_TAB_ORDER.slice();
  return DEFAULT_TAB_ORDER.filter((k) => enabled.includes(k));
}

export function serializeHubTabs(enabled: string[] | null): string {
  if (enabled === null) return "";
  const keys = DEFAULT_TAB_ORDER.filter((k) => enabled.includes(k));
  return keys.length === DEFAULT_TAB_ORDER.length ? "" : JSON.stringify(keys);
}
