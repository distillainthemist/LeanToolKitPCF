// Which actions a board TILE shows (2026-09-30). A card shows the actions
// that hang off it. An ACTION SURFACE — the actions card, the escalation
// viewer — shows the whole board's: that is its job, and what it shows
// when opened. Until now the overview gave every tile its own card's
// actions only, so the actions card's tile read "No actions yet" whatever
// the board held. Pure.

import type { LtkAction } from "../../shared/schema/actions";

export interface TileActionSources {
  /** This board's id and everything on it. */
  boardId: string;
  boardActions: LtkAction[];
  /** Other boards a surface here is set to roll up: board id → actions. */
  otherBoards: Map<string, LtkAction[]>;
}

/** The board a surface rolls up: the one it is configured for, else its own. */
export function surfaceBoard(configuredSource: string, boardId: string): string {
  return configuredSource !== "" ? configuredSource : boardId;
}

export function actionsForTile(tile: { surface: boolean; configuredSource: string; instanceKey: string }, from: TileActionSources): LtkAction[] {
  if (!tile.surface) return from.boardActions.filter((a) => a.instanceId === tile.instanceKey);
  const src = surfaceBoard(tile.configuredSource, from.boardId);
  return src === from.boardId ? from.boardActions : (from.otherBoards.get(src) ?? []);
}

/** The other boards this board's surfaces need loading. */
export function otherSurfaceBoards(surfaces: { configuredSource: string }[], boardId: string): string[] {
  return [...new Set(surfaces.map((s) => s.configuredSource).filter((b) => b !== "" && b !== boardId))];
}
