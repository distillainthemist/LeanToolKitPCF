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
  seedDefaultColumns,
  serializeAppDocsConfig,
  serializeLibraryConfig,
  suggestRoles,
} from "../docs/model";

describe("library config", () => {
  it("round-trips through serialize/parse", () => {
    const cfg = {
      title: "Standards",
      columns: [
        { internal: "DMSStatus", label: "Status", available: true, inDefault: true, role: "status", termSetId: "set-1" },
        { internal: "DMSOwner", label: "", available: false, inDefault: false, role: "owner", termSetId: "" },
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
      columns: [
        { internal: "Title", label: "", available: true, inDefault: false, role: "", termSetId: "" },
      ],
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
      controllersGroupId: "",
      controllersGroupName: "",
      sites: {},
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
        { internal: "DMSStatus", label: "Status!", available: true, inDefault: true, role: "status", termSetId: "" },
        { internal: "Vanished", label: "", available: true, inDefault: false, role: "", termSetId: "" },
      ],
      [
        { internal: "Title", title: "Name", type: "Text", choices: [], isTaxonomy: false, termSetId: "" , required: false },
        { internal: "DMSStatus", title: "Status", type: "Choice", choices: [], isTaxonomy: false, termSetId: "" , required: false },
      ]
    );
    expect(merged.map((c) => c.internal)).toEqual(["DMSStatus", "Title"]);
    expect(merged[0].label).toBe("Status!");
    expect(merged[1]).toEqual({
      internal: "Title",
      label: "",
      available: true,
      inDefault: false,
      role: "",
      termSetId: "",
    });
  });

  it("the live schema stamps termSetId; a blind live read keeps the stored one", () => {
    const merged = mergeColumns(
      [
        { internal: "DMSOrgUnit", label: "", available: true, inDefault: false, role: "orgUnit", termSetId: "old-set" },
        { internal: "DMSTags", label: "", available: true, inDefault: false, role: "tags", termSetId: "kept-set" },
      ],
      [
        { internal: "DMSOrgUnit", title: "Org", type: "TaxonomyFieldType", choices: [], isTaxonomy: true, termSetId: "new-set" , required: false },
        { internal: "DMSTags", title: "Tags", type: "TaxonomyFieldTypeMulti", choices: [], isTaxonomy: true, termSetId: "" , required: false },
      ]
    );
    expect(merged[0].termSetId).toBe("new-set");
    expect(merged[1].termSetId).toBe("kept-set");
  });
});

