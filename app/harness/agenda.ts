// The agenda card's who picker against three people lists: a template
// (nobody of its own), a ritual (participants), and the old whole roster.
import { AgendaEditor } from "../../controls/AgendaCard/editor";
import { assigneePeople } from "../../shared/schema/people";

const roster = Array.from({ length: 60 }, (_, n) => ({ whoId: `r${n}`, who: `Person ${String(n).padStart(2, "0")}` }));
const own = [{ whoId: "x1", who: "Olive Owner" }, { whoId: "r7", who: "Person 07" }, { whoId: "x2", who: "Sam Lee" }];
const ed = new AgendaEditor(document.getElementById("a")!, { onChange: () => undefined });
(window as unknown as { ed: AgendaEditor }).ed = ed;
const lists: [string, ReturnType<typeof assigneePeople>][] = [
  ["Template (nobody of its own)", assigneePeople([], roster, "search")],
  ["Ritual (participants)", assigneePeople(own, roster, "search")],
  ["Whole roster, as before", assigneePeople([], roster)],
];
const bar = document.getElementById("bar")!;
for (const [label, people] of lists) {
  const b = document.createElement("button");
  b.textContent = label;
  b.id = "case-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
  b.style.cssText = "font:inherit;padding:8px 12px;border:1px solid #cfc8bc;border-radius:6px;background:#fff;cursor:pointer";
  b.addEventListener("click", () => ed.setPeople(people));
  bar.appendChild(b);
}
ed.setPeople(lists[0][1]);
