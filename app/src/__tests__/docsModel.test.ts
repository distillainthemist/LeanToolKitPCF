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
        { internal: "Title", title: "Name", type: "Text", choices: [], isTaxonomy: false, termSetId: "" },
        { internal: "DMSStatus", title: "Status", type: "Choice", choices: [], isTaxonomy: false, termSetId: "" },
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
        { internal: "DMSOrgUnit", title: "Org", type: "TaxonomyFieldType", choices: [], isTaxonomy: true, termSetId: "new-set" },
        { internal: "DMSTags", title: "Tags", type: "TaxonomyFieldTypeMulti", choices: [], isTaxonomy: true, termSetId: "" },
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
    const dict = { columns: [{ internal: "Other", label: "", role: "", available: true, termSetId: "" }], palettes: [] };
    expect(resolveLibraryConfig(cfg, dict).columns[0].role).toBe("tags");
  });

  it("round-trips the dictionary through the app config, keyed per site", async () => {
    const { parseAppDocsConfig, serializeAppDocsConfig, emptyAppDocsConfig } = await import("../docs/model");
    const cfg = {
      ...emptyAppDocsConfig(),
      siteUrl: "https://x.sharepoint.com/sites/Dev",
      sites: {
        "https://x.sharepoint.com/sites/dev": {
          columns: [{ internal: "DMSStatus", label: "Status", role: "status", available: true, termSetId: "set-9" }],
          palettes: [{ setId: "set-9", setName: "Approval", entries: { Approved: { color: "good", glyph: "✓", label: "Approved" } } }],
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
  });

  it("keeps chosen mappings, appends new columns, drops vanished ones", async () => {
    const { syncSiteDictionary } = await import("../docs/model");
    const stored = {
      columns: [
        { internal: "DMSStatus", label: "Status", role: "status", available: true, termSetId: "" },
        { internal: "Retired", label: "Gone", role: "tags", available: true, termSetId: "" },
      ],
      palettes: [],
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
      { columns: [{ internal: "DMSTags", label: "", role: "tags", available: true, termSetId: "kept" }], palettes: [] },
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
      columns: [
        { internal: "DMSStatus", label: "", role: "status", available: true, termSetId: "set-9" },
        { internal: "DMSDocumentStatus", label: "", role: "", available: true, termSetId: "set-9" },
        { internal: "DMSImportance", label: "", role: "importance", available: true, termSetId: "set-3" },
        { internal: "Hidden", label: "", role: "", available: false, termSetId: "set-4" },
        { internal: "PlainText", label: "", role: "", available: true, termSetId: "" },
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
      dict: { columns: [sc("A", "status"), sc("B", "status"), sc("C", "owner")], palettes: [] },
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
      dict: { columns: [sc("DMSOwner", "owner"), sc("Noise")], palettes: [] },
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
