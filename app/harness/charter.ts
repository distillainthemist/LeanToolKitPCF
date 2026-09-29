// The charter card with bound fields of every kind (a stub binding over an
// in-memory header), and the forms' field inputs underneath.
import "../src/style.css";
import { CanvasEditor } from "../../controls/CanvasCard/editor";
import { CanvasBinding, CanvasConfig, CanvasField } from "../../controls/CanvasCard/types";
import { canvasFieldFor, decodeFieldValue, encodeFieldValue, plainFieldValue } from "../src/improvement/fieldCodec";
import { fieldInput } from "../src/improvement/fieldInput";
import { FIELD_KINDS, TemplateField } from "../src/improvement/templateModel";

const defs: TemplateField[] = [
  { key: "problem", label: "Problem statement", kind: "richtext", options: [], required: true },
  { key: "scope", label: "Scope", kind: "longtext", options: [], required: false },
  { key: "saving", label: "Target saving", kind: "number", options: [], required: false },
  { key: "risk", label: "Risk level", kind: "picklist", options: ["Low", "Medium", "High"], required: false },
  { key: "areas", label: "Areas affected", kind: "multichoice", options: ["Line 1", "Line 2", "Warehouse"], required: false },
  { key: "window", label: "Delivery window", kind: "daterange", options: [], required: false },
  { key: "funded", label: "Funded", kind: "yesno", options: [], required: false },
  { key: "coach", label: "Coach", kind: "person", options: [], required: false },
  { key: "confidence", label: "Confidence", kind: "rating", options: [], required: false },
  { key: "progress", label: "Progress", kind: "percent", options: [], required: false },
];
const values: Record<string, string> = { scope: "Filler 2 changeovers only.\nExcludes labelling.", problem: "Changeover takes 48 minutes on average", saving: "12500.5" };
const def = (k: string) => defs.find((d) => d.key === k)!;
const log: string[] = [];
(window as unknown as { values: typeof values; log: string[] }).values = values;
(window as unknown as { log: string[] }).log = log;

const binding: CanvasBinding = {
  get: (b) => (b === "title" ? "Reduce changeover on line 2" : b.startsWith("field:") ? plainFieldValue(def(b.slice(6)).kind, values[b.slice(6)]) : ""),
  canEdit: () => true,
  edit: (b) => log.push(`POPUP ${b}`),
  kind: () => "text",
  set: async (b, v) => void log.push(`set ${b}=${v}`),
  typeOf: (b) => {
    if (b === "title") return { type: "text", options: [] };
    const cf = canvasFieldFor(def(b.slice(6)));
    return { type: cf.type, options: cf.options };
  },
  value: (b) => (b === "title" ? "Reduce changeover on line 2" : decodeFieldValue(def(b.slice(6)).kind, values[b.slice(6)])),
  setValue: async (b, next) => {
    if (b === "title") return void log.push(`title=${String(next)}`);
    values[b.slice(6)] = encodeFieldValue(def(b.slice(6)).kind, next);
    log.push(`${b}=${values[b.slice(6)]}`);
  },
};

// every canvas field is laid out as RICH TEXT — the target's type must win
const f = (id: string, label: string, bound: string, w = 1, h = 2): CanvasField => ({ id, type: "richtext", label, w, h, hint: "", required: false, options: [], columns: [], bound });
const config: CanvasConfig = {
  cols: 3,
  fields: [
    f("t", "Initiative", "title", 3, 1),
    f("p", "Problem statement", "field:problem", 2, 3),
    f("s", "Scope", "field:scope", 1, 3),
    f("sv", "Target saving", "field:saving", 1, 1),
    f("r", "Risk level", "field:risk", 1, 1),
    f("fu", "Funded", "field:funded", 1, 1),
    f("a", "Areas affected", "field:areas", 1, 2),
    f("w", "Delivery window", "field:window", 1, 1),
    f("co", "Coach", "field:coach", 1, 1),
    { ...f("free", "Notes (free rich text)", "", 1, 2) },
  ],
};
const ed = new CanvasEditor(document.getElementById("c")!, { onChange: () => log.push("doc changed") });
ed.setConfig(config);
ed.setPeople([{ whoId: "u1", who: "Jane Smith", initials: "JS" }, { whoId: "u2", who: "Sam Lee", initials: "SL" }]);
ed.setBinding(binding);

const form = document.getElementById("f")!;
const formValues: Record<string, string> = { ...values };
(window as unknown as { formValues: typeof formValues }).formValues = formValues;
const ctx = { people: [{ whoId: "u1", who: "Jane Smith", initials: "JS" }, { whoId: "u2", who: "Sam Lee", initials: "SL" }], palette: { good: "#107c10", at_risk: "#c19c00", bad: "#d13438" } };
const all: TemplateField[] = [...defs, ...FIELD_KINDS.filter((k) => !defs.some((d) => d.kind === k.value)).map((k) => ({ key: `x_${k.value}`, label: k.label, kind: k.value, options: [], required: false }))];
for (const cf of all) {
  const row = document.createElement("div");
  row.className = "app-field";
  row.dataset.key = cf.key;
  const label = document.createElement("span");
  label.className = "app-field-label";
  label.textContent = `${cf.label} · ${cf.kind}`;
  row.append(label, fieldInput(cf, formValues[cf.key] ?? "", (raw) => (formValues[cf.key] = raw), ctx));
  form.appendChild(row);
}
