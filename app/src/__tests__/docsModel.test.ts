// Standard Documents mapping model (plan Phase 1): config round-trips,
// tolerant parsing, SharePoint response mapping, column merge, and the
// org ↔ term set drift report.

import { describe, expect, it } from "vitest";
import {
  emptyLibraryConfig,
  fieldsFromResponse,
  librariesFromLists,
  mergeColumns,
  orgDrift,
  orgTreePaths,
  parseAppDocsConfig,
  parseLibraryConfig,
  serializeAppDocsConfig,
  serializeLibraryConfig,
} from "../docs/model";

describe("library config", () => {
  it("round-trips through serialize/parse", () => {
    const cfg = {
      title: "Standards",
      columns: [
        { internal: "DMSStatus", label: "Status", available: true, inDefault: true, role: "status" },
        { internal: "DMSOwner", label: "", available: false, inDefault: false, role: "owner" },
      ],
      statusColors: { Current: "good", Draft: "neutral" },
      renditionPath: "Renditions",
    };
    expect(parseLibraryConfig(serializeLibraryConfig(cfg))).toEqual(cfg);
  });

  it("serializes sparsely — defaults are omitted", () => {
    const raw = serializeLibraryConfig(emptyLibraryConfig());
    expect(raw).toBe("{}");
    const one = serializeLibraryConfig({
      ...emptyLibraryConfig(),
      columns: [{ internal: "Title", label: "", available: true, inDefault: false, role: "" }],
    });
    expect(JSON.parse(one)).toEqual({ columns: [{ internal: "Title" }] });
  });

  it("never throws on garbage and skips broken entries", () => {
    expect(parseLibraryConfig("not json")).toEqual(emptyLibraryConfig());
    expect(parseLibraryConfig("")).toEqual(emptyLibraryConfig());
    const cfg = parseLibraryConfig(
      JSON.stringify({ columns: [{ label: "no internal" }, { internal: "Ok" }], statusColors: { X: 7, Y: "good" } })
    );
    expect(cfg.columns.map((c) => c.internal)).toEqual(["Ok"]);
    expect(cfg.statusColors).toEqual({ Y: "good" });
  });
});

describe("app docs config", () => {
  it("round-trips and trims the site URL's trailing slash", () => {
    const raw = serializeAppDocsConfig({
      siteUrl: "https://x.sharepoint.com/sites/Dev",
      termGroupId: "g1",
      termGroupName: "DMS",
      orgSetId: "s1",
      orgSetName: "Organisation",
    });
    expect(parseAppDocsConfig(raw).siteUrl).toBe("https://x.sharepoint.com/sites/Dev");
    expect(parseAppDocsConfig('{"siteUrl":"https://x/sites/Dev/"}').siteUrl).toBe(
      "https://x/sites/Dev"
    );
  });
});

describe("SharePoint response mapping", () => {
  it("maps lists to libraries, skipping id-less rows", () => {
    const libs = librariesFromLists({
      value: [
        { Id: "abc", Title: "Documents", ItemCount: 12 },
        { Title: "No id" },
        { Id: "def", Title: "Records" },
      ],
    });
    expect(libs).toEqual([
      { id: "abc", title: "Documents", itemCount: 12 },
      { id: "def", title: "Records", itemCount: 0 },
    ]);
    expect(librariesFromLists(null)).toEqual([]);
  });

  it("maps fields, dropping hidden/system/underscore names", () => {
    const fields = fieldsFromResponse({
      value: [
        { InternalName: "Title", Title: "Name", TypeAsString: "Text" },
        { InternalName: "_Hidden", Title: "x", TypeAsString: "Text" },
        { InternalName: "ContentType", Title: "CT", TypeAsString: "Computed" },
        { InternalName: "Ghost", Title: "g", TypeAsString: "Text", Hidden: true },
        {
          InternalName: "DMSStatus",
          Title: "Status",
          TypeAsString: "Choice",
          Choices: { results: ["Draft", "Current"] },
        },
      ],
    });
    expect(fields.map((f) => f.internal)).toEqual(["Title", "DMSStatus"]);
    expect(fields[1].choices).toEqual(["Draft", "Current"]);
  });

  it("detects managed-metadata columns and their term set automatically", () => {
    // so a maker never declares "this one is managed metadata" — and the
    // colour mapping can read the term set's own values
    const [direct, viaXml, plain] = fieldsFromResponse({
      value: [
        {
          InternalName: "DMSOrgUnit",
          Title: "Organisation unit",
          TypeAsString: "TaxonomyFieldType",
          TermSetId: "11111111-2222-3333-4444-555555555555",
        },
        {
          InternalName: "DMSTags",
          Title: "Tags",
          TypeAsString: "TaxonomyFieldTypeMulti",
          // some responses report the set only inside the schema
          TermSetId: "00000000-0000-0000-0000-000000000000",
          SchemaXml:
            '<Field><Customization><ArrayOfProperty><Property><Name>TermSetId</Name>' +
            "<Value>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</Value></Property>" +
            "</ArrayOfProperty></Customization></Field>",
        },
        { InternalName: "Title", Title: "Name", TypeAsString: "Text" },
      ],
    });
    expect(direct.isTaxonomy).toBe(true);
    expect(direct.termSetId).toBe("11111111-2222-3333-4444-555555555555");
    expect(viaXml.isTaxonomy).toBe(true);
    expect(viaXml.termSetId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(plain.isTaxonomy).toBe(false);
    expect(plain.termSetId).toBe("");
  });

  it("merges stored config over live fields — stored wins, new appends, vanished drops", () => {
    const merged = mergeColumns(
      [
        { internal: "DMSStatus", label: "Status!", available: true, inDefault: true, role: "status" },
        { internal: "Vanished", label: "", available: true, inDefault: false, role: "" },
      ],
      [
        { internal: "Title", title: "Name", type: "Text", choices: [], isTaxonomy: false, termSetId: "" },
        { internal: "DMSStatus", title: "Status", type: "Choice", choices: [], isTaxonomy: false, termSetId: "" },
      ]
    );
    expect(merged.map((c) => c.internal)).toEqual(["DMSStatus", "Title"]);
    expect(merged[0].label).toBe("Status!");
    expect(merged[1]).toEqual({ internal: "Title", label: "", available: true, inDefault: false, role: "" });
  });
});

describe("org drift", () => {
  const APP = [
    { site: "Bell Bay", departments: [{ department: "Casting", areas: ["Line 1"] }] },
  ];

  it("flattens the org tree into paths", () => {
    expect(orgTreePaths(APP)).toEqual([
      ["Bell Bay"],
      ["Bell Bay", "Casting"],
      ["Bell Bay", "Casting", "Line 1"],
    ]);
  });

  it("matches case-insensitively and reports both directions", () => {
    const report = orgDrift(orgTreePaths(APP), [
      ["bell bay"],
      ["Bell Bay", "casting"],
      ["Bell Bay", "Maintenance"],
    ]);
    expect(report.matched).toBe(2);
    expect(report.onlyApp).toEqual([["Bell Bay", "Casting", "Line 1"]]);
    expect(report.onlyTerms).toEqual([["Bell Bay", "Maintenance"]]);
  });

  it("skips leading term levels for a company-rooted set", () => {
    const report = orgDrift(
      orgTreePaths(APP),
      [
        ["PacOps", "Bell Bay"],
        ["PacOps", "Bell Bay", "Casting"],
        ["PacOps", "Bell Bay", "Casting", "Line 1"],
      ],
      1
    );
    expect(report.matched).toBe(3);
    expect(report.onlyApp).toEqual([]);
    expect(report.onlyTerms).toEqual([]);
  });
});
