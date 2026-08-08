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
      // no medium or small in this set: the tile falls back to large
      tileThumbUrl: "https://r-mediap.svc.ms/transform/thumbnail?cs=abc",
    });
    // tiles prefer the medium rendering — 50 tiles must not pull 50
    // full-size images
    expect(
      presignedFromItem({
        thumbnails: [{ small: { url: "s" }, medium: { url: "m" }, large: { url: "l" } }],
      })
    ).toEqual({ downloadUrl: "", thumbUrl: "l", tileThumbUrl: "m" });
    // partial and broken shapes degrade to "" rather than throwing
    expect(presignedFromItem({ thumbnails: [] })).toEqual({
      downloadUrl: "",
      thumbUrl: "",
      tileThumbUrl: "",
    });
    expect(presignedFromItem(null)).toEqual({
      downloadUrl: "",
      thumbUrl: "",
      tileThumbUrl: "",
    });
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

describe("Vault V5 hardening units", () => {
  it("multi-library union: ticked list ids OR together in one scope clause", async () => {
    const { buildSearchBody } = await import("../docs/rows");
    const body = JSON.parse(
      buildSearchBody("", { listIds: ["l1", "l2", "l3"] })
    ) as { request: { Querytext: string } };
    expect(body.request.Querytext).toContain("(ListID:l1 OR ListID:l2 OR ListID:l3)");
  });
  it("filter chain: OR within a column's terms, AND across columns", async () => {
    const { buildSearchBody } = await import("../docs/rows");
    const body = JSON.parse(
      buildSearchBody("", {
        listIds: ["l1"],
        termFilters: [
          { properties: ["owstaxIdOrganisation"], termIds: ["t1", "t2"] },
          { properties: ["owstaxIdDMSProcess"], termIds: ["p1"] },
        ],
      })
    ) as { request: { Querytext: string } };
    const q = body.request.Querytext;
    expect(q).toContain("(owstaxIdOrganisation:t1 OR owstaxIdOrganisation:t2)");
    expect(q).toContain("owstaxIdDMSProcess:p1");
    // AND across = both clauses present as separate space-joined terms
    expect(q.indexOf("owstaxIdOrganisation")).toBeLessThan(q.indexOf("owstaxIdDMSProcess"));
  });
});

