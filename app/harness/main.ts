import { el, ensureStylesheet } from "../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { openActionDialog, pdcaDisc } from "../../shared/ui/actionUi";
import { ActionBoardEditor } from "../../controls/ActionBoard/editor";
import { ACTION_PDCA, PDCA_LABELS, LtkAction, newAction, ActionPdca } from "../../shared/schema/actions";

ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
document.documentElement.style.setProperty("--ltk-accent", "#2563eb");

const legend = document.getElementById("legend")!;
for (const s of ACTION_PDCA) {
  const box = el("div");
  box.append(pdcaDisc(s, 34), el("span", undefined, PDCA_LABELS[s]));
  legend.appendChild(box);
}

const mk = (issue: string, desc: string, pdca: ActionPdca, who: string, due: string, status?: LtkAction["status"]): LtkAction => {
  const a = newAction({ source: "actionboard", sourceId: "" });
  a.issue = issue;
  a.description = desc;
  a.pdca = pdca;
  a.due = due;
  a.assignees = [{ whoId: "u1", who, done: pdca === "closed" }];
  a.status = status ?? (pdca === "closed" ? "done" : "open");
  return a;
};
const sample = [
  mk("Downtime", "Scope the conveyor belt survey", "plan", "Ben Pechey", "2026-09-10"),
  mk("Downtime", "Replace worn idler rollers", "do", "Priya Deol", "2026-09-05"),
  mk("Quality", "Verify moisture readings after calibration", "check", "Ben Pechey", "2026-09-03"),
  mk("Quality", "Standardise the new sampling method", "act", "Sam Okafor", "2026-09-12"),
  mk("Safety", "Close out the guarding audit findings", "closed", "Priya Deol", "2026-08-28"),
];

const wire = (host: HTMLElement, view: "kanban" | "list") => {
  const ed = new ActionBoardEditor(host, { onChange: () => undefined });
  ed.setChrome("Action plan", "");
  ed.setOptions({ view, groupBy: "status" } as never);
  ed.setActor({ whoId: "u1", who: "Ben Pechey" });
  ed.setActions(sample.map((a) => ({ ...a })));
};
wire(document.getElementById("kanban")!, "kanban");
wire(document.getElementById("list")!, "list");

openActionDialog({
  host: document.getElementById("dialoghost")!,
  action: mk("Quality", "Verify moisture readings after calibration", "check", "Ben Pechey", "2026-09-03"),
  people: [
    { whoId: "u1", who: "Ben Pechey", initials: "BP" },
    { whoId: "u2", who: "Priya Deol", initials: "PD" },
    { whoId: "u3", who: "Sam Okafor", initials: "SO" },
  ] as never,
  isNew: false,
  linkTargets: [
    { key: "b:c1", label: "Fishbone" },
    { key: "b:c2", label: "Fault tree" },
  ],
  linkTarget: "b:c1",
  onCommit: () => undefined,
});
