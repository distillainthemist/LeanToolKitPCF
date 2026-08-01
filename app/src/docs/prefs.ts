// Standard Documents — per-user favourites and saved views, stored on
// the person's ben_ltkuserprefs row (plan Phase 3; the plan sketched a
// separate ben_ltkdocprefs table, but userprefs IS the per-user
// presentation-prefs row — two columns beat a table + service).
// Presentation state only.

import { Ben_ltkuserprefsesService } from "../generated/services/Ben_ltkuserprefsesService";
import { eq, firstWhere, upsertWhere } from "../store/dv";
import {
  DocUiPrefs,
  DocView,
  FavDoc,
  parseDocUiPrefs,
  parseDocViews,
  parseFavDocs,
  serializeDocUiPrefs,
  serializeDocViews,
  serializeFavDocs,
} from "./views";

export interface DocPrefs {
  favorites: FavDoc[];
  views: DocView[];
  /** Presentation state (Vault V1) — ticked libraries, view, density,
   *  collapsed tree groups. */
  ui: DocUiPrefs;
}

// Session cache per person — the docs screen re-mounts on every library
// click, and favourites/views change only through this module.
const cache = new Map<string, Promise<DocPrefs>>();

export function docPrefs(whoId: string): Promise<DocPrefs> {
  let hit = cache.get(whoId);
  if (hit === undefined) {
    hit = (async () => {
      const row = await firstWhere(
        Ben_ltkuserprefsesService.getAll,
        eq("ben_userid", whoId)
      );
      return {
        favorites: parseFavDocs(row?.ben_docfavoritesjson),
        views: parseDocViews(row?.ben_docviewsjson),
        ui: parseDocUiPrefs(row?.ben_docuijson),
      };
    })();
    hit.catch(() => cache.delete(whoId)); // a failed read must not stick
    cache.set(whoId, hit);
  }
  return hit;
}

async function save(whoId: string, prefs: DocPrefs): Promise<void> {
  cache.set(whoId, Promise.resolve(prefs));
  await upsertWhere(
    Ben_ltkuserprefsesService,
    eq("ben_userid", whoId),
    (row) => row.ben_ltkuserprefsid,
    {
      ben_userid: whoId,
      ben_name: whoId,
      ben_docfavoritesjson: serializeFavDocs(prefs.favorites),
      ben_docviewsjson: serializeDocViews(prefs.views),
      ben_docuijson: serializeDocUiPrefs(prefs.ui),
    }
  );
}

// UI-state writes are frequent (a tick, a caret) and never worth blocking
// on — debounce per person, last write wins, cache updated immediately so
// remounts read the new state synchronously.
const uiTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function saveDocUi(whoId: string, ui: DocUiPrefs): void {
  if (whoId === "") return;
  void docPrefs(whoId).then((prefs) => {
    const next = { ...prefs, ui };
    cache.set(whoId, Promise.resolve(next));
    const t = uiTimers.get(whoId);
    if (t !== undefined) clearTimeout(t);
    uiTimers.set(
      whoId,
      setTimeout(() => {
        uiTimers.delete(whoId);
        void save(whoId, next).catch(() => {
          /* presentation state — losing one write is fine */
        });
      }, 800)
    );
  });
}

/** Add or remove a favourite; returns the new list. */
export async function toggleFavorite(whoId: string, doc: FavDoc): Promise<FavDoc[]> {
  const prefs = await docPrefs(whoId);
  const without = prefs.favorites.filter((f) => f.uniqueId !== doc.uniqueId);
  const favorites =
    without.length === prefs.favorites.length ? [doc, ...without] : without;
  await save(whoId, { ...prefs, favorites });
  return favorites;
}

/** Save (or overwrite, by name) one view; returns the new list. */
export async function saveDocView(whoId: string, view: DocView): Promise<DocView[]> {
  const prefs = await docPrefs(whoId);
  const views = [view, ...prefs.views.filter((v) => v.name !== view.name)];
  await save(whoId, { ...prefs, views });
  return views;
}

export async function deleteDocView(whoId: string, name: string): Promise<DocView[]> {
  const prefs = await docPrefs(whoId);
  const views = prefs.views.filter((v) => v.name !== name);
  await save(whoId, { ...prefs, views });
  return views;
}
