// The app's own prompts, as the steps that used the browser's native
// dialogs now call them.
import "../src/style.css";
import { promptConfirm, promptText } from "../src/prompts";

const log: string[] = [];
(window as unknown as { log: string[] }).log = log;
const cases: [string, () => Promise<unknown>][] = [
  ["Move stage", () => promptText({ title: "Move to Do?", note: "A comment for the log (optional).", placeholder: "What this stage achieved, or why it is moving on", confirmLabel: "Move to Do", multiline: true })],
  ["Decline gate", () => promptText({ title: "Decline this gate?", note: "Say why — the team sees this, and it stays on the stage's record.", placeholder: "What needs to change before this can move on", confirmLabel: "Decline", multiline: true, required: "A reason is needed.", danger: true })],
  ["Delete archived card", () => promptConfirm({ title: "Delete \"Safety cross\" for good?", note: "It leaves the archive and cannot be added back. Its saved content stays in the database — including the images past meetings archived — but nothing in the app will show it again.", confirmLabel: "Delete", danger: true })],
  ["Archive card", () => promptConfirm({ title: "Archive \"Safety cross\"?", note: "It comes off the board but keeps its settings and saved content — add it back any time from ＋ Add card → Archived.", confirmLabel: "Archive card" })],
  ["Rename (one line)", () => promptText({ title: "Rename site", initial: "Bendigo", confirmLabel: "Rename" })],
];
const bar = document.getElementById("cases")!;
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.className = "app-btn";
  b.textContent = label;
  b.id = "case-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
  b.addEventListener("click", () => void fn().then((v) => log.push(`${label}: ${JSON.stringify(v)}`)));
  bar.appendChild(b);
}