describe("role suggestion + register defaults (Phase 3a)", () => {
  const col = (internal: string, role = "", inDefault = false) => ({
    internal,
    label: "",
    available: true,
    inDefault,
    role,
    termSetId: "",
  });

  it("fills unset roles from the spec's DMS* names, never overwriting", () => {
    const out = suggestRoles([
      col("DMSStatus"),
      col("DMSOwner", "approvers"), // hand-set: stays
      col("SomethingElse"),
    ]);
    expect(out.map((c) => c.role)).toEqual(["status", "approvers", ""]);
  });

  it("seeds the register view per type when nothing is ticked", () => {
    const cfg = {
      ...emptyLibraryConfig(),
      columns: [
        col("DMSDocumentType", "docType"),
        col("DMSOwner", "owner"),
        col("DMSStatus", "status"),
        col("DMSEffectiveDate", "effectiveDate"),
        col("DMSTags", "tags"),
      ],
    };
    const std = seedDefaultColumns(cfg, "standard");
    expect(std.columns.filter((c) => c.inDefault).map((c) => c.internal)).toEqual([
      "DMSDocumentType",
      "DMSOwner",
      "DMSStatus",
      "DMSEffectiveDate",
    ]);
    // working documents lean on the built-in Modified column instead
    const work = seedDefaultColumns(cfg, "working");
    expect(work.columns.filter((c) => c.inDefault).map((c) => c.internal)).toEqual([
      "DMSDocumentType",
      "DMSOwner",
      "DMSStatus",
    ]);
  });

  it("never touches a config someone has ticked", () => {
    const cfg = {
      ...emptyLibraryConfig(),
      columns: [col("DMSTags", "tags", true), col("DMSStatus", "status")],
    };
    expect(seedDefaultColumns(cfg, "standard")).toBe(cfg);
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

// ---- settings consolidation, C0 ----------------------------------------
// The dictionary is what makes a column mean the same thing in every
// library. The migration into it is SILENT (Ben, 2026-08-02), so these
// tests carry the weight the Adopt step would otherwise have carried:
// same inputs → same answer, and nothing lost without a record.

const dictCol = (
  internal: string,
  role = "",
  label = "",
  extra: Partial<{ available: boolean; inDefault: boolean; termSetId: string }> = {}
) => ({
  internal,
  label,
  role,
  available: extra.available ?? true,
  inDefault: extra.inDefault ?? false,
  termSetId: extra.termSetId ?? "",
});

const dictLib = (columns: ReturnType<typeof dictCol>[], statusColors: Record<string, string> = {}) => ({
  config: { title: "", columns, statusColors, renditionPath: "" },
});

describe("site column dictionary", () => {
  it("unions every library's columns, majority winning on role and label", async () => {
    const { buildSiteDictionary } = await import("../docs/model");
    const { dictionary, conflicts } = buildSiteDictionary([
      dictLib([dictCol("DMSStatus", "status", "Status"), dictCol("DMSOwner", "owner", "Owner")]),
      dictLib([dictCol("DMSStatus", "status", "Status"), dictCol("DMSOwner", "", "")]),
      dictLib([dictCol("DMSStatus", "status", "Approval"), dictCol("DMSType", "docType", "Type")]),
    ]);
    const byName = new Map(dictionary.columns.map((c) => [c.internal, c]));
    // two libraries said "Status", one said "Approval" — majority wins
    expect(byName.get("DMSStatus")?.label).toBe("Status");
    // a role only one library mapped still lands in the dictionary: the
    // others simply had not been configured, which is the whole problem
    expect(byName.get("DMSOwner")?.role).toBe("owner");
    // a column only one library carries is still site-wide
    expect(byName.get("DMSType")?.role).toBe("docType");
    // the disagreement is RECORDED, not silently dropped
    const c = conflicts.find((x) => x.internal === "DMSStatus" && x.field === "label");
    expect(c?.chosen).toBe("Status");
    expect(c?.values).toEqual([
      { value: "Status", count: 2 },
      { value: "Approval", count: 1 },
    ]);
  });

  it("resolves ties the same way every time", async () => {
    const { buildSiteDictionary } = await import("../docs/model");
    const run = () =>
      buildSiteDictionary([
        dictLib([dictCol("X", "", "Zebra")]),
        dictLib([dictCol("X", "", "Alpha")]),
      ]).dictionary.columns[0].label;
    // one vote each — alphabetically first, and stable across runs
    expect(run()).toBe("Alpha");
    expect(run()).toBe(run());
  });

  it("treats available as a floor, not a vote", async () => {
    const { buildSiteDictionary } = await import("../docs/model");
    const { dictionary } = buildSiteDictionary([
      dictLib([dictCol("X", "", "", { available: false })]),
      dictLib([dictCol("X", "", "", { available: false })]),
      dictLib([dictCol("X", "", "", { available: true })]),
    ]);
    // hiding a column is a per-library VIEW decision; one library
    // offering it means the site can offer it
    expect(dictionary.columns[0].available).toBe(true);
  });

  it("folds per-library status colours into one palette per term set", async () => {
    const { buildSiteDictionary, paletteEntryFor } = await import("../docs/model");
    const { dictionary } = buildSiteDictionary([
      dictLib([dictCol("DMSStatus", "status", "", { termSetId: "set-9" })], { Approved: "good" }),
      dictLib([dictCol("DMSStatus", "status", "", { termSetId: "set-9" })], { Draft: "neutral" }),
    ]);
    expect(paletteEntryFor(dictionary, "set-9", "DMSStatus", "Approved")?.color).toBe("good");
    expect(paletteEntryFor(dictionary, "set-9", "DMSStatus", "Draft")?.color).toBe("neutral");
    // a Choice status column has no term set — keyed by column instead
    const choice = buildSiteDictionary([
      dictLib([dictCol("Stage", "status")], { Live: "good" }),
    ]).dictionary;
    expect(paletteEntryFor(choice, "", "Stage", "Live")?.color).toBe("good");
    expect(paletteEntryFor(choice, "", "Stage", "Retired")).toBeNull();
  });

  it("projects the dictionary onto a library, leaving the view alone", async () => {
    const { buildSiteDictionary, resolveLibraryConfig } = await import("../docs/model");
    const { dictionary } = buildSiteDictionary([
      dictLib([dictCol("DMSStatus", "status", "Status", { termSetId: "set-9" })]),
    ]);
    const target = {
      title: "Records",
      renditionPath: "",
      statusColors: {},
      // this library never mapped the column and hid it
      columns: [dictCol("DMSStatus", "", "", { available: false, inDefault: true })],
    };
    const out = resolveLibraryConfig(target, dictionary);
    expect(out.columns[0].role).toBe("status");
    expect(out.columns[0].label).toBe("Status");
    expect(out.columns[0].available).toBe(true);
    expect(out.columns[0].termSetId).toBe("set-9");
    // inDefault is the one per-library decision and survives untouched
    expect(out.columns[0].inDefault).toBe(true);
    expect(out.title).toBe("Records");
  });

  it("keeps a column the dictionary has not heard of, and no-ops when empty", async () => {
    const { emptySiteDictionary, resolveLibraryConfig } = await import("../docs/model");
    const cfg = { title: "", renditionPath: "", statusColors: {}, columns: [dictCol("Odd", "tags", "Odd one")] };
    // an empty dictionary must change nothing (a fresh deployment)
    expect(resolveLibraryConfig(cfg, emptySiteDictionary())).toEqual(cfg);
    // and an unknown column is kept as-is rather than vanishing mid-upgrade
    const dict = { columns: [{ internal: "Other", label: "", role: "", available: true, termSetId: "", isDate: false, filterable: true }], palettes: [], templates: {} };
    expect(resolveLibraryConfig(cfg, dict).columns[0].role).toBe("tags");
  });

  it("round-trips the dictionary through the app config, keyed per site", async () => {
    const { parseAppDocsConfig, serializeAppDocsConfig, emptyAppDocsConfig } = await import("../docs/model");
    const cfg = {
      ...emptyAppDocsConfig(),
      siteUrl: "https://x.sharepoint.com/sites/Dev",
      sites: {
        "https://x.sharepoint.com/sites/dev": {
          columns: [{ internal: "DMSStatus", label: "Status", role: "status", available: true, termSetId: "set-9", isDate: false, filterable: true }],
          palettes: [{ setId: "set-9", setName: "Approval", entries: { Approved: { color: "good", glyph: "✓", label: "Approved" } } }],
          templates: { record: ["DMSStatus"] },
        },
      },
    };
    const back = parseAppDocsConfig(serializeAppDocsConfig(cfg));
    expect(back.sites["https://x.sharepoint.com/sites/dev"].columns[0].role).toBe("status");
    expect(back.sites["https://x.sharepoint.com/sites/dev"].palettes[0].entries.Approved.glyph).toBe("✓");
    // trailing slashes and casing must not fork a site's dictionary
    const messy = parseAppDocsConfig(
      JSON.stringify({ sites: { "https://X.sharepoint.com/sites/Dev/": { columns: [{ internal: "A" }] } } })
    );
    expect(Object.keys(messy.sites)).toEqual(["https://x.sharepoint.com/sites/dev"]);
  });
});

describe("dictionary ↔ live schema sync (C1)", () => {
  const spField = (internal: string, termSetId = "") => ({
    internal,
    title: internal.replace(/^DMS/, ""),
    type: termSetId === "" ? "Text" : "TaxonomyFieldType",
    choices: [] as string[],
    isTaxonomy: termSetId !== "",
    termSetId,
    required: false,
  });

  it("keeps chosen mappings, appends new columns, drops vanished ones", async () => {
    const { syncSiteDictionary } = await import("../docs/model");
    const stored = {
      columns: [
        { internal: "DMSStatus", label: "Status", role: "status", available: true, termSetId: "", isDate: false, filterable: true },
        { internal: "Retired", label: "Gone", role: "tags", available: true, termSetId: "", isDate: false, filterable: true },
      ],
      palettes: [],
      templates: {},
    };
    const { dictionary, carriers } = syncSiteDictionary(stored, [
      { listId: "1", name: "Standards", fields: [spField("DMSStatus", "set-9"), spField("DMSOwner")] },
      { listId: "2", name: "Records", fields: [spField("DMSStatus", "set-9")] },
    ]);
    const names = dictionary.columns.map((c) => c.internal);
    // a hand-chosen mapping survives; a column no library carries goes
    expect(names).toEqual(["DMSStatus", "DMSOwner"]);
    expect(dictionary.columns[0].label).toBe("Status");
    // SharePoint is the record for the term set
    expect(dictionary.columns[0].termSetId).toBe("set-9");
    // a new column arrives with its role already suggested from the spec
    expect(dictionary.columns[1].role).toBe("owner");
    // and the settings table can say who actually carries what
    expect(carriers.get("DMSStatus")).toEqual(["Standards", "Records"]);
    expect(carriers.get("DMSOwner")).toEqual(["Standards"]);
  });

  it("keeps a stored term set when the live read cannot see one", async () => {
    const { syncSiteDictionary } = await import("../docs/model");
    const { dictionary } = syncSiteDictionary(
      { columns: [{ internal: "DMSTags", label: "", role: "tags", available: true, termSetId: "kept", isDate: false, filterable: true }], palettes: [], templates: {} },
      [{ listId: "1", name: "L", fields: [spField("DMSTags")] }]
    );
    expect(dictionary.columns[0].termSetId).toBe("kept");
  });
});

describe("term set palettes (C2)", () => {
  const pal = (entries: Record<string, { color: string; glyph: string; label: string }>) => ({
    setId: "set-9",
    setName: "",
    entries,
  });

  it("re-keys migrated label colours onto term GUIDs, keeping unknowns", async () => {
    const { rekeyPaletteToTerms } = await import("../docs/model");
    const out = rekeyPaletteToTerms(
      pal({
        Approved: { color: "good", glyph: "", label: "Approved" },
        Retired: { color: "neutral", glyph: "", label: "Retired" },
      }),
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Approved" }]
    );
    // the term that exists moves onto its GUID...
    expect(out.entries["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"].color).toBe("good");
    expect(out.entries.Approved).toBeUndefined();
    // ...and one with no matching term is KEPT, not guessed away: it may
    // belong to a value the column no longer offers, which Health reports
    expect(out.entries.Retired.color).toBe("neutral");
  });

  it("keeps a colour when the term is renamed — the point of GUID keys", async () => {
    const { paletteEntryFor } = await import("../docs/model");
    const dict = {
      columns: [],
      palettes: [pal({ "term-1": { color: "good", glyph: "✓", label: "Approved" } })],
      templates: {},
    };
    // the register now paints the NEW label; the live term store maps it
    // back to the id the palette already holds
    const renamed = new Map([["issued", "term-1"]]);
    expect(paletteEntryFor(dict, "set-9", "DMSStatus", "Issued", renamed)?.color).toBe("good");
    // and with no map yet, the label stored beside the entry still matches
    expect(paletteEntryFor(dict, "set-9", "DMSStatus", "Approved")?.glyph).toBe("✓");
    // an unknown value stays uncoloured rather than borrowing one
    expect(paletteEntryFor(dict, "set-9", "DMSStatus", "Nonsense")).toBeNull();
  });

  it("groups columns sharing a term set into one palette", async () => {
    const { colourableSets } = await import("../docs/model");
    const sets = colourableSets({
      templates: {},
      columns: [
        { internal: "DMSStatus", label: "", role: "status", available: true, termSetId: "set-9", isDate: false, filterable: true },
        { internal: "DMSDocumentStatus", label: "", role: "", available: true, termSetId: "set-9", isDate: false, filterable: true },
        { internal: "DMSImportance", label: "", role: "importance", available: true, termSetId: "set-3", isDate: false, filterable: true },
        { internal: "Hidden", label: "", role: "", available: false, termSetId: "set-4", isDate: false, filterable: true },
        { internal: "PlainText", label: "", role: "", available: true, termSetId: "", isDate: false, filterable: true },
      ],
      palettes: [],
    });
    // two columns, one set, ONE palette — the whole point
    expect(sets.map((s) => s.key)).toEqual(["set-9", "set-3"]);
    expect(sets[0].columns.map((c) => c.internal)).toEqual(["DMSStatus", "DMSDocumentStatus"]);
    // an unavailable column brings nothing to colour, nor does plain text
    expect(sets.some((s) => s.key === "set-4")).toBe(false);
  });
});

describe("configuration health (C4)", () => {
  const sc = (internal: string, role = "", termSetId = "") => ({
    internal,
    label: "",
    role,
    available: true,
    termSetId,
    isDate: false,
    filterable: true,
  });
  const base = {
    conflicts: [],
    carriers: new Map<string, string[]>(),
    libraries: [] as { name: string; columns: ReturnType<typeof dictCol>[] }[],
    choicesBy: new Map<string, string[]>(),
  };

  it("catches a role mapped twice and key roles not mapped at all", async () => {
    const { dictionaryHealth } = await import("../docs/model");
    const found = dictionaryHealth({
      ...base,
      dict: { columns: [sc("A", "status"), sc("B", "status"), sc("C", "owner")], palettes: [], templates: {} },
    });
    const dup = found.find((f) => f.title.includes("mapped to 2 columns"));
    expect(dup?.level).toBe("warn");
    expect(dup?.detail).toContain("A, B");
    // owner IS mapped, so only document type is reported missing
    expect(found.some((f) => f.title.includes("No column is mapped as Document type"))).toBe(true);
    expect(found.some((f) => f.title.includes("No column is mapped as Owner"))).toBe(false);
  });

  it("names the libraries a meaningful column is missing from", async () => {
    const { dictionaryHealth } = await import("../docs/model");
    const found = dictionaryHealth({
      ...base,
      dict: { columns: [sc("DMSOwner", "owner"), sc("Noise")], palettes: [], templates: {} },
      carriers: new Map([
        ["DMSOwner", ["Standards"]],
        ["Noise", ["Standards"]],
      ]),
      libraries: [
        { name: "Standards", columns: [dictCol("DMSOwner", "", "", { inDefault: true })] },
        { name: "Records", columns: [dictCol("Other", "", "", { inDefault: true })] },
      ],
    });
    const gap = found.find((f) => f.title.startsWith("DMSOwner is missing"));
    expect(gap?.detail).toContain("Records");
    // a column with no role is not worth reporting on
    expect(found.some((f) => f.title.startsWith("Noise"))).toBe(false);
  });

  it("reports colours for values a choice column dropped, and un-rekeyed palettes", async () => {
    const { dictionaryHealth } = await import("../docs/model");
    const found = dictionaryHealth({
      ...base,
      dict: {
        templates: {},
        columns: [sc("Stage", "status")],
        palettes: [
          {
            setId: "choice:Stage",
            setName: "",
            entries: {
              Live: { color: "good", glyph: "", label: "Live" },
              Retired: { color: "neutral", glyph: "", label: "Retired" },
            },
          },
          {
            setId: "set-9",
            setName: "",
            entries: { Approved: { color: "good", glyph: "", label: "Approved" } },
          },
        ],
      },
      choicesBy: new Map([["Stage", ["Live"]]]),
    });
    expect(found.some((f) => f.level === "warn" && f.title.includes("no longer offers"))).toBe(true);
    // a taxonomy palette still keyed by label is worth a nudge, not a warning
    const label = found.find((f) => f.title.includes("still keyed by label"));
    expect(label?.level).toBe("info");
  });

  it("says nothing when the libraries agree", async () => {
    const { dictionaryHealth } = await import("../docs/model");
    expect(
      dictionaryHealth({
        ...base,
        dict: {
          columns: [sc("A", "status"), sc("B", "owner"), sc("C", "docType")],
          palettes: [],
          templates: {},
        },
        carriers: new Map([
          ["A", ["One"]],
          ["B", ["One"]],
          ["C", ["One"]],
        ]),
        libraries: [{ name: "One", columns: [dictCol("A", "", "", { inDefault: true })] }],
      })
    ).toEqual([]);
  });
});

describe("taxonomy values against their term set (2026-08-03)", () => {
  const LABELS = ["Pacific", "Bell Bay", "Casting", "Maintenance"];
  const probe = (samples: string[], extra: Record<string, unknown> = {}) => ({
    samples,
    labels: LABELS,
    ...extra,
  });

  it("says nothing when the values are terms — even if only some rows are tagged", async () => {
    const { taxProbeFinding } = await import("../docs/model");
    expect(taxProbeFinding("DMSOrg", probe(["Casting", "Bell Bay; Casting"]))).toBeNull();
    // a value nobody recognises alongside one we do is somebody's typo,
    // not a broken column
    expect(taxProbeFinding("DMSOrg", probe(["Casting", "Whatever"]))).toBeNull();
  });

  it("names the display-value setting when every value is a full path", async () => {
    const { taxProbeFinding } = await import("../docs/model");
    // the production failure: folders dead, nothing in the UI to say why
    const f = taxProbeFinding("DMSOrg", probe(["Pacific:Bell Bay:Casting", "Pacific:Boyne"]));
    expect(f?.level).toBe("warn");
    expect(f?.title).toContain("whole term path");
    expect(f?.detail).toContain("Pacific:Bell Bay:Casting");
    expect(f?.detail).toContain("Display term label in the field");
    // the internal name is what the admin looks for in Site columns,
    // even when a display override is set
    expect(taxProbeFinding("DMSOrg", probe(["Pacific | Casting"]), "Organisation")?.detail).toContain(
      "DMSOrg"
    );
  });

  it("distinguishes the wrong term set from a path", async () => {
    const { taxProbeFinding } = await import("../docs/model");
    const f = taxProbeFinding("DMSOrg", probe(["Vessel 4", "Vessel 7"]));
    expect(f?.title).toContain("no value matches");
    expect(f?.detail).toContain("wrong term set");
  });

  it("holds its tongue when it cannot know", async () => {
    const { taxProbeFinding } = await import("../docs/model");
    // nothing tagged yet
    expect(taxProbeFinding("DMSOrg", probe([]))).toBeNull();
    expect(taxProbeFinding("DMSOrg", probe(["", " ; "]))).toBeNull();
    // no term set read — nothing to compare against
    expect(taxProbeFinding("DMSOrg", { samples: ["Casting"], labels: [] })).toBeNull();
    // a truncated walk cannot prove a value is unknown, but a path still
    // looks like a path
    expect(taxProbeFinding("DMSOrg", probe(["Vessel 4"], { partial: true }))).toBeNull();
    expect(
      taxProbeFinding("DMSOrg", probe(["Pacific:Casting"], { partial: true }))?.title
    ).toContain("whole term path");
  });

  it("puts the finding first, ahead of the drift reports", async () => {
    const { dictionaryHealth } = await import("../docs/model");
    const col = {
      internal: "DMSOrg",
      label: "",
      role: "orgUnit",
      available: true,
      termSetId: "set-1",
      isDate: false,
      filterable: true,
    };
    const found = dictionaryHealth({
      conflicts: [],
      carriers: new Map<string, string[]>(),
      libraries: [],
      choicesBy: new Map<string, string[]>(),
      dict: { columns: [col], palettes: [], templates: {} },
      taxProbe: new Map([["DMSOrg", probe(["Pacific:Casting"])]]),
    });
    expect(found[0].title).toContain("whole term path");
    // no probe at all = the check simply does not run
    expect(
      dictionaryHealth({
        conflicts: [],
        carriers: new Map<string, string[]>(),
        libraries: [],
        choicesBy: new Map<string, string[]>(),
        dict: { columns: [col], palettes: [], templates: {} },
      }).some((f) => f.title.includes("term path"))
    ).toBe(false);
  });
});

describe("what a write came back with (Phase 4A)", () => {
  it("reads the permissions Phase 4 actually needs", async () => {
    const { parseBasePermissions } = await import("../docs/model");
    // add + edit + delete, as decimal strings the way SharePoint sends them
    expect(parseBasePermissions({ High: "432", Low: "14" })).toEqual({
      add: true,
      edit: true,
      remove: true,
    });
    // read-only: view without add or edit
    expect(parseBasePermissions({ Low: "1" })).toEqual({
      add: false,
      edit: false,
      remove: false,
    });
    // full control arrives as a mask JS turns negative — the low bits
    // still have to answer correctly
    expect(parseBasePermissions({ Low: "4294967295" })).toEqual({
      add: true,
      edit: true,
      remove: true,
    });
    // wrapped, or absent, or nonsense — never a throw, never a yes
    expect(parseBasePermissions({ d: { Low: "4" } }).edit).toBe(true);
    expect(parseBasePermissions(null)).toEqual({ add: false, edit: false, remove: false });
    expect(parseBasePermissions({ Low: "not a number" }).add).toBe(false);
  });

  it("surfaces the fields SharePoint refused, and only those", async () => {
    const { validateItemErrors } = await import("../docs/model");
    const errs = validateItemErrors({
      value: [
        { FieldName: "Title", FieldValue: "x", HasException: false, ErrorMessage: null },
        {
          FieldName: "DMSOrg",
          FieldValue: "Nowhere",
          HasException: true,
          ErrorMessage: "The given value is not present in the term set.",
        },
        // an exception with no message still has to be reported
        { FieldName: "DMSType", HasException: true, ErrorMessage: null },
      ],
    });
    expect(errs).toEqual([
      { field: "DMSOrg", message: "The given value is not present in the term set." },
      { field: "DMSType", message: "rejected" },
    ]);
    expect(validateItemErrors({ value: [] })).toEqual([]);
    expect(validateItemErrors(null)).toEqual([]);
  });

  it("carries bytes as one character each, so a re-encode is visible", async () => {
    const { bytesToBinaryString } = await import("../docs/model");
    const bytes = new Uint8Array([0x25, 0x00, 0x7f, 0x80, 0xff]);
    const s = bytesToBinaryString(bytes);
    expect(s.length).toBe(bytes.length);
    expect([...s].map((c) => c.charCodeAt(0))).toEqual([0x25, 0x00, 0x7f, 0x80, 0xff]);
    // the failure the probe is looking for: UTF-8 turns the two bytes
    // above 0x7F into two each, so five bytes land as seven
    expect(new TextEncoder().encode(s).length).toBe(7);
  });

  it("base64 carries the same bytes through a JSON body unharmed", async () => {
    const { bytesToBase64 } = await import("../docs/model");
    const bytes = new Uint8Array([0x25, 0x00, 0x7f, 0x80, 0xff]);
    const b64 = bytesToBase64(bytes);
    // ASCII only, so nothing downstream can re-encode it — that is the
    // whole point of the envelope
    expect(/^[A-Za-z0-9+/=]+$/.test(b64)).toBe(true);
    expect(new TextEncoder().encode(b64).length).toBe(b64.length);
    // and it round-trips to exactly what went in
    expect([...atob(b64)].map((c) => c.charCodeAt(0))).toEqual([0x25, 0x00, 0x7f, 0x80, 0xff]);
  });

  it("digs SharePoint's own sentence out of JSON inside JSON", async () => {
    const { spErrorText } = await import("../docs/model");
    // exactly the shape a check-in refusal arrives in
    const raw = JSON.stringify({
      status: 423,
      message: JSON.stringify({
        "odata.error": {
          code: "-2147024738, Microsoft.SharePoint.SPFileCheckOutException",
          message: { lang: "en-US", value: "The file is not checked out." },
        },
      }),
      source: "https://tenant.sharepoint.com",
    });
    expect(spErrorText(raw)).toBe("The file is not checked out.");
    // the gateway's envelope: "BadGateway" at every level, the real
    // refusal nested in innerError — the sentence must win
    expect(
      spErrorText(
        JSON.stringify({
          error: {
            code: 502,
            message: "BadGateway",
            innerError: {
              status: 500,
              message: "The file is not checked out. You must first check out this document.",
            },
          },
        })
      )
    ).toBe("The file is not checked out. You must first check out this document.");
    // plain text passes through; junk never throws and never comes back empty
    expect(spErrorText("Access denied.")).toBe("Access denied.");
    expect(spErrorText("{not json")).toBe("{not json");
    expect(spErrorText("")).toBe("");
  });

  it("finds the hidden note field in the taxonomy column's schema", async () => {
    const { textFieldGuidFromSchema } = await import("../docs/model");
    // the reference is a GUID attribute, braces and casing SharePoint's
    const xml =
      '<Field Type="TaxonomyFieldType" DisplayName="Document status" ' +
      'TextField="{9A8F1C2D-3B4E-4F5A-8B6C-7D8E9F0A1B2C}" ' +
      'SspId="{aaaa}" TermSetId="{bbbb}" />';
    expect(textFieldGuidFromSchema(xml)).toBe("9a8f1c2d-3b4e-4f5a-8b6c-7d8e9f0a1b2c");
    // no reference = empty, never a guessed name (a guessed name was an
    // ArgumentException in production, 2026-08-03)
    expect(textFieldGuidFromSchema('<Field Type="Text" />')).toBe("");
    expect(textFieldGuidFromSchema("")).toBe("");
  });

  it("quotes the way SharePoint's OData does", async () => {
    const { spQuote } = await import("../docs/model");
    expect(spQuote("O'Brien's draft.docx")).toBe("O''Brien''s draft.docx");
    expect(spQuote("plain.docx")).toBe("plain.docx");
  });
});

describe("add a document — the write recipe (4C)", () => {
  it("routes each kind through the surface the probe proved", async () => {
    const { splitAddWrites } = await import("../docs/model");
    const { formValues, patch } = splitAddWrites([
      { internal: "Title", kind: "text", text: "  Weighbridge plan  " },
      { internal: "DMSDocumentType", kind: "choice", text: "Procedure" },
      { internal: "DMSEffective", kind: "date", text: "2026-09-01" },
      { internal: "DMSDocumentStatus", kind: "taxonomy", label: "Draft", termId: "t-1" },
      { internal: "DMSOrg", kind: "taxonomy", label: "Casting", termId: "t-2", multi: true },
    ]);
    // text + choice: ValidateUpdateListItem, trimmed
    expect(formValues).toEqual([
      { FieldName: "Title", FieldValue: "Weighbridge plan" },
      { FieldName: "DMSDocumentType", FieldValue: "Procedure" },
    ]);
    // terms: the one accepted shape (probe run six); multi = array of one
    expect(patch.DMSDocumentStatus).toEqual({ Value: "Draft", TermGuid: "t-1", WssId: -1 });
    expect(patch.DMSOrg).toEqual([{ Value: "Casting", TermGuid: "t-2", WssId: -1 }]);
    // dates ride the tabular surface as ISO, not a locale guess
    expect(patch.DMSEffective).toBe("2026-09-01");
  });

  it("an empty editor writes nothing at all", async () => {
    const { splitAddWrites } = await import("../docs/model");
    const { formValues, patch } = splitAddWrites([
      { internal: "A", kind: "text", text: "   " },
      { internal: "B", kind: "date", text: "" },
      { internal: "C", kind: "taxonomy", label: "", termId: "" },
      { internal: "D", kind: "taxonomy", label: "Orphan", termId: "" },
      { internal: "E", kind: "person", people: [] },
      { internal: "F", kind: "person", people: [{ email: "  ", name: "No address" }] },
    ]);
    expect(formValues).toEqual([]);
    expect(Object.keys(patch)).toEqual([]);
  });

  it("people travel as claims keys through the forms engine", async () => {
    const { splitAddWrites } = await import("../docs/model");
    const { formValues, patch } = splitAddWrites([
      {
        internal: "DMSOwner",
        kind: "person",
        people: [{ email: "Ben@Pechey.com", name: "Ben" }],
      },
      {
        internal: "DMSApprovers",
        kind: "person",
        people: [
          { email: "a@pechey.com", name: "A" },
          { email: "b@pechey.com", name: "B" },
        ],
      },
    ]);
    // single and multi are the same shape — a JSON array of claims keys,
    // resolved server-side; emails lowercased on the way through
    expect(formValues).toEqual([
      {
        FieldName: "DMSOwner",
        FieldValue: JSON.stringify([{ Key: "i:0#.f|membership|ben@pechey.com" }]),
      },
      {
        FieldName: "DMSApprovers",
        FieldValue: JSON.stringify([
          { Key: "i:0#.f|membership|a@pechey.com" },
          { Key: "i:0#.f|membership|b@pechey.com" },
        ]),
      },
    ]);
    expect(Object.keys(patch)).toEqual([]);
  });

  it("a new document completes in ONE forms-engine call", async () => {
    const { newDocumentWrites } = await import("../docs/model");
    const { formValues, taxInternals, patch } = newDocumentWrites([
      { internal: "Title", kind: "text", text: "Weighbridge plan" },
      { internal: "DMSEffective", kind: "date", text: "2026-09-01" },
      { internal: "DMSDocumentStatus", kind: "taxonomy", label: "Draft", termId: "t-1" },
      { internal: "DMSOrg", kind: "taxonomy", label: "Casting", termId: "t-2", multi: true },
      { internal: "DMSOwner", kind: "person", people: [{ email: "ben@pechey.com", name: "B" }] },
    ]);
    // everything becomes a form value — dates in the SITE's short
    // format (the validator's only accepted shape), taxonomy as the
    // flow-standard Label|guid, person as claims JSON
    expect(formValues).toEqual([
      { FieldName: "Title", FieldValue: "Weighbridge plan" },
      {
        FieldName: "DMSOwner",
        FieldValue: JSON.stringify([{ Key: "i:0#.f|membership|ben@pechey.com" }]),
      },
      { FieldName: "DMSEffective", FieldValue: "9/1/2026" },
      { FieldName: "DMSDocumentStatus", FieldValue: "Draft|t-1" },
      { FieldName: "DMSOrg", FieldValue: "Casting|t-2" },
    ]);
    // the fallback knows which columns are taxonomy, and holds the
    // proven term-object shapes for exactly those
    expect(taxInternals).toEqual(["DMSDocumentStatus", "DMSOrg"]);
    expect(patch).toEqual({
      DMSDocumentStatus: { Value: "Draft", TermGuid: "t-1", WssId: -1 },
      DMSOrg: [{ Value: "Casting", TermGuid: "t-2", WssId: -1 }],
    });
    // nothing filled in = nothing to write, nothing to fall back to
    const empty = newDocumentWrites([{ internal: "X", kind: "taxonomy", label: "", termId: "" }]);
    expect(empty.formValues).toEqual([]);
    expect(empty.taxInternals).toEqual([]);
  });

  it("writes dates the way the site's locale reads them", async () => {
    const { formatDateForLocale } = await import("../docs/model");
    // the measured refusal: "Enter a date like this: 2/23/2012" — en-US
    expect(formatDateForLocale("2026-09-01", 1033)).toBe("9/1/2026");
    // day-first locales put the day first (padding is the ICU's
    // business, the ORDER is ours to guarantee)
    const au = formatDateForLocale("2026-09-01", 3081).match(/\d+/g)?.map(Number);
    expect(au).toEqual([1, 9, 2026]);
    // parsed by parts: no timezone shift can move the day
    expect(formatDateForLocale("2026-01-01", 1033)).toBe("1/1/2026");
    // an unknown locale falls back to en-US; a non-ISO string passes
    // through untouched for the validator to judge
    expect(formatDateForLocale("2026-09-01", 99999)).toBe("9/1/2026");
    expect(formatDateForLocale("tomorrow", 1033)).toBe("tomorrow");
  });

  it("orders properties the way the dictionary reads (form + preview)", async () => {
    const { sortByDictionary } = await import("../docs/model");
    const dict = ["DMSDocumentID", "DMSDocumentType", "DMSStatus", "DMSOwner"];
    expect(sortByDictionary(["DMSOwner", "DMSStatus", "DMSDocumentID"], dict)).toEqual([
      "DMSDocumentID",
      "DMSStatus",
      "DMSOwner",
    ]);
    // unknown to the dictionary = keep relative order, at the end
    expect(sortByDictionary(["Zeta", "DMSOwner", "Alpha"], dict)).toEqual([
      "DMSOwner",
      "Zeta",
      "Alpha",
    ]);
    expect(sortByDictionary([], dict)).toEqual([]);
  });

  it("lists libraries standards-first, the way the site reads", async () => {
    const { sortLibrariesForDisplay } = await import("../docs/model");
    const lib = (libType: string, name: string, title = "") => ({
      libType,
      name,
      config: { title },
    });
    const sorted = sortLibrariesForDisplay([
      lib("template", "Templates"),
      lib("record", "Records"),
      lib("working", "Working Documents"),
      lib("standard", "Standards"),
      lib("revision", "Standards Revision"),
    ]);
    expect(sorted.map((l) => l.name)).toEqual([
      "Standards",
      "Working Documents",
      "Standards Revision",
      "Records",
      "Templates",
    ]);
    // same type: display name decides, and the display override wins
    const two = sortLibrariesForDisplay([
      lib("working", "ZZZ internal", "Alpha docs"),
      lib("working", "Beta docs"),
    ]);
    expect(two.map((l) => l.config.title || l.name)).toEqual(["Alpha docs", "Beta docs"]);
  });

  it("makes a name SharePoint will take", async () => {
    const { sanitizeFileName } = await import("../docs/model");
    expect(sanitizeFileName('Q3: "Casting" <plan>?')).toBe("Q3 Casting plan");
    expect(sanitizeFileName("  trailing dots... ")).toBe("trailing dots");
    expect(sanitizeFileName("###")).toBe("");
    expect(sanitizeFileName("plain name")).toBe("plain name");
  });
});

describe("lifecycle mapping (5A)", () => {
  it("round-trips through the site dictionary, keyed lowercase", async () => {
    const { parseAppDocsConfig, serializeAppDocsConfig, emptyAppDocsConfig, stageOfTerm } =
      await import("../docs/model");
    const cfg = emptyAppDocsConfig();
    cfg.siteUrl = "https://x/sites/Dev";
    cfg.controllersGroupId = "g-1";
    cfg.controllersGroupName = "Document controllers";
    cfg.sites["x/sites/dev"] = {
      columns: [],
      palettes: [],
      templates: {},
      lifecycle: { "aaa-1": "approved", "bbb-2": "draft" },
    };
    const back = parseAppDocsConfig(serializeAppDocsConfig(cfg));
    expect(back.controllersGroupId).toBe("g-1");
    expect(back.controllersGroupName).toBe("Document controllers");
    const dict = back.sites["x/sites/dev"];
    expect(stageOfTerm(dict, "AAA-1")).toBe("approved");
    expect(stageOfTerm(dict, "bbb-2")).toBe("draft");
    expect(stageOfTerm(dict, "missing")).toBe("");
    // junk stages are dropped at parse, never smuggled into the enum
    const dirty = parseAppDocsConfig(
      JSON.stringify({ sites: { k: { lifecycle: { x: "nonsense", y: "obsolete" } } } })
    );
    expect(dirty.sites.k.lifecycle).toEqual({ y: "obsolete" });
  });

  it("suggests stages with the approval filter's own vocabulary", async () => {
    const { suggestStageForLabel } = await import("../docs/model");
    expect(suggestStageForLabel("Draft")).toBe("draft");
    expect(suggestStageForLabel("In Review")).toBe("inReview");
    expect(suggestStageForLabel("Awaiting Review")).toBe("inReview");
    // review is content work; approval is sign-off — two circulations,
    // two stages (Ben, 2026-08-04)
    expect(suggestStageForLabel("Awaiting Approval")).toBe("inApproval");
    expect(suggestStageForLabel("In Approval")).toBe("inApproval");
    expect(suggestStageForLabel("Approved")).toBe("approved");
    expect(suggestStageForLabel("Current")).toBe("approved");
    expect(suggestStageForLabel("Superseded")).toBe("superseded");
    expect(suggestStageForLabel("Retired")).toBe("obsolete");
    // no opinion is an answer — the admin decides
    expect(suggestStageForLabel("Banana")).toBe("");
  });

  it("reports the gaps commands would fall into", async () => {
    const { lifecycleHealth } = await import("../docs/model");
    const dict = {
      columns: [],
      palettes: [],
      templates: {},
      lifecycle: { "t-1": "draft" as const },
    };
    const terms = [
      { id: "t-1", label: "Draft" },
      { id: "t-2", label: "Approved" },
    ];
    const found = lifecycleHealth(dict, terms);
    expect(found.some((f) => f.title.includes("without a lifecycle stage"))).toBe(true);
    expect(found.some((f) => f.title.includes("No status term is mapped as Approved"))).toBe(true);
    // fully mapped = silence
    const full = { ...dict, lifecycle: { "t-1": "draft" as const, "t-2": "approved" as const } };
    expect(lifecycleHealth(full, terms)).toEqual([]);
    // no terms readable = nothing to judge
    expect(lifecycleHealth(dict, [])).toEqual([]);
  });

  it("lists a stage's terms — what a command writes", async () => {
    const { termsForStage } = await import("../docs/model");
    const dict = {
      columns: [],
      palettes: [],
      templates: {},
      lifecycle: {
        "t-1": "approved" as const,
        "t-2": "approved" as const,
        "t-3": "draft" as const,
      },
    };
    expect(termsForStage(dict, "approved")).toEqual(["t-1", "t-2"]);
    expect(termsForStage(dict, "obsolete")).toEqual([]);
    expect(termsForStage({ columns: [], palettes: [], templates: {} }, "draft")).toEqual([]);
  });
});

describe("lifecycle commands (5B/5C — the settled workflow)", () => {
  const gates = (over: Partial<Record<string, boolean>> = {}) => ({
    isApprover: false,
    hasApprovers: false,
    hasReviewers: false,
    isOwner: false,
    isAdmin: false,
    ...over,
  });

  it("review is mandatory when reviewers are named; approval entry depends on approvers", async () => {
    const { lifecycleCommandsFor } = await import("../docs/model");
    // no reviewers: a draft may skip straight to approval
    const free = lifecycleCommandsFor("draft", gates());
    expect(free.map((c) => c.key)).toEqual(["submitReview", "submitApproval"]);
    // no approvers named → submission lands at the OWNER's stage
    expect(free[1].to).toBe("inOwnerApproval");
    // approvers named → the endorsement stage first
    expect(lifecycleCommandsFor("draft", gates({ hasApprovers: true }))[1].to).toBe("inApproval");
    // reviewers named = review round MANDATORY (Ben, 2026-08-04)
    expect(lifecycleCommandsFor("draft", gates({ hasReviewers: true })).map((c) => c.key)).toEqual([
      "submitReview",
    ]);
    expect(
      lifecycleCommandsFor("inReview", gates({ hasApprovers: true })).map((c) => c.key)
    ).toEqual(["submitApproval", "requestRevision"]);
  });

  it("approval is two steps: approvers endorse (minor), the owner's word is major", async () => {
    const { lifecycleCommandsFor } = await import("../docs/model");
    // approvers' step: an approver endorses it ONWARD, as a minor
    const endorse = lifecycleCommandsFor("inApproval", gates({ isApprover: true, hasApprovers: true }));
    expect(endorse[0].key).toBe("approve");
    expect(endorse[0].to).toBe("inOwnerApproval");
    expect(endorse[0].major).toBe(false);
    // the owner is NOT gated in at the approvers' step by ownership…
    expect(
      lifecycleCommandsFor("inApproval", gates({ hasApprovers: true, isOwner: true })).map((c) => c.key)
    ).toEqual(["requestRevision"]);
    // …their word comes at THEIR stage, and it is the major
    const final = lifecycleCommandsFor("inOwnerApproval", gates({ isOwner: true }));
    expect(final[0].key).toBe("approve");
    expect(final[0].to).toBe("approved");
    expect(final[0].major).toBe(true);
    // admins stand in at both steps; bystanders can only send it back
    expect(
      lifecycleCommandsFor("inApproval", gates({ isAdmin: true }))[0].key
    ).toBe("approve");
    expect(
      lifecycleCommandsFor("inOwnerApproval", gates({ isAdmin: true }))[0].key
    ).toBe("approve");
    expect(lifecycleCommandsFor("inOwnerApproval", gates()).map((c) => c.key)).toEqual([
      "requestRevision",
    ]);
  });

  it("approved offers Start revision (gated), which stays checked out", async () => {
    const { lifecycleCommandsFor } = await import("../docs/model");
    const revise = lifecycleCommandsFor("approved", gates({ isOwner: true }));
    expect(revise.map((c) => c.key)).toEqual(["revise"]);
    // the whole revision lives inside the check-out: no check-in, and
    // Discard reverts everything (Ben, 2026-08-04)
    expect(revise[0].staysCheckedOut).toBe(true);
    expect(lifecycleCommandsFor("approved", gates())).toEqual([]);
    // superseded / obsolete / unmapped: 5D's turf, nothing offered yet
    expect(lifecycleCommandsFor("superseded", gates({ isAdmin: true }))).toEqual([]);
    expect(lifecycleCommandsFor("", gates({ isAdmin: true }))).toEqual([]);
  });

  it("revision demands its reason", async () => {
    const { LIFECYCLE_COMMANDS } = await import("../docs/model");
    const by = Object.fromEntries(LIFECYCLE_COMMANDS.map((c) => [c.key, c]));
    expect(by.requestRevision.needsReason).toBe(true);
    expect(by.approve.needsReason).toBe(false);
  });

  it("resolves the term a command writes, or refuses to offer it", async () => {
    const { termForStage } = await import("../docs/model");
    const dict = {
      columns: [],
      palettes: [],
      templates: {},
      lifecycle: { "t-appr": "approved" as const, "t-gone": "inReview" as const },
    };
    const terms = [
      { id: "T-APPR", label: "Approved" },
      { id: "t-draft", label: "Draft" },
    ];
    // id casing tolerated; label comes back real-cased for the write
    expect(termForStage(dict, "approved", terms)).toEqual({ id: "T-APPR", label: "Approved" });
    // mapped to a term the set no longer has = null, command withheld
    expect(termForStage(dict, "inReview", terms)).toBeNull();
    expect(termForStage(dict, "obsolete", terms)).toBeNull();
  });
});

describe("view templates (C5)", () => {
  const sc = (internal: string, role = "") => ({
    internal,
    label: "",
    role,
    available: true,
    termSetId: "",
    isDate: false,
    filterable: true,
  });
  const dict = {
    columns: [sc("DMSType", "docType"), sc("DMSOwner", "owner"), sc("DMSStatus", "status"), sc("Notes")],
    palettes: [],
    templates: {},
  };

  it("falls back to the roles a type implies, in dictionary order", async () => {
    const { templateFor } = await import("../docs/model");
    // nothing configured: standards open with type, owner, status
    expect(templateFor(dict, "standard")).toEqual(["DMSType", "DMSOwner", "DMSStatus"]);
    // a plain column is not implied by any role
    expect(templateFor(dict, "standard")).not.toContain("Notes");
  });

  it("prefers a stored template but drops columns the site dropped", async () => {
    const { templateFor } = await import("../docs/model");
    const withTmpl = { ...dict, templates: { record: ["DMSOwner", "Vanished", "Notes"] } };
    expect(templateFor(withTmpl, "record")).toEqual(["DMSOwner", "Notes"]);
    // and a template emptied by that filtering falls back rather than
    // leaving a library with no columns at all
    const stale = { ...dict, templates: { record: ["Vanished"] } };
    expect(templateFor(stale, "record").length).toBeGreaterThan(0);
  });

  it("applying REPLACES the ticks, and matching ignores order", async () => {
    const { applyViewTemplate, matchesTemplate } = await import("../docs/model");
    const cfg = {
      title: "",
      renditionPath: "",
      statusColors: {},
      columns: [
        dictCol("DMSType", "", "", { inDefault: true }),
        dictCol("DMSOwner", "", "", { inDefault: false }),
      ],
    };
    const out = applyViewTemplate(cfg, ["DMSOwner"]);
    // the old tick is cleared, not merged — otherwise the result is
    // neither the template nor what was there before
    expect(out.columns.map((c) => c.inDefault)).toEqual([false, true]);
    expect(matchesTemplate(out, ["DMSOwner"])).toBe(true);
    expect(matchesTemplate(out, ["DMSOwner", "Modified"])).toBe(true);
    expect(matchesTemplate(out, ["DMSType"])).toBe(false);
  });

  it("round-trips templates through the app config", async () => {
    const { parseAppDocsConfig, serializeAppDocsConfig, emptyAppDocsConfig } = await import("../docs/model");
    const cfg = {
      ...emptyAppDocsConfig(),
      sites: { "https://x/sites/d": { ...dict, templates: { working: ["DMSOwner"], bogus: ["X"] } } },
    };
    const back = parseAppDocsConfig(serializeAppDocsConfig(cfg as never));
    expect(back.sites["https://x/sites/d"].templates.working).toEqual(["DMSOwner"]);
    // an unknown library type is not a template
    expect((back.sites["https://x/sites/d"].templates as Record<string, unknown>).bogus).toBeUndefined();
  });
});
