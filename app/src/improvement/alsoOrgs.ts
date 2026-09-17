// "Also shown in" on an initiative (Ben's field feedback, 2026-09-17): an
// initiative that spans departments keeps ONE primary organisation (its
// owner org) and lists further orgs it should appear under — the
// register's scope crumb, the team grouping, the Gantt card. Shared by the
// create form and Edit details.

import { el, clear } from "../../../shared/ui/dom";

export interface InitOrg {
  company: string;
  site: string;
  department: string;
  area: string;
}

const keyOf = (o: InitOrg) => [o.site, o.department, o.area].join("|");
export const orgLabelOf = (o: InitOrg) => [o.site, o.department, o.area].filter((x) => x !== "").join(" › ");

export function renderAlsoOrgs(o: {
  host: HTMLElement;
  sites: { site: string; departments: { department: string; areas: string[] }[] }[];
  siteCo: Record<string, string>;
  list: InitOrg[];
  primary: () => InitOrg;
}): void {
  const box = el("div", "app-im-also");
  o.host.appendChild(box);
  const draft = { site: "", department: "", area: "" };
  const paint = () => {
    clear(box);
    const chips = el("div", "app-im-links");
    if (o.list.length === 0) chips.appendChild(el("span", "app-cp-muted", "Only its own organisation."));
    o.list.forEach((org, k) => {
      const chip = el("span", "app-im-link");
      chip.appendChild(el("span", undefined, orgLabelOf(org)));
      const x = el("button", "app-im-link-x", "×") as HTMLButtonElement;
      x.type = "button";
      x.title = "Remove";
      x.addEventListener("click", () => {
        o.list.splice(k, 1);
        paint();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    box.appendChild(chips);
    const row = el("div", "app-im-orgrow");
    const sel = (value: string, options: [string, string][], on: (v: string) => void) => {
      const s = el("select", "app-input") as HTMLSelectElement;
      for (const [v, l] of options) {
        const op = el("option", "", l) as HTMLOptionElement;
        op.value = v;
        if (v === value) op.selected = true;
        s.appendChild(op);
      }
      s.addEventListener("change", () => on(s.value));
      return s;
    };
    const site = o.sites.find((x) => x.site === draft.site);
    const dept = site?.departments.find((x) => x.department === draft.department);
    row.appendChild(
      sel(draft.site, [["", "Site…"], ...o.sites.map((x) => [x.site, x.site] as [string, string])], (v) => {
        draft.site = v;
        draft.department = "";
        draft.area = "";
        paint();
      })
    );
    row.appendChild(
      sel(draft.department, [["", site ? "Whole site" : "Department"], ...(site?.departments ?? []).map((x) => [x.department, x.department] as [string, string])], (v) => {
        draft.department = v;
        draft.area = "";
        paint();
      })
    );
    if (dept && dept.areas.length > 0) row.appendChild(sel(draft.area, [["", "Whole department"], ...dept.areas.map((a) => [a, a] as [string, string])], (v) => (draft.area = v)));
    const add = el("button", "app-btn", "＋ Add") as HTMLButtonElement;
    add.type = "button";
    add.disabled = draft.site === "";
    add.addEventListener("click", () => {
      if (draft.site === "") return;
      const org: InitOrg = { company: o.siteCo[draft.site] ?? "", ...draft };
      if (keyOf(org) !== keyOf(o.primary()) && !o.list.some((x) => keyOf(x) === keyOf(org))) o.list.push(org);
      draft.site = "";
      draft.department = "";
      draft.area = "";
      paint();
    });
    row.appendChild(add);
    box.appendChild(row);
  };
  paint();
}
