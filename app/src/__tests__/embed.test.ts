import { describe, expect, it } from "vitest";
import {
  buildEmbedUrl,
  isPowerBiUrl,
  safeEmbedUrl,
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
