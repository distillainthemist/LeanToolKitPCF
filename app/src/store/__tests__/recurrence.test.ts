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
