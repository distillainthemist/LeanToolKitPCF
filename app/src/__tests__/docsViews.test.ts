// Standard Documents Phase 3: view encode/decode (the shared-link
// payload), saved-view and favourites round-trips, CSV escaping.

import { describe, expect, it } from "vitest";
import {
  decodeDocView,
  emptyDocView,
  encodeDocView,
  parseDocViews,
  parseFavDocs,
  serializeDocViews,
  serializeFavDocs,
  toCsv,
} from "../docs/views";

describe("view link payload", () => {
  it("round-trips the full state, dropping the name (links carry state, not ids)", () => {
    const v = {
      name: "My casting view",
      listId: "l1",
      query: "sop",
      contents: true,
      nonCurrent: true,
      orgTermId: "t9",
      orgPath: ["Bell Bay", "Casting"],
      filters: [{ col: "DMSProcess", termId: "p3", path: ["Casting", "Rodding"] }],
      columns: ["DMSStatus", "Modified"],
      groupBy: "DMSProcess",
    };
    const back = decodeDocView(encodeDocView(v));
    expect(back).toEqual({ ...v, name: "" });
  });

  it("a pre-3a payload keeps opening — new fields default empty", () => {
    // exactly what a v0.20–v0.23 link carries
    const legacy = '{"l":"l1","q":"sop","c":1,"o":"t9","p":["Bell Bay"]}';
    const v = decodeDocView(legacy);
    expect(v.listId).toBe("l1");
    expect(v.orgTermId).toBe("t9");
    expect(v.filters).toEqual([]);
    expect(v.columns).toEqual([]);
    expect(v.groupBy).toBe("");
    // and a filter entry missing its column or term is dropped, not kept broken
    const partial = decodeDocView('{"f":[{"c":"DMSProcess"},{"c":"A","t":"t1"}]}');
    expect(partial.filters).toEqual([{ col: "A", termId: "t1", path: [] }]);
  });

  it("an empty view encodes tiny and decodes to defaults", () => {
    expect(encodeDocView(emptyDocView())).toBe("{}");
    expect(decodeDocView("{}")).toEqual(emptyDocView());
  });

  it("a mangled link opens the plain area rather than throwing", () => {
    expect(decodeDocView("not json")).toEqual(emptyDocView());
    expect(decodeDocView("")).toEqual(emptyDocView());
  });
});

describe("saved lists", () => {
  it("saved views round-trip and drop nameless entries", () => {
    const views = [
      { ...emptyDocView(), name: "A", listId: "l1" },
      { ...emptyDocView(), name: "", query: "orphan" },
    ];
    const back = parseDocViews(serializeDocViews(views));
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe("A");
    expect(parseDocViews("garbage")).toEqual([]);
  });

  it("favourites round-trip and drop broken entries", () => {
    const favs = [
      { uniqueId: "u1", name: "A.pdf", ext: "pdf", serverUrl: "/s/A.pdf", listId: "l1" },
    ];
    expect(parseFavDocs(serializeFavDocs(favs))).toEqual(favs);
    expect(parseFavDocs('[{"name":"no id"}]')).toEqual([]);
    expect(parseFavDocs(null)).toEqual([]);
  });
});

describe("register CSV (FR-RP-008)", () => {
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv(
      ["Document", "Owner"],
      [
        ["Plain.docx", "Ben"],
        ['He said "go", then', "a,b"],
        ["Multi\nline", "ok"],
      ]
    );
    expect(csv.split("\r\n")[0]).toBe("Document,Owner");
    expect(csv).toContain('"He said ""go"", then","a,b"');
    expect(csv).toContain('"Multi\nline",ok');
  });
});
