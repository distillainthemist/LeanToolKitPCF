// The initiative board's status band in its states, the details handle,
// the commentary trail and the add / edit dialog — stub data throughout.
import "../src/style.css";
import { renderStatusBand, BandGate, BandOpts } from "../src/improvement/statusBand";
import { openUpdateDialog, renderTrail } from "../src/improvement/commentary";
import { editedDetail, staleDays, Update, updatesFrom } from "../src/improvement/commentaryModel";

const today = "2026-09-29";
let events = [
  { id: "e3", kind: "comment", actorId: "u1", actorName: "Jane Smith", at: "2026-09-26T09:00:00Z", detail: { high: "Trial run hit 27 minutes, down from 48", low: "Second fitter was not released for the afternoon run", next: "Repeat the trial on night shift with the new tool trolley", support: "Agree fitter cover for October with the shift managers", editedBy: "Sam Lee", editedAt: "2026-09-27T08:00:00Z", previous: [{ high: "Trial run hit 29 minutes", low: "", next: "Repeat the trial", support: "", who: "Jane Smith", at: "2026-09-26T09:00:00Z" }] } as Record<string, unknown> },
  { id: "e2", kind: "comment", actorId: "u2", actorName: "Sam Lee", at: "2026-09-12T09:00:00Z", detail: { high: "Spaghetti diagram done", next: "Video the changeover" } as Record<string, unknown> },
  { id: "e1", kind: "created", actorId: "u1", actorName: "Jane Smith", at: "2026-08-20T09:00:00Z", detail: {} as Record<string, unknown> },
];
const log: string[] = [];
(window as unknown as { log: string[] }).log = log;
const stage = { name: "Analyse", position: 2, count: 5, colours: ["#1d6fb8", "#1d6fb8", "#1f7a3f", "#8a4b12", "#6b3fa0"], fg: "#1d6fb8", bg: "#e3effa", target: "2026-09-26", overdueDays: 3 };
const gates: Record<string, BandGate | null> = {
  waiting: { tone: "wait", text: "⚑ Gate to Improve · waiting on Sponsor", approvals: [{ label: "Owner", state: "ok" }, { label: "Sponsor", state: "wait" }], actions: [{ label: "Approve", kind: "primary", onClick: () => log.push("approve") }, { label: "Decline", kind: "danger", onClick: () => log.push("decline") }] },
  request: { tone: "muted", text: "⚑ Gate to Improve · not yet requested", approvals: [{ label: "Owner", state: "wait" }, { label: "Sponsor", state: "wait" }], actions: [{ label: "Request gate", kind: "primary", onClick: () => log.push("request") }] },
  declined: { tone: "no", text: "⚑ Gate to Improve · declined by Sponsor", approvals: [{ label: "Owner", state: "ok" }, { label: "Sponsor", state: "no" }], actions: [] },
  open: { tone: "muted", text: "Next: Improve · no approval needed", approvals: [], actions: [{ label: "Move to Improve", kind: "plain", onClick: () => log.push("move") }] },
};
let state = { gate: "waiting", collapsed: false, canComment: true, none: false, completed: false };
const band = document.getElementById("band")!;
const trail = document.getElementById("trail")!;
const edit = (u: Update) =>
  openUpdateDialog({
    existing: u,
    offerFlag: false,
    onSave: async (fields) => {
      events = events.map((e) => (e.id === u.id ? { ...e, detail: editedDetail(u, fields, "Ben O'Brien", "2026-09-29T10:00:00Z") } : e));
      log.push(`edited ${u.id}`);
      paint();
    },
  });
const add = () =>
  openUpdateDialog({
    offerFlag: true,
    onSave: async (fields, raise) => {
      events = [{ id: `e${events.length + 1}`, kind: "comment", actorId: "u9", actorName: "Ben O'Brien", at: "2026-09-29T10:00:00Z", detail: { ...fields } }, ...events];
      log.push(`added flag=${raise}`);
      paint();
    },
  });
function paint(): void {
  const list = state.none ? [] : updatesFrom(events);
  const o: BandOpts = {
    collapsed: state.collapsed,
    onToggle: () => {
      state.collapsed = !state.collapsed;
      paint();
    },
    stage,
    completed: state.completed,
    gate: state.completed ? null : gates[state.gate],
    onOpenStages: () => log.push("open stages"),
    latest: list[0] ?? null,
    updateCount: list.length,
    today,
    stale: state.completed ? null : staleDays(list[0]?.at ?? "", "2026-08-20", today),
    canComment: state.canComment,
    onAdd: add,
    onEdit: edit,
    onAllUpdates: () => log.push("open updates"),
  };
  band.replaceChildren(renderStatusBand(o));
  trail.replaceChildren(renderTrail({ list, today, canEdit: state.canComment, onEdit: edit }));
}
const cases: [string, () => void][] = [
  ["Waiting on approver", () => (state = { ...state, gate: "waiting", none: false, completed: false })],
  ["Not requested", () => (state = { ...state, gate: "request" })],
  ["Declined", () => (state = { ...state, gate: "declined" })],
  ["No approval needed", () => (state = { ...state, gate: "open" })],
  ["No commentary", () => (state = { ...state, none: !state.none })],
  ["Viewer not on team", () => (state = { ...state, canComment: !state.canComment })],
  ["Completed", () => (state = { ...state, completed: !state.completed })],
];
const bar = document.getElementById("cases")!;
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.className = "app-btn";
  b.textContent = label;
  b.id = "case-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
  b.addEventListener("click", () => {
    fn();
    paint();
  });
  bar.appendChild(b);
}
paint();
