// Standard Documents read experience (plan Phase 2): browse-page and
// search-result parsing, query building, URLs, and the FR-SE-005
// non-current heuristic.

import { describe, expect, it } from "vitest";
import {
  buildBrowseUri,
  buildSearchBody,
  downloadUrlFor,
  embedUrlFor,
  extGlyph,
  extOf,
  formatWhen,
  isNonCurrentStatus,
  openUrlFor,
  parseItemsPage,
  rowsFromSearch,
  thumbnailUrlFor,
  toSiteRelative,
} from "../docs/rows";

const SITE = "https://x.sharepoint.com/sites/Dev";

describe("browse parsing", () => {
  const PAGE = {
    value: [
      {
        Id: 7,
        UniqueId: "{ABC-123}",
        FileRef: "/sites/Dev/Shared Documents/SOP-001.docx",
        FileLeafRef: "SOP-001.docx",
        Modified: "2026-07-20T01:00:00Z",
        FSObjType: 0,
        FieldValuesAsText: {
          "odata.type": "SP.ListItemFieldValues",
          Title: "SOP 001",
          DMSStatus: "Current",
        },
      },
      { FileLeafRef: "", Id: 9 },
    ],
    "odata.nextLink": `${SITE}/_api/web/lists(guid'l1')/items?$skiptoken=Paged%3dTRUE`,
  };

  it("maps items, strips braces, keeps text fields, de-absolutises next", () => {
    const page = parseItemsPage(PAGE, SITE, "L1");
    expect(page.rows).toHaveLength(1);
    const r = page.rows[0];
    expect(r.uniqueId).toBe("abc-123");
    expect(r.ext).toBe("docx");
    expect(r.listId).toBe("l1");
    expect(r.values.DMSStatus).toBe("Current");
    expect(r.values["odata.type"]).toBeUndefined();
    expect(page.next).toBe("_api/web/lists(guid'l1')/items?$skiptoken=Paged%3dTRUE");
  });

  it("browse uri excludes folders and pages by 50", () => {
    const uri = buildBrowseUri("l1");
    expect(uri).toContain("FSObjType eq 0");
    expect(uri).toContain("$top=50");
    expect(uri).toContain("$expand=FieldValuesAsText");
  });

  it("toSiteRelative leaves foreign urls alone", () => {
    expect(toSiteRelative("https://other/x", SITE)).toBe("https://other/x");
  });
});

describe("search", () => {
  it("builds scoped query text with wildcard, doc filter and sort", () => {
    const body = JSON.parse(buildSearchBody("pump", { listId: "l1" }));
    expect(body.request.Querytext).toBe("pump* IsDocument:1 ListID:l1");
    expect(body.request.SortList).toBeUndefined(); // text search = relevance
    const empty = JSON.parse(buildSearchBody("", {}));
    expect(empty.request.Querytext).toBe("IsDocument:1");
    expect(empty.request.SortList.results[0].Property).toBe("LastModifiedTime");
  });

  it("parses the verbose table into rows", () => {
    const raw = {
      d: {
        postquery: {
          PrimaryQueryResult: {
            RelevantResults: {
              TotalRows: 2,
              Table: {
                Rows: {
                  results: [
                    {
                      Cells: {
                        results: [
                          { Key: "Path", Value: `${SITE}/Shared Documents/A.pdf` },
                          { Key: "FileType", Value: "pdf" },
                          { Key: "UniqueId", Value: "{U-1}" },
                          { Key: "ListID", Value: "{L-9}" },
                          { Key: "ListItemID", Value: "4" },
                          { Key: "LastModifiedTime", Value: "2026-07-01T00:00:00Z" },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const page = rowsFromSearch(raw);
    expect(page.total).toBe(2);
    expect(page.rows[0]).toMatchObject({
      name: "A.pdf",
      ext: "pdf",
      uniqueId: "u-1",
      listId: "l-9",
      id: 4,
      serverUrl: "/sites/Dev/Shared Documents/A.pdf",
    });
  });

  it("never throws on junk", () => {
    expect(rowsFromSearch(null)).toEqual({ rows: [], total: 0 });
    expect(rowsFromSearch({ d: {} })).toEqual({ rows: [], total: 0 });
  });
});

describe("presentation helpers", () => {
  const row = {
    id: 1,
    uniqueId: "u-1",
    name: "A.docx",
    ext: "docx",
    serverUrl: "/sites/Dev/Shared Documents/A.docx",
    listId: "l1",
    modified: "",
    values: {},
  };

  it("previews every file type through the modern embed endpoint", () => {
    // Doc.aspx?action=embedview answers an ERROR page for a PDF, and the
    // raw file URL is served as an attachment (browsers refuse to frame
    // it) — probed 2026-07-27. embed.aspx handles both, so there is no
    // per-extension branch left to get wrong.
    const expected = `${SITE}/_layouts/15/embed.aspx?UniqueId=u-1`;
    expect(embedUrlFor(SITE, row)).toBe(expected);
    expect(embedUrlFor(SITE, { ...row, ext: "pdf" })).toBe(expected);
    expect(embedUrlFor(SITE, { ...row, ext: "png" })).toBe(expected);
  });

  it("builds the thumbnail from the absolute path, singly encoded", () => {
    expect(thumbnailUrlFor(SITE, row)).toBe(
      `${SITE}/_layouts/15/getpreview.ashx?path=` +
        encodeURIComponent("https://x.sharepoint.com/sites/Dev/Shared Documents/A.docx")
    );
  });

  it("keeps open and download on their own endpoints", () => {
    expect(openUrlFor(SITE, row)).toBe(
      "https://x.sharepoint.com/sites/Dev/Shared Documents/A.docx?web=1"
    );
    expect(downloadUrlFor(SITE, row)).toBe(
      `${SITE}/_layouts/15/download.aspx?UniqueId=u-1`
    );
  });

  it("classifies non-current statuses", () => {
    expect(isNonCurrentStatus("Draft")).toBe(true);
    expect(isNonCurrentStatus("In Review")).toBe(true);
    expect(isNonCurrentStatus("Superseded")).toBe(true);
    expect(isNonCurrentStatus("Current")).toBe(false);
    expect(isNonCurrentStatus("")).toBe(false);
  });

  it("glyphs and dates degrade gracefully", () => {
    expect(extOf("noext")).toBe("");
    expect(extGlyph("zip")).toBe("📎");
    expect(formatWhen("")).toBe("");
    expect(formatWhen("garbage")).toBe("garbage");
  });
});
