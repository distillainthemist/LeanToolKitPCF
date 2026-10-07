// The BoardGrid's phone list (mobile review M2): the wall's tiles in
// reading order — row by row, left to right — whatever order they were
// placed in, and the width that flips the wall into a list.

import { describe, expect, it } from "vitest";
import { BoardTile, LIST_MAX_WIDTH, layoutBoard, listOrder } from "../../../controls/BoardGrid/types";

const tile = (cardId: string, pos: number, w = 1, h = 1): BoardTile => ({
  pos, cardId, cardType: "StatusTile", title: cardId, svg: "", w, h, barColor: "", nav: 0,
});

describe("listOrder", () => {
  it("reads the wall row by row, left to right", () => {
    // a 3-wide wall: A at 1, C at 3, B at 2 (placed out of order), D on row 2
    const lay = layoutBoard([tile("A", 1), tile("C", 3), tile("B", 2), tile("D", 4)], 3, false);
    expect(listOrder(lay.placed).map((p) => p.tile.cardId)).toEqual(["A", "B", "C", "D"]);
  });
  it("keeps a stretched tile at its anchor's place", () => {
    // W spans two columns from cell 1; X lands at cell 3; Y on the next row
    const lay = layoutBoard([tile("X", 3), tile("W", 1, 2, 1), tile("Y", 4)], 3, false);
    expect(listOrder(lay.placed).map((p) => p.tile.cardId)).toEqual(["W", "X", "Y"]);
  });
  it("leaves the input untouched", () => {
    const lay = layoutBoard([tile("B", 2), tile("A", 1)], 2, false);
    const before = lay.placed.map((p) => p.tile.cardId);
    listOrder(lay.placed);
    expect(lay.placed.map((p) => p.tile.cardId)).toEqual(before);
  });
  it("flips to a list under the same width the register uses", () => {
    expect(LIST_MAX_WIDTH).toBe(600);
  });
});
