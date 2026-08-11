// The feed probe's character audit (mobile truncation, 2026-08-11):
// the phone bridge chokes on invisible code points that honest text
// never needs — every offender here is written as an escape, because
// the real characters are exactly the kind an editor hides.

import { describe, expect, it } from "vitest";
import { suspiciousCodePoints } from "../docs/model";

describe("suspiciousCodePoints (feed probe character audit)", () => {
  it("names the invisible troublemakers with their code points", () => {
    expect(suspiciousCodePoints("Port Shiploading")).toEqual(["U+2028"]);
    expect(suspiciousCodePoints("para break")).toEqual(["U+2029"]);
    expect(suspiciousCodePoints("zero​width and BOM﻿")).toEqual(["U+200B", "U+FEFF"]);
    expect(suspiciousCodePoints("bell")).toEqual(["U+0007"]);
    expect(suspiciousCodePoints("C1 control")).toEqual(["U+0085"]);
    expect(suspiciousCodePoints("lone half \ud83d")).toEqual(["U+D83D"]);
  });
  it("repeats an offender once, and passes honest text", () => {
    expect(suspiciousCodePoints("a b c")).toEqual(["U+2028"]);
    // accents, dashes, curly quotes, whole emoji, newlines and tabs are
    // all legitimate — the audit must not cry wolf
    expect(
      suspiciousCodePoints("København – São Paulo — d’accord 😀\nline two\ttab\r\n")
    ).toEqual([]);
    expect(suspiciousCodePoints("")).toEqual([]);
  });
});
