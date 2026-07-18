// The new-instance data policies and the close-meeting archive, as pure
// decisions (docs/master-leanboard.md, unit tested). The IO layer executes
// what these return.

import { ManifestSlot, slotLinkSource, slotPolicy } from "./mappers";

/** What instance creation must do for one slot. */
export interface SeedPlan {
  cardId: string;
  cardType: string;
  policy: "clear" | "carry" | "shared" | "link";
  /** Copy outputJSON + tilesvg from the same card in the previous instance. */
  copyFromPrevious: boolean;
  /** Read the latest output of another board's card as the seed. */
  linkSource: { boardId: string; cardId: string } | null;
  /** Ensure the board-level live row exists (never copied into). */
  ensureLiveRow: boolean;
}

export function seedPlan(slot: ManifestSlot): SeedPlan {
  const policy = slotPolicy(slot);
  const link = policy === "link" ? slotLinkSource(slot) : null;
  return {
    cardId: slot.cardId,
    cardType: slot.cardType,
    policy,
    copyFromPrevious: policy === "carry",
    linkSource: link && link.cardId !== "" ? link : null,
    ensureLiveRow: policy === "shared",
  };
}

/**
 * Close-meeting: which slots must have the live row's CURRENT tile svg
 * stamped onto this instance's row — the per-meeting SVG archive for
 * shared cards.
 */
export function archiveSlots(slots: ManifestSlot[]): string[] {
  return slots.filter((s) => slotPolicy(s) === "shared").map((s) => s.cardId);
}

/**
 * Action surfaces (ActionBoard / EscalationViewer) render the live actions
 * table and take no document seed.
 */
export function isActionSurface(slot: ManifestSlot): boolean {
  return slot.cardType === "ActionBoard" || slot.cardType === "EscalationViewer";
}
