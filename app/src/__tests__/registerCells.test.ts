// registerCells (doc-cards plan B1): the register's column-set logic,
// extracted from docsScreen so the board's documents card cannot drift
// from the screen. Building the ListColumn array is pure — the cell
// renderers are lazy closures — so the selection/order/narrowing rules
// test without a DOM, which is the suite's convention.

import { describe, expect, it } from "vitest";
import { RegisterCellCtx, buildRegisterColumns } from "../docs/registerCells";
import { SiteDictionary, emptySiteDictionary } from "../docs/model";

function dict(): SiteDictionary {
  const d = emptySiteDictionary();
  d.columns = [
    { internal: "DocType", label: "Document type", role: "docType", available: true, termSetId: "" },
    { internal: "DocOwner", label: "Owner", role: "owner", available: true, termSetId: "" },
    { internal: "DocStatus", label: "Approval status", role: "status", available: true, termSetId: "set-1" },
    { internal: "EffDate", label: "Effective date", role: "effectiveDate", available: true, termSetId: "" },
  ] as SiteDictionary["columns"];
  return d;
}

function ctx(): RegisterCellCtx {
  return {
    dict: dict(),
    states: {},
    labelToId: new Map(),
    statusCol: { internal: "DocStatus", termSetId: "set-1" },
    myEmail: "ben@pecheydistilling.com",
  };
}

const keys = (cols: { key: string }[]): string[] => cols.map((c) => c.key);

describe("buildRegisterColumns", () => {
  it("orders by the dictionary whatever order is asked for, Modified last", () => {
    const cols = buildRegisterColumns(ctx(), {
      wanted: ["EffDate", "Modified", "DocStatus", "DocType"],
      bucket: "full",
    });
    expect(keys(cols)).toEqual(["name", "DocType", "DocStatus", "EffDate", "modified"]);
  });

  it("shows Modified only when the view lists it (Ben, 2026-08-14)", () => {
    const hidden = buildRegisterColumns(ctx(), { wanted: ["DocOwner"], bucket: "full" });
    expect(keys(hidden)).toEqual(["name", "DocOwner"]);
    const shown = buildRegisterColumns(ctx(), {
      wanted: ["DocOwner", "Modified"],
      bucket: "full",
    });
    expect(keys(shown)).toEqual(["name", "DocOwner", "modified"]);
  });

  it("drops the status column first as the pane narrows (mid bucket)", () => {
    const cols = buildRegisterColumns(ctx(), {
      wanted: ["DocType", "DocStatus", "DocOwner", "Modified"],
      bucket: "mid",
    });
    expect(keys(cols)).toEqual(["name", "DocType", "DocOwner", "modified"]);
  });

  it("narrow keeps only name and Modified", () => {
    const cols = buildRegisterColumns(ctx(), {
      wanted: ["DocType", "DocStatus", "DocOwner", "Modified"],
      bucket: "narrow",
    });
    expect(keys(cols)).toEqual(["name", "modified"]);
  });

  it("shows the library column when provided — except narrow", () => {
    const label = () => "Standards";
    const wide = buildRegisterColumns(ctx(), {
      wanted: ["DocType", "Modified"],
      bucket: "full",
      libraryLabel: label,
    });
    expect(keys(wide)).toEqual(["name", "library", "DocType", "modified"]);
    const narrow = buildRegisterColumns(ctx(), {
      wanted: ["DocType", "Modified"],
      bucket: "narrow",
      libraryLabel: label,
    });
    expect(keys(narrow)).toEqual(["name", "modified"]);
  });

  it("appends trailing columns after Modified (the screen's kebab)", () => {
    const cols = buildRegisterColumns(ctx(), {
      wanted: ["Modified"],
      bucket: "full",
      trailing: [{ key: "kebab", label: "", render: () => "" }],
    });
    expect(keys(cols)).toEqual(["name", "modified", "kebab"]);
  });

  it("labels come from the dictionary, internals label themselves", () => {
    const cols = buildRegisterColumns(ctx(), {
      wanted: ["DocType", "Mystery", "Modified"],
      bucket: "full",
    });
    const byKey = new Map(cols.map((c) => [c.key, c.label]));
    expect(byKey.get("DocType")).toBe("Document type");
    // unknown to the dictionary: shown under its internal name, sorted
    // to the end (stable), not dropped — the caller filtered availability
    expect(byKey.get("Mystery")).toBe("Mystery");
    expect(keys(cols)).toEqual(["name", "DocType", "Mystery", "modified"]);
  });
});
