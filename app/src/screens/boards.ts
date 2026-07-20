// Boards list — every non-template board, opening on click.

import { el } from "../../../shared/ui/dom";
import { detectHost } from "../runtime";
import { listBoards } from "../store/boards";

export function mountBoards(parent: HTMLElement): () => void {
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(
        el("div", "app-board-note", "The rituals list needs the Power Apps host.")
      );
      return;
    }
    const boards = await listBoards();
    if (boards.length === 0) {
      parent.appendChild(
        el("div", "app-board-note", "No rituals yet — create one in Settings → Rituals.")
      );
      return;
    }
    const list = el("div", "app-people-list");
    parent.appendChild(list);
    for (const board of boards) {
      const row = el("a", "app-people-row app-boards-row") as HTMLAnchorElement;
      row.href = `#/board/${board.boardId}`;
      row.appendChild(el("span", "app-people-name", board.name));
      row.appendChild(
        el(
          "span",
          "app-people-meta",
          [board.kind, board.site, board.department].filter(Boolean).join(" · ")
        )
      );
      list.appendChild(row);
    }
  })();
  return () => undefined;
}
