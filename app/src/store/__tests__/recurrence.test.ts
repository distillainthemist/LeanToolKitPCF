// The recurrence engine, finally under unit test — the maths every
// meeting depends on: anchored cadences, roster rotation, topics,
// staleness, attendees.

import { describe, expect, it } from "vitest";
import {
  attendeesFor,
  generateInstances,
  parseCrews,
  parseDaysOfWeek,
  parseDayTopics,
  parseLocalDate,
  parseRosterPattern,
  parseWeekTopics,
  SchedulerConfig,
} from "../../../../shared/schema/recurrence";

const base = (over: Partial<SchedulerConfig>): SchedulerConfig => ({
  finalDate: parseLocalDate("2026-07-31")!,
  daysPrior: 30,
  category: "weekly",
  daysOfWeek: parseDaysOfWeek("Tue"),
  timeOfDay: "09:00",
  crews: [],
  roster: [],
  baseStart: parseLocalDate("2026-07-01")!,
  weekTopics: [],
  dayTopics: {},
  ...over,
});

const epoch = new Date(0); // calendar mode: nothing is "missing"/stale

describe("weekly + topics", () => {
  it("rotates topics by week-of-month and wraps monthly", () => {
    const cfg = base({
      weekTopics: parseWeekTopics('["Safety","Quality","Delivery","Improve","Open"]'),
    });
    const byDate = Object.fromEntries(
      generateInstances(cfg, [], epoch).map((i) => [i.date, i.topic])
    );
    expect(byDate["2026-07-07"]).toBe("Safety"); // 1st Tuesday
    expect(byDate["2026-07-14"]).toBe("Quality");
    expect(byDate["2026-07-21"]).toBe("Delivery");
    expect(byDate["2026-07-28"]).toBe("Improve"); // July has no 5th Tuesday
  });
});

describe("fortnightly parity", () => {
  it("keeps the anchor week and skips alternates", () => {
    const cfg = base({
      category: "fortnightly",
      daysOfWeek: parseDaysOfWeek("Tue"),
      baseStart: parseLocalDate("2026-07-07")!,
    });
    const dates = generateInstances(cfg, [], epoch).map((i) => i.date);
    expect(dates).toContain("2026-07-07");
    expect(dates).not.toContain("2026-07-14");
    expect(dates).toContain("2026-07-21");
  });
});

describe("monthly nth weekday", () => {
  it("projects the anchor's 2nd Tuesday forward", () => {
    const cfg = base({
      category: "monthly",
      baseStart: parseLocalDate("2026-06-09")!, // 2nd Tuesday of June
      finalDate: parseLocalDate("2026-08-31")!,
      daysPrior: 90,
    });
    const dates = generateInstances(cfg, [], epoch).map((i) => i.date);
    expect(dates).toContain("2026-07-14"); // 2nd Tuesday of July
    expect(dates).toContain("2026-08-11"); // 2nd Tuesday of August
    expect(dates).not.toContain("2026-07-07");
  });
});

describe("shiftly roster", () => {
  const cfg = base({
    category: "shiftly",
    daysOfWeek: parseDaysOfWeek("Mon,Tue,Wed,Thu,Fri"),
    timeOfDay: "07:00",
    crews: parseCrews("A,B,C,D"),
    roster: parseRosterPattern("2D-2N-4O"),
    baseStart: parseLocalDate("2026-07-13")!,
    finalDate: parseLocalDate("2026-07-17")!,
    daysPrior: 4,
    dayTopics: parseDayTopics('{"Thu":"Safety walk","Fri":"Week wrap"}'),
  });
  const instances = generateInstances(cfg, [], epoch);

  it("emits a day and a night meeting, night 12h later", () => {
    const mon = instances.filter((i) => i.date === "2026-07-13");
    expect(mon.map((i) => `${i.shift}@${i.time}`).sort()).toEqual([
      "day@07:00",
      "night@19:00",
    ]);
  });

  it("rotates crews per the 2D-2N-4O stagger", () => {
    const on = (date: string, shift: string) =>
      instances.find((i) => i.date === date && i.shift === shift)?.crew;
    expect(on("2026-07-13", "day")).toBe("A"); // A starts days at the anchor
    expect(on("2026-07-15", "day")).toBe("B"); // A moves to nights, B onto days
    expect(on("2026-07-15", "night")).toBe("A");
  });

  it("stamps day-of-week topics on both shifts", () => {
    const thu = instances.filter((i) => i.date === "2026-07-16");
    expect(new Set(thu.map((i) => i.topic))).toEqual(new Set(["Safety walk"]));
  });
});

describe("staleness", () => {
  it("hides record-less past instances older than 7 days (scheduler mode)", () => {
    const cfg = base({});
    const now = new Date(2026, 6, 31, 12, 0, 0);
    const dates = generateInstances(cfg, [], now).map((i) => i.date);
    expect(dates).not.toContain("2026-07-07"); // stale miss
    expect(dates).toContain("2026-07-28"); // recent miss survives
  });
});

describe("attendeesFor", () => {
  const people = [
    { whoId: "p0", who: "Ben", initials: "B" },
    { whoId: "p1", who: "Sam", initials: "S", crew: "A" },
    { whoId: "p2", who: "Jo", initials: "J", crew: "B" },
  ];
  it("filters to the on-shift crew plus always-attends", () => {
    expect(attendeesFor(people, "A").map((p) => p.who)).toEqual(["Ben", "Sam"]);
  });
  it("returns everyone when no crew applies", () => {
    expect(attendeesFor(people, "").map((p) => p.who)).toEqual(["Ben", "Sam", "Jo"]);
  });
});

