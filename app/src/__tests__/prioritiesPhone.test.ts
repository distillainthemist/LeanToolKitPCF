// Priorities on a phone (mobile review M3): the org select's options —
// every node of the tree in order, indented by depth.

import { describe, expect, it } from "vitest";
import { buildTree, orgSelectOptions } from "../priorities/dialogs";

describe("orgSelectOptions", () => {
  const tree = buildTree(
    JSON.stringify([
      { site: "Bell Bay", departments: [{ department: "Casting", areas: ["Line 1"] }, { department: "Rodding", areas: [] }] },
      { site: "Portland", departments: [] },
    ]),
    { "Bell Bay": "Alcoa", Portland: "Alcoa" },
    ["Alcoa"]
  );
  it("lists company, sites, departments and areas in tree order, indented", () => {
    const opts = orgSelectOptions(tree);
    expect(opts.map((o) => o.key.split("|").filter((s) => s !== "").pop())).toEqual([
      "Alcoa", "Bell Bay", "Casting", "Line 1", "Rodding", "Portland",
    ]);
    expect(opts.map((o) => o.depth)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(opts[0].label).toBe("Alcoa");
    expect(opts[2].label).toBe("\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Casting");
  });
  it("is empty for an empty tree", () => {
    expect(orgSelectOptions({ companies: [] })).toEqual([]);
  });
});
