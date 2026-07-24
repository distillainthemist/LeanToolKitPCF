import { describe, expect, it } from "vitest";
import { assigneePeople, parsePeople } from "../../../shared/schema/people";

const ROSTER = [
  { whoId: "u-dana", who: "Dana Field", crew: "A" },
  { whoId: "u-riley", who: "Riley Nguyen", crew: "B" },
  { whoId: "u-sam", who: "Sam Patel", crew: "" },
  { whoId: "u-alex", who: "Alex Chen", crew: "A" },
];

describe("assigneePeople", () => {
  it("puts the meeting's people up front and the rest behind search", () => {
    const out = assigneePeople(
      [
        { whoId: "u-sam", who: "Sam Patel" }, // owner
        { whoId: "u-dana", who: "Dana Field", crew: "A" },
      ],
      ROSTER
    );
    expect(out.map((p) => [p.who, p.secondary === true])).toEqual([
      ["Sam Patel", false],
      ["Dana Field", false],
      ["Alex Chen", true], // wider roster, name-sorted
      ["Riley Nguyen", true],
    ]);
  });

  it("dedupes by whoId with the meeting entry winning", () => {
    const out = assigneePeople(
      [{ whoId: "u-dana", who: "Dana Field", crew: "A" }],
      ROSTER
    );
    expect(out.filter((p) => p.whoId === "u-dana")).toHaveLength(1);
    expect(out.find((p) => p.whoId === "u-dana")?.secondary).toBeUndefined();
  });

  it("falls back to the whole roster as chips when the meeting has no people", () => {
    const out = assigneePeople([], ROSTER);
    expect(out).toHaveLength(ROSTER.length);
    expect(out.every((p) => p.secondary === undefined)).toBe(true);
  });

  it("skips blank meeting names and fills initials", () => {
    const out = assigneePeople(
      [{ whoId: "u-x", who: "  " }, { whoId: "u-dana", who: "Dana Field" }],
      ROSTER
    );
    expect(out[0]).toMatchObject({ who: "Dana Field", initials: "DF" });
  });

  it("round-trips the secondary flag through parsePeople", () => {
    const json = JSON.stringify(assigneePeople([{ whoId: "u-sam", who: "Sam Patel" }], ROSTER));
    const back = parsePeople(json);
    expect(back.find((p) => p.whoId === "u-riley")?.secondary).toBe(true);
    expect(back.find((p) => p.whoId === "u-sam")?.secondary).toBeUndefined();
  });
});
