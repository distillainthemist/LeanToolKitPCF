// First-run site prompt — a shell-level modal that asks a newly
// registered viewer to place themselves in the org (site → department →
// area) so their meetings, actions and protected times find them. Built
// with the app's own chrome (not the toolkit dialog, which needs a
// mounted control's --ltk-* vars). Resolves the saved person, or null if
// the viewer skips.

import { parseOrgTree } from "../../../shared/schema/meeting";
import { el } from "../../../shared/ui/dom";
import { branding, orgJson } from "../store/config";
import { RosterPerson } from "../store/mappers";
import { upsertPerson } from "../store/people";

export async function promptForSite(me: RosterPerson): Promise<RosterPerson | null> {
  const [tree, b] = await Promise.all([
    orgJson().then(parseOrgTree),
    branding(),
  ]);
  const sites = tree.map((s) => s.site);
  const deptsFor = (site: string) =>
    tree.find((s) => s.site === site)?.departments.map((d) => d.department) ?? [];
  const areasFor = (site: string, dept: string) =>
    tree.find((s) => s.site === site)?.departments.find((d) => d.department === dept)
      ?.areas ?? [];

  const appName = b.appName.trim() || "LeanBoard";

  return new Promise<RosterPerson | null>((resolve) => {
    const overlay = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    const heading = el("div", "app-modal-title", `Welcome to ${appName}`);
    const note = el(
      "div",
      "app-modal-note",
      "Choose your site so your meetings, actions and protected times find you. " +
        "Department and area are optional — you can change all of this later in Settings."
    );

    const site = pick(sites, "");
    const dept = pick([], "");
    const area = pick([], "");
    dept.disabled = true;
    area.disabled = true;

    site.addEventListener("change", () => {
      fill(dept, deptsFor(site.value));
      fill(area, []);
      dept.disabled = site.value === "";
      area.disabled = true;
    });
    dept.addEventListener("change", () => {
      fill(area, areasFor(site.value, dept.value));
      area.disabled = dept.value === "";
    });

    const footer = el("div", "app-modal-footer");
    const skip = el("button", "app-link", "Skip for now") as HTMLButtonElement;
    const save = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
    save.disabled = true;
    site.addEventListener("change", () => {
      save.disabled = site.value === "";
    });

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        resolve(null);
      }
    };

    skip.addEventListener("click", () => {
      close();
      resolve(null);
    });
    save.addEventListener("click", () => {
      if (site.value === "") return;
      save.disabled = true;
      save.textContent = "Saving…";
      const updated: RosterPerson = {
        ...me,
        site: site.value,
        department: dept.value,
        area: area.value,
      };
      void upsertPerson(updated).then(() => {
        close();
        resolve(updated);
      });
    });

    footer.append(skip, save);
    box.append(
      heading,
      note,
      modalRow("Site", site),
      modalRow("Department", dept),
      modalRow("Area", area),
      footer
    );
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    site.focus();
  });
}

function pick(options: string[], value: string): HTMLSelectElement {
  const s = el("select", "app-input") as HTMLSelectElement;
  fill(s, options);
  s.value = value;
  return s;
}

function fill(sel: HTMLSelectElement, options: string[]): void {
  const keep = sel.value;
  sel.replaceChildren();
  for (const o of ["", ...options]) {
    const opt = el("option", "", o === "" ? "Select…" : o) as HTMLOptionElement;
    opt.value = o;
    sel.appendChild(opt);
  }
  sel.value = options.includes(keep) ? keep : "";
}

function modalRow(label: string, control: HTMLElement): HTMLElement {
  const r = el("div", "app-settings-row");
  r.append(el("span", "app-settings-label", label), control);
  return r;
}
