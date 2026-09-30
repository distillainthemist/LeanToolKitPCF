// Which actions a board tile shows (2026-09-30): a card its own, an
// action surface the whole board's.
import { describe, expect, it } from "vitest";
import { boardChannelKey, newAction } from "../../../shared/schema/actions";
import { actionsForTile, otherSurfaceBoards, surfaceBoard } from "../tileActions";

const act = (instanceId: string) => ({ ...newAction({ source: "card", sourceId: "" }), instanceId });
const boardActions = [act("B1:AGENDA"), act("B1:AGENDA"), act("B1:KPI"), act(boardChannelKey("B1")), act("B1:ACTIONS")];
const from = { boardId: "B1", boardActions, otherBoards: new Map([["B9", [act("B9:X"), act("B9:Y")]]]) };

describe("actionsForTile", () => {
  it("a card shows the actions that hang off it", () => {
    expect(actionsForTile({ surface: false, configuredSource: "", instanceKey: "B1:AGENDA" }, from)).toHaveLength(2);
    expect(actionsForTile({ surface: false, configuredSource: "", instanceKey: "B1:CHARTER" }, from)).toEqual([]);
  });
  it("the actions card shows EVERY action on the board — raised on any card, or for the board as a whole", () => {
    const shown = actionsForTile({ surface: true, configuredSource: "", instanceKey: "B1:ACTIONS" }, from);
    expect(shown).toHaveLength(5);
    expect(shown.map((a) => a.instanceId)).toContain("B1:board");
  });
  it("a surface set to show another board shows that board's", () => {
    expect(actionsForTile({ surface: true, configuredSource: "B9", instanceKey: "B1:ACTIONS" }, from).map((a) => a.instanceId)).toEqual(["B9:X", "B9:Y"]);
    expect(actionsForTile({ surface: true, configuredSource: "B7", instanceKey: "B1:ACTIONS" }, from)).toEqual([]);
  });
  it("a surface configured for its own board is its own board", () => {
    expect(actionsForTile({ surface: true, configuredSource: "B1", instanceKey: "B1:ACTIONS" }, from)).toHaveLength(5);
    expect(surfaceBoard("", "B1")).toBe("B1");
    expect(surfaceBoard("B9", "B1")).toBe("B9");
  });
  it("an action for the board as a whole shows on no ordinary card", () => {
    for (const key of ["B1:AGENDA", "B1:KPI"]) {
      expect(actionsForTile({ surface: false, configuredSource: "", instanceKey: key }, from).some((a) => a.instanceId === "B1:board")).toBe(false);
    }
  });
});

describe("otherSurfaceBoards", () => {
  it("names each other board once, never its own", () => {
    expect(otherSurfaceBoards([{ configuredSource: "" }, { configuredSource: "B9" }, { configuredSource: "B9" }, { configuredSource: "B1" }, { configuredSource: "B4" }], "B1")).toEqual(["B9", "B4"]);
  });
});
