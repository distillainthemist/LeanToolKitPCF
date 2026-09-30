// The embed card's chips — Actions · present in its own window · open in
// a tab · refresh — with and without a title, with a long count.
import { EmbedView } from "../../controls/EmbedCard/editor";
import { newAction } from "../../shared/schema/actions";

const ed = new EmbedView(document.getElementById("e")!, { onActions: () => undefined });
(window as unknown as { ed: EmbedView }).ed = ed;
ed.setUrl("about:blank");
const acts = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = newAction({ source: "embed", sourceId: "" });
    a.issue = `Action ${i + 1}`;
    return a;
  });
const cases: [string, () => void][] = [
  ["Titled, no actions", () => { ed.setChrome("Production report", ""); ed.setActions([]); }],
  ["Titled, 12 actions", () => { ed.setChrome("Production report", ""); ed.setActions(acts(12)); }],
  ["No title, 3 actions", () => { ed.setChrome("", ""); ed.setActions(acts(3)); }],
  ["Read-only", () => { ed.setReadOnly(true); }],
  ["Editable", () => { ed.setReadOnly(false); }],
];
const bar = document.getElementById("bar")!;
for (const [label, fn] of cases) {
  const b = document.createElement("button");
  b.textContent = label;
  b.id = "case-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  b.style.cssText = "font:inherit;padding:8px 12px;border:1px solid #cfc8bc;border-radius:6px;background:#fff;cursor:pointer";
  b.addEventListener("click", fn);
  bar.appendChild(b);
}
cases[1][1]();
