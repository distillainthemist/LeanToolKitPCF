// LinkCard content resolution (card-settings plan, phase 4): which stored
// document a linked card renders, per the source's own data policy.

import { describe, expect, it } from "vitest";
import { pickLinkContent } from "../store/policies";

describe("pickLinkContent", () => {
  it("a shared source's truth is its live row — even when empty", () => {
    expect(pickLinkContent("shared", "LIVE", ["NEWEST", "OLDER"])).toBe("LIVE");
    expect(pickLinkContent("shared", "", ["NEWEST"])).toBe("");
  });

  it("a carry source's truth is its newest non-empty meeting content", () => {
    expect(pickLinkContent("carry", "LIVE", ["NEWEST", "OLDER"])).toBe("NEWEST");
    // the latest meeting exists but its card is untouched — fall back to
    // the most recent meeting that actually holds content
    expect(pickLinkContent("carry", "LIVE", ["", "OLDER"])).toBe("OLDER");
  });

  it("before any meeting has content, the template (live row) shows", () => {
    expect(pickLinkContent("carry", "LIVE", ["", ""])).toBe("LIVE");
    expect(pickLinkContent("clear", "LIVE", [])).toBe("LIVE");
  });
});
