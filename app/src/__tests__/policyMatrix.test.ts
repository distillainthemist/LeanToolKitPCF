// The registry's data-policy matrix (leanboard-card-settings-plan.md phase 1):
// every visible card either IS an action surface, is series-backed (no
// choice), or declares which of clear/carry/shared it offers plus the
// default stamped onto newly created slots. Link is never offered — the
// LinkCard card type replaces it (phase 4).

import { describe, expect, it } from "vitest";
import {
  CARDS,
  cardSpec,
  LINK_SOURCE_EXCLUDED,
  policyOnPick,
} from "../../../controls/CardSettings/registry";

const ACTION_SURFACES = new Set(["ActionBoard", "EscalationViewer"]);

describe("policy matrix coverage", () => {
  it("every visible card is a surface, series-backed, or declares policies", () => {
    for (const card of CARDS) {
      if (card.hidden || ACTION_SURFACES.has(card.type)) continue;
      // policies: [] is a valid declaration — a no-document card (LinkCard)
      const declared = card.seriesBacked === true || card.policies !== undefined;
      expect(declared, `${card.type} declares no policy story`).toBe(true);
    }
  });

  it("never offers link, and defaults are members of the offering", () => {
    for (const card of CARDS) {
      expect(card.policies ?? [], card.type).not.toContain("link");
      if (card.policies && card.policies.length > 0) {
        expect(card.defaultPolicy, `${card.type} has policies but no default`).toBeDefined();
        expect(card.policies, card.type).toContain(card.defaultPolicy);
      }
    }
  });

  it("LinkCard: Reference group, no policy choice, sources constrained", () => {
    const spec = cardSpec("LinkCard")!;
    expect(spec.group).toBe("Reference");
    expect(spec.policies).toEqual([]);
    expect(spec.defaultPolicy).toBeUndefined();
    // no chains, no embeds, no action surfaces, no scheduler, and no
    // live SharePoint views (a live view of a live view is noise)
    expect([...LINK_SOURCE_EXCLUDED].sort()).toEqual([
      "ActionBoard",
      "CanvasRollup",
      "CaptureRollup",
      "DocHealth",
      "DocsCard",
      "EmbedCard",
      "EscalationViewer",
      "LinkCard",
      "MeetingScheduler",
      "PrioritiesCard",
    ]);
  });

  it("CanvasRollup mirrors the capture rollup's contract", () => {
    const spec = cardSpec("CanvasRollup")!;
    expect(spec.group).toBe("Project management");
    expect(spec.policies).toEqual([]);
    expect(spec.fixedPolicy).toBe("shared");
    expect(spec.standardContent).toBe("preview");
    expect(LINK_SOURCE_EXCLUDED.has("CanvasRollup")).toBe(true);
  });

  it("CaptureRollup: fixed shared, no picker, preview standard content", () => {
    const spec = cardSpec("CaptureRollup")!;
    expect(spec.group).toBe("Rituals");
    // no maker choice — the live row exists for tiles/archives only
    expect(spec.policies).toEqual([]);
    expect(spec.fixedPolicy).toBe("shared");
    expect(spec.defaultPolicy).toBeUndefined();
    expect(spec.standardContent).toBe("preview");
    // a rollup can never be a LinkCard source (no chains)
    expect(LINK_SOURCE_EXCLUDED.has("CaptureRollup")).toBe(true);
  });

  it("a series-backed card offers no picker at all", () => {
    for (const type of ["SqdpcCard", "ConditionsCard", "KpiTrendCard", "ParetoCard"]) {
      const spec = cardSpec(type)!;
      expect(spec.seriesBacked, type).toBe(true);
      expect(spec.policies, type).toBeUndefined();
    }
  });

  it("registers never offer clear — it would empty the register each meeting", () => {
    for (const type of ["RiskMatrix", "Raci", "SkillsMatrix"]) {
      expect(cardSpec(type)!.policies).toEqual(["carry", "shared"]);
      expect(cardSpec(type)!.defaultPolicy).toBe("shared");
    }
  });

  it("the ritual defaults: agenda clear, status tile carry (no clear)", () => {
    expect(cardSpec("AgendaCard")!.defaultPolicy).toBe("clear");
    expect(cardSpec("StatusTile")!.policies).toEqual(["carry", "shared"]);
  });
});

describe("policyOnPick — the stamp on card-type selection", () => {
  it("stamps the type's default on a fresh slot", () => {
    expect(policyOnPick("AgendaCard", "")).toBe("clear");
    expect(policyOnPick("RiskMatrix", "")).toBe("shared");
    expect(policyOnPick("CaptureCard", "")).toBe("carry");
  });

  it("keeps a still-offered policy across a type change", () => {
    expect(policyOnPick("CaptureCard", "shared")).toBe("shared");
  });

  it("replaces a policy the new type does not offer", () => {
    // AgendaCard(clear) changed to RiskMatrix: clear not offered → default
    expect(policyOnPick("RiskMatrix", "clear")).toBe("shared");
    // legacy link is never offered anywhere
    expect(policyOnPick("CaptureCard", "link")).toBe("carry");
  });

  it("stamps nothing for series-backed cards and action surfaces", () => {
    expect(policyOnPick("SqdpcCard", "carry")).toBe("");
    expect(policyOnPick("ActionBoard", "clear")).toBe("");
  });

  it("leaves unknown types untouched", () => {
    expect(policyOnPick("NotACard", "shared")).toBe("shared");
  });
});

// ---- card-studio contracts (card-studio plan, phase 0) ----

describe("standardContent classifier", () => {
  it("every series-backed card is preview (a read-only pane cannot fire series writes)", () => {
    for (const card of CARDS) {
      if (!card.seriesBacked) continue;
      expect(card.standardContent, card.type).toBe("preview");
    }
  });

  it("preview cards explain why, edit cards do not need to", () => {
    for (const card of CARDS) {
      if (card.standardContent === "preview") {
        expect(card.standardContentNote, `${card.type} preview with no reason`).toBeTruthy();
      }
    }
  });

  it("the action surfaces and LinkCard are preview; document cards default to edit", () => {
    for (const type of ["ActionBoard", "EscalationViewer", "LinkCard"]) {
      expect(cardSpec(type)!.standardContent, type).toBe("preview");
    }
    for (const type of ["FiveWhys", "AgendaCard", "RiskMatrix", "StatusTile", "EmbedCard"]) {
      // undefined = "edit" (the default)
      expect(cardSpec(type)!.standardContent ?? "edit", type).toBe("edit");
    }
  });
});
