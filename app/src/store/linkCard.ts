// LinkCard resolution — a LinkCard renders ANOTHER board's card, read-only,
// by mounting that card's real type with the SOURCE's ids and settings
// (which is what makes linked series cards work: they read the source's
// series rows). This module finds the source slot and decides which stored
// document it should render.

import { LINK_SOURCE_EXCLUDED } from "../../../controls/CardSettings/registry";
import { getBoard } from "./boards";
import { rowsForBoard } from "./cards";
import { listInstances } from "./instances";
import { ManifestSlot, parseManifest, slotPolicy } from "./mappers";
import { pickLinkContent, pickLinkIndex } from "./policies";

export interface LinkTarget {
  boardName: string;
  slot: ManifestSlot;
  outputJson: string;
  /**
   * The meeting whose content is being shown, ISO datetime — so the card can
   * say WHICH occurrence a viewer is looking at, and link straight to it.
   * "" when the content is the source's live document (a shared card, or a
   * template with no meeting behind it yet), which belongs to no occurrence.
   */
  instanceWhen: string;
}

export type LinkTargetFailure = "missing" | "excluded";

/** Resolve a LinkCard's source: the slot, its board's name, its content. */
export async function loadLinkTarget(
  srcBoardId: string,
  srcCardId: string
): Promise<LinkTarget | LinkTargetFailure> {
  const board = await getBoard(srcBoardId);
  if (!board) return "missing";
  const slot = parseManifest(board.manifestRaw).slots.find(
    (s) => s.cardId === srcCardId
  );
  if (!slot) return "missing";
  // no chains, no embeds, no action surfaces — same set the picker offers
  if (LINK_SOURCE_EXCLUDED.has(slot.cardType)) return "excluded";

  const rows = await rowsForBoard(srcBoardId);
  const liveJson =
    rows.find((r) => r.cardId === srcCardId && r.instanceId === "")?.outputJson ?? "";
  const policy = slotPolicy(slot);
  let newestFirst: string[] = [];
  /** Each candidate document's meeting datetime, in the same order. */
  let whens: string[] = [];
  if (policy !== "shared") {
    // rank this card's instance rows by their meeting's datetime
    const order = new Map(
      (await listInstances(srcBoardId)).map((i) => [i.id, i.when])
    );
    const ranked = rows
      .filter((r) => r.cardId === srcCardId && r.instanceId !== "")
      .sort((a, b) =>
        (order.get(b.instanceId) ?? "").localeCompare(order.get(a.instanceId) ?? "")
      );
    newestFirst = ranked.map((r) => r.outputJson);
    whens = ranked.map((r) => order.get(r.instanceId) ?? "");
  }
  // the same decision drives both, so the datetime shown always belongs to
  // the content actually rendered
  const chosen = pickLinkIndex(policy, newestFirst);
  return {
    boardName: board.name,
    slot,
    outputJson: pickLinkContent(policy, liveJson, newestFirst),
    instanceWhen: chosen >= 0 ? (whens[chosen] ?? "") : "",
  };
}
