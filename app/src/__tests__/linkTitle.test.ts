// A linked card names its source in its own title bar (the grey band above
// the card is gone), and the datetime it shows must belong to the content it
// is actually rendering.

import { describe, expect, it } from "vitest";
import { linkTitle, whenLabel } from "../linkTitle";
import { pickLinkContent, pickLinkIndex } from "../store/policies";

describe("whenLabel", () => {
  it("reads as a date a person would say out loud", () => {
    const label = whenLabel("2026-07-25T06:00:00");
    expect(label).toMatch(/Sat/); // 25 Jul 2026 is a Saturday
    expect(label).toMatch(/Jul/);
    expect(label).toMatch(/25/);
  });

  it("an unparseable or absent datetime yields nothing, not 'Invalid Date'", () => {
    expect(whenLabel("")).toBe("");
    expect(whenLabel("not a date")).toBe("");
  });
});

describe("linkTitle", () => {
  it("says what it is, which board, and which occurrence", () => {
    expect(linkTitle("Safety Cross", "Bottling line standup", "2026-07-25T06:00:00")).toMatch(
      /^Safety Cross · Bottling line standup · .+/
    );
  });

  it("a shared source has no occurrence of its own, so it reads 'current'", () => {
    expect(linkTitle("Site risks", "Ops review", "")).toBe(
      "Site risks · Ops review · current"
    );
  });
});

describe("pickLinkIndex agrees with pickLinkContent", () => {
  const cases: [string, "clear" | "carry" | "shared", string, string[]][] = [
    ["shared reads the live row", "shared", "LIVE", ["NEWEST", "OLDER"]],
    ["carry takes the newest non-empty meeting", "carry", "LIVE", ["NEWEST", "OLDER"]],
    ["carry skips an untouched newest", "carry", "LIVE", ["", "OLDER"]],
    ["nothing stored falls back to the template", "carry", "LIVE", ["", ""]],
    ["no meetings at all", "clear", "LIVE", []],
  ];

  for (const [name, policy, live, list] of cases) {
    it(name, () => {
      const idx = pickLinkIndex(policy, list);
      const content = pickLinkContent(policy, live, list);
      // the index must point at the content, or say "not from a meeting"
      expect(idx >= 0 ? list[idx] : live).toBe(content);
    });
  }

  it("the index is what dates the title", () => {
    // newest meeting is empty, so the card shows the older one — and must
    // therefore be labelled with the OLDER meeting's datetime
    const whens = ["2026-07-25T06:00:00", "2026-07-24T06:00:00"];
    const idx = pickLinkIndex("carry", ["", "OLDER"]);
    expect(idx).toBe(1);
    expect(whens[idx]).toBe("2026-07-24T06:00:00");
  });
});

describe("where the jump button goes", () => {
  it("an instance-backed link opens that occurrence; a shared one opens the latest", async () => {
    const { boardHash, LATEST } = await import("../links");
    // the card shows a specific meeting → link straight to it
    expect(boardHash("board-x", "2026-07-25T06:00:00")).toBe(
      `#/board/board-x/${encodeURIComponent("2026-07-25T06:00:00")}`
    );
    // a shared source has no occurrence, so the ritual's latest is the
    // honest destination
    expect(boardHash("board-x", "")).toBe(`#/board/board-x/${LATEST}`);
  });
});