describe("RenderListDataAsStream (register browse feed)", () => {
  it("builds ViewXml: order, contains words, term ORs, AND across", async () => {
    const { buildRenderViewXml } = await import("../docs/rows");
    const xml = buildRenderViewXml({
      sortName: false,
      asc: false,
      nameWords: ["crane"],
      termFilters: [
        { cols: ["DMSOrganisation", "DMSOrgB"], labels: ["Bell Bay", "Casting"] },
        { cols: ["DMSDocumentType"], labels: ["Procedure"] },
      ],
      fields: ["DMSDocumentType"],
      rowLimit: 50,
    });
    expect(xml).toContain('<OrderBy><FieldRef Name="Modified" Ascending="FALSE"/></OrderBy>');
    expect(xml).toContain('<Contains><FieldRef Name="FileLeafRef"/><Value Type="File">crane</Value></Contains>');
    // OR spans every (column x label) pair of one filter
    expect(xml).toContain('<Eq><FieldRef Name="DMSOrgB"/><Value Type="Text">Casting</Value></Eq>');
    expect(xml).toContain('<Eq><FieldRef Name="DMSDocumentType"/><Value Type="Text">Procedure</Value></Eq>');
    // filters AND together; escaping holds
    expect(xml).toContain("<And>");
    expect(buildRenderViewXml({ nameWords: ["a<b"] })).toContain("a&lt;b");
    expect(buildRenderViewXml({})).not.toContain("<Where>");
  });
  it("unions the index's content hits with the name match, never narrows", async () => {
    const { buildRenderViewXml } = await import("../docs/rows");
    const both = buildRenderViewXml({
      nameWords: ["heat"],
      idIn: [12, 40],
      termFilters: [{ cols: ["DMSOrganisation"], labels: ["Bell Bay"] }],
    });
    // name match OR the content ids — a name-only hit like "Preheat"
    // survives the depth toggle, which is the whole point
    expect(both).toContain(
      '<In><FieldRef Name="ID"/><Values><Value Type="Counter">12</Value>' +
        '<Value Type="Counter">40</Value></Values></In>'
    );
    expect(both).toContain("<Or><Or><Contains");
    // filters still AND over the union, so a filtered view stays filtered
    expect(both).toContain('<And><Or><Or><Contains');
    expect(both).toContain('<Eq><FieldRef Name="DMSOrganisation"/>');
    // no ids (index cold or unreachable) degrades to the name match
    const nameOnly = buildRenderViewXml({ nameWords: ["heat"], idIn: [] });
    expect(nameOnly).not.toContain("<In>");
    expect(nameOnly).toContain('<Value Type="File">heat</Value>');
    // ids without words (never sent today) still build a valid Where
    const idsOnly = buildRenderViewXml({ idIn: [7] });
    expect(idsOnly).toContain('<Where><In><FieldRef Name="ID"/>');
    // junk ids cannot smuggle anything into the CAML
    expect(buildRenderViewXml({ idIn: [0, -3, 1.5, NaN] })).not.toContain("<Where>");
  });
  it("parses rows: taxonomy labels, person titles, ISO Modified, skips folders", async () => {
    const { parseRenderPage } = await import("../docs/rows");
    const page = parseRenderPage(
      {
        Row: [
          {
            ID: "2",
            UniqueId: "{ABC-9}",
            FileLeafRef: "Anode Change.pdf",
            FileRef: "/sites/Dev/L/Anode Change.pdf",
            FSObjType: "0",
            Modified: "8/2/2026 1:14 AM",
            "Modified.": "2026-08-02T08:14:06Z",
            DMSDocumentType: [{ Label: "Procedure", TermID: "t1" }],
            DMSOwner: [{ id: "7", title: "Ben Pechey" }],
            DMSDocumentID: "STD-1000",
          },
          { FileLeafRef: "Folder", FSObjType: "1" },
        ],
        NextHref: "?Paged=TRUE&p_ID=2",
      },
      "L1"
    );
    expect(page.rows).toHaveLength(1);
    const r = page.rows[0];
    expect(r.uniqueId).toBe("abc-9");
    expect(r.modified).toBe("2026-08-02T08:14:06Z");
    expect(r.values.DMSDocumentType).toBe("Procedure");
    expect(r.values.DMSOwner).toBe("Ben Pechey");
    expect(r.values.DMSDocumentID).toBe("STD-1000");
    expect(page.next).toBe("?Paged=TRUE&p_ID=2");
  });

  it("keeps a date column's ISO twin, and reads it as dd-MMM-yyyy (4D)", async () => {
    const { parseRenderPage, formatDayMonthYear } = await import("../docs/rows");
    const page = parseRenderPage(
      {
        Row: [
          {
            ID: "3",
            FileLeafRef: "Std.pdf",
            FSObjType: "0",
            DMSNextReviewDate: "9/1/2026",
            "DMSNextReviewDate.": "2026-09-01T00:00:00Z",
            // a dotted key that is NOT a date stays out of values
            "Org.COUNT.group": "4",
          },
        ],
      },
      "L1"
    );
    // display text in the site's locale AND the real value, both kept
    expect(page.rows[0].values.DMSNextReviewDate).toBe("9/1/2026");
    expect(page.rows[0].values["DMSNextReviewDate."]).toBe("2026-09-01T00:00:00Z");
    expect(page.rows[0].values["Org.COUNT.group"]).toBeUndefined();
    // the format Ben reads: dd-MMM-yyyy, from local date parts
    expect(formatDayMonthYear("2026-09-01T10:00:00+10:00")).toBe("01-Sep-2026");
    expect(formatDayMonthYear("")).toBe("");
    expect(formatDayMonthYear("not a date")).toBe("not a date");
  });

  it("asks about ME without ever fetching who I am (4D)", async () => {
    const { buildRenderViewXml } = await import("../docs/rows");
    // CAML's <UserID/> IS the signed-in user — the query says "me"
    const held = buildRenderViewXml({ checkedOutToMe: true });
    expect(held).toContain(
      '<Eq><FieldRef Name="CheckoutUser" LookupId="TRUE"/><Value Type="Integer"><UserID/></Value></Eq>'
    );
    const due = buildRenderViewXml({
      personIsMe: "DMSOwner",
      dueWithinDays: { col: "DMSNextReviewDate", days: 30 },
    });
    expect(due).toContain('<FieldRef Name="DMSOwner" LookupId="TRUE"/>');
    expect(due).toContain(
      '<Leq><FieldRef Name="DMSNextReviewDate"/><Value Type="DateTime"><Today OffsetDays="30"/></Value></Leq>'
    );
    // both clauses AND together — one question, not two lists
    expect(due).toContain("<And>");
    // blank column = no clause, never broken CAML
    expect(buildRenderViewXml({ personIsMe: " " })).not.toContain("<Where>");
    expect(buildRenderViewXml({ dueWithinDays: { col: "", days: 5 } })).not.toContain("<Where>");
  });

  it("person columns carry their emails under <col>#email (5B)", async () => {
    const { parseRenderPage } = await import("../docs/rows");
    const page = parseRenderPage(
      {
        Row: [
          {
            ID: "9",
            FileLeafRef: "Std.pdf",
            FSObjType: "0",
            DMSApprovers: [
              { id: "1", title: "Ben Pechey", email: "Ben@Pechey.com" },
              { id: "2", title: "Ada L", email: "ada@pechey.com" },
            ],
            DMSOwner: [{ id: "3", title: "No Address" }],
            DMSTags: [{ Label: "Awesome", TermID: "t1" }],
          },
        ],
      },
      "L1"
    );
    const v = page.rows[0].values;
    // display text unchanged; emails lowercased beside it — the approve
    // gate compares addresses, never display names
    expect(v.DMSApprovers).toBe("Ben Pechey; Ada L");
    expect(v["DMSApprovers#email"]).toBe("ben@pechey.com;ada@pechey.com");
    // a person with no address contributes no email key; taxonomy
    // arrays never grow one
    expect(v["DMSOwner#email"]).toBeUndefined();
    expect(v["DMSTags#email"]).toBeUndefined();
  });

  it("keeps the check-out holder's EMAIL, not just their name (4B)", async () => {
    const { parseRenderPage } = await import("../docs/rows");
    const page = parseRenderPage(
      {
        Row: [
          {
            ID: "5",
            FileLeafRef: "Draft.docx",
            FSObjType: "0",
            CheckoutUser: [{ id: "7", title: "Ben O'Brien", email: "Ben@Pechey.com" }],
          },
          { ID: "6", FileLeafRef: "Free.docx", FSObjType: "0" },
        ],
      },
      "L1"
    );
    // lowercased, because "checked out by me" compares it to the
    // viewer's own address and casing differs between the two sources
    expect(page.rows[0].checkoutEmail).toBe("ben@pechey.com");
    expect(page.rows[0].checkoutName).toBe("Ben O'Brien");
    // not checked out reads as empty, never undefined-by-accident
    expect(page.rows[1].checkoutName).toBe("");
    expect(page.rows[1].checkoutEmail).toBe("");
  });
});

