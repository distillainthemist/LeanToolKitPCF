// Settings → Value drivers (P9b, spec §3.2 / §3.5): the site's tree with
// the node editor beside it. Structure is configuration — superadmin,
// with the site's finance lead. Formula authoring: the input takes
// child NAMES (autocompleted from a popover), stored as {id} chips so a
// rename never breaks a formula; the rendered chip line, the live
// "= value ✓ resolves · children n of m used" and the error sentences
// sit directly beneath.

import { el, clear } from "../../../../shared/ui/dom";
import { currentViewer } from "../../runtime";
import { promptConfirm } from "../../prompts";
import { improvementSettingsJson, orgJson, saveImprovementSettingsJson } from "../../store/config";
import { viewerPerson } from "../../store/people";
import { parseOrgTree } from "../../../../shared/schema/meeting";
import { nowIso } from "../../../../shared/schema/id";
import { deleteDriverTree, listDrivers, saveDriver } from "../../store/valueDrivers";
import { parseImprovementSettings, serializeImprovementSettings } from "../templateModel";
import {
  AGGREGATE_LABELS,
  AGGREGATES,
  CADENCE_LABELS,
  CADENCES,
  DriverNode,
  childrenOf,
  formatValue,
  formulaChildren,
  newNode,
  SERIES,
} from "./model";
import { checkFormula, computeTree } from "./formula";
import { renderTree, TreeHandle } from "./tree";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

/** Stored {id} → typed names, for the input. */
function formulaToNames(src: string, nodes: DriverNode[]): string {
  const by = new Map(nodes.map((n) => [n.id, n.name]));
  return src.replace(/\{([^}]+)\}/g, (_, id: string) => by.get(id.trim()) ?? "?");
}

/** Typed names → stored {id}: longest child names first so "Volume" never
 *  eats "Saleable volume". Unknown names are left as typed (the check
 *  then names them). */
function formulaFromNames(text: string, kids: DriverNode[]): string {
  let out = text;
  const sorted = [...kids].filter((k) => k.name.trim() !== "").sort((a, b) => b.name.length - a.name.length);
  for (const k of sorted) {
    const esc = k.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), `{${k.id}}`);
  }
  return out;
}

