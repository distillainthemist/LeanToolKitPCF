// LinksCard (2026-10-08): the document's parse / serialize, the title a
// pasted URL gets, grouping, and the host glyph — all pure.

import { describe, expect, it } from "vitest";
import { groupLinks, hostKind, linkText, parseLinks, serializeLinks, titleFromUrl } from "../../../controls/LinksCard/types";

describe("parseLinks / serializeLinks", () => {
  it("round-trips a list and drops links without an https url", () => {
    const env = parseLinks(JSON.stringify({ data: { links: [
      { id: "a", title: "Spec", url: "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Spec.docx", note: "v3", group: "Design" },
      { id: "b", title: "Bad", url: "http://insecure", note: "", group: "" },
      { title: "No id", url: "https://example.com/x", note: "", group: "" },
    ] } }));
    expect(env.data.links.map((l) => l.title)).toEqual(["Spec", "No id"]);
    expect(env.data.links[1].id).not.toBe("");
    const again = parseLinks(serializeLinks(env));
    expect(again.data.links).toEqual(env.data.links);
  });
  it("yields an empty list for nothing or rubbish", () => {
    expect(parseLinks("").data.links).toEqual([]);
    expect(parseLinks("{not json").data.links).toEqual([]);
  });
});

describe("titleFromUrl", () => {
  it("takes the last path segment, decoded, dashes as spaces", () => {
    expect(titleFromUrl("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line-2_changeover")).toBe("Line 2 changeover");
    expect(titleFromUrl("https://example.com/")).toBe("example.com");
    expect(titleFromUrl("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fops%2FShared%20Documents%2FProjects")).toBe("Projects");
  });
});

describe("groupLinks / hostKind / linkText", () => {
  it("keeps the ungrouped first and groups in first-seen order", () => {
    const links = parseLinks(JSON.stringify({ data: { links: [
      { title: "b", url: "https://x.com/b", group: "B" }, { title: "u", url: "https://x.com/u", group: "" }, { title: "a", url: "https://x.com/a", group: "A" }, { title: "b2", url: "https://x.com/b2", group: "B" },
    ] } })).data.links;
    expect(groupLinks(links).map((g) => [g.group, g.links.length])).toEqual([["", 1], ["B", 2], ["A", 1]]);
  });
  it("names the service and reads a long link", () => {
    expect(hostKind("https://contoso.sharepoint.com/sites/ops")).toBe("sharepoint");
    expect(hostKind("https://teams.microsoft.com/l/channel/x")).toBe("teams");
    expect(linkText("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202")).toBe("contoso.sharepoint.com › Shared Documents › Line 2");
  });
});
