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

export async function listDocLibraries(): Promise<DocLibrary[]> {
  const rows = await allWhere(Ben_ltkdoclibrariesService.getAll);
  return rows
    .filter((r) => (r.ben_listid ?? "") !== APP_LIST_ID && (r.ben_listid ?? "") !== "")
    .map((r) => ({
      rowId: r.ben_ltkdoclibraryid ?? "",
      listId: r.ben_listid ?? "",
      siteUrl: r.ben_siteurl ?? "",
      name: r.ben_name ?? "",
      libType: TYPES.includes((r.ben_libtype ?? "") as LibraryType)
        ? ((r.ben_libtype ?? "") as LibraryType)
        : "standard",
      config: parseLibraryConfig(r.ben_configjson),
    }));
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
