// "Link to a value driver" (spec §3.6 + review point 2): a search over the
// site's tree where every hit shows its FULL PATH, so two same-named
// leaves on different branches can't be confused. A metric DRIVES a leaf
// only when the units match (or the metric has none) — otherwise the link
// is offered as LEADS (a leading-indicator relationship, no arithmetic).

import { el, clear } from "../../../../shared/ui/dom";
import { listDrivers } from "../../store/valueDrivers";
import { DriverNode, isLeaf, isNumeric, pathOf } from "./model";

export type DriverLinkMode = "drives" | "leads";

export interface DriverLink {
  driverId: string;
  mode: DriverLinkMode;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

/** Resolves a link, "clear", or null (cancelled). */
export function openDriverLinkPicker(
  host: HTMLElement,
  site: string,
  metric: { name: string; unit: string },
  current: DriverLink | null
): Promise<DriverLink | "clear" | null> {
  return new Promise((resolve) => {
    const scrim = el("div", "app-modal-overlay");
    const box = el("div", "app-modal app-modal-wide");
    box.appendChild(el("div", "app-modal-title", `Link “${metric.name}” to a value driver`));
    box.appendChild(
      el("div", "app-modal-note", `${site}'s tree. Drives = the metric's number moves this leaf (units must match: ${metric.unit || "any"}). Leads = an influence without a formula — shown dashed, never summed.`)
    );
    const search = el("input", "app-input") as HTMLInputElement;
    search.placeholder = "Search drivers…";
    box.appendChild(search);
    const list = el("div", "app-vd-picklist");
    box.appendChild(list);
    let nodes: DriverNode[] = [];
    let done = false;
    const finish = (r: DriverLink | "clear" | null) => {
      if (done) return;
      done = true;
      scrim.remove();
      resolve(r);
    };
    const paint = () => {
      clear(list);
      const q = search.value.trim().toLowerCase();
      const hits = nodes
        .filter((n) => n.kind === "driver")
        .filter((n) => q === "" || n.name.toLowerCase().includes(q) || pathOf(nodes, n.id).join(" ").toLowerCase().includes(q))
        .slice(0, 40);
      if (nodes.length === 0) {
        list.appendChild(el("div", "app-cp-muted", "No value drivers for this site yet — Settings → Value drivers."));
        return;
      }
      if (hits.length === 0) list.appendChild(el("div", "app-cp-muted", "No driver matches."));
      for (const n of hits) {
        const row = el("div", "app-vd-pickrow" + (current?.driverId === n.id ? " app-vd-pickrow-on" : ""));
        const path = pathOf(nodes, n.id);
        const main = el("div", "app-vd-pickmain");
        main.appendChild(el("div", "app-vd-pickname", n.name));
        main.appendChild(el("div", "app-vd-pickpath", path.slice(0, -1).join(" › ") || "top-level"));
        main.appendChild(el("div", "app-vd-pickmeta", [!isNumeric(n) ? (n.tracking.kind === "goodbad" ? "good / bad" : "picklist") : n.unit || "no unit", n.cadence, isLeaf(nodes, n) ? "leaf" : "computed"].join(" · ")));
        row.appendChild(main);
        const acts = el("div", "app-vd-pickacts");
        const leaf = isLeaf(nodes, n);
        const unitOk = !isNumeric(n) || metric.unit.trim() === "" || metric.unit.trim().toLowerCase() === n.unit.trim().toLowerCase();
        const drives = btn("Drives", "app-btn app-btn-primary");
        drives.disabled = !leaf || !unitOk;
        drives.title = !leaf ? "Only a leaf can be driven — computed drivers come from their formula" : !unitOk ? `Units differ (${metric.unit} vs ${n.unit || "none"}) — link as Leads, or align the units` : "The metric's number moves this leaf";
        drives.addEventListener("click", () => finish({ driverId: n.id, mode: "drives" }));
        const leads = btn("Leads");
        leads.title = "An influence without arithmetic — dashed on the tree";
        leads.addEventListener("click", () => finish({ driverId: n.id, mode: "leads" }));
        acts.append(drives, leads);
        row.appendChild(acts);
        list.appendChild(row);
      }
    };
    search.addEventListener("input", paint);
    void listDrivers(site)
      .then((ns) => {
        nodes = ns;
        paint();
      })
      .catch(() => paint());
    const foot = el("div", "app-modal-footer");
    if (current) {
      const clearB = btn("Unlink", "app-btn app-btn-danger");
      clearB.addEventListener("click", () => finish("clear"));
      foot.appendChild(clearB);
    }
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", () => finish(null));
    foot.appendChild(cancel);
    box.appendChild(foot);
    scrim.appendChild(box);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) finish(null);
    });
    host.appendChild(scrim);
    search.focus();
  });
}

/** "EBITDA › Gross margin › Saleable volume · drives" for a metric row. */
export function describeLink(nodes: DriverNode[], link: DriverLink | null): string {
  if (!link) return "";
  const path = pathOf(nodes, link.driverId);
  if (path.length === 0) return `(driver missing) · ${link.mode}`;
  return `${path.join(" › ")} · ${link.mode}`;
}
