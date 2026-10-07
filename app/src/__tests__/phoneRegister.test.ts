// The limited phone register (Tranche D): the pure rules behind the
// phone's three selects — which width is a phone, how a term walk reads
// as options, and what a select shows for the filter on its column.

import { describe, expect, it } from "vitest";
import {
  PHONE_MAX_WIDTH,
  PHONE_SEVERAL,
  isPhoneWidth,
  phoneOptions,
  phoneSelectState,
} from "../docs/phoneRegister";
import type { TermNode } from "../docs/sp";

const walk: TermNode[] = [
  { id: "t-tas", labels: ["Tasmania"] },
  { id: "t-bb-cast-l1", labels: ["Bell Bay", "Casting", "Line 1"] },
  { id: "t-bb", labels: ["Bell Bay"] },
  { id: "t-bb-rod", labels: ["Bell Bay", "Rodding"] },
  { id: "t-bb-cast", labels: ["Bell Bay", "Casting"] },
  { id: "t-bb-cast-l1-bay2", labels: ["Bell Bay", "Casting", "Line 1", "Bay 2"] },
];

describe("isPhoneWidth", () => {
  it("is the register's width under the phone ceiling, never an unmeasured 0", () => {
    expect(isPhoneWidth(375)).toBe(true);
    expect(isPhoneWidth(PHONE_MAX_WIDTH - 1)).toBe(true);
    expect(isPhoneWidth(PHONE_MAX_WIDTH)).toBe(false);
    expect(isPhoneWidth(1280)).toBe(false);
    expect(isPhoneWidth(0)).toBe(false);
  });
});

describe("phoneOptions", () => {
  it("puts parents before children, siblings in label order, and indents by depth", () => {
    const opts = phoneOptions(walk);
    expect(opts.map((o) => o.id)).toEqual(["t-bb", "t-bb-cast", "t-bb-cast-l1", "t-bb-rod", "t-tas"]);
    expect(opts.map((o) => o.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(opts[0].label).toBe("Bell Bay");
    expect(opts[1].label).toBe("   Casting");
    expect(opts[2].label).toBe("      Line 1");
  });
  it("leaves out terms deeper than the cap", () => {
    expect(phoneOptions(walk).some((o) => o.id === "t-bb-cast-l1-bay2")).toBe(false);
    expect(phoneOptions(walk, 1).map((o) => o.id)).toEqual(["t-bb", "t-tas"]);
  });
  it("is empty for an empty walk", () => {
    expect(phoneOptions([])).toEqual([]);
  });
});

describe("phoneSelectState", () => {
  const opts = phoneOptions(walk);
  it("shows Any when nothing is picked", () => {
    expect(phoneSelectState([], opts)).toEqual({ value: "", severalLabel: "" });
  });
  it("shows the one picked term when it is an option", () => {
    expect(phoneSelectState([walk[3]], opts)).toEqual({ value: "t-bb-rod", severalLabel: "" });
  });
  it("names several picks (the approved default) rather than claiming Any", () => {
    const s = phoneSelectState(
      [{ id: "s1", labels: ["Approved"] }, { id: "s2", labels: ["Current"] }],
      [{ id: "s1", label: "Approved", depth: 0 }, { id: "s2", label: "Current", depth: 0 }]
    );
    expect(s).toEqual({ value: PHONE_SEVERAL, severalLabel: "Approved · Current" });
  });
  it("names a pick deeper than the options go", () => {
    expect(phoneSelectState([walk[5]], opts)).toEqual({ value: PHONE_SEVERAL, severalLabel: "Bay 2" });
  });
});
