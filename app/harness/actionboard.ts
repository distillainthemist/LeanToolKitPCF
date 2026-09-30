// The actions card: a kanban column with more actions than fit, adding to
// a column, the List | Kanban | Gantt switch, and the app's own Gantt in
// the Gantt view (flat "board" scope — the store is never reached unless a
// date is dragged).
import "../src/style.css";
import { ActionBoardEditor } from "../../controls/ActionBoard/editor";
import { newAction, LtkAction } from "../../shared/schema/actions";
import { setActionViewerProvider } from "../../shared/ui/actionLinkProvider";
import { mountGantt } from "../src/improvement/gantt";

setActionViewerProvider(() => ({ whoId: "u1", who: "Ben O'Brien" }));
const day = (n: number) => new Date(Date.UTC(2026, 8, 30) + n * 86400000).toISOString().slice(0, 10);
const make = (n: number, status: LtkAction["status"]): LtkAction => {
  const a = newAction({ source: "actionboard", sourceId: "" });
  a.id = `a${n}`;
  a.issue = ["Safety", "Quality", "Delivery"][n % 3];
  a.description = `Action number ${n + 1} with enough words to wrap onto a second line in a column`;
  a.status = status;
  a.pdca = status === "done" ? "closed" : status === "in-progress" ? "do" : "plan";
  a.start = day(-6 + n);
  a.due = day(-2 + n * 2);
  a.assignees = [{ whoId: n % 2 ? "u2" : "u1", who: n % 2 ? "Jane Smith" : "Ben O'Brien", done: status === "done" }];
  a.instanceId = "B1:board";
  return a;
};
const many = [...Array.from({ length: 11 }, (_, n) => make(n, "open")), ...Array.from({ length: 2 }, (_, n) => make(20 + n, "in-progress")), make(30, "done")];
const log: string[] = [];
(window as unknown as { log: string[] }).log = log;
const ed = new ActionBoardEditor(document.getElementById("b")!, { onChange: (acts) => log.push(`change ${acts.length} last=${acts[acts.length - 1].status}/${acts[acts.length - 1].issue}`) });
(window as unknown as { ed: ActionBoardEditor }).ed = ed;
ed.setActor({ whoId: "u1", who: "Ben O'Brien" });
ed.setPeople([{ whoId: "u1", who: "Ben O'Brien", initials: "BO" }, { whoId: "u2", who: "Jane Smith", initials: "JS" }]);
ed.setOptions({ view: "kanban", groupBy: "status", verifyColumn: true });
ed.setUserView(null, (v) => log.push(`view ${v}`));
ed.setGanttRenderer((host, g) =>
  mountGantt({ host, scopes: [{ key: "board", label: "" }], initiatives: [], actions: g.actions, palette: { issue: "#c0392b", atrisk: "#d9a441", good: "#1f7a3f" }, canEdit: false, actor: g.actor, onChanged: g.onChanged, centerIso: "2026-09-30", hideViewSwitch: true })
);
ed.setActions(many);
const bar = document.getElementById("bar")!;
const cases: [string, () => void][] = [
  ["By status", () => ed.setOptions({ view: "kanban", groupBy: "status", verifyColumn: true })],
  ["By issue", () => ed.setOptions({ view: "kanban", groupBy: "issue", columns: ["Safety", "Quality", "Delivery"] })],
  ["Card's own Gantt", () => ed.setGanttRenderer(null)],
];
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.className = "app-btn";
  b.textContent = label;
  b.id = "case-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
  b.addEventListener("click", fn);
  bar.appendChild(b);
}
