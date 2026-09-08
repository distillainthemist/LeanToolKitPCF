// Hub → Value drivers (P9c, spec §3.3 / §3.5): the site's tree with its
// numbers. Modes: Read (the tree, one period at a time, a comparison
// series' delta chips) · Edit values (the indented rows table — exactly
// four fixed series, computed rows grey ⨍, leaves editable; Actual is
// DERIVED from the driver's dated series, entered as dated points) ·
// Simulate (P9d). Editing is a permission: superadmins + the standard
// role named in Settings → Value drivers.

import { el, clear } from "../../../../shared/ui/dom";
import { showLoading } from "../../loading";
import { currentViewer } from "../../runtime";
import { promptConfirm } from "../../prompts";
import { appPalettes, improvementSettingsJson, orgJson, prioritySettingsJson } from "../../store/config";
import { paletteMap } from "../../../../shared/palette";
import { listPeople, viewerPerson } from "../../store/people";
import { listDrivers, saveDriver } from "../../store/valueDrivers";
import { driverActual, listDriverPoints, putDriverPoint } from "../../store/driverSeries";
import { parseOrgTree } from "../../../../shared/schema/meeting";
import { nowIso, todayIso } from "../../../../shared/schema/id";
import { parsePrioritySettings, periodFor, periodWindow, nextPeriod, prevPeriod, ragPaletteKey } from "../../priorities/model";
import { driverGridSource, GridHandle, renderValueGrid } from "./grid";
import { parseImprovementSettings, roleFillersAt } from "../templateModel";
import { CADENCE_LABELS, DriverNode, childrenOf, formatValue, isLeaf, PLANNED_SERIES, Series, setValue, valueOf } from "./model";
import { computeTree } from "./formula";
import { renderTree, SERIES_LABELS, TreeHandle } from "./tree";
import { renderSimulate } from "./simulate";
import { listInitiatives } from "../../store/initiatives";
import { Initiative } from "../initiativeModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

type Mode = "read" | "edit" | "simulate";

