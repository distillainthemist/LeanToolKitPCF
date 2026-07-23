import { describe, expect, it } from "vitest";
import { latestInstanceIso } from "../links";

const NOW = Date.parse("2026-07-23T09:00:00Z");

describe("latestInstanceIso", () => {
  it("picks the most recent meeting at or before now", () => {
    const iso = latestInstanceIso(
      [
        { when: "2026-07-21T06:00:00Z" },
        { when: "2026-07-23T06:00:00Z" },
        { when: "2026-07-22T06:00:00Z" },
        { when: "2026-07-24T06:00:00Z" },
      ],
      NOW
    );
    expect(iso).toBe("2026-07-23T06:00");
  });

  it("falls forward to the next meeting when none have happened", () => {
    const iso = latestInstanceIso(
      [{ when: "2026-07-30T06:00:00Z" }, { when: "2026-07-25T06:00:00Z" }],
      NOW
    );
    expect(iso).toBe("2026-07-25T06:00");
  });

  it("returns nothing for a ritual with no records", () => {
    expect(latestInstanceIso([], NOW)).toBe("");
  });

  it("ignores unparseable dates", () => {
    const iso = latestInstanceIso(
      [{ when: "not a date" }, { when: "2026-07-20T06:00:00Z" }],
      NOW
    );
    expect(iso).toBe("2026-07-20T06:00");
  });
});
