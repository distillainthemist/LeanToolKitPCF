// Boards IO — list/get, creation from the wizard blob (build-kit §6b),
// manifest/layout persistence (§4), occurrence-settings updates.

import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { allWhere, eq, firstWhere, upsertWhere } from "./dv";
import { BoardManifest, BoardSummary, boardFromRow, serializeManifest } from "./mappers";

export async function listBoards(includeArchived = false): Promise<BoardSummary[]> {
  const rows = await allWhere(
    Ben_ltkboardsService.getAll,
    includeArchived ? "ben_istemplate ne true" : "ben_istemplate ne true and ben_isarchived ne true",
    undefined,
    ["ben_name asc"]
  );
  return rows.map(boardFromRow);
}

/** Archive (or restore) a ritual — archived boards leave every list. */
export async function setBoardArchived(boardGuid: string, archived: boolean): Promise<void> {
  await Ben_ltkboardsService.update(boardGuid, { ben_isarchived: archived });
}

export async function getBoard(boardId: string): Promise<BoardSummary | null> {
  const row = await firstWhere(Ben_ltkboardsService.getAll, eq("ben_boardid", boardId));
  return row ? boardFromRow(row) : null;
}

/**
 * Confidential meetings (wizard Basics toggle) are viewable only by their
 * owner and participants. Non-confidential boards are open to everyone;
 * unparseable blobs stay open rather than locking anyone out.
 */
export function canViewBoard(occurrenceSettingsRaw: string, whoId: string): boolean {
  const t = occurrenceSettingsRaw.trim();
  if (!t.startsWith("{")) return true;
  try {
    const o = JSON.parse(t) as {
      confidential?: unknown;
      meeting?: {
        owner?: { whoId?: string };
        participants?: { whoId?: string }[];
      };
    };
    if (o.confidential !== true) return true;
    if (whoId === "") return false;
    if (o.meeting?.owner?.whoId === whoId) return true;
    return (o.meeting?.participants ?? []).some((p) => p.whoId === whoId);
  } catch {
    return true;
  }
}

/** True when the blob marks the meeting confidential. */
export function isConfidentialBoard(occurrenceSettingsRaw: string): boolean {
  const t = occurrenceSettingsRaw.trim();
  if (!t.startsWith("{")) return false;
  try {
    return (JSON.parse(t) as { confidential?: unknown }).confidential === true;
  } catch {
    return false;
  }
}

/** Create (or update) a meeting board from the wizard's outputJSON. */
export async function saveMeetingBoard(
  boardId: string,
  wizardBlobRaw: string
): Promise<void> {
  const blob = JSON.parse(wizardBlobRaw) as Record<string, unknown>;
  const meeting = (blob.meeting ?? {}) as Record<string, unknown>;
  const org = (meeting.org ?? {}) as Record<string, unknown>;
  const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
  await upsertWhere(
    Ben_ltkboardsService,
    eq("ben_boardid", boardId),
    (row) => row.ben_ltkboardid,
    {
      ben_boardid: boardId,
      ben_name: typeof blob.title === "string" ? blob.title : boardId,
      ben_boardkind: "meeting",
      ben_category: typeof blob.meetingCategory === "string" ? blob.meetingCategory : "",
      ben_occurrencesettings: wizardBlobRaw,
      ben_peoplejson: JSON.stringify(participants),
      ben_site: typeof org.site === "string" ? org.site : "",
      ben_department: typeof org.department === "string" ? org.department : "",
    }
  );
  // a fresh meeting board starts double-column with Agenda + Actions —
  // a working ritual even if the maker skips the board-design step
  const board = await getBoard(boardId);
  if (board && board.manifestRaw.trim() === "") {
    const rand = () => Math.random().toString(36).slice(2, 6);
    await Ben_ltkboardsService.update(board.id, {
      ben_manifestjson: JSON.stringify({
        grid: "2",
        columnTitles: [],
        slots: [
          {
            pos: 1, w: 1, h: 1, nav: 1,
            cardId: `agenda-${rand()}`,
            cardType: "AgendaCard",
            title: "Agenda",
            settingsJSON: {},
          },
          {
            pos: 2, w: 1, h: 1, nav: 2,
            cardId: `actionboard-${rand()}`,
            cardType: "ActionBoard",
            title: "Actions",
            settingsJSON: {},
          },
        ],
      }),
    });
  }
}

export async function saveManifest(
  boardGuid: string,
  manifest: BoardManifest
): Promise<void> {
  await Ben_ltkboardsService.update(boardGuid, {
    ben_manifestjson: serializeManifest(manifest),
  });
}

export async function saveOccurrenceSettings(
  boardGuid: string,
  settingsRaw: string
): Promise<void> {
  await Ben_ltkboardsService.update(boardGuid, { ben_occurrencesettings: settingsRaw });
}

/** Rename a site across every board's grouping column. */
export async function renameBoardsSite(oldSite: string, newSite: string): Promise<void> {
  const rows = await allWhere(Ben_ltkboardsService.getAll, eq("ben_site", oldSite));
  for (const row of rows) {
    await Ben_ltkboardsService.update(row.ben_ltkboardid, { ben_site: newSite });
  }
}

/** Rename a department across the site's boards. */
export async function renameBoardsDepartment(
  site: string,
  oldDept: string,
  newDept: string
): Promise<void> {
  const rows = await allWhere(
    Ben_ltkboardsService.getAll,
    `${eq("ben_site", site)} and ${eq("ben_department", oldDept)}`
  );
  for (const row of rows) {
    await Ben_ltkboardsService.update(row.ben_ltkboardid, { ben_department: newDept });
  }
}

/** Copy a board's design (settings + manifest) under a new board id. */
export async function replicateBoard(
  srcBoardId: string,
  newTitle: string
): Promise<string> {
  const src = await getBoard(srcBoardId);
  if (!src) throw new Error(`unknown board ${srcBoardId}`);
  const slug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const newBoardId = `board-${slug || "meeting"}-${Math.random().toString(36).slice(2, 6)}`;
  let blobRaw = src.occurrenceSettingsRaw;
  try {
    const blob = JSON.parse(blobRaw) as Record<string, unknown>;
    blob.title = newTitle;
    blobRaw = JSON.stringify(blob);
  } catch { /* keep raw */ }
  await saveMeetingBoard(newBoardId, blobRaw);
  const created = await getBoard(newBoardId);
  if (created && src.manifestRaw.trim() !== "") {
    await Ben_ltkboardsService.update(created.id, { ben_manifestjson: src.manifestRaw });
  }
  return newBoardId;
}
