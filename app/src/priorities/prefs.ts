// Cascaded priorities — per-user presentation prefs (design §5: "the
// toggle persists per user per org"; Ben's Vault-era call: Dataverse over
// localStorage so state follows the person). Stored under the
// `priorities` key of the person's ben_preferences JSON via
// mergeUserPrefs — no schema change. Debounced, last write wins.

import { mergeUserPrefs, userPrefsJson } from "../store/config";

import { parsePriorityPrefs, PriorityPrefs } from "./model";

export { parsePriorityPrefs };
export type { PriorityPrefs, ViewMode } from "./model";

export async function loadPriorityPrefs(whoId: string): Promise<PriorityPrefs> {
  if (whoId === "") return parsePriorityPrefs("");
  try {
    return parsePriorityPrefs(await userPrefsJson(whoId));
  } catch {
    return parsePriorityPrefs("");
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function savePriorityPrefs(whoId: string, prefs: PriorityPrefs): void {
  if (whoId === "") return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void mergeUserPrefs(whoId, { priorities: prefs }).catch(() => {
      /* presentation state — losing one write is fine */
    });
  }, 800);
}
