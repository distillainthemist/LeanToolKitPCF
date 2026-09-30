// Check-in times on a daily ritual (2026-10-01): further occurrences on
// the same day that share the day's one record.
import { describe, expect, it } from "vitest";
import { cadenceFromConfig, generateInstances, occurrenceTitle, parseCheckIns, SchedulerConfig } from "../../../shared/schema/recurrence";
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

describe("parseCheckIns", () => {
  it("reads sessions with labels, bare times or a CSV; deduplicates by time (first label wins) and sorts", () => {
    expect(parseCheckIns('[{"time":"14:30","label":"Afternoon check-in"},"10:00",{"time":"14:30","label":"dup"}]')).toEqual([
      { time: "10:00", label: "" },
      { time: "14:30", label: "Afternoon check-in" },
    ]);
    expect(parseCheckIns("15:00, 9:15")).toEqual([{ time: "09:15", label: "" }, { time: "15:00", label: "" }]);
    expect(parseCheckIns("")).toEqual([]);
    expect(parseCheckIns("junk")).toEqual([]);
  });
  it("rides the config with the default time's label", () => {
    const c = cadenceFromConfig({ category: "daily", timeOfDay: "07:00", timeLabel: " Morning huddle ", checkIns: [{ time: "14:30", label: "Check-in" }] }, new Date());
    expect(c.checkIns).toEqual([{ time: "14:30", label: "Check-in" }]);
    expect(c.timeLabel).toBe("Morning huddle");
  });
  it("names an occurrence \"meeting: label\", or the meeting alone", () => {
    expect(occurrenceTitle("Production daily", "Afternoon check-in")).toBe("Production daily: Afternoon check-in");
    expect(occurrenceTitle("Production daily", "  ")).toBe("Production daily");
  });
});

describe("generateInstances with check-ins", () => {
  it("adds a session per further time on each day, sharing the day's record", () => {
    const existing = [{ date: "2026-10-01", hour: 7, minute: 0, recordId: "rec-thu", rescheduledTo: "", adhoc: false, closed: false, values: {} }];
    const rows = generateInstances(cfg({ timeLabel: "Morning huddle", checkIns: [{ time: "14:30", label: "Afternoon check-in" }] }), existing, NOW);
    const thu = rows.filter((r) => r.date === "2026-10-01").sort((a, b) => (a.time < b.time ? -1 : 1));
    expect(thu.map((r) => [r.time, r.session, r.label, r.recordId, r.status])).toEqual([
      ["07:00", 0, "Morning huddle", "rec-thu", "existing"],
      ["14:30", 1, "Afternoon check-in", "rec-thu", "existing"],
    ]);
    const fri = rows.filter((r) => r.date === "2026-10-02").sort((a, b) => (a.time < b.time ? -1 : 1));
    expect(fri.map((r) => [r.time, r.session, r.status])).toEqual([
      ["07:00", 0, "planned"],
      ["14:30", 1, "planned"],
    ]);
  });
  it("a check-in equal to the day's own time is not repeated; two check-ins number 1 and 2", () => {
    const rows = generateInstances(cfg({ checkIns: [{ time: "07:00", label: "" }, { time: "11:00", label: "" }, { time: "16:00", label: "" }] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows.map((r) => r.time).sort()).toEqual(["07:00", "11:00", "16:00"]);
    expect(rows.map((r) => r.session).sort()).toEqual([0, 1, 2]);
  });
  it("follows a day's own time override", () => {
    const rows = generateInstances(cfg({ checkIns: [{ time: "14:30", label: "" }], dayTimes: { 5: "08:00" } }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows.map((r) => r.time).sort()).toEqual(["08:00", "14:30"]);
  });
  it("never applies to shiftly (its two sessions are its shifts) or weekly", () => {
    const shiftly = generateInstances(cfg({ category: "shiftly", checkIns: [{ time: "14:30", label: "" }] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(shiftly).toHaveLength(2);
    expect(shiftly.every((r) => r.session === 0)).toBe(true);
    const weekly = generateInstances(cfg({ category: "weekly", daysOfWeek: [5], checkIns: [{ time: "14:30", label: "" }] }), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(weekly).toHaveLength(1);
  });
  it("without check-ins nothing changes", () => {
    const rows = generateInstances(cfg(), [], NOW).filter((r) => r.date === "2026-10-02");
    expect(rows).toHaveLength(1);
    expect(rows[0].session).toBe(0);
    expect(rows[0].label).toBe("");
  });
});

describe("the wizard", () => {
  it("round-trips labelled check-ins on a daily ritual, sorted, never the day's own time", () => {
    const d = emptyDraft();
    d.title = "Production daily";
    d.category = "daily";
    d.daysOfWeek = "Mon,Tue,Wed,Thu,Fri";
    d.timeOfDay = "07:00";
    d.timeLabel = " Morning huddle ";
    d.checkIns = [{ time: "16:00", label: "Wrap-up" }, { time: "07:00", label: "dup of the meeting" }, { time: "", label: "" }, { time: "11:30", label: " Midday " }];
    const json = serializeWizardDraft(d);
    const cfgOut = (JSON.parse(json) as { config: Record<string, unknown> }).config;
    expect(cfgOut.timeLabel).toBe("Morning huddle");
    expect(cfgOut.checkIns).toEqual([{ time: "11:30", label: "Midday" }, { time: "16:00", label: "Wrap-up" }]);
    const back = parseWizardDraft(json);
    expect(back.timeLabel).toBe("Morning huddle");
    expect(back.checkIns).toEqual([{ time: "11:30", label: "Midday" }, { time: "16:00", label: "Wrap-up" }]);
  });
  it("drops them for any other cadence", () => {
    const d = emptyDraft();
    d.category = "weekly";
    d.daysOfWeek = "Mon";
    d.timeLabel = "x";
    d.checkIns = [{ time: "14:00", label: "" }];
    const cfgOut = (JSON.parse(serializeWizardDraft(d)) as { config: Record<string, unknown> }).config;
    expect(cfgOut.checkIns).toBeUndefined();
    expect(cfgOut.timeLabel).toBeUndefined();
  });
});
