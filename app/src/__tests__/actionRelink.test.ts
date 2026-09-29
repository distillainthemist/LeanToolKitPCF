// What an action is linked to (2026-09-29): nothing, ONE ritual or ONE
// initiative. The link is read from the instance key and the initiative
// id, applied exclusively, and searched across both kinds.
import { describe, expect, it } from "vitest";
import { boardChannelKey, newAction } from "../../../shared/schema/actions";
import { applyLink, currentLink, homeBoardOf, homeCardOf, isCardKeyed, linkChanges, linkLabel, LinkTarget, searchLinkTargets, suggestLinkTargets } from "../../../shared/schema/actionLinks";
import { openBoardId, openCardKey } from "../actions/openBoard";
import { sourceLabel } from "../../../controls/LeanHub/types";

const t = (over: Partial<LinkTarget>): LinkTarget => ({ kind: "ritual", id: "B1", boardId: "B1", title: "Daily production meeting", detail: "Bottling / Line 2 · Tier 1 · Jane Smith", keywords: "Sam Lee", mine: false, near: false, cards: { C1: "Actions", C2: "Safety cross" }, ...over });
const ritual = t({});
const weekly = t({ id: "B2", boardId: "B2", title: "Weekly site review", detail: "Bottling · Tier 2 · Ann Ray", keywords: "", mine: true, cards: {} });
const init = t({ kind: "initiative", id: "I1", boardId: "init-I1", title: "Reduce changeover", detail: "Bottling / Packaging · Jane Smith", keywords: "A3 Tom Hall", cards: { K1: "Charter" } });
const bare = t({ kind: "initiative", id: "I2", boardId: "", title: "Lightweight fix", detail: "Bottling", keywords: "", cards: {} });
const all = [ritual, weekly, init, bare];
const act = (instanceId: string, initiativeId?: string) => ({ ...newAction({ source: "fivewhys", sourceId: "x" }), instanceId, ...(initiativeId ? { initiativeId } : {}) });

describe("instance keys", () => {
  it("name a board and a card, a channel, or neither", () => {
    expect(homeBoardOf("B1:C1")).toBe("B1");
    expect(homeCardOf("B1:C1")).toBe("C1");
    expect(homeCardOf(boardChannelKey("B1"))).toBe("");
    expect(homeBoardOf("hub:u1")).toBe("");
    expect(homeBoardOf("hub-u1")).toBe("");
    expect(homeBoardOf("improvement:I2")).toBe("");
    expect(homeBoardOf("")).toBe("");
    expect(isCardKeyed("B1:C1")).toBe(true);
    expect(isCardKeyed("B1:board")).toBe(false);
    expect(isCardKeyed("hub:u1")).toBe(false);
  });
});

describe("currentLink", () => {
  it("personal keys read as personal", () => {
    expect(currentLink(act("hub:u1"), all).kind).toBe("personal");
    expect(currentLink(act(""), all).kind).toBe("personal");
  });
  it("a card on a ritual's board names the ritual and the card", () => {
    const l = currentLink(act("B1:C2"), all);
    expect(l.kind).toBe("ritual");
    expect(linkLabel(l)).toEqual({ kind: "Ritual", text: "Daily production meeting · Safety cross" });
  });
  it("a ritual's channel names the ritual alone", () => {
    expect(linkLabel(currentLink(act("B1:board"), all)).text).toBe("Daily production meeting");
  });
  it("an initiative reads from the id, the board or the legacy key", () => {
    expect(currentLink(act("init-I1:K1", "I1"), all).cardLabel).toBe("Charter");
    expect(currentLink(act("init-I1:K1"), all).target?.id).toBe("I1");
    expect(currentLink(act("improvement:I2"), all).target?.id).toBe("I2");
  });
  it("an action with no key yet takes the card on screen", () => {
    expect(linkLabel(currentLink(act(""), all, "B1:C1")).text).toBe("Daily production meeting · Actions");
  });
  it("a row carrying both reads as the initiative", () => {
    const l = currentLink(act("B1:C1", "I1"), all);
    expect(l.kind).toBe("initiative");
    expect(l.cardId).toBe("");
  });
  it("a target the viewer is not offered names the kind only — never a title", () => {
    expect(linkLabel(currentLink(act("init-SECRET:K9", "SECRET"), all))).toEqual({ kind: "Initiative", text: "not available to you" });
    expect(linkLabel(currentLink(act("GONE:C1"), all))).toEqual({ kind: "Ritual", text: "not available to you" });
  });
});

