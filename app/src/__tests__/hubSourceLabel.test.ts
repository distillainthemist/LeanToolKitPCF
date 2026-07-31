// Actions group headers (design review Phase 1.4): a raw instance id
// must never reach the screen — label map, then Personal/Other, then
// board-title fallback by prefix, then an honest "Unknown".

import { describe, expect, it } from "vitest";
import { sourceLabel } from "../../../controls/LeanHub/types";

const LABELS = { "BOARD-1:CARD-9": "Assembly standup · Actions" };
const titles = (id: string) =>
  id === "BOARD-1" ? "Assembly standup" : id === "BOARD-2" ? "Casting review" : undefined;

describe("sourceLabel", () => {
  it("uses the host label when the exact key is known", () => {
    expect(sourceLabel("BOARD-1:CARD-9", "board", LABELS, titles)).toBe(
      "Assembly standup · Actions"
    );
  });

  it("falls back to the board title for an unseen card id (the embed-card shape)", () => {
    expect(sourceLabel("BOARD-2:EMBED-abc123", "board", LABELS, titles)).toBe(
      "Casting review · card"
    );
  });

  it("prints Unknown rather than the raw id when nothing matches", () => {
    expect(sourceLabel("BOARD-GONE:EMBED-x", "board", LABELS, titles)).toBe(
      "Unknown board · card"
    );
  });

  it("keeps the Personal and Other semantics", () => {
    expect(sourceLabel("hub-viewer1", "leanhub", LABELS, titles)).toBe("Personal");
    expect(sourceLabel("anything", "leanhub", LABELS, titles)).toBe("Personal");
    expect(sourceLabel("", "board", LABELS, titles)).toBe("Other");
  });
});
