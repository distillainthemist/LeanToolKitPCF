import { describe, expect, it } from "vitest";
import {
  cellsFromRatings,
  diffRatings,
  docKey,
  instanceDay,
  monthWindow,
  ratingsFromCells,
  splitDocKey,
} from "../store/seriesMap";

describe("doc key ↔ cell", () => {
  it("splits day, shift and week keys", () => {
    expect(splitDocKey("S|2026-07-25")).toEqual({ key: "S", date: "2026-07-25", shift: "-" });
    expect(splitDocKey("Staffing|2026-07-25|N")).toEqual({
      key: "Staffing",
      date: "2026-07-25",
      shift: "N",
    });
    // a week row keys by its Monday — same shape
    expect(splitDocKey("Equipment|2026-07-20")).toEqual({
      key: "Equipment",
      date: "2026-07-20",
      shift: "-",
    });
  });

  it("keeps pipes inside the entity name", () => {
    expect(splitDocKey("A|B|2026-07-25|D")).toEqual({ key: "A|B", date: "2026-07-25", shift: "D" });
  });

  it("rejects unusable keys", () => {
    expect(splitDocKey("nodate")).toBeNull();
    expect(splitDocKey("|2026-07-25")).toBeNull();
    expect(splitDocKey("S|25-07-2026")).toBeNull();
  });

  it("round-trips through docKey", () => {
    for (const k of ["S|2026-07-25", "Staffing|2026-07-25|N", "A|B|2026-07-01|D"]) {
      expect(docKey(splitDocKey(k)!)).toBe(k);
    }
  });
});

describe("ratings ↔ cells", () => {
  it("round-trips a mixed map and skips junk", () => {
    const ratings = {
      "S|2026-07-24": "good",
      "Q|2026-07-24|D": "issue",
      "Q|2026-07-24|N": "good",
      junk: "good",
      "P|2026-07-24": "",
    };
    const cells = cellsFromRatings(ratings);
    expect(cells).toHaveLength(3);
    expect(ratingsFromCells(cells)).toEqual({
      "S|2026-07-24": "good",
      "Q|2026-07-24|D": "issue",
      "Q|2026-07-24|N": "good",
    });
  });
});

describe("diffRatings", () => {
  it("puts new + changed, deletes vanished and blanked", () => {
    const prev = { "S|2026-07-24": "good", "Q|2026-07-24": "issue", "D|2026-07-24": "good" };
    const next = { "S|2026-07-24": "good", "Q|2026-07-24": "good", "P|2026-07-24": "issue", "D|2026-07-24": "" };
    const { put, del } = diffRatings(prev, next);
    expect(put.map(docKey).sort()).toEqual(["P|2026-07-24", "Q|2026-07-24"]);
    expect(del.map(docKey)).toEqual(["D|2026-07-24"]);
  });

  it("is empty for identical maps", () => {
    const m = { "S|2026-07-24|D": "good" };
    const { put, del } = diffRatings(m, { ...m });
    expect(put).toEqual([]);
    expect(del).toEqual([]);
  });
});

describe("windows", () => {
  it("instanceDay slices the instance datetime, falls back to today", () => {
    expect(instanceDay("2026-07-23T06:00:00Z")).toBe("2026-07-23");
    expect(instanceDay("")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("monthWindow spans the instance's month", () => {
    expect(monthWindow("2026-07-23")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthWindow("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
