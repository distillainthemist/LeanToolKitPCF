// Simulate (P9d, spec §3.4 + review): the same tree plus a right panel.
// Only initiatives whose metric DRIVES a leaf move numbers — a toggle and
// an editable delta in the leaf's unit, recomputed live; the tree marks
// ONLY what moved (green border, delta chip, green path leaf → root).
// Initiatives that LEAD a driver are listed under it, toggle-only, with
// an optional ASSUMED EFFECT on the driver — judgement, drawn dashed and
// named in the foot sentence, never mistaken for arithmetic. Scenarios
// save the toggles + deltas + assumed effects. Adopt as forecast writes
// LEAF forecasts (plan + delta) — the computed nodes fall out of the
// formulas; assumed effects are not written.

import { writePeriodSpread } from "../../store/driverSeries";
import { el, clear } from "../../../../shared/ui/dom";
import { promptConfirm, promptText } from "../../prompts";
import { newId, nowIso } from "../../../../shared/schema/id";
import { saveDriver } from "../../store/valueDrivers";
import { deleteScenario, listScenarios, saveScenario } from "../../store/valueDrivers";
import { Initiative } from "../initiativeModel";
import { AssumedEffect, DriverNode, formatValue, isLeaf, Scenario, ScenarioToggle, setValue, valueOf } from "./model";
import { computeTree, pathToRoot } from "./formula";
import { renderTree, TreeHandle } from "./tree";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface SimulateCtx {
  host: HTMLElement;
  nodes: DriverNode[];
  period: string;
  site: string;
  /** Active initiatives whose metrics link into this tree. */
  initiatives: Initiative[];
  actor: { whoId: string; who: string };
  /** The period's date window (Adopt writes bucket forecasts). */
  window: { from: string; to: string };
  canAdopt: boolean;
  /** After Adopt: reload values and repaint the host. */
  onAdopted: () => Promise<void>;
}

interface DriveRow {
  initiative: Initiative;
  metricName: string;
  leaf: DriverNode;
  defaultDelta: number | null;
}
interface LeadRow {
  initiative: Initiative;
  metricName: string;
  leading: DriverNode; // the leading node the metric links to
  driver: DriverNode | null; // the driver it leads (its parent)
}

