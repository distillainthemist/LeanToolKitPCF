// Cascaded priorities — the screen (design spec `leanboard-cascade-
// priorities-design.md`, build item 1 = the Simple-view spine, plus the
// add/edit priority dialog pulled forward from item 2 so the matrix can be
// filled and tested). Rides as a hub tab like Documents (dynamic import).
//
// Screen anatomy top to bottom: org bar (plain crumbs, one ▾ popover on
// the current node: Switch · Descend · Browse all…) → toolbar (period · status · Simple/Dynamic ·
// cascade chip · ＋ Priority · ⋮ view options) → vision band (directly
// over the pillars) → the matrix (rail: "Strategic Pillars" over one
// rectangle per pillar spanning its sub-pillar columns, settings order;
// "Priorities" row; "Objectives" row) → the Other strip.
// Density: ≤4 comfortable · 5–6 compact · 7+ scroll (or group by pillar).
// Phone (<720px): sub-pillar headings with their cards stacked.
//
// P1 renders statuses from a stub resolver (no initiatives yet): every
// priority is grey with "· 0 initiatives" and every objective cell reads
// "No metric set". The detail overlay, cascade review list, close /
// carry-forward flows live in lifecycle.ts (P2); P3 adds the Dynamic
// view — built (P3), persists per user per org via prefs.ts; P4 adds TV
// walk mode + the embedded card.

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
  CascadeTarget,
  childOrgs,
  editVision,
  OrgTree,
  pickOrg,
  priorityDialog,
  siblingOrgs,
} from "./dialogs";
import { loadPriorityPrefs, savePriorityPrefs, ViewMode } from "./prefs";
import { mountWalk } from "./walk";
import { initialsFor } from "../../../shared/schema/people";
import { carryForwardFlow, cascadeDialog, cascadeReview, closeDialog, closePriority, LifecycleCtx, openPriorityOverlay, reopenPriority } from "./lifecycle";
import {
  canManageOrg,
  densityFor,
  groupByColumn,
  isDescendant,
  nextPeriod,
  objectiveColumns,
  OrgRef,
  orgKey,
  orgFromKey,
  orgLevel,
  orgName,
  orgParent,
  orgPath,
  orgRef,
  parentClosed,
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
  /** Embedded ritual card (§8): a fixed org (blank parts fall back to the
   *  viewer's site), optional pillar filter by name, view mode, and the
   *  meeting's period. `mode: "tile"` = compact displayed matrix; "focused"
   *  = opens the walk at step 1 with ⊞ All objectives returning to the
   *  matrix. Card mounts never persist prefs. */
  card?: {
    mode: "tile" | "focused";
    org?: Partial<OrgRef>;
    pillarName?: string;
    /** Rotation focus (P4): pillar / sub-pillar ids in focus for this
     *  occurrence's topic; wins over pillarName. */
    focus?: string[];
    /** The occurrence's rotation topic, shown in the presentation title. */
    topic?: string;
    view?: ViewMode;
    /** The meeting's date (ISO) — the period is derived from it. */
    periodDate?: string;
    /** Receives the tile snapshot SVG after each paint (§8). */
    onSnapshot?: (svg: string) => void;
  };
}

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tile snapshot (§8): vision band, objective headings and status edges
 *  only — no metric text, unreadable at tile size. Pure. */
