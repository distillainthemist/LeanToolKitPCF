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

import {
  cellsFromPoints,
  diffPoints,
  pointsFromCells,
  trailingWindow,
} from "../store/seriesMap";

describe("KPI points ↔ cells", () => {
  it("round-trips and date-sorts", () => {
    const cells = cellsFromPoints([
      { id: "k2", date: "2026-07-20", value: 95 },
      { id: "k1", date: "2026-07-10", value: 92.5 },
    ]);
    expect(pointsFromCells(cells)).toEqual([
      { id: "k1", date: "2026-07-10", value: 92.5 },
      { id: "k2", date: "2026-07-20", value: 95 },
    ]);
  });

  it("skips junk points and non-numeric cells", () => {
    expect(cellsFromPoints([{ id: "", date: "2026-07-10", value: 1 }])).toEqual([]);
    expect(
      pointsFromCells([{ key: "k1", date: "2026-07-10", shift: "-", value: "abc" }])
    ).toEqual([]);
  });
});

describe("diffPoints", () => {
  const prev = [
    { id: "k1", date: "2026-07-10", value: 92 },
    { id: "k2", date: "2026-07-11", value: 95 },
    { id: "k3", date: "2026-07-12", value: 97 },
  ];

  it("upserts a changed value in place", () => {
    const { put, del } = diffPoints(prev, [
      { ...prev[0], value: 93 },
      prev[1],
      prev[2],
    ]);
    expect(put).toEqual([{ key: "k1", date: "2026-07-10", shift: "-", value: "93" }]);
    expect(del).toEqual([]);
  });

  it("a changed date deletes the old row and writes the new", () => {
    const { put, del } = diffPoints(prev, [
      { ...prev[0], date: "2026-07-09" },
      prev[1],
      prev[2],
    ]);
    expect(del).toEqual([{ key: "k1", date: "2026-07-10", shift: "-", value: "" }]);
    expect(put).toEqual([{ key: "k1", date: "2026-07-09", shift: "-", value: "92" }]);
  });

  it("a removed point deletes; a new one puts", () => {
    const { put, del } = diffPoints(prev, [
      prev[0],
      prev[2],
      { id: "k4", date: "2026-07-13", value: 99 },
    ]);
    expect(del).toEqual([{ key: "k2", date: "2026-07-11", shift: "-", value: "" }]);
    expect(put).toEqual([{ key: "k4", date: "2026-07-13", shift: "-", value: "99" }]);
  });

  it("empty baseline puts everything (the migration-by-edit path)", () => {
    const { put, del } = diffPoints([], prev);
    expect(put).toHaveLength(3);
    expect(del).toEqual([]);
  });
});

describe("trailingWindow", () => {
  it("spans N days inclusive ending on the day", () => {
    expect(trailingWindow("2026-07-23", 7)).toEqual({ from: "2026-07-17", to: "2026-07-23" });
    expect(trailingWindow("2026-03-05", 91)).toEqual({ from: "2025-12-05", to: "2026-03-05" });
  });
});
