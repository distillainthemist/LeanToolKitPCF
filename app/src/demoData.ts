// Phase 1 fake data — stands in for the Dataverse store until Phase 3.
// Shapes match what the store will return: boards with scheduler settings
// blobs, a roster, protected times, an actions rollup.

export const PEOPLE = [
  { whoId: "p0", who: "Dana Field" },
  { whoId: "p1", who: "Sam Patel", crew: "A" },
  { whoId: "p2", who: "Jo Hughes", crew: "B" },
  { whoId: "p3", who: "Alex Reed", crew: "C" },
  { whoId: "p4", who: "Chris Nolan", crew: "D" },
];

export const VIEWER_ID = "p0";

export const ORG_TREE = [
  {
    site: "Riverbend",
    departments: [
      { department: "Bottling", areas: ["Line 1", "Line 2"] },
      { department: "Distilling", areas: ["Stills", "Fermentation"] },
      { department: "Warehouse", areas: [] },
    ],
  },
  { site: "Maryborough", departments: [{ department: "Packaging", areas: ["Pack 1"] }] },
];

/** Board rows: what LTK Boards will hold (ben_occurrencesettings). */
export const BOARDS = [
  {
    boardId: "board-standup",
    settingsJSON: {
      cardType: "MeetingScheduler",
      title: "Bottling standup",
      theme: { titlebar: "#8b1e1e", accent: "#8b1e1e" },
      config: {
        category: "shiftly",
        daysOfWeek: "Mon,Tue,Wed,Thu,Fri",
        timeOfDay: "07:00",
        daysPrior: 7,
        crewList: "A,B,C,D",
        rosterPattern: "2D-2N-4O",
        baseStartDate: "2026-07-13",
        dayTopics: { Thu: "Safety walk", Fri: "Week wrap" },
        columns: "Chair",
      },
      meeting: {
        purpose: "Shift handover: review the last shift, agree the top issue, assign actions.",
        owner: { whoId: "p0", who: "Dana Field" },
        org: { site: "Riverbend", department: "Bottling", area: "Line 1" },
        participants: [
          { whoId: "p0", who: "Dana Field" },
          { whoId: "p1", who: "Sam Patel", crew: "A" },
          { whoId: "p2", who: "Jo Hughes", crew: "B" },
        ],
      },
    },
  },
  {
    boardId: "board-leadership",
    settingsJSON: {
      cardType: "MeetingScheduler",
      title: "Site leadership",
      theme: { titlebar: "#0b6b3a", accent: "#0b6b3a" },
      config: {
        category: "weekly",
        daysOfWeek: "Tue",
        timeOfDay: "09:00",
        daysPrior: 14,
        weekTopics: ["Safety", "Quality", "Delivery & cost", "Improvement"],
        columns: "Chair,Notetaker",
      },
      meeting: {
        purpose: "Cross-department leadership alignment.",
        owner: { whoId: "p0", who: "Dana Field" },
        org: { site: "Riverbend" },
        participants: [
          { whoId: "p0", who: "Dana Field" },
          { whoId: "p3", who: "Alex Reed" },
        ],
      },
    },
  },
];

export const PROTECTED_TIMES = [
  { label: "Field leadership", color: "#2b88d8", days: "Mon,Tue,Wed,Thu,Fri", start: "10:00", end: "11:30" },
  { label: "Problem solving", color: "#8764b8", days: "Thu", start: "13:00", end: "15:00" },
];

export const ACTIONS = [
  {
    id: "a1",
    instanceId: "b-fish",
    issue: "Label misfeed root cause",
    description: "Confirm feeder alignment fix",
    assignees: [{ whoId: "p0", who: "Dana Field", done: false }],
    start: "",
    due: "2026-07-16",
    status: "open",
    comments: [],
    escalated: true,
    context: { source: "fishbone", sourceId: "c1" },
  },
  {
    id: "a2",
    instanceId: "b-actions",
    issue: "Order spare seals",
    description: "",
    assignees: [
      { whoId: "p0", who: "Dana Field", done: false },
      { whoId: "p1", who: "Sam Patel", done: true },
    ],
    start: "",
    due: "2026-07-25",
    status: "in-progress",
    comments: [],
    escalated: false,
    context: { source: "actionboard", sourceId: "" },
  },
];

export const ACTION_SOURCES = [
  { instanceId: "b-fish", label: "Bottling board · Top issue" },
  { instanceId: "b-actions", label: "Bottling board · Actions" },
];
