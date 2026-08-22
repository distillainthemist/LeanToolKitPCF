// Improvement — the hub tab (P5; design spec §1): one table, three
// groups — My initiatives · Owned by my team (org owners, with a scope
// select and a Gantt › stub) · All initiatives I can see — the same
// columns throughout (Initiative · Stage · Primary metric · Next gate ·
// Health · ⋮), and the three-step create flow (template picker with the
// single-action variant · header form · save lands on the new board).
// P5 stand-ins: metric values, health scores, Tiles view and the board's
// header band arrive with P6 — the columns say so plainly.

import { el, clear } from "../../../shared/ui/dom";
import { showLoading } from "../loading";
import { currentViewer } from "../runtime";
import { boardHash } from "../links";
import { dayLabel } from "../linkTitle";
import { listPeople } from "../store/people";
import type { RosterPerson } from "../store/mappers";
import { improvementSettingsJson, orgJson, orgOwnersMap, prioritySettingsJson, siteCompanies } from "../store/config";
import { loadCascade } from "../store/priorities";
import { listTemplates } from "../store/templates";
import { appendInitiativeEvent, createInitiative, listInitiatives, saveInitiative } from "../store/initiatives";
import { actionsForInitiatives, upsertActions } from "../store/actions";
import { listBoards } from "../store/boards";
import { rowsForInitiativeBoards } from "../store/cards";
import { buildMetricState } from "./metricValues";
import { newAction } from "../../../shared/schema/actions";
import { promptConfirm } from "../prompts";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { periodFor, parsePrioritySettings, ragPaletteKey } from "../priorities/model";
import { paletteMap } from "../../../shared/palette";
import { appPalettes } from "../store/config";
import { todayIso } from "../../../shared/schema/id";
import {
  groupInitiatives,
  ImprovementViewer,
  Initiative,
  myRoles,
  nextGateFor,
  orgKeyOf,
  ragInputsFor,
  validateNewInitiative,
} from "./initiativeModel";
import { initiativeRag } from "../priorities/model";
import {
  ImprovementSettings,
  InitiativeTemplate,
  parseImprovementSettings,
  PDCA_TOKENS,
  roleFillersAt,
  STANDARD_ROLES,
  stepperChips,
} from "./templateModel";
import { pickOwner } from "../priorities/dialogs";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface ImprovementMountOpts {
  embedded?: boolean;
}

