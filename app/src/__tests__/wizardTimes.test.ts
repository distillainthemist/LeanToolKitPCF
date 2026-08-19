import { describe, expect, it } from "vitest";
import { emptyDraft, hasDayRows, isSingleDay, parseWizardDraft, serializeWizardDraft } from "../../../controls/MeetingWizard/types";

describe("wizard: times by day / week (kickoff-closeout)", () => {
  it("weekly is multi-day; fortnightly stays single-day", () => {
    expect(isSingleDay("weekly")).toBe(false);
    expect(isSingleDay("fortnightly")).toBe(true);
    expect(hasDayRows("weekly")).toBe(true);
    expect(hasDayRows("monthly")).toBe(false);
  });
  it("round-trips dayTimes / weekTimes, dropping overrides equal to the default", () => {
    const d = emptyDraft();
    d.title = "Weekly cycle";
    d.category = "weekly";
    d.daysOfWeek = "Mon,Fri";
    d.timeOfDay = "09:00";
    d.dayTimes = { Mon: "07:00", Fri: "15:00", Wed: "09:00" };
    d.dayTopics = { Mon: "Kickoff", Fri: "Closeout" };
    d.weekTimes = ["", "10:00"];
    const json = serializeWizardDraft(d);
    const cfg = (JSON.parse(json) as { config: Record<string, unknown> }).config;
    expect(cfg.dayTimes).toEqual({ Mon: "07:00", Fri: "15:00" });
    expect(cfg.weekTimes).toEqual(["", "10:00"]);
    expect(cfg.dayTopics).toEqual({ Mon: "Kickoff", Fri: "Closeout" });
    const back = parseWizardDraft(json);
    expect(back.dayTimes).toEqual({ Mon: "07:00", Fri: "15:00" });
    expect(back.weekTimes).toEqual(["", "10:00"]);
    expect(back.daysOfWeek).toBe("Mon,Fri");
  });
  it("a daily meeting keeps day times but never week times", () => {
    const d = emptyDraft();
    d.category = "daily";
    d.timeOfDay = "06:00";
    d.dayTimes = { Fri: "14:00" };
    d.weekTimes = ["07:00"];
    const cfg = (JSON.parse(serializeWizardDraft(d)) as { config: Record<string, unknown> }).config;
    expect(cfg.dayTimes).toEqual({ Fri: "14:00" });
    expect(cfg.weekTimes).toBeUndefined();
  });
});
