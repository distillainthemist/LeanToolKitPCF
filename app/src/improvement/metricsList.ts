// The initiative's metrics list (metric rework 2026-09-03) — ONE component
// for the create form and Edit details: ＋ from the value driver tree (a
// leaf or leading node; the metric IS the driver) · ＋ initiative-specific
// (proposed here, private series) · ★ one primary · target per row ·
// Link… / Promote… an own metric into the tree later · ×.

import { el, clear } from "../../../shared/ui/dom";
import { promptConfirm } from "../prompts";
import { listDrivers, saveDriver } from "../store/valueDrivers";
import { directionOf, keyFor, MetricKind, normalizeMetrics, OWN_CADENCES, OwnCadence, TemplateMetric, Tracking } from "./templateModel";
import { DriverNode, isLeaf, newNode, pathOf } from "./vdt/model";
import { openDriverLinkPicker } from "./vdt/linkPicker";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface MetricsListOpts {
  host: HTMLElement;
  /** Mutated in place. */
  metrics: TemplateMetric[];
  /** The initiative's site (the tree to pick from) — read live. */
  site: () => string;
  /** May this viewer create drivers (promote)? */
  canPromote: boolean;
  /** An existing initiative: linking/promoting migrates its card's series. */
  onLinked?: (m: TemplateMetric) => Promise<void>;
  onChanged?: () => void;
}

