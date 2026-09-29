// (no suggestions are listed before typing)
// The action dialog's "Linked to" field and its confirmations, with stub
// targets. Buttons open the dialog on each kind of action.
import { ensureStylesheet } from "../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { openActionDialog } from "../../shared/ui/actionUi";
import { newAction, LtkAction } from "../../shared/schema/actions";
import { LinkTarget } from "../../shared/schema/actionLinks";
import { setActionLinkProvider, setActionViewerProvider, setEndorsementLookup } from "../../shared/ui/actionLinkProvider";

ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
const t = (over: Partial<LinkTarget>): LinkTarget => ({ kind: "ritual", id: "B1", boardId: "B1", title: "Daily production meeting", detail: "Bendigo / Packaging · Tier 1 · Jane Smith", keywords: "Sam Lee", mine: true, near: true, cards: { C1: "Actions", C2: "Safety cross" }, ...over });
const targets: LinkTarget[] = [
  t({}),
  t({ id: "B2", boardId: "B2", title: "Weekly site review", detail: "Bendigo · Tier 2 · Ann Ray", mine: false }),
  t({ id: "B3", boardId: "B3", title: "Packaging line 2 start-up huddle with a deliberately long name to prove wrapping", detail: "Bendigo / Packaging / Line 2 · Tier 1 · Tom Hall", mine: false }),
  t({ kind: "initiative", id: "I1", boardId: "init-I1", title: "Reduce changeover on line 2", detail: "Bendigo / Packaging · Jane Smith", keywords: "A3", cards: { K1: "Charter" } }),
  t({ kind: "initiative", id: "I2", boardId: "init-I2", title: "Packaging scrap reduction", detail: "Bendigo / Packaging · Sam Lee", keywords: "DMAIC", mine: false, cards: {} }),
];
let openBoardId: string | null = null;
setActionLinkProvider(() => Promise.resolve({ targets, personalWho: "u1", openBoardId, openHome: "" }));

setActionViewerProvider(() => ({ whoId: "u1", who: "Ben O'Brien" }));
// I1 asks for endorsement; the harness flips whether the viewer may give it
let endorser = false;
(window as unknown as { setEndorser: (v: boolean) => void }).setEndorser = (v) => (endorser = v);
setEndorsementLookup((a) => (a.initiativeId === "I1" ? { on: true, mine: endorser } : null));
const host = document.getElementById("h")!;
const people = [{ whoId: "u1", who: "Ben O'Brien" }, { whoId: "u2", who: "Jane Smith" }];
const make = (instanceId: string, initiativeId?: string): LtkAction => {
  const a = newAction({ source: "card", sourceId: "" });
  a.instanceId = instanceId;
  a.issue = "Guard on filler 2 is loose";
  a.description = "Refit and torque the guard bolts";
  a.assignees = [{ whoId: "u1", who: "Ben O'Brien", done: false }];
  if (initiativeId) a.initiativeId = initiativeId;
  return a;
};
const cases: [string, () => void][] = [
  ["Personal", () => open(make("hub:u1"), false)],
  ["On a ritual card", () => open(make("B1:C2"), false)],
  ["On an initiative", () => open(make("init-I1:board", "I1"), false)],
  ["Restricted initiative", () => open(make("init-X:K1", "X"), false)],
  ["With comments, on hold", () => {
    const a = make("B1:C2");
    a.pdca = "hold";
    a.comments = [{ whoId: "u2", who: "Jane Smith", when: "2026-09-26", text: "Guard bolts are on order, due Friday." }, { whoId: "u1", who: "Ben O'Brien", when: "2026-09-28", text: "Holding until the parts land." }];
    open(a, false);
  }],
  ["Initiative action, open", () => open(make("init-I1:K1", "I1"), false)],
  ["Awaiting endorsement", () => {
    const a = make("init-I1:K1", "I1");
    a.status = "verify";
    a.pdca = "closed";
    open(a, false);
  }],
  ["Quick add (board open)", () => { openBoardId = "init-I1"; open(make("hub:u1"), true, true); openBoardId = null; }],
];
function open(action: LtkAction, isNew: boolean, linkToOpenBoard = false): void {
  openActionDialog({ host, action, people, isNew, linkToOpenBoard, onCommit: () => {
    (window as unknown as { last: unknown }).last = JSON.parse(JSON.stringify(action));
    console.log("commit", action.instanceId, action.initiativeId ?? "-", action.status);
  } });
}
const bar = document.getElementById("bar")!;
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.textContent = label;
  b.id = `case-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  b.style.cssText = "font:inherit;padding:8px 12px;border:1px solid #cfc8bc;border-radius:6px;background:#fff;cursor:pointer";
  b.addEventListener("click", fn);
  bar.appendChild(b);
}
(window as unknown as { cases: typeof cases }).cases = cases;
