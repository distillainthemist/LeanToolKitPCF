// LinksCard (2026-10-08): the document's parse / serialize, the title a
// pasted URL gets, grouping, and the host glyph — all pure.

import { describe, expect, it } from "vitest";
import { folderTarget, groupLinks, hostKind, isTokenShare, linkText, parseLinks, serializeLinks, titleFromUrl } from "../../../controls/LinksCard/types";

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

describe("folderTarget", () => {
  it("resolves a library path to its site and server-relative path", () => {
    expect(folderTarget("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202")).toEqual({ site: "https://contoso.sharepoint.com/sites/ops", path: "/sites/ops/Shared Documents/Line 2" });
  });
  it("reads the folder out of an AllItems / onedrive view link", () => {
    expect(folderTarget("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fops%2FShared%20Documents%2FProjects&viewid=1")).toEqual({ site: "https://contoso.sharepoint.com/sites/ops", path: "/sites/ops/Shared Documents/Projects" });
    expect(folderTarget("https://contoso-my.sharepoint.com/personal/ben_contoso_com/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fben_contoso_com%2FDocuments%2FLine%202")).toEqual({ site: "https://contoso-my.sharepoint.com/personal/ben_contoso_com", path: "/personal/ben_contoso_com/Documents/Line 2" });
  });
  it("reads a /:f:/r/ sharing link, which carries the path", () => {
    expect(folderTarget("https://contoso.sharepoint.com/:f:/r/sites/ops/Shared%20Documents/Line%202?csf=1&web=1")).toEqual({ site: "https://contoso.sharepoint.com/sites/ops", path: "/sites/ops/Shared Documents/Line 2" });
  });
  it("cannot resolve a /:f:/g/ token share, a layouts page, a site root or a non-SharePoint link", () => {
    expect(folderTarget("https://pecheydistillingcom-my.sharepoint.com/:f:/g/personal/partnership_pecheydistilling_com/IgAzE8mq?e=rPEaS8")).toBeNull();
    expect(folderTarget("https://contoso.sharepoint.com/sites/ops/_layouts/15/viewlsts.aspx")).toBeNull();
    expect(folderTarget("https://contoso.sharepoint.com/sites/ops")).toBeNull();
    expect(folderTarget("https://example.com/folder")).toBeNull();
    expect(folderTarget("not a url")).toBeNull();
  });
  it("knows a token share when it sees one", () => {
    expect(isTokenShare("https://pecheydistillingcom-my.sharepoint.com/:f:/g/personal/x/Ig?e=1")).toBe(true);
    expect(isTokenShare("https://contoso.sharepoint.com/:f:/r/sites/ops/Docs")).toBe(false);
    expect(linkText("https://pecheydistillingcom-my.sharepoint.com/:f:/g/personal/x/Ig?e=1")).toBe("pecheydistillingcom-my.sharepoint.com › shared folder");
  });
});
