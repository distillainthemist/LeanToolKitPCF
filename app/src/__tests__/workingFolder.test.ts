// The initiative working folder (2026-10-08): the url test, the display
// text for long SharePoint / Teams links, and the host kind for the glyph.

import { describe, expect, it } from "vitest";
import { linkDisplayText, linkHostKind, workingFolderUrl } from "../improvement/workingFolder";

describe("workingFolderUrl", () => {
  it("accepts an https link and nothing else", () => {
    expect(workingFolderUrl({ workingFolder: " https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202 " })).toBe("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202");
    expect(workingFolderUrl({ workingFolder: "http://insecure" })).toBe("");
    expect(workingFolderUrl({ workingFolder: "not a link" })).toBe("");
    expect(workingFolderUrl(undefined)).toBe("");
  });
});

describe("linkDisplayText", () => {
  it("reads host and the last two folders of a SharePoint path", () => {
    expect(linkDisplayText("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202%20changeover")).toBe("contoso.sharepoint.com › Shared Documents › Line 2 changeover");
  });
  it("reads the folder from an AllItems link's id", () => {
    expect(linkDisplayText("https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fops%2FShared%20Documents%2FProjects%2FLine%202&viewid=abc")).toBe("contoso.sharepoint.com › Projects › Line 2");
  });
  it("falls back to the url when it cannot parse", () => {
    expect(linkDisplayText("nope")).toBe("nope");
  });
});

describe("linkHostKind", () => {
  it("tells SharePoint, OneDrive, Teams and the web apart", () => {
    expect(linkHostKind("https://contoso.sharepoint.com/sites/ops")).toBe("sharepoint");
    expect(linkHostKind("https://contoso-my.sharepoint.com/personal/ben")).toBe("onedrive");
    expect(linkHostKind("https://teams.microsoft.com/l/channel/x")).toBe("teams");
    expect(linkHostKind("https://example.com/doc")).toBe("web");
    expect(linkHostKind("nope")).toBe("web");
  });
});
