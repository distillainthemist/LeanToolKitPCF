// Rituals shown in more than one organisation's cadence (2026-09-08):
// the primary org stays the owner; alsoOrgs are extra cadence homes.
import { describe, expect, it } from "vitest";
import { buildMeetingSection, meetingInOrg, parseMeetingInfo } from "../../../shared/schema/meeting";

const info = (alsoOrgs: { site: string; department: string; area: string }[]) => ({
  purpose: "",
  owner: null,
  org: { site: "Bendigo", department: "Packaging", area: "" },
  alsoOrgs,
  participants: [],
});

describe("alsoOrgs", () => {
  it("round-trips sparsely, dropping the primary and duplicates", () => {
    const section = buildMeetingSection(
      info([
        { site: "Bendigo", department: "Packaging", area: "" }, // = primary → dropped
        { site: "Bendigo", department: "Distillery", area: "" },
        { site: "Bendigo", department: "Distillery", area: "" }, // dup
        { site: "Melbourne", department: "", area: "" },
        { site: "", department: "X", area: "" }, // no site → dropped
      ])
    );
    expect(section?.alsoOrgs).toEqual([
      { site: "Bendigo", department: "Distillery" },
      { site: "Bendigo", department: "Distillery" },
      { site: "Melbourne" },
    ]);
    const back = parseMeetingInfo(JSON.stringify({ meeting: section }));
    expect(back?.alsoOrgs).toEqual([
      { site: "Bendigo", department: "Distillery", area: "" },
      { site: "Melbourne", department: "", area: "" },
    ]);
  });
  it("meetingInOrg matches the primary or any also-org, each level narrowing", () => {
    const m = info([{ site: "Melbourne", department: "Sales", area: "" }]);
    expect(meetingInOrg(m, { site: "Bendigo", department: "", area: "" })).toBe(true);
    expect(meetingInOrg(m, { site: "Bendigo", department: "Packaging", area: "" })).toBe(true);
    expect(meetingInOrg(m, { site: "Bendigo", department: "Distillery", area: "" })).toBe(false);
    expect(meetingInOrg(m, { site: "Melbourne", department: "", area: "" })).toBe(true);
    expect(meetingInOrg(m, { site: "Melbourne", department: "Sales", area: "" })).toBe(true);
    expect(meetingInOrg(m, { site: "Melbourne", department: "Sales", area: "Inside" })).toBe(false);
    expect(meetingInOrg(m, { site: "", department: "", area: "" })).toBe(true);
    expect(meetingInOrg(null, { site: "Bendigo", department: "", area: "" })).toBe(false);
  });
  it("older blobs without alsoOrgs parse with an empty list", () => {
    expect(parseMeetingInfo(JSON.stringify({ meeting: { org: { site: "Bendigo" } } }))?.alsoOrgs).toEqual([]);
  });
});