export function mountValueDrivers(parent: HTMLElement): () => void {
  const wrap = el("div", "app-vd-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const viewer = currentViewer();
    const [treeRaw, impRaw, prRaw, me, roster, palettes] = await Promise.all([
      orgJson(),
      improvementSettingsJson(),
      prioritySettingsJson(),
      viewer ? viewerPerson(viewer.objectId).catch(() => null) : Promise.resolve(null),
      listPeople().catch(() => []),
      appPalettes().catch(() => ({ states: [], titles: [] })),
    ]);
    const stateColors = paletteMap(palettes.states);
    const ragColor = (rag: "green" | "amber" | "red"): string => stateColors[ragPaletteKey(rag)] ?? "#9a948a";
    if (dead) return;
    stopLoading();
    const sites = parseOrgTree(treeRaw).map((s) => s.site);
    const imp = parseImprovementSettings(impRaw);
    const periodSettings = parsePrioritySettings(prRaw).period;
    let site = sites.includes(me?.site ?? "") ? (me?.site ?? "") : (sites[0] ?? "");
    let period = periodFor(periodSettings, todayIso()) || periodSettings.currentPeriod;
    let mode: Mode = "read";
    let series: Series = "plan";
    let compare: Series | "" = "baseline";
    const actor = { whoId: viewer?.objectId ?? "", who: me?.who ?? viewer?.name ?? "" };
    void roster;

    const canEdit = (): boolean => {
      if (me?.role === "superadmin") return true;
      const role = imp.standardRoles.find((r) => r.key === imp.vdtEditorRole);
      return role !== undefined && roleFillersAt(role, site).some((p) => p.whoId === actor.whoId);
    };

    let nodes: DriverNode[] = [];
    let initiatives: Initiative[] = [];
    /** Leaf actuals for the period, folded from each driver's series. */
    let actuals = new Map<string, number | null>();
    let tree: TreeHandle | null = null;
    /** Grid entry (2026-09-08): the leaf whose grid drawer is open. */
    let gridOpen: string | null = null;
    let gridHandle: GridHandle | null = null;

    const windowFor = () => periodWindow(periodSettings, period) ?? { from: "1900-01-01", to: "2999-12-31" };

    const loadActuals = async () => {
      const w = windowFor();
      const leaves = nodes.filter((n) => isLeaf(nodes, n));
      const got = await Promise.all(leaves.map((n) => driverActual(n.id, w.from, w.to, n.cadence, n.aggregate).catch(() => null)));
      actuals = new Map(leaves.map((n, i) => [n.id, got[i]]));
    };

    const load = async () => {
      [nodes, initiatives] = await Promise.all([listDrivers(site), listInitiatives().catch(() => [])]);
      await loadActuals();
      if (dead) return;
      render();
    };

    /** The numbers for a series: actuals ride in as leaf overrides. */
    const numbers = (s: Series): Map<string, number | null> =>
      computeTree(nodes, period, s, s === "actual" ? actuals : new Map());

    // ---- header (the Priorities/Improvement bar metric) --------------------------
    const renderHeader = (): HTMLElement => {
      const head = el("div", "app-im-head");
      const title = el("div", "app-cp-tvorg");
      title.appendChild(el("span", "app-cp-tvorg-lead", "Value drivers"));
      title.appendChild(el("span", "app-cp-tvorg-sep", " | "));
      const siteSel = el("select", "app-input app-vd-sitesel") as HTMLSelectElement;
      for (const s of sites) {
        const o = el("option", "", s) as HTMLOptionElement;
        o.value = s;
        if (s === site) o.selected = true;
        siteSel.appendChild(o);
      }
      siteSel.addEventListener("change", () => {
        site = siteSel.value;
        void load();
      });
      title.appendChild(siteSel);
      head.appendChild(title);
      // period pager
      const pager = el("div", "app-vd-pager");
      const prev = btn("‹", "app-btn app-cp-tvbtn");
      const p0 = prevPeriod(periodSettings, period);
      prev.disabled = p0 === "";
      prev.title = p0 !== "" ? p0 : "";
      prev.addEventListener("click", () => {
        period = p0;
        void loadActuals().then(render);
      });
      const cur = el("span", "app-vd-period", period);
      const next = btn("›", "app-btn app-cp-tvbtn");
      const p1 = nextPeriod(periodSettings, period);
      next.disabled = p1 === "";
      next.title = p1;
      next.addEventListener("click", () => {
        period = p1;
        void loadActuals().then(render);
      });
      pager.append(prev, cur, next);
      head.appendChild(pager);
      // mode seg
      const seg = el("div", "app-docs-seg");
      const modes: [Mode, string][] = [["read", "Read"], ["edit", "Edit values"]];
      for (const [m, l] of modes) {
        const b = btn(l, "app-docs-segbtn" + (mode === m ? " app-docs-segbtn-on" : ""));
        if (m === "edit" && !canEdit()) {
          b.disabled = true;
          b.title = "Editing values needs a superadmin or the role set in Settings → Value drivers";
        }
        b.addEventListener("click", () => {
          mode = m;
          render();
        });
        seg.appendChild(b);
      }
      const sim = btn("Simulate", "app-docs-segbtn" + (mode === "simulate" ? " app-docs-segbtn-on" : ""));
      sim.addEventListener("click", () => {
        mode = "simulate";
        render();
      });
      seg.appendChild(sim);
      head.appendChild(seg);
      return head;
    };

    // ---- read: the tree with numbers ------------------------------------------------
    const renderRead = (): HTMLElement => {
      const box = el("div", "app-vd-readwrap");
      const bar = el("div", "app-vd-readbar");
      const showSel = el("select", "app-input app-vd-sel") as HTMLSelectElement;
      for (const s of ["plan", "forecast", "actual", "baseline"] as Series[]) {
        const o = el("option", "", SERIES_LABELS[s]) as HTMLOptionElement;
        o.value = s;
        if (s === series) o.selected = true;
        showSel.appendChild(o);
      }
      showSel.addEventListener("change", () => {
        series = showSel.value as Series;
        render();
      });
      const cmpSel = el("select", "app-input app-vd-sel") as HTMLSelectElement;
      const noneO = el("option", "", "No comparison") as HTMLOptionElement;
      noneO.value = "";
      cmpSel.appendChild(noneO);
      for (const s of ["baseline", "plan", "forecast", "actual"] as Series[]) {
        const o = el("option", "", `vs ${SERIES_LABELS[s].toLowerCase()}`) as HTMLOptionElement;
        o.value = s;
        if (s === compare) o.selected = true;
        cmpSel.appendChild(o);
      }
      cmpSel.addEventListener("change", () => {
        compare = cmpSel.value as Series | "";
        render();
      });
      bar.append(el("span", "app-field-label", "Show"), showSel, cmpSel);
      box.appendChild(bar);
      const host = el("div");
      box.appendChild(host);
      tree?.destroy();
      tree = renderTree(nodes, {
        host,
        mode: "values",
        values: numbers(series),
        compare: compare !== "" ? numbers(compare) : undefined,
        compareLabel: compare !== "" ? SERIES_LABELS[compare].toLowerCase() : undefined,
      });
      return box;
    };

    // ---- edit values: the indented rows table -----------------------------------------
    const renderEdit = (): HTMLElement => {
      const box = el("div", "app-vd-editwrap");
      const table = el("div", "app-vd-table");
      const headRow = el("div", "app-vd-row app-vd-rowhead");
      headRow.append(
        el("span", undefined, "Driver"),
        el("span", undefined, "Baseline"),
        el("span", undefined, "Plan"),
        el("span", undefined, "Forecast"),
        el("span", undefined, `Actual · ${period}`)
      );
      table.appendChild(headRow);
      const computed = {
        baseline: numbers("baseline"),
        plan: numbers("plan"),
        forecast: numbers("forecast"),
        actual: numbers("actual"),
      };
      const walk = (parentId: string, depth: number) => {
        for (const n of childrenOf(nodes, parentId)) {
          const leaf = isLeaf(nodes, n);
          const row = el("div", "app-vd-row" + (leaf ? "" : " app-vd-row-computed") + (n.kind === "leading" ? " app-vd-row-leading" : ""));
          const nameCell = el("span", "app-vd-rowname");
          nameCell.style.paddingLeft = `${depth * 18}px`;
          nameCell.append(el("span", "app-vd-rowtitle", `${!leaf ? "⨍ " : ""}${n.name}`), el("span", "app-vd-rowmeta", [n.unit, CADENCE_LABELS[n.cadence].toLowerCase()].filter((x) => x !== "").join(" · ")));
          row.appendChild(nameCell);
          for (const s of PLANNED_SERIES) {
            if (leaf) {
              const input = el("input", "app-input app-vd-cell") as HTMLInputElement;
              input.type = "number";
              input.step = "any";
              const cur = valueOf(n, period, s);
              input.value = cur === null ? "" : String(cur);
              input.placeholder = "—";
              input.addEventListener("change", () => {
                const raw = input.value.trim();
                const v = raw === "" ? null : Number(raw);
                if (v !== null && !Number.isFinite(v)) return;
                setValue(n, period, s, v, actor, nowIso());
                void saveDriver(n).then(() => render());
              });
              row.appendChild(input);
            } else {
              row.appendChild(el("span", "app-vd-cellro", formatValue(computed[s].get(n.id) ?? null, n.unit, n.format)));
            }
          }
          // actual: derived — the dated series folded
          const act = el("span", "app-vd-cellro app-vd-cellact");
          const actVal = el("span", undefined, formatValue(computed.actual.get(n.id) ?? null, n.unit, n.format));
          actVal.dataset.actualFor = n.id;
          act.appendChild(actVal);
          if (leaf) {
            const add = btn("＋", "app-link app-vd-addpt");
            add.title = `Enter an actual for ${n.name} (${CADENCE_LABELS[n.cadence].toLowerCase()})`;
            add.addEventListener("click", () => openEnterActual(n));
            act.appendChild(add);
            const grid = btn("⊞", "app-link app-vd-gridbtn" + (gridOpen === n.id ? " app-vd-gridbtn-on" : ""));
            grid.title = gridOpen === n.id ? "Close the grid" : `Grid — targets, limits and actuals per ${CADENCE_LABELS[n.cadence].toLowerCase().replace(/ly$/, "")} for ${period}`;
            grid.addEventListener("click", () => {
              gridOpen = gridOpen === n.id ? null : n.id;
              render();
            });
            act.appendChild(grid);
          }
          row.appendChild(act);
          table.appendChild(row);
          if (leaf && gridOpen === n.id) table.appendChild(renderGridDrawer(n));
          walk(n.id, depth + 1);
        }
      };
      walk("", 0);
      if (nodes.length === 0) table.appendChild(el("div", "app-cp-muted app-vd-tablenote", "No value drivers for this site yet — structure lives in Settings → Value drivers."));
      box.appendChild(table);
      const foot = el("div", "app-vd-tablefoot");
      const imp2 = btn("Import from finance pack…");
      imp2.title = "Paste rows of  driver name, baseline, plan, forecast";
      imp2.addEventListener("click", () => openImport());
      foot.appendChild(imp2);
      foot.appendChild(el("span", "app-cp-muted", "Planned numbers are per period; actuals are dated points folded at each driver's cadence."));
      box.appendChild(foot);
      return box;
    };

    /** The grid drawer under a leaf: a column per bucket of the period. */
    const renderGridDrawer = (n: DriverNode): HTMLElement => {
      const drawer = el("div", "app-vd-drawer");
      const head = el("div", "app-vd-drawerhead");
      head.append(el("span", "app-vd-rowtitle", n.name), el("span", "app-cp-muted", `${CADENCE_LABELS[n.cadence]} · ${n.unit || "no unit"} · folds by ${n.aggregate} · ${period}`));
      drawer.appendChild(head);
      const host = el("div");
      drawer.appendChild(host);
      const w = windowFor();
      gridHandle?.destroy().catch(() => undefined);
      gridHandle = renderValueGrid({
        host,
        source: driverGridSource(n, { target: null, lsl: null, usl: null }, !canEdit()),
        home: w,
        ragColor,
        csvName: `${n.name}-${period}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
        onSaved: () => {
          // the period's Actual column re-folds from the series
          void loadActuals().then(() => {
            if (dead) return;
            const cell = wrap.querySelector(`[data-actual-for="${n.id}"]`);
            if (cell) cell.textContent = formatValue(numbers("actual").get(n.id) ?? null, n.unit, n.format);
          });
        },
        footer: (api) => {
          if (!canEdit()) return [];
          const fill = btn("Fill plan from targets", "app-link");
          fill.title = `Fold the columns' targets by ${n.aggregate} into this period's Plan`;
          fill.addEventListener("click", () => {
            void api.foldTargets(w.from, w.to).then((v) => {
              if (v === null) return;
              return promptConfirm({
              title: `Set ${period} plan to ${formatValue(v, n.unit, n.format)}?`,
              note: `The ${n.aggregate} of the grid's targets for ${n.name}. Plan stays a number finance owns — this only fills it, it doesn't link it.`,
              confirmLabel: "Set plan",
              }).then((ok) => {
                if (!ok) return;
                setValue(n, period, "plan", v, actor, nowIso());
                void saveDriver(n).then(() => render());
              });
            });
          });
          return [fill];
        },
      });
      return drawer;
    };

    /** A dated point on the driver's ONE actuals series. */
    const openEnterActual = (n: DriverNode) => {
      const scrim = el("div", "app-modal-overlay");
      const box = el("div", "app-modal");
      box.appendChild(el("div", "app-modal-title", `Actual — ${n.name}`));
      box.appendChild(el("div", "app-modal-note", `${CADENCE_LABELS[n.cadence]} · ${n.unit || "no unit"} · folds by ${n.aggregate}. The same series any linked KPI card records into.`));
      const w = windowFor();
      const field = (label: string, control: HTMLElement) => {
        const f = el("div", "app-field");
        f.append(el("span", "app-field-label", label), control);
        box.appendChild(f);
      };
      const date = el("input", "app-input") as HTMLInputElement;
      date.type = "date";
      const today = todayIso();
      date.value = today >= w.from && today <= w.to ? today : w.to;
      field(n.cadence === "annually" ? "Date (any day in the year)" : n.cadence === "monthly" ? "Date (any day in the month)" : "Date", date);
      let shift: HTMLInputElement | null = null;
      if (n.cadence === "shiftly") {
        shift = el("input", "app-input") as HTMLInputElement;
        shift.placeholder = "Shift (e.g. D, N, A)";
        field("Shift", shift);
      }
      const val = el("input", "app-input") as HTMLInputElement;
      val.type = "number";
      val.step = "any";
      field(`Value (${n.unit || "number"})`, val);
      const recent = el("div", "app-vd-recent");
      box.appendChild(recent);
      void listDriverPoints(n.id, w.from, w.to).then((pts) => {
        if (pts.length === 0) return;
        recent.appendChild(el("div", "app-field-label", `Recorded this period (${pts.length})`));
        for (const p of pts.slice(-6).reverse()) recent.appendChild(el("div", "app-cp-muted", `${p.date}${p.shift !== "-" ? " · " + p.shift : ""} — ${formatValue(p.value, n.unit, n.format)}`));
      });
      const foot = el("div", "app-modal-footer");
      const cancel = btn("Cancel", "app-link");
      cancel.addEventListener("click", () => scrim.remove());
      const save = btn("Record", "app-btn app-btn-primary");
      save.addEventListener("click", () => {
        const v = Number(val.value);
        if (val.value.trim() === "" || !Number.isFinite(v) || date.value === "") return;
        void (async () => {
          await putDriverPoint(n.id, date.value, shift?.value.trim() || "-", n.format.percent ? v / 100 : v);
          scrim.remove();
          await loadActuals();
          render();
        })();
      });
      foot.append(cancel, save);
      box.appendChild(foot);
      scrim.appendChild(box);
      wrap.appendChild(scrim);
      val.focus();
    };

    /** Paste "name, baseline, plan, forecast" rows; matched by name. */
    const openImport = () => {
      const scrim = el("div", "app-modal-overlay");
      const box = el("div", "app-modal");
      box.appendChild(el("div", "app-modal-title", `Import from finance pack — ${period}`));
      box.appendChild(el("div", "app-modal-note", "One driver per line: name, baseline, plan, forecast (leave a value blank to keep it). Names match the tree; computed drivers are skipped."));
      const ta = el("textarea", "app-input") as HTMLTextAreaElement;
      ta.rows = 8;
      ta.placeholder = "Saleable volume, 1800, 2000, 1950\nUnit margin, 5300, 5450,";
      box.appendChild(ta);
      const out = el("div", "app-cp-muted", "");
      box.appendChild(out);
      const foot = el("div", "app-modal-footer");
      const cancel = btn("Cancel", "app-link");
      cancel.addEventListener("click", () => scrim.remove());
      const go = btn("Import", "app-btn app-btn-primary");
      go.addEventListener("click", () => {
        void (async () => {
          const lines = ta.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
          let applied = 0;
          const missed: string[] = [];
          for (const line of lines) {
            const [name, b, p, f] = line.split(/\t|,/).map((x) => x.trim());
            const n = nodes.find((x) => x.name.toLowerCase() === (name ?? "").toLowerCase());
            if (!n || !isLeaf(nodes, n)) {
              missed.push(name ?? "");
              continue;
            }
            const vals: [Series, string | undefined][] = [["baseline", b], ["plan", p], ["forecast", f]];
            let changed = false;
            for (const [s, raw] of vals) {
              if (raw === undefined || raw === "") continue;
              const v = Number(raw.replace(/[^0-9.\-eE]/g, ""));
              if (!Number.isFinite(v)) continue;
              setValue(n, period, s, v, actor, nowIso());
              changed = true;
            }
            if (changed) {
              await saveDriver(n);
              applied++;
            }
          }
          out.textContent = `${applied} driver${applied === 1 ? "" : "s"} updated${missed.length > 0 ? ` · not matched: ${missed.join(", ")}` : ""}`;
          if (applied > 0) render();
        })();
      });
      foot.append(cancel, go);
      box.appendChild(foot);
      scrim.appendChild(box);
      wrap.appendChild(scrim);
    };

    let simTeardown: (() => void) | null = null;
    const renderSimulateMode = (): HTMLElement => {
      const host = el("div", "app-vd-simhost");
      const inTree = initiatives.filter((i) => i.status === "active" && i.metrics.some((m) => m.driverId && nodes.some((n) => n.id === m.driverId)));
      simTeardown?.();
      simTeardown = renderSimulate({
        host,
        nodes,
        period,
        site,
        initiatives: inTree,
        actor,
        canAdopt: canEdit(),
        onAdopted: async () => {
          await load();
        },
      });
      return host;
    };
    const render = () => {
      simTeardown?.();
      simTeardown = null;
      if (gridHandle) {
        void gridHandle.destroy().catch(() => undefined);
        gridHandle = null;
      }
      clear(wrap);
      wrap.appendChild(renderHeader());
      if (mode === "edit" && !canEdit()) mode = "read";
      wrap.appendChild(mode === "read" ? renderRead() : mode === "edit" ? renderEdit() : renderSimulateMode());
    };

    await load();
  })().catch((err) => {
    stopLoading();
    wrap.appendChild(el("div", "app-board-note", `Value drivers could not load: ${err instanceof Error ? err.message : String(err)}`));
  });

  return () => {
    dead = true;
    for (const fn of cleanups) fn();
    wrap.remove();
  };
}


