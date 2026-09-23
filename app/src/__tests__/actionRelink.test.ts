// Linking an action to an initiative from a dialog (2026-09-24): the id is
// what the register reads; channel-keyed actions move with the link,
// card-keyed ones keep their card. Quick add's open-board detection too.
import { describe, expect, it } from "vitest";
import { boardChannelKey, isChannelKeyed, newAction, relinkInitiative } from "../../../shared/schema/actions";
import { openBoardId } from "../actions/openBoard";
import { sourceLabel } from "../../../controls/LeanHub/types";

const init = { id: "I1", title: "Reduce changeover", boardId: "init-I1" };
const noBoard = { id: "I2", title: "Lightweight", boardId: "" };

describe("relinkInitiative", () => {
  it("a personal action moves onto the initiative board's channel", () => {
    const a = { ...newAction({ source: "leanhub", sourceId: "" }), instanceId: "hub:u1" };
    relinkInitiative(a, init, "u1");
    expect(a.initiativeId).toBe("I1");
    expect(a.instanceId).toBe("init-I1:board");
  });
  it("an initiative without a board takes the legacy key", () => {
    const a = { ...newAction({ source: "leanhub", sourceId: "" }), instanceId: "hub-u1" };
    relinkInitiative(a, noBoard, "u1");
    expect(a.instanceId).toBe("improvement:I2");
  });
  it("a card-keyed action keeps its card and gains the id", () => {
    const a = { ...newAction({ source: "fivewhys", sourceId: "x" }), instanceId: "BOARD-7:CARD-2" };
    relinkInitiative(a, init, "u1");
    expect(a.initiativeId).toBe("I1");
    expect(a.instanceId).toBe("BOARD-7:CARD-2");
  });
  it("a meeting board's channel action keeps the board", () => {
    const a = { ...newAction({ source: "leanhub", sourceId: "" }), instanceId: "BOARD-7:board" };
    relinkInitiative(a, init, "u1");
    expect(a.instanceId).toBe("BOARD-7:board");
    expect(a.initiativeId).toBe("I1");
  });
  it("unlinking returns a channel action to the personal channel; a card one stays put", () => {
    const a = { ...newAction({ source: "leanhub", sourceId: "" }), instanceId: "init-I1:board", initiativeId: "I1" };
    relinkInitiative(a, null, "u1");
    expect(a.initiativeId).toBeUndefined();
    expect(a.instanceId).toBe("hub:u1");
    const b = { ...newAction({ source: "card", sourceId: "" }), instanceId: "init-I1:CARD-3", initiativeId: "I1" };
    relinkInitiative(b, null, "u1");
    expect(b.initiativeId).toBeUndefined();
    expect(b.instanceId).toBe("init-I1:CARD-3");
  });
  it("unlinking an unlinked action is a no-op", () => {
    const a = { ...newAction({ source: "leanhub", sourceId: "" }), instanceId: "hub-u1" };
    relinkInitiative(a, null, "u1");
    expect(a.instanceId).toBe("hub-u1");
  });
  it("channel keys", () => {
    expect(isChannelKeyed("")).toBe(true);
    expect(isChannelKeyed("hub:u1")).toBe(true);
    expect(isChannelKeyed("improvement:I1")).toBe(true);
    expect(isChannelKeyed(boardChannelKey("init-I1"))).toBe(true);
    expect(isChannelKeyed(boardChannelKey("B1"))).toBe(false);
    expect(isChannelKeyed("B1:CARD")).toBe(false);
  });
});

describe("quick add destination", () => {
  it("reads the open board from the route", () => {
    expect(openBoardId("#/board/init-I1/2026-09-24")).toBe("init-I1");
    expect(openBoardId("#/board/BOARD-7")).toBe("BOARD-7");
    expect(openBoardId("#/")).toBeNull();
    expect(openBoardId("#/improvement")).toBeNull();
    expect(openBoardId("#/board/")).toBeNull();
  });
  it("the hub labels a board channel by the board's name", () => {
    const labels = { [boardChannelKey("init-I1")]: "Reduce changeover" };
    expect(sourceLabel("init-I1:board", "leanhub", labels, () => undefined)).toBe("Reduce changeover");
  });
});
