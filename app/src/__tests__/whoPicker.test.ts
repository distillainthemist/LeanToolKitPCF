// Who a picker offers (2026-09-30): the board's own people up front,
// capped, everyone else behind the search — and a design surface with
// nobody of its own is search only, never a wall of every user.
import { describe, expect, it } from "vitest";
import { assigneePeople, splitWho, WHO_CHIP_CAP } from "../../../shared/schema/people";

const roster = Array.from({ length: 60 }, (_, n) => ({ whoId: `r${n}`, who: `Person ${String(n).padStart(2, "0")}` }));
const own = [{ whoId: "r7", who: "Person 07" }, { whoId: "x1", who: "Olive Owner" }];

describe("assigneePeople", () => {
  it("puts the board's own people up front and the rest behind the search", () => {
    const p = assigneePeople(own, roster);
    expect(p.filter((x) => x.secondary !== true).map((x) => x.whoId)).toEqual(["r7", "x1"]);
    expect(p.filter((x) => x.secondary === true)).toHaveLength(59);
    expect(p.filter((x) => x.whoId === "r7")).toHaveLength(1);
  });
  it("with nobody of its own: the whole roster up front by default (the old behaviour)", () => {
    expect(assigneePeople([], roster).every((x) => x.secondary !== true)).toBe(true);
  });
  it("with nobody of its own on a design surface: everyone behind the search", () => {
    const p = assigneePeople([], roster, "search");
    expect(p).toHaveLength(60);
    expect(p.every((x) => x.secondary === true)).toBe(true);
  });
});

describe("splitWho", () => {
  it("shows the board's own people, and searches the rest", () => {
    const { upFront, behindSearch } = splitWho(assigneePeople(own, roster));
    expect(upFront.map((x) => x.whoId)).toEqual(["r7", "x1"]);
    expect(behindSearch).toHaveLength(59);
  });
  it("caps what is up front — the overflow is searchable, nobody is lost", () => {
    const { upFront, behindSearch } = splitWho(assigneePeople([], roster));
    expect(upFront).toHaveLength(WHO_CHIP_CAP);
    expect(behindSearch).toHaveLength(60 - WHO_CHIP_CAP);
    expect(new Set([...upFront, ...behindSearch].map((x) => x.whoId)).size).toBe(60);
  });
  it("a template's picker opens on the search alone", () => {
    const { upFront, behindSearch } = splitWho(assigneePeople([], roster, "search"));
    expect(upFront).toEqual([]);
    expect(behindSearch).toHaveLength(60);
  });
});
