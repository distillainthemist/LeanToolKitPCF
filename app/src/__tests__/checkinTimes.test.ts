// Check-in times on a daily ritual (2026-10-01): further occurrences on
// the same day that share the day's one record.
import { describe, expect, it } from "vitest";
import { cadenceFromConfig, generateInstances, parseExtraTimes, SchedulerConfig } from "../../../shared/schema/recurrence";
import { emptyDraft, parseWizardDraft, serializeWizardDraft } from "../../../controls/MeetingWizard/types";

const cfg = (over: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  finalDate: new Date(2026, 9, 2), // Fri 2 Oct 2026
  daysPrior: 1,
  category: "daily",
  daysOfWeek: [1, 2, 3, 4, 5],
  timeOfDay: "07:00",
  crews: [],
  roster: [],
  baseStart: new Date(2026, 0, 5),
  weekTopics: [],
  dayTopics: {},
  ...over,
});
const NOW = new Date(2026, 9, 1, 12, 0); // Thu 1 Oct, noon

describe("parseExtraTimes", () => {
  it("reads a list or CSV, cleans, deduplicates and sorts", () => {
    expect(parseExtraTimes('["14:30","10:00","14:30"]')).toEqual(["10:00", "14:30"]);
    expect(parseExtraTimes("15:00, 9:15")).toEqual(["09:15", "15:00"]);
    expect(parseExtraTimes("")).toEqual([]);
    expect(parseExtraTimes("junk")).toEqual([]);
  });
  it("rides the config", () => {
    expect(cadenceFromConfig({ category: "daily", timeOfDay: "07:00", extraTimes: ["14:30"] }, new Date()).extraTimes).toEqual(["14:30"]);
  });
});

describe("generateInstances with check-ins", () => {
  it("adds a session per further time on each day, sharing the day's record", () => {
    const existing = [{ date: "2026-10-01", hour: 7, minute: 0, recordId: "rec-thu", rescheduledTo: "", adhoc: false, closed: false, values: {} }];
    const rows = generateInstances(cfg({ extraTimes: ["14:30"] }), existing, NOW);
    const thu = rows.filter((r) => r.date === "2026-10-01").sort((a, b) => (a.time < b.time ? -1 : 1));
    expect(thu.map((r) => [r.time, r.session, r.recordId, r.status])).toEqual([
      ["07:00", 0, "rec-thu", "existing"],
      ["14:30", 1, "rec-thu", "existing"],
    ]);
    const fri = rows.filter((r) => r.date === "2026-10-02").sort((a, b) => (a.time < b.time ? -1 : 1));
    expect(fri.map((r) => [r.time, r.session, r.status])).toEqual([
      ["07:00", 0, "planned"],
      ["14:30", 1, "planned"],
    ]);
  });
  it("a check-in equal to the day's own time is not repeated; two check-ins number 1 and 2", () => {
    const rows = generateInstances(cfg({ extraTimes: ["07:00", "11:00", "16:00"] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows.map((r) => r.time).sort()).toEqual(["07:00", "11:00", "16:00"]);
    expect(rows.map((r) => r.session).sort()).toEqual([0, 1, 2]);
  });
  it("follows a day's own time override", () => {
    const rows = generateInstances(cfg({ extraTimes: ["14:30"], dayTimes: { 5: "08:00" } }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows.map((r) => r.time).sort()).toEqual(["08:00", "14:30"]);
  });
  it("never applies to shiftly (its two sessions are its shifts) or weekly", () => {
    const shiftly = generateInstances(cfg({ category: "shiftly", extraTimes: ["14:30"] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(shiftly).toHaveLength(2);
    expect(shiftly.every((r) => r.session === 0)).toBe(true);
    const weekly = generateInstances(cfg({ category: "weekly", daysOfWeek: [5], extraTimes: ["14:30"] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(weekly).toHaveLength(1);
  });
  it("without check-ins nothing changes", () => {
    const rows = generateInstances(cfg(), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows).toHaveLength(1);
    expect(rows[0].session).toBe(0);
  });
});

describe("the wizard", () => {
  it("round-trips check-in times on a daily ritual, sorted, never the day's own time", () => {
    const d = emptyDraft();
    d.title = "Production daily";
    d.category = "daily";
    d.daysOfWeek = "Mon,Tue,Wed,Thu,Fri";
    d.timeOfDay = "07:00";
    d.extraTimes = ["16:00", "07:00", "", "11:30"];
    const json = serializeWizardDraft(d);
    const cfgOut = (JSON.parse(json) as { config: Record<string, unknown> }).config;
    expect(cfgOut.extraTimes).toEqual(["11:30", "16:00"]);
    expect(parseWizardDraft(json).extraTimes).toEqual(["11:30", "16:00"]);
  });
  it("drops them for any other cadence", () => {
    const d = emptyDraft();
    d.category = "weekly";
    d.daysOfWeek = "Mon";
    d.extraTimes = ["14:00"];
    const cfgOut = (JSON.parse(serializeWizardDraft(d)) as { config: Record<string, unknown> }).config;
    expect(cfgOut.extraTimes).toBeUndefined();
  });
});