describe("rotation topics + topic for date", () => {
  const weekly = JSON.stringify({ config: { category: "weekly", weekTopics: ["Safety", "Ops", "", "Cost"] } });
  const daily = JSON.stringify({ config: { category: "daily", dayTopics: { 1: "Safety", 3: "Ops" } } });
  it("lists the rotation in order, skipping blanks and repeats", async () => {
    const { rotationTopics } = await import("../../../../shared/schema/recurrence");
    expect(rotationTopics(weekly)).toEqual([
      { key: "Safety", label: "1st week · Safety" },
      { key: "Ops", label: "2nd week · Ops" },
      { key: "Cost", label: "4th week · Cost" },
    ]);
    expect(rotationTopics(daily).map((t) => t.label)).toEqual(["Monday · Safety", "Wednesday · Ops"]);
    expect(rotationTopics("")).toEqual([]);
    expect(rotationTopics(JSON.stringify({ config: { category: "monthly" } }))).toEqual([]);
  });
  it("derives the topic for a date the way the engine stamps it", async () => {
    const { topicForDate } = await import("../../../../shared/schema/recurrence");
    expect(topicForDate(weekly, "2026-08-04T09:00")).toBe("Safety"); // 1st week
    expect(topicForDate(weekly, "2026-08-12T09:00")).toBe("Ops"); // 2nd week
    expect(topicForDate(weekly, "2026-08-19T09:00")).toBe(""); // 3rd blank
    expect(topicForDate(daily, "2026-08-19")).toBe("Ops"); // a Wednesday
    expect(topicForDate(daily, "2026-08-18")).toBe(""); // Tuesday unset
    expect(topicForDate("garbage", "2026-08-18")).toBe("");
  });
});

describe("times that vary by day / week (kickoff-closeout cycles)", () => {
  it("parses per-day and per-week times, rejecting malformed", async () => {
    const m = await import("../../../../shared/schema/recurrence");
    expect(m.parseDayTimes('{"Mon":"7:00","Fri":"15:00","Tue":"25:99"}')).toEqual({ 1: "07:00", 5: "15:00" });
    expect(m.parseDayTimes("mon:07:00,fri:15:00")).toEqual({ 1: "07:00", 5: "15:00" });
    expect(m.parseWeekTimes('["07:00","","","15:00"]')).toEqual(["07:00", "", "", "15:00"]);
    expect(m.parseWeekTimes("07:00,,bad,15:00,,")).toEqual(["07:00", "", "", "15:00"]);
    expect(m.parseWeekTimes("")).toEqual([]);
  });
  it("timeFor: day override > week override > default; weekly-only for weeks", async () => {
    const m = await import("../../../../shared/schema/recurrence");
    const base = { category: "weekly" as const, timeOfDay: "09:00", dayTimes: { 5: "15:00" }, weekTimes: ["07:00", "", "", "16:00"] };
    expect(m.timeFor(base, new Date(2026, 7, 3))).toBe("07:00"); // Mon 3 Aug — 1st week
    expect(m.timeFor(base, new Date(2026, 7, 7))).toBe("15:00"); // Fri 7 Aug — day override wins
    expect(m.timeFor(base, new Date(2026, 7, 10))).toBe("09:00"); // Mon 10 Aug — 2nd week blank → default
    expect(m.timeFor(base, new Date(2026, 7, 24))).toBe("16:00"); // Mon 24 Aug — 4th week
    expect(m.timeFor({ ...base, category: "daily" }, new Date(2026, 7, 3))).toBe("09:00"); // daily ignores week table
    expect(m.timeVaries(base)).toBe(true);
    expect(m.timeVaries({ category: "weekly", timeOfDay: "09:00", dayTimes: { 1: "09:00" } })).toBe(false);
  });
  it("generateInstances stamps the varied time (and shiftly night = day + 12h)", async () => {
    const m = await import("../../../../shared/schema/recurrence");
    const cfg: import("../../../../shared/schema/recurrence").SchedulerConfig = {
      finalDate: new Date(2026, 7, 7),
      daysPrior: 6,
      category: "weekly",
      daysOfWeek: [1, 5],
      timeOfDay: "09:00",
      crews: [],
      roster: [],
      baseStart: new Date(2026, 7, 3),
      weekTopics: [],
      dayTopics: { 1: "Kickoff", 5: "Closeout" },
      dayTimes: { 1: "07:00", 5: "15:00" },
    };
    const rows = m.generateInstances(cfg, [], new Date(0));
    expect(rows.map((r) => `${r.day} ${r.time} ${r.topic}`)).toEqual(["Fri 15:00 Closeout", "Mon 07:00 Kickoff"]);
    const shift = m.generateInstances({ ...cfg, category: "shiftly", dayTopics: {} }, [], new Date(0));
    expect(shift.filter((r) => r.day === "Mon").map((r) => `${r.shift} ${r.time}`)).toEqual(["night 19:00", "day 07:00"]);
  });
  it("cadenceFromConfig reads the two tables like the rest", async () => {
    const m = await import("../../../../shared/schema/recurrence");
    const c = m.cadenceFromConfig({ category: "weekly", daysOfWeek: "Mon,Fri", timeOfDay: "09:00", dayTimes: { Mon: "07:00" }, weekTimes: ["", "10:00"] }, new Date(2026, 0, 1));
    expect(c.dayTimes).toEqual({ 1: "07:00" });
    expect(c.weekTimes).toEqual(["", "10:00"]);
    expect(c.daysOfWeek).toEqual([1, 5]);
  });
});
