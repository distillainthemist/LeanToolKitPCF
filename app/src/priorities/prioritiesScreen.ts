// Cascaded priorities — the screen (design spec `leanboard-cascade-
// priorities-design.md`, build item 1 = the Simple-view spine, plus the
// add/edit priority dialog pulled forward from item 2 so the matrix can be
// filled and tested). Rides as a hub tab like Documents (dynamic import).
//
// Screen anatomy top to bottom: org bar (breadcrumb dropdowns · Descend
// chips · ⌗ Org picker) → toolbar (period · status · Simple/Dynamic ·
// cascade chip · ＋ Priority · ⋮ view options) → vision band (directly
// over the pillars) → the matrix (rail: "Strategic Pillars" over one
// rectangle per pillar spanning its sub-pillar columns, settings order;
// "Priorities" row; "Objectives" row) → the Other strip.
// Density: ≤4 comfortable · 5–6 compact · 7+ scroll (or group by pillar).
// Phone (<720px): sub-pillar headings with their cards stacked.
//
// P1 renders statuses from a stub resolver (no initiatives yet): every
// priority is grey with "· 0 initiatives" and every objective cell reads
// "No metric set". P2 adds the detail overlay + cascade review list;
// P3 the Dynamic view; P4 TV walk mode + the embedded card.

import { el, clear } from "../../../shared/ui/dom";
import { paletteMap } from "../../../shared/palette";
import { todayIso } from "../../../shared/schema/id";
import { showLoading } from "../loading";
import { currentViewer } from "../runtime";
import {
  appPalettes,
  orgJson,
  orgOwnersMap,
  orgVisions,
  prioritySettingsJson,
  saveOrgVision,
  siteCompanies,
} from "../store/config";
import { listPeople } from "../store/people";
import type { RosterPerson } from "../store/mappers";
import {
  appendEvent,
  CascadeData,
  loadCascade,
  newPriority,
  saveAssignment,
  savePriority,
} from "../store/priorities";
import {
  childOrgs,
  editVision,
  OrgTree,
  pickOrg,
  priorityDialog,
  siblingOrgs,
} from "./dialogs";
import {
  canManageOrg,
  densityFor,
  groupByColumn,
  isDescendant,
  lineageFor,
  lineageWords,
  nextPeriod,
  objectiveColumns,
  OrgRef,
  orgKey,
  orgLevel,
  orgName,
  orgParent,
  orgPath,
  orgRef,
  parsePrioritySettings,
  pendingCascades,
  periodFor,
  Pillar,
  pillarSpans,
  Priority,
  prioritiesForOrg,
  PrioritySettings,
  Rag,
  ragPaletteKey,
  rollup,
  RollupRule,
  sameOrg,
  strategyChips,
  tally,
  tallyLine,
  Viewer,
} from "./model";

export interface PrioritiesMountOpts {
  embedded?: boolean;
}

interface OrgSiteRow {
  site: string;
  departments?: { department?: string; name?: string; areas?: string[] }[];
}

/** The org tree from the site-settings rows + site→company map. */
function buildTree(raw: string, siteCo: Record<string, string>, companyList: string[]): OrgTree {
  let rows: OrgSiteRow[] = [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) rows = arr as OrgSiteRow[];
  } catch {
    rows = [];
  }
  const companies = new Map<string, OrgTree["companies"][number]>();
  for (const c of companyList) companies.set(c, { name: c, sites: [] });
  for (const r of rows) {
    if (!r || typeof r.site !== "string" || r.site === "") continue;
    const co = siteCo[r.site] ?? "";
    if (!companies.has(co)) companies.set(co, { name: co, sites: [] });
    companies.get(co)!.sites.push({
      name: r.site,
      departments: (r.departments ?? [])
        .map((d) => ({
          name: typeof d.department === "string" ? d.department : (d.name ?? ""),
          areas: Array.isArray(d.areas) ? d.areas.filter((a) => typeof a === "string") : [],
        }))
        .filter((d) => d.name !== ""),
    });
  }
  return { companies: [...companies.values()].filter((c) => c.name !== "" || c.sites.length > 0) };
}

interface ScreenState {
  org: OrgRef;
  l1: string | null; // pillar filter
  period: string;
  status: "active" | "completed" | "all";
  rule: RollupRule;
  showOther: boolean;
  groupByPillar: boolean;
  lastColumn: string; // the sub-pillar last interacted with (＋ Priority preselect)
}

