// The new-instance data policies and the close-meeting archive, as pure
// decisions (docs/master-leanboard.md, unit tested). The IO layer executes
// what these return.

import { ManifestSlot, slotPolicy } from "./mappers";

/** What instance creation must do for one slot. */
export interface SeedPlan {
  cardId: string;
  cardType: string;
  policy: "clear" | "carry" | "shared";
  /** Copy outputJSON + tilesvg from the same card in the previous instance. */
  copyFromPrevious: boolean;
  /** Ensure the board-level live row exists (never copied into). */
  ensureLiveRow: boolean;
}

export function seedPlan(slot: ManifestSlot): SeedPlan {
  const policy = slotPolicy(slot);
  return {
    cardId: slot.cardId,
    cardType: slot.cardType,
    policy,
    copyFromPrevious: policy === "carry",
    ensureLiveRow: policy === "shared",
  };
}

/** One close-meeting archive stamp target. */
export interface ArchiveStamp {
  cardId: string;
  /**
   * LinkCard only: copy the SOURCE card's live tile svg rather than this
   * board's own — the record of what the linked card showed at this meeting.
   * null = stamp from this board's live row (shared cards).
   */
  from: { boardId: string; cardId: string } | null;
}

/**
 * Close-meeting: which slots must have a CURRENT tile svg stamped onto this
 * instance's row — shared cards archive their own live row, link cards
 * archive their source's.
 */
export function archiveSlots(slots: ManifestSlot[]): ArchiveStamp[] {
  return slots
    .filter((s) => isLinkCard(s) || slotPolicy(s) === "shared")
    .map((s) => ({
      cardId: s.cardId,
      from: isLinkCard(s) ? linkCardSource(s.settings) : null,
    }));
}

/**
 * Action surfaces (ActionBoard / EscalationViewer) render the live actions
 * table and take no document seed.
 */
export function isActionSurface(slot: ManifestSlot): boolean {
  return slot.cardType === "ActionBoard" || slot.cardType === "EscalationViewer";
}

/** LinkCard: no document of its own — a live window onto another board's
 *  card, with an empty instance row kept purely as the archive target. */
export function isLinkCard(slot: ManifestSlot): boolean {
  return slot.cardType === "LinkCard";
}

/** A LinkCard slot's configured source ({boardId, cardId}), else null. */
export function linkCardSource(
  settings: Record<string, unknown>
): { boardId: string; cardId: string } | null {
  const config = (settings.config ?? {}) as Record<string, unknown>;
  const boardId =
    typeof config.sourceBoardId === "string" ? config.sourceBoardId.trim() : "";
  const cardId =
    typeof config.sourceCardId === "string" ? config.sourceCardId.trim() : "";
  return boardId !== "" && cardId !== "" ? { boardId, cardId } : null;
}

/**
 * WHICH of the candidates a LinkCard renders: the index into
 * `newestFirstInstanceJsons`, or -1 when the answer is the live row (a
 * shared source, or nothing stored yet). Kept beside the content rule so the
 * two cannot disagree — the datetime a linked card shows has to belong to
 * the content it is actually rendering.
 */
export function pickLinkIndex(
  policy: "clear" | "carry" | "shared",
  newestFirstInstanceJsons: string[]
): number {
  if (policy === "shared") return -1;
  return newestFirstInstanceJsons.findIndex((j) => j !== "");
}

/**
 * Which document a LinkCard renders (store/linkCard.ts executes this):
 *  - a SHARED source's truth is its live row (series cards land here too,
 *    via slotPolicy's override);
 *  - a carry/clear source's truth is its most recent meeting's content —
 *    newest instance row with a non-empty document — falling back to the
 *    live row (its standard-content template) before any meeting has run.
 */
export function pickLinkContent(
  policy: "clear" | "carry" | "shared",
  liveJson: string,
  newestFirstInstanceJsons: string[]
): string {
  if (policy === "shared") return liveJson;
  return newestFirstInstanceJsons.find((j) => j !== "") ?? liveJson;
}
