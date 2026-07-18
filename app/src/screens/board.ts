// Board screen (Phase 1 slice) — the left-pane MeetingScheduler mounted
// from the board's settings blob, landing pre-selected via selectByIso:
// the deep-link handshake the hub navigation contract promises. The tile
// grid joins in Phase 4.

import { MeetingSchedulerView } from "../../../controls/MeetingScheduler/editor";
import {
  generateInstances,
  parseCategory,
  parseColumns,
  parseCrews,
  parseDaysOfWeek,
  parseDayTopics,
  parseLocalDate,
  parseRosterPattern,
  parseTimeOfDay,
  parseWeekTopics,
  startOfDay,
} from "../../../shared/schema/recurrence";
import { parseMeetingInfo } from "../../../shared/schema/meeting";
import { el } from "../../../shared/ui/dom";
import { appTheme, editorHost } from "../cardHost";
import { BOARDS } from "../demoData";

export function mountBoard(
  parent: HTMLElement,
  boardId: string,
  iso: string
): () => void {
  const board = BOARDS.find((b) => b.boardId === boardId);
  if (!board) {
    parent.appendChild(el("p", "app-missing", `Unknown board: ${boardId}`));
    return () => undefined;
  }
  const blob = board.settingsJSON;
  const raw = JSON.stringify(blob);
  const config = blob.config as Record<string, unknown>;
  const s = (k: string) => String(config[k] ?? "");

  const banner = el("div", "app-board-note");
  banner.textContent =
    `Deep-linked from the hub: ${boardId} @ ${iso} — the tile grid lands here in Phase 4.`;
  parent.appendChild(banner);

  const host = editorHost(parent);
  const view = new MeetingSchedulerView(host, {
    onSelect: (inst, values) =>
      console.log("store: open/create meeting record", inst, values),
  });

  const today = startOfDay(new Date());
  view.setTheme({ ...appTheme(), titleBar: String((blob.theme as any)?.titlebar ?? "") || "#8b1e1e" });
  view.setChrome(String(blob.title ?? boardId), "");
  view.setMeetingInfo(parseMeetingInfo(raw));
  view.setColumns(parseColumns(s("columns")));
  view.setInstances(
    generateInstances(
      {
        finalDate: today,
        daysPrior: Number(config.daysPrior ?? 14),
        category: parseCategory(s("category")),
        daysOfWeek: parseDaysOfWeek(s("daysOfWeek")),
        timeOfDay: parseTimeOfDay(s("timeOfDay")),
        crews: parseCrews(s("crewList")),
        roster: parseRosterPattern(s("rosterPattern")),
        baseStart: parseLocalDate(s("baseStartDate")) ?? today,
        weekTopics: parseWeekTopics(
          Array.isArray(config.weekTopics) ? JSON.stringify(config.weekTopics) : s("weekTopics")
        ),
        dayTopics: parseDayTopics(
          config.dayTopics && typeof config.dayTopics === "object"
            ? JSON.stringify(config.dayTopics)
            : s("dayTopics")
        ),
      },
      [],
      new Date()
    ),
    parseCrews(s("crewList"))
  );
  view.selectByIso(iso);

  return () => view.destroy();
}
