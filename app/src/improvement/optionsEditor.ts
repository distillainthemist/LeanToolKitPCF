// The picklist options editor (label + the state it means), shared by the
// own-metric form and the value-driver rail (2026-09-09).

import { el, clear } from "../../../shared/ui/dom";

export interface StateOption {
  label: string;
  state: "green" | "amber" | "red";
}

export const DEFAULT_PICKLIST: StateOption[] = [
  { label: "On track", state: "green" },
  { label: "At risk", state: "amber" },
  { label: "Off track", state: "red" },
];

/** Renders into `host`; mutates `options` in place. */
export function renderOptionsEditor(host: HTMLElement, options: StateOption[]): { refresh: () => void } {
  const paint = () => {
    clear(host);
    options.forEach((op, k) => {
      const row = el("div", "app-im-optrow");
      const lbl = el("input", "app-input") as HTMLInputElement;
      lbl.value = op.label;
      lbl.placeholder = "Option";
      lbl.addEventListener("input", () => (op.label = lbl.value));
      const st = el("select", "app-input app-im-optstate") as HTMLSelectElement;
      for (const [v, l] of [["green", "On track"], ["amber", "At risk"], ["red", "Issue"]] as const) {
        const o2 = el("option", "", l) as HTMLOptionElement;
        o2.value = v;
        if (v === op.state) o2.selected = true;
        st.appendChild(o2);
      }
      st.addEventListener("change", () => (op.state = st.value as StateOption["state"]));
      const x = el("button", "app-im-link-x", "×") as HTMLButtonElement;
      x.type = "button";
      x.addEventListener("click", () => {
        options.splice(k, 1);
        paint();
      });
      row.append(lbl, st, x);
      host.appendChild(row);
    });
    const add = el("button", "app-link", "＋ Option") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => {
      options.push({ label: "", state: options.length === 0 ? "green" : "red" });
      paint();
      (host.querySelector(".app-im-optrow:last-of-type input") as HTMLInputElement | null)?.focus();
    });
    host.appendChild(add);
  };
  paint();
  return { refresh: paint };
}
