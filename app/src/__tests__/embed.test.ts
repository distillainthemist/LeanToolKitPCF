import { describe, expect, it } from "vitest";
import {
  buildEmbedUrl,
  extractIframeSrc,
  isPowerBiUrl,
  isSharePointUrl,
  safeEmbedUrl,
  sharePointEmbedUrl,
} from "../../../controls/EmbedCard/types";

describe("safeEmbedUrl", () => {
  it("passes https through and adds a scheme to bare hosts", () => {
    expect(safeEmbedUrl("https://www.pecheydistilling.com.au")).toBe(
      "https://www.pecheydistilling.com.au"
    );
    expect(safeEmbedUrl("www.pecheydistilling.com.au")).toBe(
      "https://www.pecheydistilling.com.au"
    );
  });

  it("rejects empty and non-http schemes", () => {
    expect(safeEmbedUrl("")).toBe("");
    expect(safeEmbedUrl("  ")).toBe("");
    expect(safeEmbedUrl("javascript:alert(1)")).toBe("");
  });
});

describe("isPowerBiUrl", () => {
  it("recognises the Power BI service across clouds", () => {
    expect(isPowerBiUrl("https://app.powerbi.com/reportEmbed?reportId=x")).toBe(true);
    expect(isPowerBiUrl("https://app.powerbi.cn/reportEmbed")).toBe(true);
    expect(isPowerBiUrl("https://www.pecheydistilling.com.au")).toBe(false);
  });
});

describe("extractIframeSrc", () => {
  it("lifts the src out of a pasted iframe snippet and decodes &amp;", () => {
    const snippet =
      '<iframe width="640" height="480" ' +
      'src="https://app.powerbi.com/reportEmbed?reportId=abc&amp;autoAuth=true" ' +
      'frameborder="0" allowFullScreen="true"></iframe>';
    expect(extractIframeSrc(snippet)).toBe(
      "https://app.powerbi.com/reportEmbed?reportId=abc&autoAuth=true"
    );
  });

  it("returns a plain url unchanged", () => {
    expect(extractIframeSrc("https://app.powerbi.com/x")).toBe(
      "https://app.powerbi.com/x"
    );
  });

  it("flows through safeEmbedUrl", () => {
    expect(
      safeEmbedUrl('<iframe src="https://contoso.sharepoint.com/x"></iframe>')
    ).toBe("https://contoso.sharepoint.com/x");
  });
});

describe("isSharePointUrl", () => {
  it("recognises SharePoint / OneDrive-for-Business hosts", () => {
    expect(isSharePointUrl("https://contoso.sharepoint.com/sites/x")).toBe(true);
    expect(isSharePointUrl("https://contoso-my.sharepoint.com/personal/x")).toBe(true);
    expect(isSharePointUrl("https://app.powerbi.com/x")).toBe(false);
  });
});

describe("sharePointEmbedUrl", () => {
  it("rewrites a Doc.aspx link to the embed view", () => {
    const out = sharePointEmbedUrl(
      "https://contoso.sharepoint.com/sites/Ops/_layouts/15/Doc.aspx?sourcedoc=%7BGUID%7D&file=book.xlsx&action=default"
    );
    const u = new URL(out);
    expect(u.searchParams.get("action")).toBe("embedview");
    expect(u.searchParams.get("sourcedoc")).toBe("{GUID}");
  });

  it("leaves an already-embed url untouched", () => {
    const embed =
      "https://contoso.sharepoint.com/_layouts/15/embed.aspx?UniqueId=abc";
    expect(sharePointEmbedUrl(embed)).toBe(embed);
  });

  it("leaves a modern short share link untouched (can't convert client-side)", () => {
    const share = "https://contoso-my.sharepoint.com/:x:/r/personal/a_b/ETokenHere";
    expect(sharePointEmbedUrl(share)).toBe(share);
  });

  it("is applied by buildEmbedUrl for SharePoint links", () => {
    const out = buildEmbedUrl({
      url: "https://contoso.sharepoint.com/sites/Ops/_layouts/15/Doc.aspx?sourcedoc=x",
      hideFilterPane: false,
      hidePageNav: false,
      pageName: "",
    });
    expect(new URL(out).searchParams.get("action")).toBe("embedview");
  });
});

describe("buildEmbedUrl", () => {
  it("returns the generic url untouched", () => {
    expect(
      buildEmbedUrl({
        url: "www.pecheydistilling.com.au",
        hideFilterPane: true, // Power BI only — ignored here
        hidePageNav: true,
        pageName: "x",
      })
    ).toBe("https://www.pecheydistilling.com.au");
  });

  it("injects the Power BI pane toggles and page as query params", () => {
    const out = buildEmbedUrl({
      url: "https://app.powerbi.com/reportEmbed?reportId=abc",
      hideFilterPane: true,
      hidePageNav: true,
      pageName: "ReportSection2",
    });
    const u = new URL(out);
    expect(u.searchParams.get("reportId")).toBe("abc");
    expect(u.searchParams.get("filterPaneEnabled")).toBe("false");
    expect(u.searchParams.get("navContentPaneEnabled")).toBe("false");
    expect(u.searchParams.get("pageName")).toBe("ReportSection2");
  });

  it("is empty for an unusable url", () => {
    expect(buildEmbedUrl({ url: "", hideFilterPane: false, hidePageNav: false, pageName: "" })).toBe("");
  });
});