export function prioritiesSnapshotSvg(
  title: string,
  vision: string,
  columns: { name: string; color: string; edges: string[] }[]
): string {
  const W = 480;
  const H = 320;
  const n = Math.max(1, Math.min(columns.length, 6));
  const gap = 8;
  const left = 16;
  const colW = (W - left * 2 - gap * (n - 1)) / n;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="16" y="30" font-size="18" font-weight="600" fill="#111" font-family="system-ui, sans-serif">${esc(title.slice(0, 44))}</text>`);
  parts.push(`<rect x="16" y="44" width="${W - 32}" height="34" rx="6" fill="${vision !== "" ? "#26241f" : "#f4f1ea"}"/>`);
  parts.push(
    `<text x="${W / 2}" y="66" text-anchor="middle" font-size="13" font-weight="600" fill="${vision !== "" ? "#fff" : "#8b8478"}" font-family="system-ui, sans-serif">${esc((vision || "No vision statement set").slice(0, 70))}</text>`
  );
  columns.slice(0, 6).forEach((c, i) => {
    const x = left + i * (colW + gap);
    parts.push(`<rect x="${x}" y="92" width="${colW}" height="40" rx="5" fill="${esc(c.color || "#6d675c")}"/>`);
    const words = c.name.split(/\s+/);
    const l1 = words.slice(0, 2).join(" ");
    const l2 = words.slice(2, 4).join(" ");
    parts.push(`<text x="${x + 6}" y="${l2 ? 108 : 116}" font-size="11" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${esc(l1.slice(0, 16))}</text>`);
    if (l2) parts.push(`<text x="${x + 6}" y="122" font-size="11" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${esc(l2.slice(0, 16))}</text>`);
    c.edges.slice(0, 5).forEach((edge, j) => {
      const y = 142 + j * 32;
      parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="26" rx="4" fill="#faf8f4" stroke="#e4dfd6"/>`);
      parts.push(`<rect x="${x}" y="${y}" width="4" height="26" rx="2" fill="${esc(edge || "#9a948a")}"/>`);
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
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
  l1: string | null; // pillar filter (chip)
  focus: string[] | null; // rotation focus set (card) — wins over l1
  period: string;
  status: "active" | "completed" | "all";
  rule: RollupRule;
  showOther: boolean;
  groupByPillar: boolean;
  lastColumn: string; // the sub-pillar last interacted with (＋ Priority preselect)
  view: ViewMode; // Simple (default, TV) | Dynamic — persists per user per org
  tv: boolean; // presentation mode (design §7 "TV"): org name only, toolbar hidden, type ×1.4, vision full-width
}

/** P1 stub: what a priority's initiatives look like. Initiatives arrive
 *  with P5; until then every priority is "no data". */
function ragsFor(_p: Priority): Rag[] {
  return [];
}

export function mountPriorities(parent: HTMLElement, opts: PrioritiesMountOpts = {}): () => void {
  const card = opts.card ?? null;
  const wrap = el("div", "app-cp-wrap" + (card ? ` app-cp-card app-cp-card-${card.mode}` : ""));
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const who = currentViewer();
    const [rawTree, siteCo, roster, visions, settingsRaw, owners, palettes, prefs] = await Promise.all([
      orgJson(),
      siteCompanies(),
      listPeople(),
      orgVisions(),
      prioritySettingsJson(),
      orgOwnersMap(),
      appPalettes(),
      loadPriorityPrefs(who?.objectId ?? ""),
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
    // card: the configured org, blank parts falling back to the viewer's
    // site (the board's own org is what the card is normally set to)
    const cardOrg = (): OrgRef | null => {
      if (!card) return null;
      const site = card.org?.site ?? mySite?.site ?? "";
      const company = card.org?.company ?? (site !== "" ? (siteCo[site] ?? "") : (mySite?.company ?? companyList[0] ?? ""));
      return orgRef(company, site, card.org?.department ?? "", card.org?.area ?? "");
    };
    const startOrg = cardOrg() ?? (prefs.lastOrg !== "" ? orgFromKey(prefs.lastOrg) : (mySite ?? firstSite));
    const cardL1 = card?.pillarName ? (data0Pillars: Pillar[]) => data0Pillars.find((x) => x.level === 1 && x.name.toLowerCase() === card.pillarName!.toLowerCase())?.id ?? null : null;
    const state: ScreenState = {
      org: startOrg,
      l1: null,
      focus: card?.focus && card.focus.length > 0 ? card.focus : null,
      tv: false,
      period: currentPeriod,
      status: "active",
      rule: prefs.rule,
      showOther: prefs.showOther,
      groupByPillar: prefs.groupByPillar,
      lastColumn: "",
      view: card?.view ?? (prefs.viewByOrg[orgKey(startOrg)] ?? "simple"),
    };
    if (card?.periodDate) state.period = periodFor(settings.period, card.periodDate) || currentPeriod;
    const persist = () => {
      if (card) return; // card mounts never touch the person's prefs
      prefs.lastOrg = orgKey(state.org);
      prefs.rule = state.rule;
      prefs.showOther = state.showOther;
      prefs.groupByPillar = state.groupByPillar;
      if (state.view === "dynamic") prefs.viewByOrg[orgKey(state.org)] = "dynamic";
      else delete prefs.viewByOrg[orgKey(state.org)];
      savePriorityPrefs(viewer.whoId, prefs);
    };

    let data: CascadeData = await loadCascade(state.org.company);
    if (dead) return;
    stopLoading();
    if (cardL1) state.l1 = cardL1(data.pillars);

    /** The nearest scrolling ancestor — closing the overlay / repainting
     *  after a write must land where the user was (§13). */
    const scroller = (): Element => {
      let n: HTMLElement | null = wrap.parentElement;
      while (n) {
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
        n = n.parentElement;
      }
      return document.scrollingElement ?? document.documentElement;
    };
    const reload = async () => {
      const sc = scroller();
      const top = sc.scrollTop;
      data = await loadCascade(state.org.company);
      if (dead) return;
      render();
      sc.scrollTop = top;
    };

    const canManage = () => canManageOrg(viewer, state.org, owners);
    const reviewQueueLen = () => data.assignments.filter((a) => orgKey(a.org) === orgKey(state.org) && a.status === "onhold").length;
    const periodsOnOffer = () => {
      const cur = currentPeriod;
      const next = nextPeriod(settings.period, cur);
      const set = new Set<string>([cur]);
      if (next !== "") set.add(next);
      for (const p of data.priorities) if (p.period !== "") set.add(p.period);
      return [...set].sort();
    };

    const ownerNameFor = (o: OrgRef) => {
      const govern = orgLevel(o) === "area" ? { ...o, area: "" } : o;
      return owners[orgKey(govern)]?.[0]?.who ?? "";
    };
    const actorRef = () => ({ whoId: viewer.whoId, who: me?.who ?? who?.name ?? "" });
    const ctx: LifecycleCtx = {
      host: wrap,
      data: () => data,
      tree,
      roster,
      settings,
      rule: () => state.rule,
      palette,
      actor: actorRef,
      canManage: (o) => canManageOrg(viewer, o, owners),
      ownerNameFor,
      periodsOnOffer: () => periodsOnOffer(),
      currentPeriod,
      ragsFor,
      changed: reload,
      open: (p) => openOverlay(p),
    };
    const openOverlay = (p: Priority) => {
      openPriorityOverlay(ctx, p, (live) => void editPriority(live));
    };

    // ---- the render -------------------------------------------------------

    let walkOpen = false;
    let walkStep = 0;
    let closeWalk: (() => void) | null = null;
    const render = () => {
      clear(wrap);
      persist();
      wrap.classList.toggle("app-cp-tv", state.tv);
      if (walkOpen) {
        renderWalk();
        return;
      }
      // presentation / tile: org name only, no toolbar (§7); otherwise the full bar
      // and the vision band directly over the pillars (Ben, 2026-08-19)
      if (state.tv || card?.mode === "tile") wrap.append(renderTvBar(), renderVision());
      else wrap.append(renderOrgBar(), renderToolbar(), renderVision());
      const columns = objectiveColumns(data.pillars, state.focus ?? state.l1);
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
      if (card?.onSnapshot) {
        const visible = visibleFor(state.org);
        const { byColumn } = groupByColumn(columns, visible);
        card.onSnapshot(
          prioritiesSnapshotSvg(
            `${orgName(state.org)} · ${state.period}`,
            visions[orgKey(state.org)] ?? "",
            columns.map((c) => ({
              name: c.name,
              color: c.color || data.pillars.find((x) => x.id === c.parentId)?.color || "",
              edges: (byColumn.get(c.id) ?? []).map((p) => palette[ragPaletteKey(rollup(tally(ragsFor(p)), state.rule, settings.ragRatioPct))] ?? "#9a948a"),
            }))
          )
        );
      }
    };

    /** Presentation / tile bar: the org name at ×1.4, ▶ Walk, Exit presentation. */
    const renderTvBar = (): HTMLElement => {
      const bar = el("div", "app-cp-tvbar");
      // "FY26 Cascaded Priorities | Company › Site › Department" — the
      // first part in the app accent, the org chain as far as it goes
      const title = el("div", "app-cp-tvorg");
      title.appendChild(el("span", "app-cp-tvorg-lead", `${state.period} Cascaded Priorities`));
      title.appendChild(el("span", "app-cp-tvorg-sep", " | "));
      title.appendChild(el("span", "app-cp-tvorg-chain", orgPath(state.org).map(orgName).join(" › ")));
      if (card?.topic) title.appendChild(el("span", "app-cp-tvorg-topic", ` · ${card.topic}`));
      bar.appendChild(title);
      if (card?.mode !== "tile") {
        const walk = el("button", "app-btn app-cp-tvbtn", "▶ Walk") as HTMLButtonElement;
        walk.type = "button";
        walk.addEventListener("click", () => openWalk(0));
        bar.appendChild(walk);
        if (!card) {
          const exit = el("button", "app-btn app-cp-tvbtn", "Exit presentation") as HTMLButtonElement;
          exit.type = "button";
          exit.addEventListener("click", () => {
            state.tv = false;
            render();
          });
          bar.appendChild(exit);
        }
      }
      return bar;
    };

    /** The walk (§15): objectives visible under the current filters. */
    const openWalk = (startStep: number) => {
      walkOpen = true;
      walkStep = startStep;
      render();
    };
    const renderWalk = () => {
      const columns = objectiveColumns(data.pillars, state.focus ?? state.l1);
      const visible = visibleFor(state.org);
      const { byColumn } = groupByColumn(columns, visible);
      const adoptedIds = new Set(prioritiesForOrg(state.org, data.priorities, data.assignments).adopted.map((p) => p.id));
      closeWalk?.();
      closeWalk = mountWalk({
        host: wrap,
        ctx,
        org: state.org,
        period: state.period,
        columns,
        pillars: data.pillars,
        byColumn,
        adoptedIds,
        startStep: walkStep,
        className: card ? "" : "app-cp-walk-fixed",
        onStep: (i) => {
          walkStep = i;
        },
        onExit: () => {
          walkOpen = false;
          closeWalk?.();
          closeWalk = null;
          render();
        },
        onOpen: (p) => openOverlay(p),
      });
      cleanups.push(() => closeWalk?.());
    };

    // One row, one control (Ben, 2026-08-19): plain crumbs — click an
    // ancestor to go up — and a single ▾ on the current node opening a
    // popover with Switch (siblings) · Descend (children, with pending-
    // cascade counts) · Browse all… (the tree picker for far jumps).
    const renderOrgBar = (): HTMLElement => {
      const bar = el("div", "app-cp-orgbar");
      const crumbs = el("div", "app-cp-crumbs");
      const path = orgPath(state.org);
      path.forEach((node, i) => {
        if (i > 0) crumbs.appendChild(el("span", "app-cp-crumb-sep", "›"));
        const last = i === path.length - 1;
        const b = el("button", "app-cp-crumb" + (last ? " app-cp-crumb-here" : ""), orgName(node) + (last ? " ▾" : "")) as HTMLButtonElement;
        b.type = "button";
        b.title = last ? "Switch, descend or browse" : `Go up to ${orgName(node)}`;
        b.addEventListener("click", () => {
          if (last) openOrgMenu(b);
          else void goTo(node);
        });
        crumbs.appendChild(b);
      });
      bar.appendChild(crumbs);
      return bar;
    };

    const openOrgMenu = (anchor: HTMLElement) => {
      document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu app-cp-orgmenu");
      const row = (o: OrgRef, here: boolean, badge: number) => {
        const b = el("button", "app-cp-menu-item app-cp-orgmenu-item" + (here ? " app-cp-orgmenu-here" : "")) as HTMLButtonElement;
        b.type = "button";
        b.appendChild(el("span", "app-cp-orgmenu-name", (here ? "✓ " : "") + orgName(o)));
        if (badge > 0) b.appendChild(el("span", "app-cp-orgmenu-badge", `⇩ ${badge}`));
        b.addEventListener("click", () => {
          menu.remove();
          if (!here) void goTo(o);
        });
        menu.appendChild(b);
      };
      const sibs = siblingOrgs(tree, state.org);
      if (sibs.length > 1) {
        menu.appendChild(el("div", "app-cp-menu-h", `Switch ${orgLevel(state.org)}`));
        for (const o of sibs) row(o, sameOrg(o, state.org), pendingCascades(o, data.assignments).length);
      }
      const kids = childOrgs(tree, state.org);
      if (kids.length > 0) {
        menu.appendChild(el("div", "app-cp-menu-h", "Descend"));
        for (const o of kids) row(o, false, pendingCascades(o, data.assignments).length);
      }
      const browse = el("button", "app-cp-menu-item app-cp-orgmenu-browse", "Browse all…") as HTMLButtonElement;
      browse.type = "button";
      browse.addEventListener("click", () => {
        menu.remove();
        void pickOrg(wrap, tree, state.org).then((o) => {
          if (o) void goTo(o);
        });
      });
      menu.appendChild(browse);
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
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

    const goTo = async (o: OrgRef) => {
      const companyChanged = o.company !== state.org.company;
      state.org = o;
      state.lastColumn = "";
      state.view = prefs.viewByOrg[orgKey(o)] ?? "simple";
      if (companyChanged) await reload();
      else render();
    };

    const renderVision = (): HTMLElement => {
      const row = el("div", "app-cp-visionrow");
      row.appendChild(el("div", "app-cp-label", "Vision"));
      const band = el("div", "app-cp-vision");
      row.appendChild(band);
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
      return row;
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
      // view toggle — persists per user per org (§5)
      const seg = el("div", "app-cp-seg");
      const simple = el("button", "app-cp-seg-btn" + (state.view === "simple" ? " app-cp-seg-on" : ""), "Simple") as HTMLButtonElement;
      simple.type = "button";
      const dynamic = el("button", "app-cp-seg-btn" + (state.view === "dynamic" ? " app-cp-seg-on" : ""), "Dynamic") as HTMLButtonElement;
      dynamic.type = "button";
      simple.title = "The physical template — matrix of pillars × priorities";
      dynamic.title = "Card per priority with headline metric and owner";
      simple.addEventListener("click", () => {
        state.view = "simple";
        render();
      });
      dynamic.addEventListener("click", () => {
        state.view = "dynamic";
        render();
      });
      seg.append(simple, dynamic);
      bar.appendChild(seg);
      // cascade chip (review list arrives with P2)
      const pending = pendingCascades(state.org, data.assignments).length;
      if (pending > 0) {
        const chip = el("button", "app-cp-cascadechip", `⇩ ${pending} cascade${pending === 1 ? "" : "s"} to accept`) as HTMLButtonElement;
        chip.type = "button";
        chip.title = "Review the cascades sent to this org";
        chip.addEventListener("click", () => cascadeReview(ctx, state.org));
        bar.appendChild(chip);
      } else if (reviewQueueLen() > 0) {
        const chip = el("button", "app-cp-cascadechip app-cp-cascadechip-quiet", `⏸ ${reviewQueueLen()} parked`) as HTMLButtonElement;
        chip.type = "button";
        chip.title = "Cascades this org put on hold";
        chip.addEventListener("click", () => cascadeReview(ctx, state.org));
        bar.appendChild(chip);
      }
      bar.appendChild(el("span", "app-cp-spacer"));
      const present = el("button", "app-btn", "▶ Present") as HTMLButtonElement;
      present.type = "button";
      present.title = "Presentation mode — full-width, larger type, then ▶ Walk one pillar at a time";
      present.addEventListener("click", () => {
        state.tv = true;
        render();
      });
      bar.appendChild(present);
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
      if (canManage()) {
        menu.appendChild(el("div", "app-cp-menu-h", "Period"));
        item(`Carry forward ${state.period} to next period…`, null, () => {
          const mine = data.priorities.filter((p) => orgKey(p.org) === orgKey(state.org) && p.period === state.period && p.status === "active");
          carryForwardFlow(ctx, state.org, state.period, mine);
        });
      }
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

      const cardFor = (p: Priority, col: Pillar) =>
        state.view === "dynamic" ? dynamicCard(p, col, adoptedIds.has(p.id)) : priorityCard(p, adoptedIds.has(p.id), density);
      if (phone) {
        for (const col of columns) {
          box.appendChild(el("div", "app-cp-ph-h", col.name));
          const items = byColumn.get(col.id) ?? [];
          if (items.length === 0) box.appendChild(el("div", "app-cp-empty-cell", "—"));
          for (const p of items) box.appendChild(cardFor(p, col));
        }
        return box;
      }

      const grid = el("div", "app-cp-grid");
      grid.style.gridTemplateColumns = `126px repeat(${Math.max(1, columns.length)}, 1fr)`;
      box.appendChild(grid);

      // row 1: rail "Strategic Pillars" over the pillar spans + column heads.
      // Each pillar is a rectangle stretched over its own sub-pillar
      // columns (settings order); click filters to that pillar, ✕ clears.
      const rail1 = el("div", "app-cp-label", "Strategic pillars");
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
          if (l1.color !== "") {
            b.style.background = l1.color;
            b.style.borderColor = l1.color;
            b.style.color = "#fff";
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
      grid.appendChild(el("div", "app-cp-label", "Priorities"));
      for (const col of columns) {
        const cell = el("div", "app-cp-cell");
        cell.addEventListener("click", () => {
          state.lastColumn = col.id;
        });
        const items = byColumn.get(col.id) ?? [];
        for (const p of items) cell.appendChild(cardFor(p, col));
        // empty cells stay blank — the toolbar's ＋ Priority is the one
        // door (Ben, 2026-08-19); clicking a column still preselects it
        if (items.length === 0) cell.appendChild(el("div", "app-cp-empty-cell", ""));
        grid.appendChild(cell);
      }
      if (columns.length === 0) grid.appendChild(el("div", "app-cp-cell"));

      // row 4: Objectives (headline metrics — P5 fills these). Always shown
      // at every density (Ben, 2026-08-19); in Dynamic the metric lives on
      // the card, so the row is not repeated.
      if (state.view === "dynamic") {
        // fall through to the unplaced note
      } else {
      grid.appendChild(el("div", "app-cp-label", "Objectives"));
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

    // ---- Dynamic view (§5, as Ben wants it 2026-08-19): SAME matrix —
    // pillars over sub-pillar columns — the card carries every detail
    // (metric, owner, tallies, lineage) and the Objectives row folds into it.
    const dynamicCard = (p: Priority, col: Pillar | null, adopted: boolean): HTMLElement => {
      const rags = ragsFor(p);
      const t = tally(rags);
      const rag = rollup(t, state.rule, settings.ragRatioPct);
      const card = el("div", "app-cp-dcard");
      card.style.borderLeftColor = palette[ragPaletteKey(rag)] ?? "#9a948a";
      void col; // the column head names the pillar — no strip on the card
      if (canManage() && !adopted) {
        const kebab = el("button", "app-cp-kebab", "⋮") as HTMLButtonElement;
        kebab.type = "button";
        kebab.title = "Edit · cascade · reorder · complete";
        kebab.addEventListener("click", (e) => {
          e.stopPropagation();
          openCardMenu(kebab, p);
        });
        card.appendChild(kebab);
      }
      const body = el("div", "app-cp-dcard-body");
      body.appendChild(el("div", "app-cp-dcard-statement", p.statement));
      // headline metric: large value + target + 96×40 sparkline (P5 fills)
      const metric = el("div", "app-cp-dcard-metric");
      const val = el("div", "app-cp-dcard-value");
      val.appendChild(el("span", "app-cp-dcard-num app-cp-muted", "—"));
      val.appendChild(el("span", "app-cp-dcard-target", "No metric set"));
      metric.appendChild(val);
      const spark = el("div", "app-cp-dcard-spark");
      spark.title = "Sparkline — follows the headline metric";
      metric.appendChild(spark);
      body.appendChild(metric);
      // owner chip + name (dynamic shows it; the matrix card omits it)
      const owner = el("div", "app-cp-dcard-owner");
      const chip = el("span", "app-cp-dcard-initials", p.ownerName !== "" ? initialsFor(p.ownerName) : "—");
      owner.append(chip, el("span", p.ownerName !== "" ? "" : "app-cp-muted", p.ownerName !== "" ? p.ownerName : "No owner"));
      body.appendChild(owner);
      // tallies + total, lineage, flags — same as the matrix card
      const meta = el("div", "app-cp-tallies");
      for (const part of tallyLine(t)) {
        const s = el("span", "app-cp-tally" + (part.count === 0 ? " app-cp-tally-zero" : ""), `${part.glyph} ${part.count}`);
        if (part.count > 0) s.style.color = palette[ragPaletteKey(part.rag)] ?? "";
        meta.appendChild(s);
      }
      meta.appendChild(el("span", "app-cp-total", `· ${t.total} initiative${t.total === 1 ? "" : "s"}`));
      body.appendChild(meta);
      if (p.status !== "active") body.appendChild(el("div", "app-cp-flag", p.status === "completed" ? "✓ Completed" : p.status === "archived" ? "▣ Archived" : "▣ Retired"));
      if (parentClosed(p, data.priorities)) body.appendChild(el("div", "app-cp-flag app-cp-flag-amber", "▲ Parent completed — decide"));
      card.appendChild(body);
      card.addEventListener("click", () => {
        state.lastColumn = p.pillarId;
        openOverlay(p);
      });
      return card;
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
      // cascade lineage and sender flags live in the detail overlay, not
      // on the card (Ben, 2026-08-19)
      if (p.status !== "active") {
        card.appendChild(el("div", "app-cp-flag", p.status === "completed" ? "✓ Completed" : p.status === "archived" ? "▣ Archived" : "▣ Retired"));
      }
      if (parentClosed(p, data.priorities)) card.appendChild(el("div", "app-cp-flag app-cp-flag-amber", "▲ Parent completed — decide"));
      // owner actions (⋮): P1 offers Edit + reorder; Cascade to… / Complete arrive with P2
      if (canManage() && !adopted) {
        const kebab = el("button", "app-cp-kebab", "⋮") as HTMLButtonElement;
        kebab.type = "button";
        kebab.title = "Edit · cascade · reorder · complete";
        kebab.addEventListener("click", (e) => {
          e.stopPropagation();
          openCardMenu(kebab, p);
        });
        card.appendChild(kebab);
      }
      card.addEventListener("click", () => {
        state.lastColumn = p.pillarId;
        openOverlay(p);
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
      item("Cascade to…", () => cascadeDialog(ctx, p), p.status !== "active");
      item("Complete…", () => void closeFromCard(p, "complete"), p.status !== "active");
      item("Archive…", () => void closeFromCard(p, "archive"), p.status !== "active");
      item("Reopen", () => void reopenPriority(ctx, p), p.status === "active");
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

    const closeFromCard = async (p: Priority, mode: "complete" | "archive") => {
      const r = await closeDialog(wrap, p, mode, nextPeriod(settings.period, p.period));
      if (r) await closePriority(ctx, p, mode, r);
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

    const cascadeTargetsFor = (p: Priority | null): CascadeTarget[] => {
      const org = p ? p.org : state.org;
      const kids = childOrgs(tree, org);
      const parent = orgParent(org);
      const peers = parent ? childOrgs(tree, parent).filter((o) => !sameOrg(o, org)) : [];
      const named = (o: OrgRef) => {
        // areas fall to their department's owner for the label
        const govern = orgLevel(o) === "area" ? { ...o, area: "" } : o;
        return owners[orgKey(govern)]?.[0]?.who ?? "";
      };
      return [
        ...kids.map((o) => ({ org: o, ownerName: named(o), kind: "child" as const })),
        ...peers.map((o) => ({ org: o, ownerName: named(o), kind: "peer" as const })),
      ];
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

    wrap.addEventListener("ltk-exit-tv", () => {
      state.tv = false;
      render();
    });
    if (card?.mode === "focused") walkOpen = true;
    render();
  })().catch((err) => {
    stopLoading();
    wrap.appendChild(
      el("div", "app-board-note", `Priorities could not load: ${err instanceof Error ? err.message : String(err)}`)
    );
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !wrap.classList.contains("app-cp-tv")) return;
    if (document.querySelector(".app-modal-overlay, .app-cp-scrim, .app-cp-walk")) return;
    wrap.dispatchEvent(new CustomEvent("ltk-exit-tv"));
  };
  document.addEventListener("keydown", onKey);
  return () => {
    dead = true;
    document.removeEventListener("keydown", onKey);
    for (const fn of cleanups) fn();
    wrap.remove();
  };
}

// keep the roster type in play for the dialogs' signatures
export type { RosterPerson };
export type { PrioritySettings };