export function renderMetricsList(o: MetricsListOpts): { refresh: () => void } {
  const box = el("div", "app-im-metrics app-im-metricslist");
  o.host.appendChild(box);
  let drivers: DriverNode[] = [];
  let driversFor = "";

  const loadDrivers = async () => {
    const site = o.site();
    if (site === driversFor) return;
    driversFor = site;
    drivers = await listDrivers(site).catch(() => []);
  };

  const changed = () => {
    normalizeMetrics(o.metrics).forEach((m, i) => {
      o.metrics[i] = m;
    });
    o.onChanged?.();
    paint();
  };

  const kindOf = (m: TemplateMetric): MetricKind => m.kind ?? (m.driverId ? "driver" : "own");

  const paint = () => {
    clear(box);
    if (o.metrics.length === 0) box.appendChild(el("div", "app-cp-muted", "No metrics yet — pick one from the value driver tree, or propose one for this initiative."));
    o.metrics.forEach((m, idx) => {
      const row = el("div", "app-im-metricrow");
      // ★ primary
      const star = btn(m.primary ? "★" : "☆", "app-im-metricstar" + (m.primary ? " app-im-metricstar-on" : ""));
      star.title = m.primary ? "Primary metric — headlines the register and the roll-up" : "Make primary";
      star.addEventListener("click", () => {
        o.metrics.forEach((x) => delete x.primary);
        m.primary = true;
        changed();
      });
      row.appendChild(star);
      const main = el("div", "app-im-metricmain");
      const name = el("div", "app-im-metricname");
      name.appendChild(el("span", undefined, m.name));
      if (kindOf(m) === "driver") {
        const p = m.driverId ? pathOf(drivers, m.driverId) : [];
        name.appendChild(el("span", "app-im-metrickind app-im-metrickind-vdt", `· VDT${m.driverLink === "leads" ? " (leads)" : ""}`));
        if (p.length > 0) name.title = p.join(" › ");
      } else name.appendChild(el("span", "app-im-metrickind", "· initiative-specific"));
      main.appendChild(name);
      const dir = directionOf(m);
      main.appendChild(el("div", "app-im-metricmeta", [m.unit || "no unit", dir === "down" ? "lower is better" : dir === "range" ? "within limits" : "higher is better", m.tracking === "value" ? "value vs target" : m.tracking === "goodbad" ? "good / bad" : "status", ...(kindOf(m) === "own" ? [m.cadence ?? "weekly"] : [])].join(" · ")));
      row.appendChild(main);
      // target + limits (the KPI card's spec)
      const numIn = (label: string, cur: number | null | undefined, set: (v: number | null) => void, cls: string) => {
        const inp = el("input", "app-input " + cls) as HTMLInputElement;
        inp.type = "number";
        inp.step = "any";
        inp.placeholder = label;
        inp.value = typeof cur === "number" ? String(cur) : "";
        inp.title = `${label}${m.unit ? ` (${m.unit})` : ""}`;
        inp.addEventListener("change", () => {
          const n = Number(inp.value);
          set(inp.value.trim() === "" || !Number.isFinite(n) ? null : n);
          o.onChanged?.();
          paint();
        });
        return inp;
      };
      const spec = el("div", "app-im-metricspec");
      spec.appendChild(numIn("lower", m.lsl, (v) => (m.lsl = v), "app-im-limit"));
      spec.appendChild(numIn("target", m.target, (v) => (m.target = v), "app-im-target"));
      spec.appendChild(numIn("upper", m.usl, (v) => (m.usl = v), "app-im-limit"));
      row.appendChild(spec);
      // own metrics: into the tree
      const acts = el("div", "app-im-metricacts");
      if (kindOf(m) === "own") {
        const link = btn("Link…", "app-link");
        link.title = "Link to an existing driver — its series takes this metric's points";
        link.addEventListener("click", () => void linkOwn(m));
        acts.appendChild(link);
        const promote = btn("Promote…", "app-link");
        promote.disabled = !o.canPromote;
        promote.title = o.canPromote ? "Create a driver in the tree from this metric" : "Promoting needs the Value-drivers editor role";
        promote.addEventListener("click", () => void promoteOwn(m));
        acts.appendChild(promote);
      }
      const x = btn("×", "app-im-link-x");
      x.title = "Remove metric";
      x.addEventListener("click", () => {
        o.metrics.splice(idx, 1);
        changed();
      });
      acts.appendChild(x);
      row.appendChild(acts);
      box.appendChild(row);
    });
    const adders = el("div", "app-im-metricadders");
    const fromTree = btn("＋ From the value driver tree");
    fromTree.addEventListener("click", () => void addFromTree());
    const own = btn("＋ Initiative-specific metric");
    own.addEventListener("click", () => openOwnForm());
    adders.append(fromTree, own);
    box.appendChild(adders);
  };

  /** Pick a leaf or leading node; the metric IS the driver. */
  const addFromTree = async () => {
    await loadDrivers();
    const r = await openDriverLinkPicker(document.body, o.site(), { name: "this initiative's metric", unit: "" }, null);
    if (r === null || r === "clear") return;
    const n = drivers.find((d) => d.id === r.driverId) ?? null;
    if (!n) return;
    if (n.kind === "driver" && !isLeaf(drivers, n)) {
      await promptConfirm({ title: `${n.name} comes from its formula`, note: "A computed driver can't be an initiative's metric — the initiative can't own its actuals. Pick one of the drivers beneath it.", confirmLabel: "OK" });
      return;
    }
    if (o.metrics.some((m) => m.driverId === n.id)) return;
    o.metrics.push({
      key: keyFor(n.name, o.metrics.map((x) => x.key)),
      name: n.name,
      unit: n.unit,
      target: null,
      goodDirection: "up",
      tracking: "value",
      kind: "driver",
      driverId: n.id,
      driverLink: n.kind === "leading" ? "leads" : "drives",
    });
    changed();
  };

  /** Propose an initiative-specific metric inline. */
  const openOwnForm = () => {
    const scrim = el("div", "app-modal-overlay");
    const dlg = el("div", "app-modal");
    dlg.appendChild(el("div", "app-modal-title", "Initiative-specific metric"));
    dlg.appendChild(el("div", "app-modal-note", "Measured on this initiative's own KPI card. It can be linked to, or promoted into, the value driver tree later."));
    const field = (label: string, control: HTMLElement) => {
      const f = el("div", "app-field");
      f.append(el("span", "app-field-label", label), control);
      dlg.appendChild(f);
    };
    const nameIn = el("input", "app-input") as HTMLInputElement;
    nameIn.placeholder = "e.g. Changeover time";
    field("Name", nameIn);
    const unitIn = el("input", "app-input") as HTMLInputElement;
    unitIn.placeholder = "min, %, $, kL";
    field("Unit", unitIn);
    const numField = (label: string, hint: string) => {
      const inp = el("input", "app-input") as HTMLInputElement;
      inp.type = "number";
      inp.step = "any";
      inp.placeholder = hint;
      field(label, inp);
      return inp;
    };
    const tgtIn = numField("Target", "the number to reach");
    const lslIn = numField("Lower limit", "below this = red (blank = none)");
    const uslIn = numField("Upper limit", "above this = red (blank = none)");
    dlg.appendChild(el("div", "app-field-hint", "Direction follows the limits: a lower limit only means higher is better; an upper only, lower is better; both, within range."));
    const trk = el("select", "app-input") as HTMLSelectElement;
    for (const [v, l] of [["value", "Value vs target"], ["goodbad", "Good / bad"], ["picklist", "Status picklist"]] as const) {
      const op = el("option", "", l) as HTMLOptionElement;
      op.value = v;
      trk.appendChild(op);
    }
    field("Tracking", trk);
    const cad = el("select", "app-input") as HTMLSelectElement;
    for (const c of OWN_CADENCES) {
      const op = el("option", "", c[0].toUpperCase() + c.slice(1)) as HTMLOptionElement;
      op.value = c;
      if (c === "weekly") op.selected = true;
      cad.appendChild(op);
    }
    field("Cadence", cad);
    dlg.appendChild(el("div", "app-field-hint", "The period the KPI card's grid enters values by — a column per day, week, month or year."));
    const err = el("div", "app-cp-err", "");
    dlg.appendChild(err);
    const foot = el("div", "app-modal-footer");
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", () => scrim.remove());
    const add = btn("Add metric", "app-btn app-btn-primary");
    add.addEventListener("click", () => {
      const nm = nameIn.value.trim();
      if (nm === "") {
        err.textContent = "A name is needed.";
        return;
      }
      const numOf = (inp: HTMLInputElement): number | null => {
        const n = Number(inp.value);
        return inp.value.trim() === "" || !Number.isFinite(n) ? null : n;
      };
      const lsl = numOf(lslIn);
      const usl = numOf(uslIn);
      o.metrics.push({
        key: keyFor(nm, o.metrics.map((x) => x.key)),
        name: nm,
        unit: unitIn.value.trim(),
        target: numOf(tgtIn),
        goodDirection: directionOf({ usl, lsl, goodDirection: "up" }),
        tracking: trk.value as Tracking,
        kind: "own",
        cadence: cad.value as OwnCadence,
        ...(lsl !== null ? { lsl } : {}),
        ...(usl !== null ? { usl } : {}),
      });
      scrim.remove();
      changed();
    });
    foot.append(cancel, add);
    dlg.appendChild(foot);
    scrim.appendChild(dlg);
    document.body.appendChild(scrim);
    nameIn.focus();
  };

  /** Own → an existing driver (the host migrates the card's series). */
  const linkOwn = async (m: TemplateMetric) => {
    await loadDrivers();
    const r = await openDriverLinkPicker(document.body, o.site(), { name: m.name, unit: m.unit }, null);
    if (r === null || r === "clear") return;
    const n = drivers.find((d) => d.id === r.driverId);
    if (!n) return;
    m.driverId = n.id;
    m.driverLink = r.mode;
    m.kind = "driver";
    if (r.mode === "drives") {
      m.name = n.name;
      m.unit = n.unit;
    }
    if (o.onLinked) await o.onLinked(m);
    changed();
  };

  /** Own → a NEW node in the tree under a chosen parent. */
  const promoteOwn = async (m: TemplateMetric) => {
    await loadDrivers();
    const parents = drivers.filter((d) => d.kind === "driver");
    if (parents.length === 0) {
      await promptConfirm({ title: "No tree to promote into", note: "Settings → Value drivers has no drivers for this site yet.", confirmLabel: "OK" });
      return;
    }
    const scrim = el("div", "app-modal-overlay");
    const dlg = el("div", "app-modal");
    dlg.appendChild(el("div", "app-modal-title", `Promote “${m.name}” into the value driver tree`));
    dlg.appendChild(el("div", "app-modal-note", "A new node is created beneath the parent you choose and this metric links to it — its KPI card then records into the driver's series."));
    const field = (label: string, control: HTMLElement) => {
      const f = el("div", "app-field");
      f.append(el("span", "app-field-label", label), control);
      dlg.appendChild(f);
    };
    const parentSel = el("select", "app-input") as HTMLSelectElement;
    for (const p of parents) {
      const op = el("option", "", pathOf(drivers, p.id).join(" › ")) as HTMLOptionElement;
      op.value = p.id;
      parentSel.appendChild(op);
    }
    field("Under", parentSel);
    const kindSel = el("select", "app-input") as HTMLSelectElement;
    for (const [v, l] of [["driver", "A driver — enters the parent's formula (units should match)"], ["leading", "A leading indicator — influences, no formula"]] as const) {
      const op = el("option", "", l) as HTMLOptionElement;
      op.value = v;
      kindSel.appendChild(op);
    }
    field("As", kindSel);
    const foot = el("div", "app-modal-footer");
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", () => scrim.remove());
    const go = btn("Promote", "app-btn app-btn-primary");
    go.addEventListener("click", () => {
      void (async () => {
        const parent = parents.find((p) => p.id === parentSel.value);
        if (!parent) return;
        const n = newNode(o.site(), parent.id, m.name);
        n.unit = m.unit;
        n.kind = kindSel.value === "leading" ? "leading" : "driver";
        n.cadence = parent.cadence;
        n.order = drivers.filter((d) => d.parentId === parent.id).length + 1;
        n.source = "initiative metric";
        await saveDriver(n);
        drivers.push(n);
        m.driverId = n.id;
        m.driverLink = n.kind === "leading" ? "leads" : "drives";
        m.kind = "driver";
        scrim.remove();
        if (o.onLinked) await o.onLinked(m);
        changed();
      })();
    });
    foot.append(cancel, go);
    dlg.appendChild(foot);
    scrim.appendChild(dlg);
    document.body.appendChild(scrim);
  };

  void loadDrivers().then(paint);
  paint();
  return { refresh: () => void loadDrivers().then(paint) };
}
