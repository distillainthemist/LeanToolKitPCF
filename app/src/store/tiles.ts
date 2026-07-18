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
    return {
      pos: slot.pos,
      w: slot.w,
      h: slot.h,
      nav: slot.nav,
      cardId: slot.cardId,
      cardType: slot.cardType,
      title: slot.title,
      barColor: typeof theme.titlebar === "string" ? theme.titlebar : "",
      svg: own !== "" ? own : live !== "" ? live : fallback,
    };
  });
}