describe("multi-library browse union (REST, no index)", () => {
  const row = (name: string, modified: string) => ({
    id: 1, uniqueId: name, name, ext: "pdf", serverUrl: "/x", listId: "l",
    modified, values: {},
  });
  it("merges per-library feeds newest-first and drains them fully", async () => {
    const { browseComparator, pickBrowseHead } = await import("../docs/rows");
    const cmp = browseComparator("modified", false);
    const a = [row("a1", "2026-08-01T10:00:00Z"), row("a2", "2026-07-01T10:00:00Z")];
    const b = [row("b1", "2026-08-02T10:00:00Z"), row("b2", "2026-07-15T10:00:00Z")];
    const out: string[] = [];
    const buffers = [a, b];
    for (;;) {
      const i = pickBrowseHead(buffers, cmp);
      if (i < 0) break;
      out.push(buffers[i].shift()!.name);
    }
    expect(out).toEqual(["b1", "a1", "b2", "a2"]);
  });
  it("sorts by name ascending case-insensitively when asked", async () => {
    const { browseComparator, pickBrowseHead } = await import("../docs/rows");
    const cmp = browseComparator("name", true);
    const buffers = [[row("bravo", "")], [row("Alpha", ""), row("charlie", "")]];
    const out: string[] = [];
    for (;;) {
      const i = pickBrowseHead(buffers, cmp);
      if (i < 0) break;
      out.push(buffers[i].shift()!.name);
    }
    expect(out).toEqual(["Alpha", "bravo", "charlie"]);
  });
  it("returns -1 only when every buffer is empty", async () => {
    const { browseComparator, pickBrowseHead } = await import("../docs/rows");
    const cmp = browseComparator("modified", false);
    expect(pickBrowseHead([[], []], cmp)).toBe(-1);
    expect(pickBrowseHead([[], [row("x", "2026-01-01")]], cmp)).toBe(1);
  });
});