export async function renderValueDriversSettings(body: HTMLElement): Promise<void> {
  clear(body);
  const viewer = currentViewer();
  const [treeRaw, impRaw, me] = await Promise.all([orgJson(), improvementSettingsJson(), viewer ? viewerPerson(viewer.objectId).catch(() => null) : Promise.resolve(null)]);
  const sites = parseOrgTree(treeRaw).map((s) => s.site);
  const imp = parseImprovementSettings(impRaw);
  let site = sites.includes(me?.site ?? "") ? (me?.site ?? "") : (sites[0] ?? "");
  const actor = { whoId: viewer?.objectId ?? "", who: me?.who ?? viewer?.name ?? "" };

  body.appendChild(el("h3", "app-pr-h3", "Value drivers"));
  body.appendChild(
    el("div", "app-settings-note", "The site's value driver tree — top-level measures at the left, the drivers that move them to the right. Structure changes rarely; values live on the hub's Value drivers tab.")
  );

  // ---- site + permission row ----
  const top = el("div", "app-settings-row app-vd-toprow");
  const siteSel = el("select", "app-input app-vd-sitesel") as HTMLSelectElement;
  for (const s of sites) {
    const o = el("option", "", s) as HTMLOptionElement;
    o.value = s;
    if (s === site) o.selected = true;
    siteSel.appendChild(o);
  }
  top.append(el("span", "app-field-label", "Site"), siteSel);
  top.appendChild(el("span", "app-bar-gap"));
  const roleSel = el("select", "app-input") as HTMLSelectElement;
  const none = el("option", "", "Superadmins only") as HTMLOptionElement;
  none.value = "";
  roleSel.appendChild(none);
  for (const r of imp.standardRoles) {
    const o = el("option", "", r.label) as HTMLOptionElement;
    o.value = r.key;
    if (r.key === imp.vdtEditorRole) o.selected = true;
    roleSel.appendChild(o);
  }
  roleSel.title = "Whose site fillers may edit values and adopt a forecast, besides superadmins";
  roleSel.addEventListener("change", () => {
    imp.vdtEditorRole = roleSel.value;
    void saveImprovementSettingsJson(serializeImprovementSettings(imp));
  });
  top.append(el("span", "app-field-label", "Edit values / adopt"), roleSel);
  body.appendChild(top);

  // ---- tree + rail ----
  const split = el("div", "app-vd-split");
  const treeHost = el("div", "app-vd-treehost");
  const rail = el("div", "app-vd-rail");
  split.append(treeHost, rail);
  body.appendChild(split);

  let nodes: DriverNode[] = [];
  let selected: string | null = null;
  let tree: TreeHandle | null = null;

  const load = async () => {
    nodes = await listDrivers(site);
    if (selected !== null && !nodes.some((n) => n.id === selected)) selected = null;
    paint();
  };

  const paint = () => {
    tree?.destroy();
    tree = renderTree(nodes, {
      host: treeHost,
      mode: "structure",
      selectedId: selected,
      onSelect: (id) => {
        selected = id;
        paint();
      },
    });
    paintRail();
  };

  const addChild = async (parentId: string) => {
    const n = newNode(site, parentId, parentId === "" ? "New measure" : "New driver");
    n.order = childrenOf(nodes, parentId).length + 1;
    const parent = nodes.find((x) => x.id === parentId);
    if (parent) {
      n.unit = parent.unit;
      n.cadence = parent.cadence;
    }
    await saveDriver(n);
    nodes.push(n);
    selected = n.id;
    paint();
  };

  const paintRail = () => {
    clear(rail);
    const n = selected !== null ? (nodes.find((x) => x.id === selected) ?? null) : null;
    if (n === null) {
      rail.appendChild(el("div", "app-tw-preview-h", nodes.length === 0 ? "Start the tree" : "Select a driver"));
      rail.appendChild(
        el(
          "div",
          "app-settings-note",
          nodes.length === 0
            ? "A top-level measure is one the site is judged on — EBITDA, cost per tonne, OEE. A site can have several."
            : "Click a card to edit it, add a driver beneath it, or remove it. A site can carry several top-level measures."
        )
      );
      // a site may need several top-level measures (Ben, 2026-09-02)
      const add = btn(nodes.length === 0 ? "＋ Add the first top-level measure" : "＋ Add a top-level measure", "app-btn" + (nodes.length === 0 ? " app-btn-primary" : ""));
      add.addEventListener("click", () => void addChild(""));
      rail.appendChild(add);
      return;
    }
    const draft: DriverNode = { ...n, format: { ...n.format }, values: n.values, history: n.history };
    const kids = formulaChildren(nodes, n.id);
    rail.appendChild(el("div", "app-tw-preview-h", n.parentId === "" ? "Top-level measure" : n.kind === "leading" ? "Leading indicator" : "Driver"));
    const field = (label: string, control: HTMLElement, hint?: string) => {
      const f = el("div", "app-field");
      f.append(el("span", "app-field-label", label), control);
      if (hint) f.appendChild(el("span", "app-field-hint", hint));
      rail.appendChild(f);
    };
    const text = (v: string, ph: string) => {
      const i = el("input", "app-input") as HTMLInputElement;
      i.value = v;
      i.placeholder = ph;
      return i;
    };
    const name = text(draft.name, "e.g. Saleable volume");
    field("Name", name);
    const def = el("textarea", "app-input") as HTMLTextAreaElement;
    def.rows = 2;
    def.value = draft.definition;
    def.placeholder = "What this measures, in a sentence";
    field("Definition", def);
    // kind (not for the root)
    let kindSel: HTMLSelectElement | null = null;
    if (n.parentId !== "") {
      kindSel = el("select", "app-input") as HTMLSelectElement;
      for (const [v, l] of [["driver", "Driver — part of the parent's formula"], ["leading", "Leading indicator — influences, no formula"]] as const) {
        const o = el("option", "", l) as HTMLOptionElement;
        o.value = v;
        if (v === draft.kind) o.selected = true;
        kindSel.appendChild(o);
      }
      field("Kind", kindSel);
    }
    const unit = text(draft.unit, "$, kL, %, $/kL");
    field("Unit", unit);
    const source = text(draft.source, "e.g. payroll, OEE model");
    field("Source", source, "Named under the card so nobody argues about where the number came from.");
    const sourceUrl = text(draft.sourceUrl, "https://… the report it comes from");
    sourceUrl.type = "url";
    field("Source link", sourceUrl, "Optional — the source line on the card opens it.");
    const cadSel = el("select", "app-input") as HTMLSelectElement;
    for (const c of CADENCES) {
      const o = el("option", "", CADENCE_LABELS[c]) as HTMLOptionElement;
      o.value = c;
      if (c === draft.cadence) o.selected = true;
      cadSel.appendChild(o);
    }
    const aggSel = el("select", "app-input") as HTMLSelectElement;
    for (const a of AGGREGATES) {
      const o = el("option", "", AGGREGATE_LABELS[a]) as HTMLOptionElement;
      o.value = a;
      if (a === draft.aggregate) o.selected = true;
      aggSel.appendChild(o);
    }
    const twin = el("div", "app-vd-twin");
    twin.append(cadSel, aggSel);
    field("Measured", twin, "How often, and how a finer series rolls up (volume sums, OEE averages). Actuals are one dated series — entered on the values tab or by any linked KPI card — folded at this cadence.");
    // format
    const fmtRow = el("div", "app-vd-twin");
    const dec = el("select", "app-input") as HTMLSelectElement;
    for (const d of [0, 1, 2, 3]) {
      const o = el("option", "", `${d} decimal${d === 1 ? "" : "s"}`) as HTMLOptionElement;
      o.value = String(d);
      if (d === draft.format.decimals) o.selected = true;
      dec.appendChild(o);
    }
    const scale = el("select", "app-input") as HTMLSelectElement;
    for (const [v, l] of [["", "As is"], ["k", "Thousands (k)"], ["m", "Millions (m)"], ["%", "Percent"]] as const) {
      const o = el("option", "", l) as HTMLOptionElement;
      o.value = v;
      if ((v === "%" && draft.format.percent) || (v !== "%" && !draft.format.percent && v === draft.format.scale)) o.selected = true;
      scale.appendChild(o);
    }
    fmtRow.append(dec, scale);
    field("Display", fmtRow);

    // ---- formula (drivers with driver children) ----
    let formulaIn: HTMLInputElement | null = null;
    const checkLine = el("div", "app-vd-check");
    const chipLine = el("div", "app-vd-chips");
    if (n.kind === "driver" && kids.length > 0) {
      formulaIn = text(formulaToNames(draft.formula, nodes), `e.g. ${kids[0].name} × ${kids[1]?.name ?? "…"}`);
      const wrapF = el("div", "app-vd-formulawrap");
      wrapF.appendChild(formulaIn);
      const ac = el("div", "app-vd-ac");
      wrapF.appendChild(ac);
      const paintAc = () => {
        clear(ac);
        const v = formulaIn!.value;
        const tail = /([A-Za-z][A-Za-z0-9 ]*)$/.exec(v.slice(0, formulaIn!.selectionStart ?? v.length))?.[1]?.trim().toLowerCase() ?? "";
        if (tail === "") return;
        const hits = kids.filter((k) => k.name.toLowerCase().startsWith(tail) && k.name.toLowerCase() !== tail).slice(0, 6);
        for (const k of hits) {
          const b = btn(k.name, "app-vd-achit");
          b.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const pos = formulaIn!.selectionStart ?? v.length;
            const before = v.slice(0, pos).replace(/([A-Za-z][A-Za-z0-9 ]*)$/, "");
            formulaIn!.value = `${before}${k.name}${v.slice(pos)}`;
            formulaIn!.focus();
            clear(ac);
            paintCheck();
          });
          ac.appendChild(b);
        }
      };
      formulaIn.addEventListener("input", () => {
        paintAc();
        paintCheck();
      });
      formulaIn.addEventListener("blur", () => setTimeout(() => clear(ac), 150));
      field("Formula", wrapF, "Type the drivers by name — they become chips. + − × ÷ ^ %, SUM AVG MIN MAX ABS ROUND, CHILDREN for every driver.");
      rail.append(chipLine, checkLine);
    } else if (n.kind === "driver" && n.parentId !== "" && kids.length === 0) {
      rail.appendChild(el("div", "app-settings-note", "A leaf — its values are entered (or fed by a linked metric). Add drivers beneath it and a formula appears."));
    }

    const readDraft = (): DriverNode => {
      const d = { ...draft };
      d.name = name.value.trim();
      d.definition = def.value.trim();
      if (kindSel) d.kind = kindSel.value === "leading" ? "leading" : "driver";
      d.unit = unit.value.trim();
      d.source = source.value.trim();
      d.sourceUrl = sourceUrl.value.trim();
      d.cadence = cadSel.value as DriverNode["cadence"];
      d.aggregate = aggSel.value as DriverNode["aggregate"];
      d.format = { decimals: Number(dec.value) || 0, scale: scale.value === "k" || scale.value === "m" ? scale.value : "", percent: scale.value === "%" };
      d.formula = d.kind === "leading" ? "" : formulaIn ? formulaFromNames(formulaIn.value.trim(), kids) : draft.formula;
      return d;
    };

    const paintCheck = () => {
      const d = readDraft();
      const others = nodes.map((x) => (x.id === d.id ? d : x));
      const c = checkFormula(d, others);
      clear(chipLine);
      clear(checkLine);
      if (!formulaIn) return;
      // the chip line: names as chips, operators as text
      const parts = d.formula.split(/(\{[^}]+\})/g);
      for (const p of parts) {
        const m = /^\{([^}]+)\}$/.exec(p);
        if (m) chipLine.appendChild(el("span", "app-vd-chip", nodes.find((x) => x.id === m[1].trim())?.name ?? "?"));
        else if (p.trim() !== "") chipLine.appendChild(el("span", "app-vd-op", p.replace(/\*/g, "×").replace(/\//g, "÷")));
      }
      // live result: the most recent period holding plan values
      const periods = [...new Set(nodes.flatMap((x) => Object.keys(x.values)))].sort().reverse();
      let resolved = "";
      for (const p of periods) {
        for (const s of SERIES) {
          const v = computeTree(others, p, s).get(d.id) ?? null;
          if (v !== null) {
            resolved = `= ${formatValue(v, d.unit, d.format)} (${s}, ${p})`;
            break;
          }
        }
        if (resolved !== "") break;
      }
      const ok = el("div", "app-vd-checkline" + (c.ok ? " app-vd-ok" : " app-vd-bad"));
      ok.textContent = c.ok
        ? `${resolved !== "" ? resolved + " ✓ resolves" : "✓ resolves — no values yet"} · children ${c.used.length} of ${kids.length} used${c.unit !== "" ? ` · ${c.unit}` : ""}`
        : "✕ doesn't resolve";
      checkLine.appendChild(ok);
      for (const e of c.errors) checkLine.appendChild(el("div", "app-vd-err", e));
      for (const w of c.warnings) checkLine.appendChild(el("div", "app-vd-warn", w));
    };
    if (formulaIn) paintCheck();

    // ---- actions ----
    const acts = el("div", "app-vd-railacts");
    const save = btn("Save driver", "app-btn app-btn-primary");
    save.addEventListener("click", () => {
      void (async () => {
        const d = readDraft();
        const c = checkFormula(d, nodes.map((x) => (x.id === d.id ? d : x)));
        if (!c.ok) {
          paintCheck();
          return;
        }
        Object.assign(n, d);
        await saveDriver(n);
        paint();
      })();
    });
    acts.appendChild(save);
    if (n.kind === "driver") {
      const add = btn("＋ Add driver beneath");
      add.addEventListener("click", () => void addChild(n.id));
      acts.appendChild(add);
    }
    const sibs = childrenOf(nodes, n.parentId);
    const idx = sibs.findIndex((s) => s.id === n.id);
    if (n.parentId !== "" && sibs.length > 1) {
      const up = btn("▲");
      up.title = "Move up";
      up.disabled = idx <= 0;
      const down = btn("▼");
      down.title = "Move down";
      down.disabled = idx >= sibs.length - 1;
      const swap = async (dir: -1 | 1) => {
        const other = sibs[idx + dir];
        if (!other) return;
        sibs[idx] = other;
        sibs[idx + dir] = n;
        sibs.forEach((s, i) => (s.order = i + 1)); // distinct, in the new order
        await Promise.all([saveDriver(n), saveDriver(other)]);
        paint();
      };
      up.addEventListener("click", () => void swap(-1));
      down.addEventListener("click", () => void swap(1));
      acts.append(up, down);
    }
    const del = btn("Remove…", "app-btn app-btn-danger");
    del.addEventListener("click", () => {
      const below = nodes.filter((x) => x.parentId === n.id).length;
      void promptConfirm({
        title: `Remove “${n.name}”?`,
        note: below > 0 ? `Its ${below} driver${below === 1 ? "" : "s"} beneath go too. Formulas that reference it will need fixing.` : "Formulas that reference it will need fixing.",
        confirmLabel: "Remove",
        danger: true,
      }).then(async (yes) => {
        if (!yes) return;
        await deleteDriverTree(nodes, n.id);
        selected = null;
        await load();
      });
    });
    acts.appendChild(del);
    rail.appendChild(acts);
    if (n.history.length > 0) {
      rail.appendChild(el("div", "ltk-mw-help", `Last value change: ${n.history[0].who} · ${n.history[0].at.slice(0, 10)} · ${n.history[0].series} ${n.history[0].period}`));
    }
    void actor; // the values tab writes the log (P9c); structure edits are not value changes
    void nowIso;
  };

  siteSel.addEventListener("change", () => {
    site = siteSel.value;
    selected = null;
    void load();
  });
  await load();
}
