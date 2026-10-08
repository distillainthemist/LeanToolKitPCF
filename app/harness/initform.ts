// The initiative header form (2026-10-08): the six groups in the form
// modal, create and edit modes, with stub data — no stores behind it
// (the metrics list's driver read fails quietly to an empty tree).
import "../src/style.css";
import { el } from "../../shared/ui/dom";
import { renderInitiativeForm, InitiativeDraft } from "../src/improvement/initiativeForm";
import type { TemplateField, TemplateRole } from "../src/improvement/templateModel";

const sites = [
  { site: "Bendigo", departments: [{ department: "Packaging", areas: ["Line 1", "Line 2"] }, { department: "Distilling", areas: [] }] },
  { site: "Geelong", departments: [{ department: "Warehouse", areas: [] }] },
];
const siteCo: Record<string, string> = { Bendigo: "Pechey", Geelong: "Pechey" };
const roster = ["Ann Ray", "Ben O'Brien", "Jane Smith", "Sam Lee"].map((who, i) => ({ whoId: `u${i}`, who, email: "", site: "Bendigo", department: "", area: "", role: "user", active: true }));
const imp = {
  standardRoles: [{ key: "owner", label: "Owner", people: { Bendigo: [{ whoId: "u1", who: "Ben O'Brien" }] } }, { key: "sponsor", label: "Sponsor", people: { Bendigo: [{ whoId: "u0", who: "Ann Ray" }] } }],
  standardFields: [
    { key: "workingFolder", label: "Working folder", kind: "url", options: [], required: false },
    { key: "context", label: "Context", kind: "longtext", options: [], required: false },
    { key: "problem", label: "Problem / opportunity statement", kind: "longtext", options: [], required: true },
  ] as TemplateField[],
  methods: [],
  vdtEditorRole: "owner",
  healthQuestions: [],
  hiddenBuiltins: [],
} as unknown as Parameters<typeof renderInitiativeForm>[0]["imp"];
const roleDefs: TemplateRole[] = [
  { key: "sponsor", label: "Sponsor", standard: true, multi: false, timeCommitment: false },
  { key: "owner", label: "Owner", standard: true, multi: false, timeCommitment: false },
  { key: "team", label: "Team", standard: true, multi: true, timeCommitment: false },
] as TemplateRole[];
const tplFields: TemplateField[] = [
  { key: "start", label: "Start date", kind: "date", options: [], required: false },
  { key: "rating", label: "Test rating", kind: "rating", options: [], required: false },
  { key: "budget", label: "Budget", kind: "number", options: [], required: false },
  { key: "notes", label: "Notes", kind: "text", options: [], required: false },
];
const priorities = [
  { id: "p1", statement: "Leadership in the Field is awesome", status: "active", org: { company: "Pechey", site: "Bendigo", department: "", area: "" } },
  { id: "p2", statement: "Zero harm every shift", status: "active", org: { company: "Pechey", site: "", department: "", area: "" } },
];
const host = document.getElementById("host")!;
const log = document.getElementById("log")!;
const empty: InitiativeDraft = { title: "", description: "", org: { company: "Pechey", site: "Bendigo", department: "", area: "" }, alsoOrgs: [], priorities: [], roles: {}, fieldValues: {}, metrics: [], confidential: false, endorsement: false };
const filled: InitiativeDraft = {
  ...empty,
  title: "LiF Plan on a Page",
  description: "",
  org: { company: "Pechey", site: "Bendigo", department: "Packaging", area: "" },
  alsoOrgs: [{ company: "Pechey", site: "Geelong", department: "Warehouse", area: "" }],
  priorities: [{ priorityId: "p1", primary: true, label: "p1" }],
  roles: { sponsor: [{ whoId: "u0", who: "Ann Ray" }], owner: [{ whoId: "u1", who: "Ben O'Brien" }] },
  fieldValues: { workingFolder: "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/03%20Marketing", rating: "3" },
  confidential: false,
  endorsement: true,
};
let handle: ReturnType<typeof renderInitiativeForm> | null = null;
const open = (mode: "create" | "edit", initial: InitiativeDraft) => {
  host.replaceChildren();
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal app-modal-form app-im-create");
  overlay.appendChild(box);
  host.appendChild(overlay);
  box.appendChild(el("div", "app-modal-title", mode === "create" ? "New A3 problem solving" : "Edit details"));
  const body = el("div", "app-cp-modal-body");
  box.appendChild(body);
  handle = renderInitiativeForm({
    host: body, dialogHost: host, mode, sites, siteCo, roster, imp, roleDefs, fields: [...imp.standardFields, ...tplFields],
    singleAction: false, metricRule: "none", initial, fiCtx: { people: [], palette: {} }, canPromote: false,
    loadPriorities: async () => priorities,
  });
  const foot = el("div", "app-modal-footer");
  const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
  cancel.type = "button";
  cancel.addEventListener("click", () => host.replaceChildren());
  const save = el("button", "app-btn app-btn-primary", mode === "create" ? "Create initiative" : "Save details") as HTMLButtonElement;
  save.type = "button";
  save.addEventListener("click", () => {
    const errs = handle!.validate();
    log.textContent = errs.length > 0 ? errs.join("\n") : JSON.stringify(handle!.read(), null, 1).slice(0, 600);
  });
  foot.append(cancel, save);
  box.appendChild(foot);
  handle.focus();
};
(window as unknown as { openForm: typeof open; handle: () => typeof handle }).openForm = open;
(window as unknown as { handle: () => typeof handle }).handle = () => handle;
const bar = document.getElementById("cases")!;
for (const [label, fn] of [["Edit (filled)", () => open("edit", filled)], ["Create (empty)", () => open("create", empty)]] as [string, () => void][]) {
  const b = document.createElement("button");
  b.className = "app-btn";
  b.textContent = label;
  b.addEventListener("click", fn);
  bar.appendChild(b);
}
open("edit", filled);
