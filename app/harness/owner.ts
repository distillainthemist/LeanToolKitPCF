// The priority owner picker (2026-10-02): suggested people first, the
// roster behind a search, the directory behind that — stub data.
import "../src/style.css";
import { pickOwner } from "../src/priorities/dialogs";

const roster = ["Ann Ray", "Ben O'Brien", "Jane Smith", "Sam Lee", "Kim Lowe"].map((who, i) => ({ whoId: `u${i}`, who, email: "", site: "Bendigo", department: "", area: "", role: "user", active: true }));
const suggested = [{ whoId: "u2", who: "Jane Smith" }, { whoId: "u3", who: "Sam Lee" }, { whoId: "u4", who: "Kim Lowe" }];
const log: string[] = [];
(window as unknown as { log: string[] }).log = log;
const host = document.getElementById("host")!;
const directory = {
  search: async (q: string) => [{ objectId: "e1", displayName: `Pat ${q} (Contractor)`, mail: "pat@x.test" }, { objectId: "u1", displayName: "Ben O'Brien", mail: "ben@x.test" }],
  add: async (hit: { objectId: string; displayName: string; mail: string }) => {
    log.push(`add ${hit.displayName}`);
    return { whoId: hit.objectId, who: hit.displayName };
  },
};
const cases: [string, () => void][] = [
  ["Suggested + directory", () => void pickOwner(host, roster, null, "owner", { suggested, directory }).then((r) => log.push(`chose ${JSON.stringify(r)}`))],
  ["Roster only (legacy)", () => void pickOwner(host, roster, { whoId: "u2", who: "Jane Smith" }).then((r) => log.push(`chose ${JSON.stringify(r)}`))],
];
const bar = document.getElementById("cases")!;
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.className = "app-btn";
  b.textContent = label;
  b.addEventListener("click", fn);
  bar.appendChild(b);
}
