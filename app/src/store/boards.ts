// Boards IO — list/get, creation from the wizard blob (build-kit §6b),
// manifest/layout persistence (§4), occurrence-settings updates.

import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { allWhere, eq, firstWhere, upsertWhere } from "./dv";
import { BoardManifest, BoardSummary, boardFromRow, serializeManifest } from "./mappers";

export async function listBoards(): Promise<BoardSummary[]> {
  const rows = await allWhere(
    Ben_ltkboardsService.getAll,
    "ben_istemplate ne true",
    undefined,
    ["ben_name asc"]
  );
  return rows.map(boardFromRow);
}

export async function getBoard(boardId: string): Promise<BoardSummary | null> {
  const row = await firstWhere(Ben_ltkboardsService.getAll, eq("ben_boardid", boardId));
  return row ? boardFromRow(row) : null;
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
  // a fresh board starts with an empty grid — composed in BoardGrid edit mode
  const board = await getBoard(boardId);
  if (board && board.manifestRaw.trim() === "") {
    await Ben_ltkboardsService.update(board.id, {
      ben_manifestjson: JSON.stringify({ grid: "3", columnTitles: [], slots: [] }),
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