describe("Vault V3 server-side presentation", () => {
  it("browse URI carries sort and the modified window", async () => {
    const { buildBrowseUri } = await import("../docs/rows");
    expect(buildBrowseUri("L1")).toContain("$orderby=Modified desc");
    expect(buildBrowseUri("L1", 50, { sortName: true, asc: true })).toContain(
      "$orderby=FileLeafRef asc"
    );
    const withWindow = buildBrowseUri("L1", 50, {
      modifiedAfterIso: "2026-07-01T00:00:00.000Z",
    });
    expect(withWindow).toContain("Modified ge datetime'2026-07-01T00:00:00.000Z'");
    expect(withWindow).toContain("FSObjType eq 0 and");
  });
  it("search body carries sort direction and the modified range", async () => {
    const { buildSearchBody } = await import("../docs/rows");
    const asc = JSON.parse(
      buildSearchBody("", { listIds: ["a"], byModified: true, sortAsc: true })
    ) as { request: { SortList: { results: { Direction: number }[] } } };
    expect(asc.request.SortList.results[0].Direction).toBe(0);
    const body = JSON.parse(
      buildSearchBody("pump", {
        listIds: ["a"],
        modifiedAfterIso: "2026-07-01T00:00:00.000Z",
      })
    ) as { request: { Querytext: string } };
    expect(body.request.Querytext).toContain("LastModifiedTime>=2026-07-01");
  });
  it("quick search rides REST: substringof per word over name/Title", async () => {
    const { buildBrowseUri } = await import("../docs/rows");
    const uri = buildBrowseUri("L1", 50, { nameWords: ["crane", "pre-start"] });
    expect(uri).toContain("(substringof('crane',FileLeafRef) or substringof('crane',Title))");
    expect(uri).toContain(
      "(substringof('pre-start',FileLeafRef) or substringof('pre-start',Title))"
    );
    // quotes are doubled, empties dropped — no broken OData
    const quoted = buildBrowseUri("L1", 50, { nameWords: ["o'brien", "  "] });
    expect(quoted).toContain("substringof('o''brien',FileLeafRef)");
    expect(quoted).not.toContain("substringof('',");
  });
  it("splits filenames so the extension survives (finding 6)", async () => {
    const { splitNameForEllipsis } = await import("../docs/rows");
    expect(splitNameForEllipsis("Crane Pre-start Checklist Form.docx")).toEqual({
      stem: "Crane Pre-start Checklist Form",
      ext: ".docx",
    });
    expect(splitNameForEllipsis("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      ext: ".gz",
    });
    expect(splitNameForEllipsis("README")).toEqual({ stem: "README", ext: "" });
    expect(splitNameForEllipsis(".hidden")).toEqual({ stem: ".hidden", ext: "" });
    expect(splitNameForEllipsis("dot.")).toEqual({ stem: "dot.", ext: "" });
  });
});


describe("date range filters (2026-08-03)", () => {
  it("bounds a date column, either end optional, end-date inclusive", async () => {
    const { buildRenderViewXml } = await import("../docs/rows");
    const both = buildRenderViewXml({
      dateRanges: [{ col: "DMSEffectiveDate", from: "2025-01-01", to: "2025-03-31" }],
    });
    expect(both).toContain(
      '<Geq><FieldRef Name="DMSEffectiveDate"/><Value Type="DateTime" IncludeTimeValue="TRUE" StorageTZ="TRUE">2025-01-01T00:00:00Z</Value></Geq>'
    );
    // the whole end day counts — a column holding midnight would
    // otherwise drop documents dated ON the end date
    expect(both).toContain("2025-03-31T23:59:59Z");
    // "everything since March" is a valid question
    const openEnded = buildRenderViewXml({
      dateRanges: [{ col: "DMSEffectiveDate", from: "2025-03-01", to: "" }],
    });
    expect(openEnded).toContain("2025-03-01T00:00:00Z");
    expect(openEnded).not.toContain("Leq");
    // an empty range contributes no clause at all
    expect(buildRenderViewXml({ dateRanges: [{ col: "X", from: "", to: "" }] })).not.toContain(
      "<Where>"
    );
    expect(buildRenderViewXml({ dateRanges: [{ col: "", from: "2025-01-01", to: "" }] })).not.toContain(
      "<Where>"
    );
  });

  it("ANDs a date bound with the term filters and the name search", async () => {
    const { buildRenderViewXml } = await import("../docs/rows");
    const xml = buildRenderViewXml({
      nameWords: ["pump"],
      termFilters: [{ cols: ["Org"], labels: ["Bell Bay"] }],
      dateRanges: [{ col: "Due", from: "2025-01-01", to: "" }],
    });
    expect(xml).toContain("<And>");
    expect(xml).toContain('<Value Type="File">pump</Value>');
    expect(xml).toContain('<Value Type="Text">Bell Bay</Value>');
    expect(xml).toContain('Name="Due"');
  });
});