describe("applyLink — exclusive", () => {
  it("to an initiative: the id, and the initiative board's channel", () => {
    const a = act("B1:C1");
    applyLink(a, init, "u1");
    expect(a.initiativeId).toBe("I1");
    expect(a.instanceId).toBe("init-I1:board");
    expect(a.context).toEqual({ source: "card", sourceId: "" });
  });
  it("to an initiative without a board: the legacy key", () => {
    const a = act("hub:u1");
    applyLink(a, bare, "u1");
    expect(a.instanceId).toBe("improvement:I2");
  });
  it("to a ritual: the initiative id goes", () => {
    const a = act("init-I1:board", "I1");
    applyLink(a, ritual, "u1");
    expect(a.initiativeId).toBeUndefined();
    expect(a.instanceId).toBe("B1:board");
  });
  it("to nothing: the personal channel, read as Personal on the hub", () => {
    const a = act("init-I1:K1", "I1");
    applyLink(a, null, "u1");
    expect(a.initiativeId).toBeUndefined();
    expect(a.instanceId).toBe("hub:u1");
    expect(sourceLabel(a.instanceId, a.context.source, {}, () => undefined)).toBe("Personal");
  });
});

describe("linkChanges", () => {
  it("the same target changes nothing — unless the action hangs off a card", () => {
    expect(linkChanges(currentLink(act("B1:board"), all), ritual)).toBe(false);
    expect(linkChanges(currentLink(act("B1:C1"), all), ritual)).toBe(true);
    expect(linkChanges(currentLink(act("hub:u1"), all), null)).toBe(false);
    expect(linkChanges(currentLink(act("hub:u1"), all), init)).toBe(true);
    expect(linkChanges(currentLink(act("B1:board"), all), weekly)).toBe(true);
    expect(linkChanges(currentLink(act("GONE:C1"), all), ritual)).toBe(true);
  });
});

describe("search and suggestions", () => {
  it("groups by kind; every word must match somewhere", () => {
    const r = searchLinkTargets(all, "bottling jane");
    expect(r.rituals.map((x) => x.id)).toEqual(["B1"]);
    expect(r.initiatives.map((x) => x.id)).toEqual(["I1"]);
    expect(searchLinkTargets(all, "bottling zzz").rituals).toEqual([]);
  });
  it("matches people and method behind the second line", () => {
    expect(searchLinkTargets(all, "tom hall").initiatives.map((x) => x.id)).toEqual(["I1"]);
    expect(searchLinkTargets(all, "a3").initiatives.map((x) => x.id)).toEqual(["I1"]);
  });
  it("title matches lead, then the viewer's own", () => {
    const many = [t({ id: "X1", boardId: "X1", title: "Review of packaging", detail: "" }), t({ id: "X2", boardId: "X2", title: "Packaging daily", detail: "", mine: true }), t({ id: "X3", boardId: "X3", title: "Line walk", detail: "Packaging" })];
    expect(searchLinkTargets(many, "packaging").rituals.map((x) => x.id)).toEqual(["X2", "X1", "X3"]);
  });
  it("caps each kind and answers nothing for an empty query", () => {
    const many = Array.from({ length: 9 }, (_, n) => t({ id: `R${n}`, boardId: `R${n}`, title: `Meeting ${n}` }));
    expect(searchLinkTargets(many, "meeting").rituals).toHaveLength(5);
    expect(searchLinkTargets(many, "  ").rituals).toEqual([]);
  });
  it("suggests the open board first, then the viewer's own", () => {
    expect(suggestLinkTargets(all, "init-I1").map((x) => x.id)).toEqual(["I1", "B2"]);
    expect(suggestLinkTargets(all, null).map((x) => x.id)).toEqual(["B2"]);
  });
});

describe("the route", () => {
  it("names the open board and card", () => {
    expect(openBoardId("#/board/init-I1/2026-09-24")).toBe("init-I1");
    expect(openBoardId("#/edit/B1/guid-1/C1")).toBe("B1");
    expect(openCardKey("#/edit/B1/guid-1/C1")).toBe("B1:C1");
    expect(openCardKey("#/board/B1/latest")).toBe("");
    expect(openBoardId("#/")).toBeNull();
    expect(openBoardId("#/improvement")).toBeNull();
    expect(openBoardId("#/board/")).toBeNull();
  });
  it("the hub labels a board channel by the board's name", () => {
    expect(sourceLabel("init-I1:board", "card", { [boardChannelKey("init-I1")]: "Reduce changeover" }, () => undefined)).toBe("Reduce changeover");
  });
});
