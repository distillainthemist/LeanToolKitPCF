// The tilesJSON join, as pure logic (docs/board-app-build.md §4 in TS):
// manifest slots ⋈ this instance's Card Data rows, with the svg fallback
// chain per policy — instance row → (shared) live row → catalog default →
// BoardGrid's own typed placeholder (empty string here).

import type { BoardTile } from "../../../controls/BoardGrid/types";
import { ManifestSlot, slotPolicy } from "./mappers";

export interface CardRowLite {
  cardId: string;
  /** "" = the live (instance-less) row of a shared card. */
  instanceId: string;
  tileSvg: string;
}

export function joinTiles(
  slots: ManifestSlot[],
  instanceId: string,
  cardRows: CardRowLite[],
  catalogSvgByType: Record<string, string>
): BoardTile[] {
  const instanceRow = (cardId: string) =>
    cardRows.find((r) => r.cardId === cardId && r.instanceId === instanceId);
  const liveRow = (cardId: string) =>
    cardRows.find((r) => r.cardId === cardId && r.instanceId === "");

  return slots.map((slot) => {
    const theme = (slot.settings.theme ?? {}) as Record<string, unknown>;
    const own = instanceRow(slot.cardId)?.tileSvg ?? "";
    const live =
      slotPolicy(slot) === "shared" ? (liveRow(slot.cardId)?.tileSvg ?? "") : "";
    const fallback = catalogSvgByType[slot.cardType] ?? "";
    // neither this meeting's row nor a shared card's live row held a tile,
    // so nothing was ever saved here and the fallback art is generic
    const noData = own === "" && live === "";
    return {
      pos: slot.pos,
      w: slot.w,
      h: slot.h,
      nav: slot.nav,
      noData,
      cardId: slot.cardId,
      cardType: slot.cardType,
      title: slot.title,
      barColor: typeof theme.titlebar === "string" ? theme.titlebar : "",
      svg: own !== "" ? own : live !== "" ? live : fallback,
    };
  });
}

/**
 * Whether a board should render LIVE tiles rather than its stored snapshots.
 *
 * Live rendering shows the data as it is NOW. That is right for the meeting
 * in progress and wrong for one that has finished: closeInstance() stamps
 * each card's snapshot onto the instance row precisely so that reopening a
 * past meeting shows what it showed at the time. Rendering a closed meeting
 * live would silently replace that record with today's numbers — and worse,
 * a future styling change would retroactively alter what past meetings
 * appear to have said.
 *
 * So: open meeting → live (subject to the flag); closed → the archive.
 * A board with no instance selected has nothing to render live either.
 */
export function liveTilesEnabled(
  flagOn: boolean,
  instanceStatus: "open" | "closed" | undefined
): boolean {
  return flagOn && instanceStatus === "open";
}

/**
 * Whether an embed card should load with the board rather than waiting to be
 * opened. Preloading is the default — it is the point of live tiles — but a
 * wall of sign-in-protected Power BI reports all loading at once is worse
 * than one loading on demand, so a card can opt out (`deferLoad`).
 */
export function embedPreloadEnabled(settings: Record<string, unknown>): boolean {
  const config = settings.config;
  if (!config || typeof config !== "object") return true;
  return (config as Record<string, unknown>).deferLoad !== true;
}
