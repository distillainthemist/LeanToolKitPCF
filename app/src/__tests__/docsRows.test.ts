// Standard Documents read experience (plan Phase 2): browse-page and
// search-result parsing, query building, URLs, and the FR-SE-005
// non-current heuristic.

import { describe, expect, it } from "vitest";
import {
  buildBrowseUri,
  buildSearchBody,

  extGlyph,
  extOf,
  formatWhen,
  isNonCurrentStatus,
  parseItemsPage,
  pdfDownloadUrlFor,
  pdfViewUrlFor,
  presignedFromItem,
  rowsFromSearch,
  sourceUrlFor,
  taxonomySearchProperty,
  termTreeOrder,
  thumbnailUrlFor,
  toSiteRelative,
  transformPdfUrl,
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
  it("matches names and titles by default, not document contents", () => {
    // full-text search is why "pump" returned every procedure that so much
    // as mentions one; the default is now the narrower, predictable match
    const body = JSON.parse(buildSearchBody("pump", { listIds: ["l1"] }));
    expect(body.request.Querytext).toBe(
      "(Title:pump* OR Filename:pump*) IsDocument:1 ListID:l1"
    );
  });

  it("ANDs each word, so more words narrow rather than widen", () => {
    const body = JSON.parse(buildSearchBody("brand guidelines", { listIds: ["l1"] }));
    expect(body.request.Querytext).toBe(
      "(Title:brand* OR Filename:brand*) (Title:guidelines* OR Filename:guidelines*) " +
        "IsDocument:1 ListID:l1"
    );
  });

  it("searches inside documents only when asked", () => {
    const body = JSON.parse(
      buildSearchBody("pump seal", { listIds: ["l1"], searchContents: true })
    );
    expect(body.request.Querytext).toBe("pump* seal* IsDocument:1 ListID:l1");
  });

  it("strips characters that would change the query's meaning", () => {
    const body = JSON.parse(buildSearchBody('pu"mp (x)', { listIds: ["l1"] }));
    expect(body.request.Querytext).toBe(
      "(Title:pump* OR Filename:pump*) (Title:x* OR Filename:x*) IsDocument:1 ListID:l1"
    );
  });

  it("builds scoped query text with wildcard, doc filter and sort", () => {
    const body = JSON.parse(buildSearchBody("pump", { listIds: ["l1"] }));
    expect(body.request.SortList).toBeUndefined(); // text search = relevance
    const empty = JSON.parse(buildSearchBody("", { listIds: ["l1"] }));
    expect(empty.request.Querytext).toBe("IsDocument:1 ListID:l1");
    expect(empty.request.SortList.results[0].Property).toBe("LastModifiedTime");
  });

  it("ORs several libraries — 'all documents' means all EXPOSED ones", () => {
    const body = JSON.parse(buildSearchBody("", { listIds: ["l1", "l2", "l3"] }));
    expect(body.request.Querytext).toBe(
      "IsDocument:1 (ListID:l1 OR ListID:l2 OR ListID:l3)"
    );
  });

  it("never emits an unscoped query — that would return the whole tenant", () => {
    // measured on the dev site: unscoped 4,543 hits (OneDrive, .loop,
    // site pages) vs 2 in the configured library
    for (const listIds of [[], [""], ["  "]]) {
      expect(JSON.parse(buildSearchBody("pump", { listIds })).request.Querytext).toBe(
        "(Title:pump* OR Filename:pump*) IsDocument:1"
      );
    }
    // …and the transport refuses to send it at all (see data.searchPage)
  });

  it("filters by organisation term via the auto-created taxonomy property", () => {
    // verified on the dev tenant 2026-07-28: owstaxIdOrganisation:<guid>
    // answered with no tenant-admin mapping
    expect(taxonomySearchProperty("Organisation")).toBe("owstaxIdOrganisation");
    expect(taxonomySearchProperty("DMSOrgUnit")).toBe("owstaxIdDMSOrgUnit");
    const one = JSON.parse(
      buildSearchBody("", {
        listIds: ["l1"],
        termFilters: [{ properties: ["owstaxIdOrganisation"], termIds: ["t1"] }],
      })
    );
    expect(one.request.Querytext).toBe("IsDocument:1 ListID:l1 owstaxIdOrganisation:t1");
    // a picked node ORs its subtree — a GUID matches only its exact term
    const subtree = JSON.parse(
      buildSearchBody("pump", {
        listIds: ["l1"],
        termFilters: [{ properties: ["owstaxIdOrganisation"], termIds: ["t1", "t2"] }],
      })
    );
    expect(subtree.request.Querytext).toBe(
      "(Title:pump* OR Filename:pump*) IsDocument:1 ListID:l1 " +
        "(owstaxIdOrganisation:t1 OR owstaxIdOrganisation:t2)"
    );
    // an empty filter contributes nothing rather than a broken clause
    const empty = JSON.parse(
      buildSearchBody("", {
        listIds: ["l1"],
        termFilters: [{ properties: [], termIds: ["t1"] }],
      })
    );
    expect(empty.request.Querytext).toBe("IsDocument:1 ListID:l1");
  });

  it("ANDs filters across columns, ORs terms within one (Phase 3a)", () => {
    const two = JSON.parse(
      buildSearchBody("", {
        listIds: ["l1"],
        termFilters: [
          { properties: ["owstaxIdDMSOrgUnit"], termIds: ["o1", "o2"] },
          { properties: ["owstaxIdDMSProcess"], termIds: ["p1"] },
        ],
      })
    );
    // both clauses present = both must match (KQL terms are ANDed)
    expect(two.request.Querytext).toBe(
      "IsDocument:1 ListID:l1 (owstaxIdDMSOrgUnit:o1 OR owstaxIdDMSOrgUnit:o2) " +
        "owstaxIdDMSProcess:p1"
    );
  });

  it("re-orders a level-by-level term walk into render (depth-first) order", () => {
    // the parallel walk returns levels, which painted Bell Bay's areas
    // indented under Boyne (Ben's screenshot)
    const bfs = [
      { id: "bb", labels: ["Bell Bay"] },
      { id: "bo", labels: ["Boyne"] },
      { id: "c", labels: ["Bell Bay", "Casting"] },
      { id: "m", labels: ["Bell Bay", "Maintenance"] },
      { id: "ca", labels: ["Boyne", "Carbon"] },
    ];
    expect(termTreeOrder(bfs).map((n) => n.id)).toEqual(["bb", "c", "m", "bo", "ca"]);
  });

  it("never confuses 'Bell Bay' with a Bell → Bay path", () => {
    // labels contain spaces, so the parent key must join on a character
    // that cannot appear in one — a space separator would collide here
    const nodes = [
      { id: "1", labels: ["Bell Bay"] },
      { id: "2", labels: ["Bell"] },
      { id: "3", labels: ["Bell", "Bay"] },
      { id: "4", labels: ["Bell", "Bay", "X"] },
      { id: "5", labels: ["Bell Bay", "Y"] },
    ];
    expect(termTreeOrder(nodes).map((n) => n.id)).toEqual(["1", "5", "2", "3", "4"]);
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

  it("builds the thumbnail from the absolute path, singly encoded", () => {
    expect(thumbnailUrlFor(SITE, row)).toBe(
      `${SITE}/_layouts/15/getpreview.ashx?path=` +
        encodeURIComponent("https://x.sharepoint.com/sites/Dev/Shared Documents/A.docx")
    );
  });

  const DRIVE = "b!drive-id";

  it("sends readers to a PDF rendering, never the editable source", () => {
    // an office doc converts on the fly…
    expect(pdfViewUrlFor(SITE, DRIVE, row)).toBe(
      `${SITE}/_api/v2.0/drives/${DRIVE}/items/u-1/content?format=pdf`
    );
    expect(pdfDownloadUrlFor(SITE, DRIVE, row)).toBe(
      `${SITE}/_api/v2.0/drives/${DRIVE}/items/u-1/content?format=pdf`
    );
    // …while a file that IS a pdf cannot be converted (both SharePoint's
    // format=pdf and the media transform answer 406), so it renders
    // through SharePoint's viewer and downloads its own bytes
    const asPdf = { ...row, ext: "pdf" };
    expect(pdfViewUrlFor(SITE, DRIVE, asPdf)).toBe(
      `${SITE}/_layouts/15/embed.aspx?UniqueId=u-1`
    );
    expect(pdfDownloadUrlFor(SITE, DRIVE, asPdf)).toBe(
      `${SITE}/_api/v2.0/drives/${DRIVE}/items/u-1/content`
    );
  });

  it("is drive-scoped — the default drive 404s for any other library", () => {
    // the production bug: `/drive/items/…` (no drive id) addresses only
    // the site's DEFAULT library, so every purpose-made document library
    // answered itemNotFound. Reproduced against a real non-default
    // library on 2026-07-27.
    for (const url of [
      pdfViewUrlFor(SITE, DRIVE, row),
      pdfDownloadUrlFor(SITE, DRIVE, row),
    ]) {
      expect(url).toContain(`/drives/${DRIVE}/items/`);
      expect(url).not.toContain("/_api/v2.0/drive/items/");
    }
  });

  it("degrades to site-scoped URLs when the drive cannot be resolved", () => {
    expect(pdfViewUrlFor(SITE, "", row)).toBe(
      `${SITE}/_layouts/15/embed.aspx?UniqueId=u-1`
    );
    expect(pdfDownloadUrlFor(SITE, "", row)).toBe(
      `${SITE}/_layouts/15/download.aspx?UniqueId=u-1`
    );
  });

  it("keeps the editable source on its own helper (working docs only)", () => {
    expect(sourceUrlFor(SITE, row)).toBe(
      "https://x.sharepoint.com/sites/Dev/Shared Documents/A.docx?web=1"
    );
  });

  it("pulls presigned URLs from a thumbnails-expanded drive item", () => {
    // shape probed live 2026-07-29: @content.downloadUrl at the top,
    // thumbnails as a sized-set array
    const item = {
      "@content.downloadUrl": "https://x.sharepoint.com/dl?tempauth=t",
      thumbnails: [{ large: { url: "https://r-mediap.svc.ms/transform/thumbnail?cs=abc" } }],
    };
    expect(presignedFromItem(item)).toEqual({
      downloadUrl: "https://x.sharepoint.com/dl?tempauth=t",
      thumbUrl: "https://r-mediap.svc.ms/transform/thumbnail?cs=abc",
    });
    // partial and broken shapes degrade to "" rather than throwing
    expect(presignedFromItem({ thumbnails: [] })).toEqual({ downloadUrl: "", thumbUrl: "" });
    expect(presignedFromItem(null)).toEqual({ downloadUrl: "", thumbUrl: "" });
  });

  it("turns the transform thumbnail into a transform PDF — office only", () => {
    const thumb = "https://r-mediap.svc.ms/transform/thumbnail?provider=spo&cs=abc";
    expect(transformPdfUrl(thumb, "docx")).toBe(
      "https://r-mediap.svc.ms/transform/pdf?provider=spo&cs=abc"
    );
    // pdf input answers 406 "no conversion available" — never offered
    expect(transformPdfUrl(thumb, "pdf")).toBe("");
    // a thumbnail not on the transform service cannot be substituted
    expect(transformPdfUrl("https://x.sharepoint.com/getpreview.ashx?path=p", "docx")).toBe("");
    expect(transformPdfUrl("", "docx")).toBe("");
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
