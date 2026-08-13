// Document linking (relationships plan L1): the JSON-in-column model.
// The column predates the feature, so the parser's FIRST duty is to
// leave old values meaning what they meant.

import { describe, expect, it } from "vitest";
import {
  DocLink,
  parentCycles,
  parseDocLinks,
  serializeDocLinks,
} from "../docs/model";

const link = (over: Partial<DocLink>): DocLink => ({
  uid: "aaaa-1",
  rel: "parent",
  site: "/sites/Corp",
  listId: "list-1",
  name: "Crane Standard.pdf",
  docId: "STD-1035",
  ...over,
});

describe("parseDocLinks", () => {
  it("round-trips the shape and tolerates missing display fields", () => {
    const s = serializeDocLinks([link({}), link({ uid: "bbbb-2", rel: "peer", name: "" })]);
    const back = parseDocLinks(s)!;
    expect(back).toHaveLength(2);
    expect(back[0].rel).toBe("parent");
    expect(back[1].name).toBe("");
    expect(parseDocLinks('[{"uid":"x","rel":"child"}]')![0].site).toBe("");
  });
  it("legacy and broken content parses to NULL, never to links", () => {
    // the pre-feature convention: URLs / references in free text
    expect(parseDocLinks("https://x/y.pdf; STD-22")).toBeNull();
    expect(parseDocLinks("")).toBeNull();
    expect(parseDocLinks("[not json")).toBeNull();
    expect(parseDocLinks('{"uid":"x"}')).toBeNull(); // an object is not a list
  });
  it("drops entries without an anchor or with an unknown rel", () => {
    const got = parseDocLinks(
      '[{"uid":"","rel":"parent"},{"uid":"x","rel":"boss"},{"uid":"y","rel":"peer"}]'
    )!;
    expect(got).toHaveLength(1);
    expect(got[0].uid).toBe("y");
  });
});

describe("serializeDocLinks", () => {
  it("dedupes by (uid, rel) keeping the newest display, groups by rel", () => {
    const s = serializeDocLinks([
      link({ uid: "b", rel: "child" }),
      link({ uid: "a", rel: "peer", name: "old" }),
      link({ uid: "A", rel: "peer", name: "new" }), // same anchor, case-blind
      link({ uid: "c", rel: "parent" }),
    ]);
    const back = parseDocLinks(s)!;
    expect(back.map((l) => l.rel)).toEqual(["parent", "peer", "child"]);
    expect(back.filter((l) => l.rel === "peer")).toHaveLength(1);
    expect(back.find((l) => l.rel === "peer")!.name).toBe("old"); // first kept
  });
  it("the same document may be parent AND peer — different questions", () => {
    const back = parseDocLinks(
      serializeDocLinks([link({ uid: "a", rel: "parent" }), link({ uid: "a", rel: "peer" })])
    )!;
    expect(back).toHaveLength(2);
  });
});

describe("parentCycles", () => {
  const doc = (uid: string, name: string, parents: string[]) => ({
    uid,
    name,
    links: parents.map((p) => link({ uid: p, rel: "parent" as const })),
  });
  it("finds a mutual pair and a longer loop, reported once", () => {
    const cycles = parentCycles([
      doc("a", "A", ["b"]),
      doc("b", "B", ["a"]),
      doc("c", "C", ["d"]),
      doc("d", "D", ["e"]),
      doc("e", "E", ["c"]),
      doc("f", "F", ["a"]), // points INTO a cycle but is not part of one
    ]);
    expect(cycles).toHaveLength(2);
    expect(cycles.some((c) => c.line.includes("A") && c.line.includes("B"))).toBe(true);
    expect(cycles.some((c) => c.line.includes("C") && c.line.includes("E"))).toBe(true);
  });
  it("a healthy tree and links leaving the corpus report nothing", () => {
    expect(
      parentCycles([doc("a", "A", ["b"]), doc("b", "B", ["outside"]), doc("c", "C", [])])
    ).toEqual([]);
  });
});
