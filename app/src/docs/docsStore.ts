// Standard Documents — Dataverse IO for the library configuration rows
// (ben_ltkdoclibrary; plan Phase 1). One row per exposed library; the
// reserved "__app__" row carries the app-level docs config. Presentation
// state only — SharePoint columns are the record.

import { Ben_ltkdoclibrariesService } from "../generated/services/Ben_ltkdoclibrariesService";
import { allWhere, eq, firstWhere, upsertWhere } from "../store/dv";
import {
  APP_LIST_ID,
  AppDocsConfig,
  LibraryConfig,
  LibraryType,
  parseAppDocsConfig,
  parseLibraryConfig,
  serializeAppDocsConfig,
  serializeLibraryConfig,
} from "./model";

export interface DocLibrary {
  /** Dataverse row GUID (delete handle). */
  rowId: string;
  /** SharePoint list GUID — the stable identity. */
  listId: string;
  siteUrl: string;
  /** SharePoint title at expose time (display fallback). */
  name: string;
  libType: LibraryType;
  config: LibraryConfig;
}

const TYPES: LibraryType[] = ["standard", "record", "working", "revision", "template"];

// Session cache — library config changes only through the settings tab
// (which invalidates), so repeat #/docs navigation costs no Dataverse
// round-trips (performance contract: repeat navigation feels instant).
let cache: Promise<{ app: AppDocsConfig; libraries: DocLibrary[] }> | null = null;

export function invalidateDocsCache(): void {
  cache = null;
}

/** App config + exposed libraries in one cached read. */
export function docsConfig(): Promise<{ app: AppDocsConfig; libraries: DocLibrary[] }> {
  cache ??= (async () => {
    const rows = await allWhere(Ben_ltkdoclibrariesService.getAll);
    const appRow = rows.find((r) => r.ben_listid === APP_LIST_ID);
    return {
      app: parseAppDocsConfig(appRow?.ben_configjson),
      libraries: rows
        .filter((r) => (r.ben_listid ?? "") !== APP_LIST_ID && (r.ben_listid ?? "") !== "")
        .map(mapRow),
    };
  })();
  cache.catch(() => (cache = null)); // a failed read must not stick
  return cache;
}

export async function appDocsConfig(): Promise<AppDocsConfig> {
  const row = await firstWhere(
    Ben_ltkdoclibrariesService.getAll,
    eq("ben_listid", APP_LIST_ID)
  );
  return parseAppDocsConfig(row?.ben_configjson);
}

export async function saveAppDocsConfig(cfg: AppDocsConfig): Promise<void> {
  await upsertWhere(
    Ben_ltkdoclibrariesService,
    eq("ben_listid", APP_LIST_ID),
    (row) => row.ben_ltkdoclibraryid,
    {
      ben_listid: APP_LIST_ID,
      ben_name: "Documents configuration",
      ben_siteurl: cfg.siteUrl,
      ben_configjson: serializeAppDocsConfig(cfg),
    }
  );
}

function mapRow(r: {
  ben_ltkdoclibraryid?: string;
  ben_listid?: string;
  ben_siteurl?: string;
  ben_name?: string;
  ben_libtype?: string;
  ben_configjson?: string;
}): DocLibrary {
  return {
    rowId: r.ben_ltkdoclibraryid ?? "",
    listId: r.ben_listid ?? "",
    siteUrl: r.ben_siteurl ?? "",
    name: r.ben_name ?? "",
    libType: TYPES.includes((r.ben_libtype ?? "") as LibraryType)
      ? ((r.ben_libtype ?? "") as LibraryType)
      : "standard",
    config: parseLibraryConfig(r.ben_configjson),
  };
}

export async function listDocLibraries(): Promise<DocLibrary[]> {
  const rows = await allWhere(Ben_ltkdoclibrariesService.getAll);
  return rows
    .filter((r) => (r.ben_listid ?? "") !== APP_LIST_ID && (r.ben_listid ?? "") !== "")
    .map(mapRow);
}

export async function saveDocLibrary(lib: {
  listId: string;
  siteUrl: string;
  name: string;
  libType: LibraryType;
  config: LibraryConfig;
}): Promise<void> {
  await upsertWhere(
    Ben_ltkdoclibrariesService,
    eq("ben_listid", lib.listId),
    (row) => row.ben_ltkdoclibraryid,
    {
      ben_listid: lib.listId,
      ben_name: lib.name.slice(0, 200),
      ben_siteurl: lib.siteUrl,
      ben_libtype: lib.libType,
      ben_configjson: serializeLibraryConfig(lib.config),
    }
  );
}

/** Unexpose: the row is deleted outright — no orphans (plan proof). */
export async function deleteDocLibrary(rowId: string): Promise<void> {
  await Ben_ltkdoclibrariesService.delete(rowId);
}