export function mountImprovement(parent: HTMLElement, _opts: ImprovementMountOpts = {}): () => void {
  const wrap = el("div", "app-im-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const who = currentViewer();
    const [initiatives, templates, roster, owners, treeRaw, siteCo, impRaw, prSettingsRaw, initActions, allBoards, initRows, palettes, cascade] = await Promise.all([
      listInitiatives(),
      listTemplates(),
      listPeople(),
      orgOwnersMap(),
      orgJson(),
      siteCompanies(),
      improvementSettingsJson(),
      prioritySettingsJson(),
      actionsForInitiatives().catch(() => []),
      listBoards().catch(() => []),
      rowsForInitiativeBoards().catch(() => []),
      appPalettes(),
      // the priorities' statements, for the row meta line (all companies;
      // a rename shows on the next open — no label is stored on the link)
      loadCascade("").catch(() => null),
    ]);
    if (dead) return;
    stopLoading();
    const me = roster.find((p) => p.whoId === (who?.objectId ?? "")) ?? null;
    const imp = parseImprovementSettings(impRaw);
    const priorityStatement = new Map((cascade?.priorities ?? []).map((p) => [p.id, p.statement]));
    /** Who may act for a role on this initiative: the people assigned on
     *  the row PLUS the site's standard-role fillers (the approval pool
     *  the board header honours). */
    const actorsForRole = (i: Initiative, key: string): { whoId: string; who: string }[] => {
      const std = imp.standardRoles.find((r) => r.key === key);
      return [...(i.roles[key] ?? []), ...(std ? roleFillersAt(std, i.org.site) : [])];
    };
    const sites = parseOrgTree(treeRaw);
    const currentPeriod = periodFor(parsePrioritySettings(prSettingsRaw).period, todayIso());
    const ownedOrgKeys = Object.entries(owners)
      .filter(([, people]) => people.some((p) => p.whoId === (who?.objectId ?? "")))
      .map(([key]) => key);
    const viewer: ImprovementViewer = {
      whoId: who?.objectId ?? "",
      ownedOrgKeys,
      isAdmin: me?.role === "superadmin" || me?.role === "siteadmin",
    };
    let list = initiatives;
    const metricState = buildMetricState(initiatives, allBoards, initRows);
    // state colours resolve through the SITE STATE PALETTE (ui-standard §1)
    const stateColors = paletteMap(palettes.states);
    const ragColor = (rag: "green" | "amber" | "red" | "grey"): string => stateColors[ragPaletteKey(rag)] ?? "#9a948a";
    /** Escalated IS the Issue state, needs-support the At-risk state —
     *  chips resolve through the palette (ui-standard §1). */
    const flagChip = (text: string, kind: "escalated" | "flag"): HTMLElement => {
      const chip = el("span", "app-im-chip", text);
      const c = kind === "escalated" ? ragColor("red") : ragColor("amber");
      if (kind === "escalated") {
        chip.style.background = c;
        chip.style.color = "#fff";
      } else {
        chip.style.border = `1px solid ${c}`;
        chip.style.color = c;
      }
      return chip;
    };

    interface Filters {
      site: string;
      pdca: string;
      period: string;
      status: string;
      flagOnly: boolean;
      method: string;
      teamScope: string; // "" = my orgs + children (all owned keys)
    }
    const f: Filters = { site: me?.site ?? "", pdca: "", period: currentPeriod, status: "active", flagOnly: false, method: "", teamScope: "" };
    let viewMode: "list" | "tiles" = "list";
    let search = "";

    const visible = (i: Initiative): boolean =>
      (search === "" || i.title.toLowerCase().includes(search.toLowerCase())) &&
      (f.site === "" || i.org.site === f.site) &&
      (f.period === "" || i.period === f.period) &&
      (f.status === "all" || i.status === f.status) &&
      (!f.flagOnly || i.flag !== "") &&
      (f.method === "" || i.method === f.method) &&
      (f.pdca === "" || i.snapshot.stages.find((s) => s.id === i.stageId)?.pdca === f.pdca);

    /** The Documents-register filters popover: anchored under the Filters
     *  button, groups of pills, Clear all / Done. It lives on the body so
     *  a pill click can repaint the list beneath without closing it. */
    let filterPop: HTMLElement | null = null;
    let paintFilterPop: () => void = () => {};
    const closeFilterPop = () => {
      filterPop?.remove();
      filterPop = null;
    };
    const render = () => {
      clear(wrap);
      wrap.appendChild(renderHeader());
      if (filterPop) paintFilterPop();
      const groups = groupInitiatives(list.filter(visible), viewer);
      if (viewMode === "tiles") {
        // wall view (design 1.2): tiles for at-distance reading
        const grid = el("div", "app-im-tiles");
        for (const i of groups.all) grid.appendChild(tileFor(i));
        if (groups.all.length === 0) grid.appendChild(note(`No initiatives for ${f.period || "this period"} in this org.`));
        if (groups.hiddenConfidential > 0) grid.appendChild(note(`· ${groups.hiddenConfidential} confidential in this org`));
        wrap.appendChild(grid);
        return;
      }
      const table = el("div", "app-im-table");
      const roleLabel = (i: Initiative, key: string) => i.snapshot.roleLabels[key] ?? key;
      const ownerName = (i: Initiative): string => (i.roles.owner ?? [])[0]?.who ?? "no owner";
      // 1 — my initiatives
      table.appendChild(groupHead(`My initiatives · ${groups.mine.length}`));
      if (groups.mine.length === 0) table.appendChild(note("You don't hold a role on any initiative yet."));
      else table.appendChild(columnHead());
      for (const i of groups.mine) table.appendChild(rowFor(i, myRoles(i, viewer.whoId).map((k) => roleLabel(i, k)).join(", ")));
      // 2 — owned by my team (org owners only)
      if (ownedOrgKeys.length > 0) {
        const scoped = f.teamScope === "" ? groups.team : groups.team.filter((i) => orgKeyOf(i.org).startsWith(f.teamScope.replace(/\|+$/, "")));
        const head = groupHead(`Owned by my team · ${scoped.length}`);
        const scope = el("select", "app-input app-im-scope") as HTMLSelectElement;
        const opts: [string, string][] = [["", "All my orgs + children"]];
        for (const k of ownedOrgKeys) {
          const parts = k.split("|").filter((x) => x !== "");
          opts.push([k, parts[parts.length - 1] ?? k]);
        }
        for (const [v, l] of opts) {
          const o = el("option", "", l) as HTMLOptionElement;
          o.value = v;
          if (v === f.teamScope) o.selected = true;
          scope.appendChild(o);
        }
        scope.addEventListener("change", () => {
          f.teamScope = scope.value;
          render();
        });
        head.appendChild(scope);
        const gantt = btn("Gantt ›", "app-cp-ov-link app-im-gantt");
        gantt.disabled = true;
        gantt.title = "The org-wide actions Gantt arrives with the initiative board";
        head.appendChild(gantt);
        table.appendChild(head);
        if (scoped.length === 0) table.appendChild(note(`No initiatives in your orgs for ${f.period || "this period"}.`));
        else table.appendChild(columnHead());
        for (const i of scoped.slice(0, 5)) table.appendChild(rowFor(i, ownerName(i)));
        if (scoped.length > 5) {
          const more = btn(`Show all ${scoped.length} ›`, "app-link app-im-more");
          more.addEventListener("click", () => {
            for (const i of scoped.slice(5)) table.insertBefore(rowFor(i, ownerName(i)), more);
            more.remove();
          });
          table.appendChild(more);
        }
      }
      // 3 — everything I can see
      const mineIds = new Set(groups.mine.map((x) => x.id));
      const others = groups.all.filter((x) => !mineIds.has(x.id));
      table.appendChild(groupHead(`Other initiatives · ${others.length}`));
      if (others.length === 0) table.appendChild(note(`No other initiatives for ${f.period || "this period"}.`));
      else table.appendChild(columnHead());
      for (const i of others) table.appendChild(rowFor(i, ownerName(i)));
      if (groups.hiddenConfidential > 0) table.appendChild(note(`· ${groups.hiddenConfidential} confidential in this org`));
      wrap.appendChild(table);
    };

    const groupHead = (label: string): HTMLElement => {
      const h = el("div", "app-im-group");
      h.appendChild(el("span", "app-im-group-label", label));
      return h;
    };

    /** The Documents-tab column header row — same labels as the spec. */
    const columnHead = (): HTMLElement => {
      const h = el("div", "app-im-row app-im-colhead");
      h.append(
        el("span", undefined, "Initiative"),
        el("span", undefined, "Stage"),
        el("span", undefined, "Primary metric"),
        el("span", undefined, "Next gate"),
        el("span", undefined, "Health"),
        el("span", undefined, "")
      );
      return h;
    };
    const note = (text: string): HTMLElement => el("div", "app-settings-note app-im-note", text);

    /** The Documents-tab header standard: title + scope subtitle + count
     *  on the left; ＋ primary · Filters · List|Tiles · on the right. The
     *  filter selects live behind the Filters button, not in a raw row. */
    const activeFilterCount = (): number =>
      [f.pdca !== "", f.status !== "active", f.method !== "", f.flagOnly, f.period !== currentPeriod].filter(Boolean).length;
    const renderHeader = (): HTMLElement => {
      const head = el("div", "app-im-head");
      const left = el("div", "app-im-head-left");
      left.appendChild(el("div", "app-im-head-title", `Improvement — ${f.site || "All sites"}`));
      left.appendChild(el("div", "app-im-head-sub", f.period || "All periods"));
      const matching = list.filter(visible).length;
      const narrowed = search !== "" || activeFilterCount() > 0;
      left.appendChild(el("div", "app-im-head-count", `${matching} initiative${matching === 1 ? "" : "s"}${narrowed ? " matching" : ""}`));
      head.appendChild(left);
      head.appendChild(el("span", "app-bar-gap"));
      const add = btn("＋ Initiative", "app-btn app-btn-primary");
      add.addEventListener("click", () => openCreate());
      head.appendChild(add);
      // search sits between ＋ Initiative and Filters (Ben, 2026-08-20)
      const input = el("input", "app-input app-im-search-input") as HTMLInputElement;
      input.type = "search";
      input.placeholder = "Search initiatives…";
      input.value = search;
      input.addEventListener("input", () => {
        search = input.value.trim();
        const at = input.selectionStart;
        render();
        const fresh = wrap.querySelector<HTMLInputElement>(".app-im-search-input");
        fresh?.focus();
        if (fresh && at !== null) fresh.setSelectionRange(at, at);
      });
      head.appendChild(input);
      const filters = btn(
        activeFilterCount() > 0 ? `Filters · ${activeFilterCount()}` : "Filters",
        "app-btn app-docs-filtersbtn" + (activeFilterCount() > 0 ? " app-docs-filtersbtn-on" : "")
      );
      filters.title = "Filter the register";
      filters.addEventListener("click", () => {
        if (filterPop) {
          closeFilterPop();
          return;
        }
        openFilters(filters);
      });
      head.appendChild(filters);
      // the Documents-tab segmented control (accent fill on the active side)
      const seg = el("div", "app-docs-seg");
      const listBtn = btn("List", "app-docs-segbtn" + (viewMode === "list" ? " app-docs-segbtn-on" : ""));
      const tilesBtn = btn("Tiles", "app-docs-segbtn" + (viewMode === "tiles" ? " app-docs-segbtn-on" : ""));
      listBtn.addEventListener("click", () => {
        viewMode = "list";
        render();
      });
      tilesBtn.addEventListener("click", () => {
        viewMode = "tiles";
        render();
      });
      seg.append(listBtn, tilesBtn);
      head.appendChild(seg);
      return head;
    };

    const openFilters = (anchor: HTMLElement) => {
      closeFilterPop();
      const menu = el("div", "app-docs-menu app-docs-filterpop");
      const body = el("div", "app-docs-filterpop-body");
      menu.appendChild(body);
      filterPop = menu;
      const paintPop = () => {
        clear(body);
        const group = (label: string): HTMLElement => {
          const g = el("div", "app-docs-fgroup");
          g.appendChild(el("div", "app-docs-fgroup-label", label));
          const pills = el("div", "app-docs-fpills");
          g.appendChild(pills);
          body.appendChild(g);
          return pills;
        };
        /** One pill; `on` repaints both the list and this popover. */
        const pill = (into: HTMLElement, label: string, on: boolean, pick: () => void) => {
          const pb = btn(label, "app-docs-fpill" + (on ? " app-docs-fpill-on" : ""));
          pb.setAttribute("aria-pressed", String(on));
          pb.addEventListener("click", () => {
            pick();
            render();
          });
          into.appendChild(pb);
        };
        /** A group whose pills are exclusive; clicking the lit pill
         *  clears to `empty` (the "All" reading) like the Documents pills. */
        const exclusive = (label: string, opts: [string, string][], cur: string, empty: string, set: (v: string) => void) => {
          const pills = group(label);
          for (const [v, l] of opts) pill(pills, l, cur === v, () => set(cur === v ? empty : v));
        };
        if (sites.length > 1) {
          exclusive("Site", sites.map((s) => [s.site, s.site] as [string, string]), f.site, "", (v) => {
            f.site = v;
          });
        }
        exclusive("Stage", [["plan", "Plan"], ["do", "Do"], ["check", "Check"], ["act", "Act"]], f.pdca, "", (v) => {
          f.pdca = v;
        });
        const periods = [...new Set([currentPeriod, ...list.map((i) => i.period)])].filter((p) => p !== "").sort();
        exclusive("Period", periods.map((p) => [p, p] as [string, string]), f.period, "", (v) => {
          f.period = v;
        });
        // status always has one pill lit (like Documents' "Modified")
        const statusPills = group("Status");
        for (const [v, l] of [["active", "Active"], ["completed", "Completed"], ["archived", "Archived"], ["all", "All"]] as const) {
          pill(statusPills, l, f.status === v, () => {
            f.status = v;
          });
        }
        if (imp.methods.length > 0) {
          exclusive("Method", imp.methods.map((m) => [m, m] as [string, string]), f.method, "", (v) => {
            f.method = v;
          });
        }
        const flagPills = group("Flags");
        pill(flagPills, "⚑ Flagged only", f.flagOnly, () => {
          f.flagOnly = !f.flagOnly;
        });
        const foot = el("div", "app-docs-fpop-foot");
        const clearAll = btn("Clear all", "app-btn");
        clearAll.addEventListener("click", () => {
          // the site is the page's scope (the title says it), so it stays
          f.pdca = "";
          f.period = currentPeriod;
          f.status = "active";
          f.method = "";
          f.flagOnly = false;
          render();
        });
        const done = btn("Done", "app-btn app-btn-primary");
        done.addEventListener("click", () => closeFilterPop());
        foot.append(clearAll, done);
        body.appendChild(foot);
      };
      paintFilterPop = paintPop;
      paintPop();
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 420))}px`;
      document.body.appendChild(menu);
    };
    // outside click / Escape close the popover (the Documents behaviour)
    const onFilterPointer = (e: PointerEvent) => {
      if (filterPop && !filterPop.contains(e.target as Node)) {
        // the Filters button itself toggles; let its click handler decide
        const t = e.target as HTMLElement;
        if (t.closest?.(".app-docs-filtersbtn")) return;
        closeFilterPop();
      }
    };
    document.addEventListener("pointerdown", onFilterPointer);
    cleanups.push(() => document.removeEventListener("pointerdown", onFilterPointer));
    const onFilterKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && filterPop) {
        e.stopPropagation();
        closeFilterPop();
      }
    };
    document.addEventListener("keydown", onFilterKey, true);
    cleanups.push(() => document.removeEventListener("keydown", onFilterKey, true));
    cleanups.push(closeFilterPop);

    const rowFor = (i: Initiative, meta: string): HTMLElement => {
      const row = el("div", "app-im-row");
      // status edge = the initiative's RAG (flags + action position; metric
      // values join the mix with reporting)
      const inputs = ragInputsFor(i, initActions, todayIso());
      inputs.metric = metricState.get(i.id)?.rag ?? null;
      const rag = initiativeRag(inputs);
      row.style.borderLeftColor = ragColor(rag);
      const main = el("div", "app-im-main");
      const titleLine = el("div", "app-im-title");
      titleLine.appendChild(el("span", "app-im-title-text", i.title));
      if (i.flag === "escalated") titleLine.appendChild(flagChip("▲ Escalated", "escalated"));
      else if (i.flag === "flag") titleLine.appendChild(flagChip("⚐ Needs support", "flag"));
      if (i.confidential) titleLine.appendChild(el("span", "app-im-chip app-im-chip-conf", "◈ Confidential"));
      main.appendChild(titleLine);
      // priority statement · my roles / owner · org (the method is a filter
      // dimension and the stage names already say it)
      const primary = i.priorities.find((p) => p.primary) ?? i.priorities[0] ?? null;
      const priorityText = primary ? (priorityStatement.get(primary.priorityId) ?? "Linked priority") : "Other";
      const metaBits = [priorityText, meta, i.org.department || i.org.site].filter((s) => s !== "");
      main.appendChild(el("div", "app-im-meta", metaBits.join(" · ")));
      row.appendChild(main);
      // stage chip
      const stage = i.snapshot.stages.find((s) => s.id === i.stageId) ?? null;
      const stageCell = el("div", "app-im-cell");
      if (i.singleAction) stageCell.appendChild(el("span", "app-cp-muted", "single action"));
      else if (stage) {
        const chip = el("span", "app-im-stagechip", stage.name);
        chip.style.color = PDCA_TOKENS[stage.pdca].fg;
        chip.style.background = PDCA_TOKENS[stage.pdca].bg;
        stageCell.appendChild(chip);
      }
      row.appendChild(stageCell);
      // primary metric — values arrive with P6's metric cards
      const metricCell = el("div", "app-im-cell");
      const mv = (metricState.get(i.id)?.values ?? [])[0] ?? null;
      if (mv && mv.last !== null) {
        // value + / target — the value takes the state colour only when
        // off-target (design 1.2)
        const v = el("span", undefined, `${mv.last}${mv.unit}`);
        if (mv.rag === "amber" || mv.rag === "red") v.style.color = ragColor(mv.rag);
        if (mv.rag !== "green" && mv.rag !== null) v.style.fontWeight = "700";
        metricCell.appendChild(el("span", "app-cp-muted", `${mv.name} `));
        metricCell.appendChild(v);
        if (mv.target !== null) metricCell.appendChild(el("span", "app-cp-muted", ` / ${mv.target}${mv.unit}`));
      } else {
        metricCell.classList.add("app-cp-muted");
        metricCell.textContent =
          i.metrics.length > 0
            ? `${i.metrics[0].name}${i.metrics[0].target !== null ? ` → ${i.metrics[0].target}${i.metrics[0].unit}` : ""}`
            : "No metric set";
        metricCell.title = i.metrics.length > 0 ? "Chart values on the initiative board's KPI card" : "";
      }
      row.appendChild(metricCell);
      // next gate
      const gateCell = el("div", "app-im-cell");
      const ng = nextGateFor(i);
      if (ng === null) gateCell.appendChild(el("span", "app-cp-muted", i.status === "active" ? "—" : i.status));
      else {
        const overdue = ng.target !== "" && ng.target < todayIso();
        gateCell.appendChild(el("div", "", `${ng.fromName} → ${ng.toName}`));
        if (ng.target !== "") {
          const when = el("div", "", dayLabel(ng.target));
          if (overdue) {
            when.style.color = ragColor("red");
            when.style.fontWeight = "600";
          } else when.classList.add("app-cp-muted");
          gateCell.appendChild(when);
        }
        // a pending request: "awaiting you" when YOUR decision is still
        // outstanding (assigned or a site standard-role filler), else
        // who it waits on
        const pending = i.gate;
        if (pending) {
          const open = pending.approverRoles.filter((r) => !pending.decisions[r]);
          const mine = open.filter((r) => actorsForRole(i, r).some((p) => p.whoId === viewer.whoId));
          if (mine.length > 0) gateCell.appendChild(el("div", "app-im-awaiting", "awaiting you"));
          else if (open.length > 0) {
            gateCell.appendChild(el("div", "app-cp-muted", `awaiting ${open.map((r) => i.snapshot.roleLabels[r] ?? r).join(", ")}`));
          }
        }
      }
      row.appendChild(gateCell);
      // health — last check stored on the row (boardHeader writes it)
      let healthText = "Not checked";
      try {
        const h = JSON.parse(i.fieldValues.__health ?? "null") as { score?: number; of?: number; at?: string } | null;
        if (h && typeof h.score === "number") healthText = `${h.score} / ${h.of ?? 10} · ${(h.at ?? "").slice(5, 7)}/${(h.at ?? "").slice(2, 4)}`;
      } catch {
        /* not checked */
      }
      row.appendChild(el("div", "app-im-cell" + (healthText === "Not checked" ? " app-cp-muted" : ""), healthText));
      // kebab
      const kebab = btn("⋮", "app-cp-kebab app-im-kebab");
      kebab.addEventListener("click", (e) => {
        e.stopPropagation();
        openRowMenu(kebab, i);
      });
      row.appendChild(kebab);
      row.addEventListener("click", () => openInitiative(i));
      return row;
    };

    const tileFor = (i: Initiative): HTMLElement => {
      const inputs = ragInputsFor(i, initActions, todayIso());
      inputs.metric = metricState.get(i.id)?.rag ?? null;
      const rag = initiativeRag(inputs);
      const tile = el("div", "app-im-tile");
      tile.style.borderTopColor = ragColor(rag);
      tile.appendChild(el("div", "app-im-tile-title", i.title));
      const stage = i.snapshot.stages.find((s) => s.id === i.stageId) ?? null;
      const line = el("div", "app-im-tile-line");
      if (i.singleAction) line.appendChild(el("span", "app-cp-muted", "single action"));
      else if (stage) {
        const chip = el("span", "app-im-stagechip", stage.name);
        chip.style.color = PDCA_TOKENS[stage.pdca].fg;
        chip.style.background = PDCA_TOKENS[stage.pdca].bg;
        line.appendChild(chip);
      }
      if (i.flag === "escalated") line.appendChild(flagChip("▲", "escalated"));
      else if (i.flag === "flag") line.appendChild(flagChip("⚐", "flag"));
      tile.appendChild(line);
      const mv = (metricState.get(i.id)?.values ?? [])[0] ?? null;
      tile.appendChild(
        el("div", "app-im-tile-metric" + (mv && mv.last !== null ? "" : " app-cp-muted"), mv && mv.last !== null ? `${mv.name} ${mv.last}${mv.unit}${mv.target !== null ? ` / ${mv.target}${mv.unit}` : ""}` : "No metric value")
      );
      tile.appendChild(el("div", "app-im-tile-owner", [(i.roles.owner ?? [])[0]?.who ?? "no owner", i.org.department || i.org.site].filter((x) => x !== "").join(" · ")));
      tile.addEventListener("click", () => openInitiative(i));
      return tile;
    };

    const openInitiative = (i: Initiative) => {
      if (i.boardId !== "") window.location.hash = boardHash(i.boardId);
    };

    const openRowMenu = (anchor: HTMLElement, i: Initiative) => {
      document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu");
      const item = (label: string, run: () => void, disabled = false) => {
        const b = btn(label, "app-cp-menu-item");
        b.disabled = disabled;
        b.addEventListener("click", () => {
          menu.remove();
          run();
        });
        menu.appendChild(b);
      };
      const mine = myRoles(i, viewer.whoId).length > 0 || viewer.isAdmin;
      item("Open", () => openInitiative(i), i.boardId === "");
      item("Edit details…", () => {
        void import("./editDetails").then(({ openEditDetails }) => {
          openEditDetails({
            host: wrap,
            initiative: i,
            actor: actor(),
            onSaved: () => {
              void listInitiatives().then((fresh) => {
                list = fresh;
                render();
              });
            },
          });
        });
      }, !mine);
      item(i.flag === "" ? "⚐ Flag — needs support" : "Clear flag", () => void setFlag(i, i.flag === "" ? "flag" : ""), !mine);
      item("▲ Escalate to sponsor", () => void setFlag(i, "escalated"), !mine || i.flag === "escalated");
      item("Health check (next update)", () => undefined, true);
      item("Move stage (next update)", () => undefined, true);
      item(i.status === "archived" ? "Restore" : "Archive", () => void archive(i), !mine);
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
      document.body.appendChild(menu);
      const off = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", off, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
      cleanups.push(() => menu.remove());
    };

    const actor = () => ({ whoId: viewer.whoId, who: me?.who ?? who?.name ?? "" });

    const setFlag = async (i: Initiative, flag: Initiative["flag"]) => {
      if (flag === "escalated") {
        const { openEscalateDialog } = await import("./escalate");
        const sponsors = (i.roles.sponsor ?? [])
          .map((p) => ({ name: p.who, email: roster.find((r) => r.whoId === p.whoId)?.email ?? "" }))
          .filter((p) => p.email !== "");
        openEscalateDialog({
          host: wrap,
          initiativeTitle: i.title,
          orgLine: `${actor().who} escalated "${i.title}" (${i.org.site}${i.org.department ? " · " + i.org.department : ""})`,
          recipients: sponsors,
          link: `${window.location.origin}${window.location.pathname}${window.location.search}#/board/${i.boardId}`,
          onEscalate: async (note) => {
            i.flag = "escalated";
            i.flagNote = note;
            await saveInitiative(i);
            await appendInitiativeEvent(i, "flag", { flag: "escalated", note }, actor());
            render();
          },
        });
        return;
      }
      i.flag = flag;
      i.flagNote = "";
      await saveInitiative(i);
      await appendInitiativeEvent(i, "flag", { flag }, actor());
      render();
    };

    const archive = async (i: Initiative) => {
      i.status = i.status === "archived" ? "active" : "archived";
      await saveInitiative(i);
      await appendInitiativeEvent(i, i.status === "archived" ? "archived" : "reopened", {}, actor());
      render();
    };

    // ---- create flow (design 1.3): three steps in one modal ---------------------

    const openCreate = (lockedPriority?: { priorityId: string; label: string }) => {
      const scrim = el("div", "app-modal-overlay");
      const box = el("div", "app-modal app-modal-wide app-im-create");
      scrim.appendChild(box);
      wrap.appendChild(scrim);
      const close = () => scrim.remove();
      scrim.addEventListener("click", (e) => {
        if (e.target === scrim) close();
      });
      let chosen: InitiativeTemplate | null = null;

      const paintPicker = () => {
        clear(box);
        box.appendChild(el("div", "app-modal-title", "Pick how you'll run this"));
        const grid = el("div", "app-im-tplgrid");
        const usable = templates.filter((t) => t.active && (t.company === "" || t.company === siteCo[f.site || (me?.site ?? "")]));
        const ordered = [...usable.filter((t) => !t.singleAction), ...usable.filter((t) => t.singleAction)];
        for (const t of ordered) {
          const used = list.filter((x) => x.templateId === t.id).length;
          const card = el("button", "app-im-tplcard") as HTMLButtonElement;
          card.type = "button";
          const head = el("div", "app-im-tplcard-head");
          head.appendChild(el("span", "app-tw-card-name", t.name));
          head.appendChild(el("span", "app-tw-card-method" + (t.singleAction ? " app-tw-card-method-single" : ""), t.singleAction ? `${t.method} · no board` : t.method));
          card.appendChild(head);
          if (t.singleAction) card.appendChild(el("div", "ltk-mw-help", "One action instead — no board, no stages"));
          else {
            const strip = el("div", "app-tw-stepper app-tw-stepper-small");
            for (const c of stepperChips(t)) {
              const chip = el("span", "app-tw-step" + (c.pdca === null ? " app-tw-step-complete" : ""), `${c.gated ? "⚑ " : ""}${c.label}`);
              if (c.pdca !== null) {
                chip.style.color = PDCA_TOKENS[c.pdca].fg;
                chip.style.background = PDCA_TOKENS[c.pdca].bg;
              }
              strip.appendChild(chip);
            }
            card.appendChild(strip);
          }
          if (t.description !== "") card.appendChild(el("div", "ltk-mw-help", t.description));
          card.appendChild(el("div", "app-cp-muted app-im-tplused", `used ${used} time${used === 1 ? "" : "s"}`));
          card.addEventListener("click", () => {
            chosen = t;
            paintHeaderForm();
          });
          grid.appendChild(card);
        }
        if (ordered.length === 0) grid.appendChild(el("div", "app-settings-note", "No active templates — a super admin authors them in Settings → Improvement."));
        box.appendChild(grid);
        const foot = el("div", "app-modal-footer");
        const cancel = btn("Cancel", "app-link");
        cancel.addEventListener("click", close);
        foot.appendChild(cancel);
        box.appendChild(foot);
      };

      const paintHeaderForm = () => {
        const t = chosen!;
        clear(box);
        box.appendChild(el("div", "app-modal-title", `New ${t.name}`));
        const body = el("div", "app-cp-modal-body");
        box.appendChild(body);
        const field = (label: string, control: HTMLElement, hint?: string) => {
          const fEl = el("div", "app-field");
          fEl.append(el("span", "app-field-label", label), control);
          if (hint) fEl.appendChild(el("span", "app-field-hint", hint));
          body.appendChild(fEl);
        };
        const title = el("input", "app-input") as HTMLInputElement;
        title.placeholder = "What this initiative delivers, in a line";
        field("Title", title);
        // org: site → department → area from the tree
        const siteSel = el("select", "app-input") as HTMLSelectElement;
        for (const s of sites) {
          const o = el("option", "", s.site) as HTMLOptionElement;
          o.value = s.site;
          if (s.site === (me?.site ?? "")) o.selected = true;
          siteSel.appendChild(o);
        }
        const deptSel = el("select", "app-input") as HTMLSelectElement;
        const areaSel = el("select", "app-input") as HTMLSelectElement;
        const rebuildOrg = () => {
          clear(deptSel);
          const site = sites.find((s) => s.site === siteSel.value);
          const dOpt = el("option", "", "Whole site") as HTMLOptionElement;
          dOpt.value = "";
          deptSel.appendChild(dOpt);
          for (const d of site?.departments ?? []) {
            const o = el("option", "", d.department) as HTMLOptionElement;
            o.value = d.department;
            deptSel.appendChild(o);
          }
          rebuildArea();
        };
        const rebuildArea = () => {
          clear(areaSel);
          const site = sites.find((s) => s.site === siteSel.value);
          const d = site?.departments.find((x) => x.department === deptSel.value);
          const aOpt = el("option", "", "Whole department") as HTMLOptionElement;
          aOpt.value = "";
          areaSel.appendChild(aOpt);
          for (const a of d?.areas ?? []) {
            const o = el("option", "", a) as HTMLOptionElement;
            o.value = a;
            areaSel.appendChild(o);
          }
        };
        siteSel.addEventListener("change", rebuildOrg);
        deptSel.addEventListener("change", rebuildArea);
        rebuildOrg();
        const orgRow = el("div", "app-im-orgrow");
        orgRow.append(siteSel, deptSel, areaSel);
        field("Organisation", orgRow);
        // linked priorities (multi, one primary); a handoff from a priority
        // arrives pre-linked and locked
        const links: { priorityId: string; primary: boolean; label: string; locked?: boolean }[] = lockedPriority
          ? [{ priorityId: lockedPriority.priorityId, primary: true, label: lockedPriority.label, locked: true }]
          : [];
        const priBox = el("div", "app-im-links");
        const priAdd = btn("＋ Link a priority");
        const paintLinks = async () => {
          clear(priBox);
          links.forEach((l, li) => {
            const chip = el("span", "ltk-mw-chip" + (l.primary ? " app-im-link-primary" : ""));
            chip.appendChild(el("span", undefined, (l.primary ? "★ " : "") + l.label));
            chip.title = l.primary ? "Primary" : "Click ★ to make primary";
            if (!l.primary) {
              const star = btn("★", "ltk-mw-chip-x");
              star.title = "Make primary";
              star.addEventListener("click", () => {
                links.forEach((x) => (x.primary = false));
                l.primary = true;
                void paintLinks();
              });
              chip.appendChild(star);
            }
            if (!l.locked) {
              const x = btn("×", "ltk-mw-chip-x");
              x.addEventListener("click", () => {
                links.splice(li, 1);
                if (l.primary && links.length > 0) links[0].primary = true;
                void paintLinks();
              });
              chip.appendChild(x);
            }
            priBox.appendChild(chip);
          });
          priBox.appendChild(priAdd);
        };
        priAdd.addEventListener("click", () => {
          void (async () => {
            const company = siteCo[siteSel.value] ?? "";
            const data = await loadCascade(company);
            const open = data.priorities.filter((p) => p.status === "active" && !links.some((l) => l.priorityId === p.id));
            if (open.length === 0) return;
            const menu = el("div", "app-cp-menu");
            for (const p of open.slice(0, 30)) {
              const item = btn(p.statement.slice(0, 70), "app-cp-menu-item");
              item.addEventListener("click", () => {
                menu.remove();
                links.push({ priorityId: p.id, primary: links.length === 0, label: p.statement.slice(0, 40) });
                void paintLinks();
              });
              menu.appendChild(item);
            }
            const r = priAdd.getBoundingClientRect();
            menu.style.top = `${r.bottom + 4}px`;
            menu.style.left = `${Math.min(r.left, window.innerWidth - 340)}px`;
            document.body.appendChild(menu);
            const off = (e: PointerEvent) => {
              if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener("pointerdown", off, true);
              }
            };
            setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
          })();
        });
        void paintLinks();
        field("Linked priorities", priBox, "One is the primary — its charter and metric headline the priority.");
        // roles: template roles with people pickers; standard roles pre-fill
        const rolePeople: Record<string, { whoId: string; who: string }[]> = {};
        const rolesBox = el("div", "app-im-roles");
        const paintRoles = () => {
          clear(rolesBox);
          for (const role of t.roles) {
            const line = el("div", "app-im-rolerow");
            line.appendChild(el("span", "app-im-rolename", role.label));
            const std = imp.standardRoles.find((sr) => sr.key === role.key);
            if (std && !(role.key in rolePeople)) {
              const fillers = roleFillersAt(std, siteSel.value);
              if (fillers.length > 0) rolePeople[role.key] = fillers.map((p) => ({ ...p }));
            }
            const people = rolePeople[role.key] ?? [];
            people.forEach((p, pi) => {
              const chip = el("span", "app-owner", p.who);
              chip.title = "Click to remove";
              chip.addEventListener("click", () => {
                people.splice(pi, 1);
                paintRoles();
              });
              line.appendChild(chip);
            });
            if (role.multi || people.length === 0) {
              const add = btn("＋", "app-owner app-owner-none");
              add.addEventListener("click", () => {
                void pickOwner(wrap, roster, null).then((res) => {
                  if (res === null || res === "clear") return;
                  const cur = rolePeople[role.key] ?? [];
                  if (cur.some((p) => p.whoId === res.whoId)) return;
                  rolePeople[role.key] = [...cur, { whoId: res.whoId, who: res.who }];
                  paintRoles();
                });
              });
              line.appendChild(add);
            }
            rolesBox.appendChild(line);
          }
        };
        paintRoles();
        siteSel.addEventListener("change", paintRoles);
        field("Roles", rolesBox, "Standard roles pre-fill from the site's people (Settings → Improvement); adjust per initiative.");
        // custom fields: standard + template
        const fieldValues: Record<string, string> = {};
        const allFields = [...imp.standardFields, ...t.fields];
        for (const cf of allFields) {
          if (cf.kind === "picklist") {
            const s = el("select", "app-input") as HTMLSelectElement;
            const blank = el("option", "", cf.required ? "Choose…" : "—") as HTMLOptionElement;
            blank.value = "";
            s.appendChild(blank);
            for (const opt of cf.options) {
              const o = el("option", "", opt) as HTMLOptionElement;
              o.value = opt;
              s.appendChild(o);
            }
            s.addEventListener("change", () => (fieldValues[cf.key] = s.value));
            field(cf.label + (cf.required ? " *" : ""), s);
          } else if (cf.kind === "longtext") {
            const ta = el("textarea", "app-input") as HTMLTextAreaElement;
            ta.rows = 3;
            ta.addEventListener("change", () => (fieldValues[cf.key] = ta.value.trim()));
            field(cf.label + (cf.required ? " *" : ""), ta);
          } else {
            const inp = el("input", "app-input") as HTMLInputElement;
            inp.type = cf.kind === "number" ? "number" : cf.kind === "date" ? "date" : "text";
            inp.addEventListener("change", () => (fieldValues[cf.key] = inp.value.trim()));
            field(cf.label + (cf.required ? " *" : ""), inp);
          }
        }
        // mandatory metrics: targets editable
        const metrics = t.metrics.map((m) => ({ ...m }));
        if (metrics.length > 0) {
          const mBox = el("div", "app-im-metrics");
          for (const m of metrics) {
            const line = el("div", "app-im-rolerow");
            line.appendChild(el("span", "app-im-rolename", `${m.name}${m.unit ? ` (${m.unit})` : ""}`));
            const tgt = el("input", "app-input app-im-target") as HTMLInputElement;
            tgt.type = "number";
            tgt.placeholder = "target";
            tgt.value = m.target === null ? "" : String(m.target);
            tgt.addEventListener("change", () => {
              const n = Number(tgt.value);
              m.target = tgt.value === "" || !Number.isFinite(n) ? null : n;
            });
            line.appendChild(tgt);
            line.appendChild(el("span", "ltk-mw-help", m.goodDirection === "down" ? "lower is better" : m.goodDirection === "range" ? "within limits" : "higher is better"));
            mBox.appendChild(line);
          }
          field("Mandatory for this template", mBox);
        }
        // confidential + period
        const conf = el("label", "app-cp-cascade-row") as HTMLLabelElement;
        const confCb = el("input") as HTMLInputElement;
        confCb.type = "checkbox";
        conf.append(confCb, el("span", undefined, "Confidential — visible to its roles and org owners only"));
        body.appendChild(conf);
        const err = el("div", "app-cp-err", "");
        body.appendChild(err);
        const foot = el("div", "app-modal-footer");
        const back = btn("‹ Back", "app-link");
        back.addEventListener("click", paintPicker);
        const cancel = btn("Cancel", "app-link");
        cancel.addEventListener("click", close);
        const create = btn("Create initiative", "app-btn app-btn-primary");
        create.addEventListener("click", () => {
          void (async () => {
            const draft = {
              title: title.value.trim(),
              description: "",
              org: { company: siteCo[siteSel.value] ?? "", site: siteSel.value, department: deptSel.value, area: areaSel.value },
              confidential: confCb.checked,
              flag: "" as const,
              flagNote: "",
              endorsement: false,
              period: f.period !== "" ? f.period : currentPeriod,
              roles: rolePeople,
              priorities: links.map((l) => ({ priorityId: l.priorityId, primary: l.primary })),
              fieldValues,
              metrics,
            };
            const errs = validateNewInitiative({ title: draft.title, org: draft.org, metrics, singleAction: t.singleAction, roles: rolePeople });
            const missingReq = allFields.filter((cf) => cf.required && !(fieldValues[cf.key] ?? "").trim()).map((cf) => `"${cf.label}" is needed.`);
            const allErrs = [...errs, ...missingReq];
            if (allErrs.length > 0) {
              err.textContent = allErrs.join(" ");
              return;
            }
            create.disabled = true;
            const made = await createInitiative(t, draft, actor());
            if (t.singleAction) {
              // the lightweight variant writes ONE action linked to the header
              const a = newAction({ source: "initiative", sourceId: made.id });
              a.description = draft.title;
              const owner = (rolePeople.owner ?? [])[0];
              if (owner) a.assignees = [{ whoId: owner.whoId, who: owner.who, done: false }];
              a.initiativeId = made.id;
              a.instanceId = `improvement:${made.id}`;
              await upsertActions([a]);
            }
            list = await listInitiatives();
            close();
            if (made.boardId !== "") window.location.hash = boardHash(made.boardId);
            else render();
          })().catch((e) => {
            err.textContent = e instanceof Error ? e.message : String(e);
            create.disabled = false;
          });
        });
        foot.append(back, cancel, create);
        box.appendChild(foot);
        title.focus();
      };

      paintPicker();
      cleanups.push(close);
    };

    render();
    // handed over from a priority's overlay (design 1.3: pre-filled and
    // locked to the source priority)
    try {
      const pending = sessionStorage.getItem("ltk-pending-init-priority");
      if (pending) {
        sessionStorage.removeItem("ltk-pending-init-priority");
        const o = JSON.parse(pending) as { priorityId?: string; label?: string };
        if (typeof o.priorityId === "string" && o.priorityId !== "") {
          openCreate({ priorityId: o.priorityId, label: o.label ?? "linked priority" });
        }
      }
    } catch {
      /* fine */
    }
  })().catch((err) => {
    stopLoading();
    wrap.appendChild(el("div", "app-board-note", `Improvement could not load: ${err instanceof Error ? err.message : String(err)}`));
  });

  return () => {
    dead = true;
    for (const fn of cleanups) fn();
    wrap.remove();
  };
}

export type { ImprovementSettings, RosterPerson };
export { STANDARD_ROLES };