export function renderSimulate(ctx: SimulateCtx): () => void {
  const { nodes, period } = ctx;
  const by = new Map(nodes.map((n) => [n.id, n]));
  const split = el("div", "app-vd-simsplit");
  ctx.host.appendChild(split);
  const treeHost = el("div", "app-vd-simtree");
  const panel = el("div", "app-vd-simpanel");
  split.append(treeHost, panel);
  let tree: TreeHandle | null = null;

  // ---- the linked initiatives, split by link mode -----------------------------------
  const drives: DriveRow[] = [];
  const leads: LeadRow[] = [];
  for (const i of ctx.initiatives) {
    for (const m of i.metrics) {
      if (!m.driverId) continue;
      const n = by.get(m.driverId);
      if (!n) continue;
      if (m.driverLink === "leads" || n.kind === "leading") {
        leads.push({ initiative: i, metricName: m.name, leading: n, driver: n.kind === "leading" ? (by.get(n.parentId) ?? null) : n });
      } else if (isLeaf(nodes, n)) {
        // review point 2: a default delta only when the units agree and
        // both a target and a baseline exist — otherwise it is typed
        const base = valueOf(n, period, "baseline");
        const unitOk = m.unit.trim() === "" || m.unit.trim().toLowerCase() === n.unit.trim().toLowerCase();
        const defaultDelta = unitOk && m.target !== null && base !== null ? m.target - base : null;
        drives.push({ initiative: i, metricName: m.name, leaf: n, defaultDelta });
      }
    }
  }

  // ---- scenario state ----------------------------------------------------------------
  const toggles = new Map<string, ScenarioToggle>(); // key initiativeId|leafId
  const keyOf = (r: DriveRow) => `${r.initiative.id}|${r.leaf.id}`;
  for (const r of drives) toggles.set(keyOf(r), { initiativeId: r.initiative.id, nodeId: r.leaf.id, on: false, delta: r.defaultDelta });
  const assumed = new Map<string, AssumedEffect>(); // key initiativeId|driverId
  const leadOn = new Set<string>();
  let scenarioName = "";
  let saved: Scenario[] = [];

  const plan = computeTree(nodes, period, "plan");

  /** Scenario numbers: leaf deltas first, then assumed effects on drivers. */
  const simulate = (): { values: Map<string, number | null>; overrides: Map<string, number | null> } => {
    const overrides = new Map<string, number | null>();
    for (const t of toggles.values()) {
      if (!t.on || t.delta === null) continue;
      const base = overrides.has(t.nodeId) ? overrides.get(t.nodeId) : plan.get(t.nodeId);
      if (base === null || base === undefined) continue;
      overrides.set(t.nodeId, base + t.delta);
    }
    const first = computeTree(nodes, period, "plan", overrides);
    const withAssumed = new Map(overrides);
    for (const a of assumed.values()) {
      if (a.effect === 0) continue;
      const base = withAssumed.has(a.nodeId) ? withAssumed.get(a.nodeId) : first.get(a.nodeId);
      if (base === null || base === undefined) continue;
      withAssumed.set(a.nodeId, base + a.effect);
    }
    return { values: computeTree(nodes, period, "plan", withAssumed), overrides: withAssumed };
  };

  const paintTree = () => {
    const { values } = simulate();
    const moved = new Set<string>();
    for (const n of nodes) {
      const a = values.get(n.id) ?? null;
      const b = plan.get(n.id) ?? null;
      if (a !== null && b !== null && Math.abs(a - b) > 1e-9) moved.add(n.id);
      if (a !== null && b === null) moved.add(n.id);
    }
    const assumedIds = new Set([...assumed.values()].filter((a) => a.effect !== 0).map((a) => a.nodeId));
    tree?.destroy();
    tree = renderTree(nodes, { host: treeHost, mode: "simulate", values, compare: plan, compareLabel: "plan", moved, assumed: assumedIds });
  };

  const footSentence = (): { line: string; path: string } => {
    const { values } = simulate();
    const on = [...toggles.values()].filter((t) => t.on).length;
    const roots = nodes.filter((n) => n.parentId === "");
    const bits: string[] = [];
    for (const r of roots) {
      const a = values.get(r.id) ?? null;
      const b = plan.get(r.id) ?? null;
      if (a === null || b === null) continue;
      const d = a - b;
      bits.push(`${r.name} ${d >= 0 ? "+" : "−"}${formatValue(Math.abs(d), r.unit, r.format)} vs plan`);
    }
    const anyAssumed = [...assumed.values()].some((a) => a.effect !== 0);
    const line = `${on} of ${drives.length} on${bits.length > 0 ? " · " + bits.join(" · ") : ""}${anyAssumed ? " · incl. assumed effects" : ""}`;
    const firstOn = [...toggles.values()].find((t) => t.on);
    const path = firstOn ? pathToRoot(nodes, firstOn.nodeId).map((n) => n.name).join(" → ") : "";
    return { line, path };
  };

  // ---- the panel ---------------------------------------------------------------------
  const paintPanel = () => {
    clear(panel);
    panel.appendChild(el("div", "app-tw-preview-h", "What if"));
    if (drives.length === 0 && leads.length === 0) {
      panel.appendChild(el("div", "app-cp-muted", "Link an initiative metric to a driver to run what-ifs."));
    }
    if (drives.length > 0) {
      panel.appendChild(el("div", "app-vd-simh", "Drives a formula"));
      for (const r of drives) {
        const t = toggles.get(keyOf(r)) as ScenarioToggle;
        const row = el("div", "app-vd-simrow" + (t.on ? " app-vd-simrow-on" : ""));
        const top = el("label", "app-vd-simtop");
        const cb = el("input") as HTMLInputElement;
        cb.type = "checkbox";
        cb.checked = t.on;
        cb.addEventListener("change", () => {
          t.on = cb.checked;
          paintTree();
          paintPanel();
        });
        top.append(cb, el("span", "app-vd-simtitle", r.initiative.title));
        row.appendChild(top);
        row.appendChild(el("div", "app-vd-simmeta", `${r.metricName} → ${r.leaf.name}`));
        const dl = el("div", "app-vd-simdelta");
        const inp = el("input", "app-input") as HTMLInputElement;
        inp.type = "number";
        inp.step = "any";
        inp.value = t.delta === null ? "" : String(t.delta);
        inp.placeholder = "delta";
        inp.title = r.defaultDelta === null ? "No default — the metric's unit or baseline doesn't line up with the leaf; enter the forecast change" : "Default = target − baseline";
        inp.addEventListener("change", () => {
          const v = Number(inp.value);
          t.delta = inp.value.trim() === "" || !Number.isFinite(v) ? null : v;
          paintTree();
          paintPanel();
        });
        dl.append(inp, el("span", "app-cp-muted", r.leaf.unit || ""));
        row.appendChild(dl);
        panel.appendChild(row);
      }
    }
    if (leads.length > 0) {
      panel.appendChild(el("div", "app-vd-simh", "Leads a driver"));
      const byDriver = new Map<string, LeadRow[]>();
      for (const r of leads) byDriver.set(r.driver?.id ?? "", [...(byDriver.get(r.driver?.id ?? "") ?? []), r]);
      for (const [driverId, rows] of byDriver) {
        const d = by.get(driverId) ?? null;
        panel.appendChild(el("div", "app-vd-simdriver", d ? `↳ ${d.name}` : "↳ (unplaced)"));
        for (const r of rows) {
          const k = `${r.initiative.id}|${driverId}`;
          const row = el("div", "app-vd-simrow app-vd-simrow-lead" + (leadOn.has(k) ? " app-vd-simrow-on" : ""));
          const top = el("label", "app-vd-simtop");
          const cb = el("input") as HTMLInputElement;
          cb.type = "checkbox";
          cb.checked = leadOn.has(k);
          cb.addEventListener("change", () => {
            if (cb.checked) leadOn.add(k);
            else {
              leadOn.delete(k);
              assumed.delete(k);
            }
            paintTree();
            paintPanel();
          });
          top.append(cb, el("span", "app-vd-simtitle", r.initiative.title));
          row.appendChild(top);
          row.appendChild(el("div", "app-vd-simmeta", `${r.metricName} → ${r.leading.name} · no formula — judgement`));
          if (leadOn.has(k) && d) {
            const dl = el("div", "app-vd-simdelta");
            const inp = el("input", "app-input") as HTMLInputElement;
            inp.type = "number";
            inp.step = "any";
            inp.placeholder = `assumed effect on ${d.name}`;
            inp.value = assumed.get(k)?.effect ? String(assumed.get(k)?.effect) : "";
            inp.addEventListener("change", () => {
              const v = Number(inp.value);
              if (inp.value.trim() === "" || !Number.isFinite(v) || v === 0) assumed.delete(k);
              else assumed.set(k, { nodeId: d.id, effect: v, initiativeId: r.initiative.id });
              paintTree();
              paintPanel();
            });
            dl.append(inp, el("span", "app-cp-muted", `${d.unit} · dashed`));
            row.appendChild(dl);
          }
          panel.appendChild(row);
        }
      }
    }
    // foot: the scenario in one sentence + the causal path
    const foot = el("div", "app-vd-simfoot");
    const { line, path } = footSentence();
    foot.appendChild(el("div", "app-vd-simline", line));
    if (path !== "") foot.appendChild(el("div", "app-cp-muted", path));
    const acts = el("div", "app-vd-simacts");
    const reset = btn("Reset to plan");
    reset.addEventListener("click", () => {
      for (const t of toggles.values()) t.on = false;
      assumed.clear();
      leadOn.clear();
      scenarioName = "";
      paintTree();
      paintPanel();
    });
    const save = btn("Save scenario…");
    save.addEventListener("click", () => void saveCurrent());
    const adopt = btn("Adopt as forecast", "app-btn app-btn-primary");
    adopt.disabled = !ctx.canAdopt || ![...toggles.values()].some((t) => t.on);
    adopt.title = !ctx.canAdopt ? "Adopting needs a superadmin or the role set in Settings → Value drivers" : "Write these leaf deltas as the forecast";
    adopt.addEventListener("click", () => void adoptForecast());
    acts.append(reset, save, adopt);
    foot.appendChild(acts);
    // saved scenarios
    if (saved.length > 0) {
      const sel = el("select", "app-input") as HTMLSelectElement;
      const o0 = el("option", "", scenarioName !== "" ? `Loaded: ${scenarioName}` : "Load a saved scenario…") as HTMLOptionElement;
      o0.value = "";
      sel.appendChild(o0);
      for (const s of saved) {
        const o = el("option", "", `${s.name} · ${s.author} · ${s.at.slice(0, 10)}`) as HTMLOptionElement;
        o.value = s.id;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        const s = saved.find((x) => x.id === sel.value);
        if (s) loadScenario(s);
      });
      foot.appendChild(sel);
    }
    panel.appendChild(foot);
  };

  const loadScenario = (s: Scenario) => {
    for (const t of toggles.values()) t.on = false;
    assumed.clear();
    leadOn.clear();
    for (const st of s.toggles) {
      const t = toggles.get(`${st.initiativeId}|${st.nodeId}`);
      if (t) {
        t.on = st.on;
        t.delta = st.delta;
      }
    }
    for (const a of s.assumed) {
      const k = `${a.initiativeId}|${a.nodeId}`;
      leadOn.add(k);
      assumed.set(k, a);
    }
    scenarioName = s.name;
    paintTree();
    paintPanel();
  };

  const saveCurrent = async () => {
    const name = await promptText({ title: "Save scenario", initial: scenarioName, confirmLabel: "Save" });
    if (name === null || name.trim() === "") return;
    const s: Scenario = {
      id: saved.find((x) => x.name === name.trim())?.id ?? newId("sc"),
      site: ctx.site,
      period,
      name: name.trim(),
      authorId: ctx.actor.whoId,
      author: ctx.actor.who,
      at: nowIso(),
      toggles: [...toggles.values()],
      assumed: [...assumed.values()],
    };
    await saveScenario(s);
    scenarioName = s.name;
    saved = await listScenarios(ctx.site).catch(() => saved);
    paintPanel();
  };

  /** Adopt: leaf forecasts = the scenario's leaf values (plan + deltas);
   *  computed nodes derive; assumed effects are judgement and stay out. */
  const adoptForecast = async () => {
    const yes = await promptConfirm({
      title: `Make this scenario the forecast for ${period}?`,
      note: "Plan and actual are untouched. Leaf forecasts become plan + the toggled deltas; assumed effects are judgement and are not written.",
      confirmLabel: "Adopt as forecast",
    });
    if (!yes) return;
    const { overrides } = simulate();
    const leafDeltas = new Map<string, number>();
    for (const t of toggles.values()) if (t.on && t.delta !== null) leafDeltas.set(t.nodeId, (leafDeltas.get(t.nodeId) ?? 0) + t.delta);
    void overrides;
    for (const n of nodes) {
      if (!isLeaf(nodes, n) || n.kind === "leading") continue;
      const p = valueOf(n, period, "plan");
      if (p === null) continue;
      const next = p + (leafDeltas.get(n.id) ?? 0);
      if (valueOf(n, period, "forecast") === next) continue;
      // the bucket is the unit of entry: spread over the period, then the
      // period value follows
      await writePeriodSpread(n, period, ctx.window, "forecast", next, ctx.actor, saveDriver);
    }
    await ctx.onAdopted();
  };

  void listScenarios(ctx.site)
    .then((s) => {
      saved = s.filter((x) => x.period === period);
      paintPanel();
    })
    .catch(() => undefined);
  paintTree();
  paintPanel();

  return () => {
    tree?.destroy();
    split.remove();
  };
}

/** Housekeeping for the scenario list (a ⋮ later); exported for the tab. */
export { deleteScenario };