const PREF_KEY = "ltk-priorities-view";

function loadPrefs(): Partial<ScreenState> {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? (JSON.parse(raw) as Partial<ScreenState>) : {};
  } catch {
    return {};
  }
}

function savePrefs(s: ScreenState): void {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ org: s.org, l1: s.l1, rule: s.rule, showOther: s.showOther, groupByPillar: s.groupByPillar })
    );
  } catch {
    /* fine */
  }
}

/** P1 stub: what a priority's initiatives look like. Initiatives arrive
 *  with P5; until then every priority is "no data". */
function ragsFor(_p: Priority): Rag[] {
  return [];
}

export function mountPriorities(parent: HTMLElement, _opts: PrioritiesMountOpts = {}): () => void {
  const wrap = el("div", "app-cp-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const who = currentViewer();
    const [rawTree, siteCo, roster, visions, settingsRaw, owners, palettes] = await Promise.all([
      orgJson(),
      siteCompanies(),
      listPeople(),
      orgVisions(),
      prioritySettingsJson(),
      orgOwnersMap(),
      appPalettes(),
    ]);
    if (dead) return;
    const companyList = [...new Set(Object.values(siteCo).filter((c) => c !== ""))];
    const tree = buildTree(rawTree, siteCo, companyList);
    const me = roster.find((p) => p.whoId === (who?.objectId ?? "")) ?? null;
    const viewer: Viewer = {
      whoId: who?.objectId ?? "",
      role: me?.role === "superadmin" || me?.role === "siteadmin" ? me.role : "user",
      site: me?.site ?? "",
    };
    const settings = parsePrioritySettings(settingsRaw);
    const palette = paletteMap(palettes.states);
    const today = todayIso();
    const currentPeriod = periodFor(settings.period, today) || settings.period.currentPeriod;

    // default org = viewer's own site (under its company); else the first site
    const mySite = me?.site && siteCo[me.site] !== undefined ? orgRef(siteCo[me.site], me.site) : null;
    const firstSite = tree.companies.flatMap((c) => c.sites.map((s) => orgRef(c.name, s.name)))[0] ?? orgRef(companyList[0] ?? "");
    const prefs = loadPrefs();
    const state: ScreenState = {
      org: prefs.org && typeof prefs.org === "object" ? (prefs.org as OrgRef) : (mySite ?? firstSite),
      l1: typeof prefs.l1 === "string" ? prefs.l1 : null,
      period: currentPeriod,
      status: "active",
      rule: prefs.rule === "ratio" ? "ratio" : "strict",
      showOther: prefs.showOther === true,
      groupByPillar: prefs.groupByPillar === true,
      lastColumn: "",
    };

    let data: CascadeData = await loadCascade(state.org.company);
    if (dead) return;
    stopLoading();

    const reload = async () => {
      data = await loadCascade(state.org.company);
      if (!dead) render();
    };

    const canManage = () => canManageOrg(viewer, state.org, owners);
    const periodsOnOffer = () => {
      const cur = currentPeriod;
      const next = nextPeriod(settings.period, cur);
      const set = new Set<string>([cur]);
      if (next !== "") set.add(next);
      for (const p of data.priorities) if (p.period !== "") set.add(p.period);
      return [...set].sort();
    };

    // ---- the render -------------------------------------------------------

    const render = () => {
      clear(wrap);
      savePrefs(state);
      // the vision band sits directly over the pillars (Ben, 2026-08-19)
      wrap.append(renderOrgBar(), renderToolbar(), renderVision());
      const columns = objectiveColumns(data.pillars, state.l1);
      if (state.groupByPillar && state.l1 === null && densityFor(columns.length) === "scroll") {
        for (const l1 of strategyChips(data.pillars)) {
          const cols = objectiveColumns(data.pillars, l1.id);
          if (cols.length === 0) continue;
          wrap.appendChild(renderMatrix(cols, l1));
        }
      } else {
        wrap.appendChild(renderMatrix(columns, null));
      }
      wrap.appendChild(renderOther());
    };

    const renderOrgBar = (): HTMLElement => {
      const bar = el("div", "app-cp-orgbar");
      // breadcrumb: each level a dropdown of siblings
      const crumbs = el("div", "app-cp-crumbs");
      const path = orgPath(state.org);
      path.forEach((node, i) => {
        if (i > 0) crumbs.appendChild(el("span", "app-cp-crumb-sep", "›"));
        const sel = el("select", "app-cp-crumb") as HTMLSelectElement;
        for (const sib of siblingOrgs(tree, node)) {
          const opt = el("option", "", orgName(sib)) as HTMLOptionElement;
          opt.value = orgKey(sib);
          if (sameOrg(sib, node)) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.title = `Switch ${orgLevel(node)}`;
        sel.addEventListener("change", () => {
          const [company = "", site = "", department = "", area = ""] = sel.value.split("|");
          void goTo(orgRef(company, site, department, area));
        });
        crumbs.appendChild(sel);
      });
      bar.appendChild(crumbs);
      // descend chips
      const kids = childOrgs(tree, state.org);
      if (kids.length > 0) {
        const row = el("div", "app-cp-descend");
        row.appendChild(el("span", "app-cp-descend-label", "Descend:"));
        for (const k of kids) {
          const chip = el("button", "app-cp-chip", orgName(k)) as HTMLButtonElement;
          chip.type = "button";
          chip.addEventListener("click", () => void goTo(k));
          row.appendChild(chip);
        }
        bar.appendChild(row);
      }
      const picker = el("button", "app-cp-chip app-cp-chip-quiet", "⌗ Org picker") as HTMLButtonElement;
      picker.type = "button";
      picker.addEventListener("click", () => {
        void pickOrg(wrap, tree, state.org).then((o) => {
          if (o) void goTo(o);
        });
      });
      bar.appendChild(picker);
      return bar;
    };

    const goTo = async (o: OrgRef) => {
      const companyChanged = o.company !== state.org.company;
      state.org = o;
      state.lastColumn = "";
      if (companyChanged) await reload();
      else render();
    };

    const renderVision = (): HTMLElement => {
      const band = el("div", "app-cp-vision");
      const text = visions[orgKey(state.org)] ?? "";
      band.appendChild(el("div", "app-cp-vision-text", text !== "" ? text : "No vision statement set for this org."));
      if (text === "") band.classList.add("app-cp-vision-empty");
      if (canManage() && orgLevel(state.org) !== "area") {
        const edit = el("button", "app-cp-vision-edit", "⋮") as HTMLButtonElement;
        edit.type = "button";
        edit.title = "Edit vision";
        edit.addEventListener("click", () => {
          void editVision(wrap, state.org, text).then(async (v) => {
            if (v === null) return;
            await saveOrgVision(state.org, v);
            visions[orgKey(state.org)] = v;
            render();
          });
        });
        band.appendChild(edit);
      }
      return band;
    };

    const renderToolbar = (): HTMLElement => {
      const bar = el("div", "app-cp-toolbar");
      // period
      const per = el("select", "app-input app-cp-select") as HTMLSelectElement;
      for (const p of periodsOnOffer()) {
        const o = el("option", "", p) as HTMLOptionElement;
        o.value = p;
        if (p === state.period) o.selected = true;
        per.appendChild(o);
      }
      per.addEventListener("change", () => {
        state.period = per.value;
        render();
      });
      bar.appendChild(per);
      // status
      const st = el("select", "app-input app-cp-select") as HTMLSelectElement;
      for (const [v, l] of [
        ["active", "Active"],
        ["completed", "Completed"],
        ["all", "All"],
      ] as const) {
        const o = el("option", "", l) as HTMLOptionElement;
        o.value = v;
        if (v === state.status) o.selected = true;
        st.appendChild(o);
      }
      st.addEventListener("change", () => {
        state.status = st.value as ScreenState["status"];
        render();
      });
      bar.appendChild(st);
      // view toggle (Dynamic arrives with P3)
      const seg = el("div", "app-cp-seg");
      const simple = el("button", "app-cp-seg-btn app-cp-seg-on", "Simple") as HTMLButtonElement;
      simple.type = "button";
      const dynamic = el("button", "app-cp-seg-btn", "Dynamic") as HTMLButtonElement;
      dynamic.type = "button";
      dynamic.disabled = true;
      dynamic.title = "Dynamic view arrives with the next update";
      seg.append(simple, dynamic);
      bar.appendChild(seg);
      // cascade chip (review list arrives with P2)
      const pending = pendingCascades(state.org, data.assignments).length;
      if (pending > 0) {
        const chip = el("button", "app-cp-cascadechip", `⇩ ${pending} cascade${pending === 1 ? "" : "s"} to accept`) as HTMLButtonElement;
        chip.type = "button";
        chip.title = "The review list arrives with the next update";
        bar.appendChild(chip);
      }
      bar.appendChild(el("span", "app-cp-spacer"));
      if (canManage()) {
        const add = el("button", "app-btn app-btn-primary", "＋ Priority") as HTMLButtonElement;
        add.type = "button";
        add.addEventListener("click", () => void addPriority());
        bar.appendChild(add);
      }
      // ⋮ view options
      const more = el("button", "app-btn app-cp-more", "⋮") as HTMLButtonElement;
      more.type = "button";
      more.title = "View options";
      more.addEventListener("click", () => openViewOptions(more));
      bar.appendChild(more);
      return bar;
    };

    const openViewOptions = (anchor: HTMLElement) => {
      document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu");
      const item = (label: string, on: boolean | null, run: () => void) => {
        const b = el("button", "app-cp-menu-item", (on === null ? "" : on ? "● " : "○ ") + label) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          menu.remove();
          run();
        });
        menu.appendChild(b);
      };
      menu.appendChild(el("div", "app-cp-menu-h", "Roll-up rule"));
      item("Strict — any red is red", state.rule === "strict", () => {
        state.rule = "strict";
        render();
      });
      item(`Ratio — red above ${settings.ragRatioPct}%`, state.rule === "ratio", () => {
        state.rule = "ratio";
        render();
      });
      menu.appendChild(el("div", "app-cp-menu-h", "Show"));
      item("Other (unlinked initiatives)", state.showOther, () => {
        state.showOther = !state.showOther;
        render();
      });
      item("Group by pillar (7+ columns)", state.groupByPillar, () => {
        state.groupByPillar = !state.groupByPillar;
        render();
      });
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      document.body.appendChild(menu);
      const close = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", close, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
      cleanups.push(() => menu.remove());
    };

    // ---- the matrix -------------------------------------------------------

    const visibleFor = (org: OrgRef): Priority[] => {
      const { own, adopted } = prioritiesForOrg(org, data.priorities, data.assignments);
      return [...own, ...adopted].filter(
        (p) =>
          (state.period === "" || p.period === state.period) &&
          (state.status === "all" ||
            (state.status === "active" ? p.status === "active" : p.status === "completed"))
      );
    };

    const renderMatrix = (columns: Pillar[], onlyL1: Pillar | null): HTMLElement => {
      const density = densityFor(columns.length);
      const phone = window.matchMedia("(max-width: 719px)").matches;
      const box = el("div", `app-cp-matrix app-cp-${density}` + (phone ? " app-cp-phone" : ""));
      const visible = visibleFor(state.org);
      const { byColumn, unplaced } = groupByColumn(columns, visible);
      const adoptedIds = new Set(prioritiesForOrg(state.org, data.priorities, data.assignments).adopted.map((p) => p.id));

      if (phone) {
        for (const col of columns) {
          box.appendChild(el("div", "app-cp-ph-h", col.name));
          const items = byColumn.get(col.id) ?? [];
          if (items.length === 0) box.appendChild(el("div", "app-cp-empty-cell", "—"));
          for (const p of items) box.appendChild(priorityCard(p, adoptedIds.has(p.id), density));
        }
        return box;
      }

      const grid = el("div", "app-cp-grid");
      grid.style.gridTemplateColumns = `126px repeat(${Math.max(1, columns.length)}, 1fr)`;
      box.appendChild(grid);

      // row 1: rail "Strategic Pillars" over the pillar spans + column heads.
      // Each pillar is a rectangle stretched over its own sub-pillar
      // columns (settings order); click filters to that pillar, ✕ clears.
      const rail1 = el("div", "app-cp-rail app-cp-rail-tall", "Strategic Pillars");
      rail1.style.gridRow = "1 / span 2";
      grid.appendChild(rail1);
      const spans = columns.length > 0 ? pillarSpans(data.pillars, columns) : [];
      if (spans.length === 0) {
        const none = el("div", "app-cp-l1span app-cp-l1span-none");
        none.appendChild(el("span", "app-cp-muted", "No pillars yet — a super admin sets them in Settings → Priorities."));
        grid.appendChild(none);
      }
      for (const sp of spans) {
        const l1 = sp.pillar;
        const on = l1 !== null && state.l1 === l1.id;
        const box = el(l1 ? "button" : "div", "app-cp-l1span" + (on ? " app-cp-l1span-on" : "") + (l1 ? "" : " app-cp-l1span-none"));
        box.style.gridColumn = `span ${sp.span}`;
        if (l1) {
          const b = box as HTMLButtonElement;
          b.type = "button";
          b.textContent = on ? `${l1.name} ✕` : l1.name;
          b.title = on ? "Clear the pillar filter" : `Show only ${l1.name}`;
          if (l1.color !== "" && !on) {
            b.style.borderColor = l1.color;
            b.style.color = l1.color;
          }
          b.addEventListener("click", () => {
            state.l1 = on ? null : l1.id;
            render();
          });
        } else {
          box.textContent = "—";
          box.title = "Sub-pillars whose pillar is retired";
        }
        grid.appendChild(box);
      }
      for (const col of columns) {
        const head = el("div", "app-cp-colhead", col.name);
        const parentL1 = data.pillars.find((p) => p.id === col.parentId);
        const colour = col.color || parentL1?.color || "";
        if (colour !== "") {
          head.style.background = colour;
          head.style.color = "#fff";
        }
        head.addEventListener("click", () => {
          state.lastColumn = col.id;
        });
        grid.appendChild(head);
      }
      if (columns.length === 0) {
        const none = el("div", "app-cp-colhead app-cp-colhead-empty", "No sub-pillars");
        grid.appendChild(none);
      }

      // row 3: Priorities
      grid.appendChild(el("div", "app-cp-rail", "Priorities"));
      for (const col of columns) {
        const cell = el("div", "app-cp-cell");
        cell.addEventListener("click", () => {
          state.lastColumn = col.id;
        });
        const items = byColumn.get(col.id) ?? [];
        for (const p of items) cell.appendChild(priorityCard(p, adoptedIds.has(p.id), density));
        if (items.length === 0) {
          if (canManage()) {
            const add = el("button", "app-cp-addcell", "＋ Add priority") as HTMLButtonElement;
            add.type = "button";
            add.addEventListener("click", (e) => {
              e.stopPropagation();
              state.lastColumn = col.id;
              void addPriority();
            });
            cell.appendChild(add);
          } else {
            cell.appendChild(el("div", "app-cp-empty-cell", ""));
          }
        }
        grid.appendChild(cell);
      }
      if (columns.length === 0) grid.appendChild(el("div", "app-cp-cell"));

      // row 4: Objectives (headline metrics — P5 fills these)
      if (density !== "compact") {
        grid.appendChild(el("div", "app-cp-rail", "Objectives"));
        for (const col of columns) {
          const cell = el("div", "app-cp-cell app-cp-cell-obj");
          const items = byColumn.get(col.id) ?? [];
          for (const p of items) {
            const line = el("div", "app-cp-metric");
            line.appendChild(el("span", "app-cp-metric-name", p.statement.slice(0, 40)));
            line.appendChild(el("span", "app-cp-muted", "No metric set"));
            cell.appendChild(line);
          }
          grid.appendChild(cell);
        }
        if (columns.length === 0) grid.appendChild(el("div", "app-cp-cell"));
      } else {
        const strip = el("div", "app-cp-objstrip", "▸ Objectives row collapsed at 5–6 columns — filter to one pillar to see values inline");
        strip.style.gridColumn = `1 / span ${columns.length + 1}`;
        grid.appendChild(strip);
      }

      // priorities whose sub-pillar is not a shown column
      if (unplaced.length > 0 && onlyL1 === null) {
        const note = el("div", "app-cp-unplaced");
        note.appendChild(el("span", "app-cp-muted", `${unplaced.length} priorit${unplaced.length === 1 ? "y" : "ies"} under a retired or filtered sub-pillar: `));
        for (const p of unplaced) {
          const b = el("button", "app-link", p.statement.slice(0, 60)) as HTMLButtonElement;
          b.type = "button";
          b.addEventListener("click", () => void editPriority(p));
          note.appendChild(b);
        }
        box.appendChild(note);
      }
      return box;
    };

    const priorityCard = (p: Priority, adopted: boolean, density: ReturnType<typeof densityFor>): HTMLElement => {
      const rags = ragsFor(p);
      const t = tally(rags);
      const rag = rollup(t, state.rule, settings.ragRatioPct);
      const card = el("div", "app-cp-card");
      card.style.borderLeftColor = palette[ragPaletteKey(rag)] ?? "#9a948a";
      card.appendChild(el("div", "app-cp-statement", p.statement));
      const meta = el("div", "app-cp-tallies");
      for (const part of tallyLine(t)) {
        const s = el("span", "app-cp-tally" + (part.count === 0 ? " app-cp-tally-zero" : ""));
        s.textContent = density === "compact" ? `${part.glyph}${part.count}` : `${part.glyph} ${part.count}`;
        if (part.count > 0) s.style.color = palette[ragPaletteKey(part.rag)] ?? "";
        meta.appendChild(s);
      }
      meta.appendChild(
        el("span", "app-cp-total", density === "compact" ? `·${t.total}` : `· ${t.total} initiative${t.total === 1 ? "" : "s"}`)
      );
      card.appendChild(meta);
      const lin = lineageFor(p, data.priorities, data.assignments);
      const words = lineageWords(lin, "org");
      if (adopted && lin.from === null) words.unshift(`↑ ${orgName(p.org)}`);
      if (words.length > 0) {
        const line = el("div", "app-cp-lineage");
        for (const w of words) {
          const s = el("span", "app-cp-lineage-part", density === "compact" ? w.replace(/ (orgs?|areas?)/, "") : w);
          if (/declined/.test(w)) s.classList.add("app-cp-lineage-declined");
          line.appendChild(s);
        }
        card.appendChild(line);
      }
      if (p.status !== "active") {
        card.appendChild(el("div", "app-cp-flag", p.status === "completed" ? "✓ Completed" : p.status === "archived" ? "▣ Archived" : "▣ Retired"));
      }
      // owner actions (⋮): P1 offers Edit + reorder; Cascade to… / Complete arrive with P2
      if (canManage() && !adopted) {
        const kebab = el("button", "app-cp-kebab", "⋮") as HTMLButtonElement;
        kebab.type = "button";
        kebab.title = "Edit · reorder";
        kebab.addEventListener("click", (e) => {
          e.stopPropagation();
          openCardMenu(kebab, p);
        });
        card.appendChild(kebab);
      }
      card.addEventListener("click", () => {
        state.lastColumn = p.pillarId;
        // the detail overlay arrives with P2 — owners edit for now
        if (canManage() && !adopted) void editPriority(p);
      });
      return card;
    };

    const openCardMenu = (anchor: HTMLElement, p: Priority) => {
      document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu");
      const item = (label: string, run: () => void, disabled = false) => {
        const b = el("button", "app-cp-menu-item", label) as HTMLButtonElement;
        b.type = "button";
        b.disabled = disabled;
        b.addEventListener("click", () => {
          menu.remove();
          run();
        });
        menu.appendChild(b);
      };
      item("Edit…", () => void editPriority(p));
      const siblings = visibleFor(state.org).filter((x) => x.pillarId === p.pillarId && orgKey(x.org) === orgKey(state.org));
      const i = siblings.indexOf(p);
      item("Move up", () => void reorder(siblings, i, i - 1), i <= 0);
      item("Move down", () => void reorder(siblings, i, i + 1), i < 0 || i >= siblings.length - 1);
      item("Cascade to… (next update)", () => undefined, true);
      item("Complete / archive (next update)", () => undefined, true);
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
      document.body.appendChild(menu);
      const close = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", close, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
      cleanups.push(() => menu.remove());
    };

    const reorder = async (siblings: Priority[], from: number, to: number) => {
      if (to < 0 || to >= siblings.length) return;
      const list = siblings.slice();
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      list.forEach((p, i) => (p.order = i + 1));
      for (const p of list) await savePriority(p, data);
      const actor = { whoId: viewer.whoId, who: me?.who ?? who?.name ?? "" };
      await appendEvent(moved, "reordered", { to: to + 1 }, actor);
      await reload();
    };

    const renderOther = (): HTMLElement => {
      const strip = el("div", "app-cp-other");
      if (!state.showOther) {
        strip.style.display = "none";
        return strip;
      }
      // initiatives arrive with P5 — until then the strip states the fact
      strip.appendChild(el("span", undefined, "Other — 0 initiatives not linked to an open priority"));
      strip.appendChild(el("span", "app-cp-muted", " · initiatives arrive with a later update"));
      return strip;
    };

    // ---- add / edit -----------------------------------------------------------

    const cascadeTargetsFor = (p: Priority | null): { org: OrgRef; ownerName: string }[] => {
      const org = p ? p.org : state.org;
      const kids = childOrgs(tree, org);
      const parent = orgParent(org);
      const peers = parent ? childOrgs(tree, parent).filter((o) => !sameOrg(o, org)) : [];
      const named = (o: OrgRef) => {
        // areas fall to their department's owner for the label
        const govern = orgLevel(o) === "area" ? { ...o, area: "" } : o;
        return owners[orgKey(govern)]?.[0]?.who ?? "";
      };
      return [...kids, ...peers].map((o) => ({ org: o, ownerName: named(o) }));
    };

    const actor = () => ({ whoId: viewer.whoId, who: me?.who ?? who?.name ?? "" });

    const addPriority = async () => {
      const draft = newPriority(state.org, state.period !== "" ? state.period : currentPeriod);
      if (me) {
        draft.ownerId = me.whoId;
        draft.ownerName = me.who;
      }
      const inColumn = visibleFor(state.org).filter((x) => x.pillarId === (state.lastColumn || ""));
      draft.order = inColumn.length + 1;
      const r = await priorityDialog({
        host: wrap,
        title: "Add priority",
        priority: draft,
        pillars: data.pillars,
        preselectPillarId: state.lastColumn,
        periods: periodsOnOffer(),
        roster,
        cascadeTargets: cascadeTargetsFor(null),
        alreadyCascaded: [],
        primaryInitiativeLabel: "",
      });
      if (!r) return;
      r.priority.rowId = await savePriority(r.priority, data);
      data.priorities.push(r.priority);
      await appendEvent(r.priority, "created", { statement: r.priority.statement }, actor());
      await cascade(r.priority, r.cascadeTo);
      await reload();
    };

    const editPriority = async (p: Priority) => {
      const copy: Priority = { ...p, org: { ...p.org } };
      const already = data.assignments.filter((a) => a.priorityId === p.id).map((a) => a.org);
      const r = await priorityDialog({
        host: wrap,
        title: "Edit priority",
        priority: copy,
        pillars: data.pillars,
        periods: periodsOnOffer(),
        roster,
        cascadeTargets: cascadeTargetsFor(p),
        alreadyCascaded: already,
        primaryInitiativeLabel: "",
      });
      if (!r) return;
      const before = p.statement;
      await savePriority(r.priority, data);
      Object.assign(p, r.priority);
      await appendEvent(
        p,
        "edited",
        before !== p.statement ? { from: before, to: p.statement } : { fields: "properties" },
        actor()
      );
      await cascade(p, r.cascadeTo);
      await reload();
    };

    /** Create proposed assignments for the chosen orgs (skipping any that
     *  already have one) and log the cascade event. */
    const cascade = async (p: Priority, targets: OrgRef[]) => {
      const existing = new Set(data.assignments.filter((a) => a.priorityId === p.id).map((a) => orgKey(a.org)));
      const fresh = targets.filter((o) => !existing.has(orgKey(o)) && !isDescendant(p.org, o));
      for (const org of fresh) {
        await saveAssignment(
          {
            id: "",
            priorityId: p.id,
            org,
            status: "proposed",
            reason: "",
            decidedById: "",
            decidedByName: "",
            decidedAt: "",
            childPriorityId: "",
          },
          data
        );
      }
      if (fresh.length > 0) {
        await appendEvent(p, "cascaded", { to: fresh.map(orgName) }, actor());
      }
    };

    render();
  })().catch((err) => {
    stopLoading();
    wrap.appendChild(
      el("div", "app-board-note", `Priorities could not load: ${err instanceof Error ? err.message : String(err)}`)
    );
  });

  return () => {
    dead = true;
    for (const fn of cleanups) fn();
    wrap.remove();
  };
}

// keep the roster type in play for the dialogs' signatures
export type { RosterPerson };
export type { PrioritySettings };
