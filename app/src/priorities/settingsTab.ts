// Settings → Priorities (cascade plan P0): the configuration the cascade
// needs before any priority exists.
//
//   Pillars            superadmin — pillars (filter chips above the
//                      matrix) and their sub-pillars (the matrix
//                      columns): name, colour, active, ▲▼ order
//   Period & roll-up   superadmin — the period definition (FY start /
//                      calendar / custom label) and the ratio-rule X%
//   Vision             superadmin, or a site admin for their site — the
//                      vision statement per company / site / department,
//                      shown as the band across the priorities matrix
//
// Owners are NOT here: the org editor's owners (Organisation tab) are the
// one source of truth for who governs an org (Ben, 2026-08-19).
//
// Lazy chunk (dynamic import from settings.ts); the settings screen's
// dirty/save contract.

import { el, clear } from "../../../shared/ui/dom";
import type { RosterPerson } from "../store/mappers";
import {
  companies,
  orgJson,
  orgVisions,
  prioritySettingsJson,
  saveOrgVision,
  savePrioritySettingsJson,
  siteCompanies,
} from "../store/config";
import { deletePillar, listPillars, savePillar } from "../store/priorities";
import {
  DEFAULT_PRIORITY_SETTINGS,
  parsePrioritySettings,
  periodFor,
  Pillar,
  serializePrioritySettings,
} from "./model";
import { newId, todayIso } from "../../../shared/schema/id";

interface DirtyCtx {
  markDirty: () => void;
  markClean: () => void;
  registerSave: (fn: () => Promise<void>) => void;
  isDirty: () => boolean;
  saveCurrent: () => Promise<void>;
}

interface OrgSiteNode {
  site: string;
  departments?: { name: string }[];
}

function parseOrgTree(raw: string): OrgSiteNode[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => s && typeof s === "object" && typeof (s as OrgSiteNode).site === "string")
      .map((s) => {
        const o = s as { site: string; departments?: unknown };
        const departments = Array.isArray(o.departments)
          ? o.departments
              .map((d) =>
                typeof d === "string"
                  ? { name: d }
                  : d && typeof d === "object" && typeof (d as { name?: unknown }).name === "string"
                    ? { name: (d as { name: string }).name }
                    : null
              )
              .filter((d): d is { name: string } => d !== null)
          : [];
        return { site: o.site, departments };
      });
  } catch {
    return [];
  }
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const f = el("div", "app-field");
  f.append(el("span", "app-field-label", label), control);
  if (hint) f.appendChild(el("span", "app-field-hint", hint));
  return f;
}

function sectionTitle(text: string, note?: string): HTMLElement {
  const wrap = el("div", "app-pr-section");
  wrap.appendChild(el("h3", "app-pr-h3", text));
  if (note) wrap.appendChild(el("div", "app-settings-note", note));
  return wrap;
}

export async function renderPrioritiesSettings(
  body: HTMLElement,
  me: RosterPerson,
  ctx: DirtyCtx
): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";
  const saves: (() => Promise<void>)[] = [];
  ctx.registerSave(async () => {
    for (const fn of saves) await fn();
    ctx.markClean();
    await renderPrioritiesSettings(body, me, ctx);
  });

  if (isSuper) {
    await renderPillars(body, ctx, saves);
    await renderPeriod(body, ctx, saves);
  }
  await renderVisions(body, me, ctx, saves);
}

// ---- pillars ------------------------------------------------------------------

async function renderPillars(body: HTMLElement, ctx: DirtyCtx, saves: (() => Promise<void>)[]) {
  const box = sectionTitle(
    "Strategic pillars",
    "Pillars appear as filter chips above the priorities matrix; their sub-pillars are the matrix columns. Company-wide; typically change every few years. Order here is the order on screen."
  );
  body.appendChild(box);
  const companyList = await companies();
  const pillars = await listPillars();
  const removed: Pillar[] = [];
  let dirtyPillars = false;

  const list = el("div", "app-pr-pillars");
  box.appendChild(list);

  const l1sOrdered = () =>
    pillars.filter((p) => p.level === 1).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const childrenOf = (l1: Pillar) =>
    pillars.filter((p) => p.level === 2 && p.parentId === l1.id).sort((a, b) => a.order - b.order);
  /** Renumber a sibling set 1..n after a move/add/remove. */
  const renumber = (siblings: Pillar[]) => siblings.forEach((p, i) => (p.order = i + 1));
  const touch = () => {
    dirtyPillars = true;
    ctx.markDirty();
  };

  const move = (p: Pillar, siblings: Pillar[], delta: -1 | 1) => {
    const i = siblings.indexOf(p);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    renumber(siblings);
    touch();
    paint();
  };

  const paint = () => {
    clear(list);
    const l1s = l1sOrdered();
    if (l1s.length === 0) {
      list.appendChild(el("div", "app-settings-note", "No pillars yet — add one to start."));
    }
    for (const l1 of l1s) {
      list.appendChild(pillarRow(l1, null, l1s));
      const children = childrenOf(l1);
      for (const c of children) list.appendChild(pillarRow(c, l1, children));
      const addSub = el("button", "app-pr-addlink", "＋ Add sub-pillar") as HTMLButtonElement;
      addSub.type = "button";
      addSub.addEventListener("click", () => {
        pillars.push({
          id: newId("pl"),
          name: "",
          level: 2,
          parentId: l1.id,
          color: l1.color,
          order: children.length + 1,
          active: true,
          company: l1.company,
        });
        touch();
        paint();
        const rows = list.querySelectorAll<HTMLInputElement>(".app-pr-pillar-l2 input[type=text]");
        rows[rows.length - 1]?.focus();
      });
      list.appendChild(addSub);
    }
    const addL1 = el("button", "app-btn", "＋ Add pillar") as HTMLButtonElement;
    addL1.type = "button";
    addL1.addEventListener("click", () => {
      pillars.push({
        id: newId("pl"),
        name: "",
        level: 1,
        parentId: "",
        color: "#2563eb",
        order: l1s.length + 1,
        active: true,
        company: companyList[0] ?? "",
      });
      touch();
      paint();
      const rows = list.querySelectorAll<HTMLInputElement>(".app-pr-pillar:not(.app-pr-pillar-l2) input[type=text]");
      rows[rows.length - 1]?.focus();
    });
    list.appendChild(addL1);
  };

  const pillarRow = (p: Pillar, parent: Pillar | null, siblings: Pillar[]): HTMLElement => {
    const row = el("div", "app-pr-pillar" + (parent ? " app-pr-pillar-l2" : ""));
    const arrows = el("span", "app-pr-arrows");
    const up = el("button", "app-pr-arrow", "▲") as HTMLButtonElement;
    up.type = "button";
    up.title = "Move up";
    up.disabled = siblings.indexOf(p) === 0;
    up.addEventListener("click", () => move(p, siblings, -1));
    const down = el("button", "app-pr-arrow", "▼") as HTMLButtonElement;
    down.type = "button";
    down.title = "Move down";
    down.disabled = siblings.indexOf(p) === siblings.length - 1;
    down.addEventListener("click", () => move(p, siblings, 1));
    arrows.append(up, down);

    const swatch = el("input", "app-palette-swatch") as HTMLInputElement;
    swatch.type = "color";
    swatch.value = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#2563eb";
    swatch.addEventListener("input", () => {
      p.color = swatch.value;
      touch();
    });
    const name = el("input", "app-input") as HTMLInputElement;
    name.type = "text";
    name.value = p.name;
    name.placeholder = parent ? "Sub-pillar" : "Pillar";
    name.addEventListener("input", () => {
      p.name = name.value;
      touch();
    });
    const active = el("label", "app-check") as HTMLLabelElement;
    const box = el("input") as HTMLInputElement;
    box.type = "checkbox";
    box.checked = p.active;
    box.addEventListener("change", () => {
      p.active = box.checked;
      touch();
    });
    active.append(box, document.createTextNode(" Active"));
    const x = el("button", "app-btn app-palette-x", "×") as HTMLButtonElement;
    x.type = "button";
    x.title = parent ? "Remove sub-pillar" : "Remove pillar (and its sub-pillars)";
    x.addEventListener("click", () => {
      const doomed = parent ? [p] : [p, ...childrenOf(p)];
      for (const d of doomed) {
        const i = pillars.indexOf(d);
        if (i >= 0) pillars.splice(i, 1);
        if (d.rowId) removed.push(d);
      }
      renumber(parent ? childrenOf(parent) : l1sOrdered());
      touch();
      paint();
    });
    if (companyList.length > 1 && !parent) {
      const co = el("select", "app-input app-pr-co") as HTMLSelectElement;
      for (const c of companyList) {
        const o = el("option", "", c) as HTMLOptionElement;
        o.value = c;
        if (c === p.company) o.selected = true;
        co.appendChild(o);
      }
      co.addEventListener("change", () => {
        p.company = co.value;
        for (const c of pillars) if (c.parentId === p.id) c.company = co.value;
        touch();
      });
      row.append(arrows, swatch, name, co, active, x);
    } else {
      row.append(arrows, swatch, name, active, x);
    }
    return row;
  };
  paint();

  saves.push(async () => {
    if (!dirtyPillars) return;
    // parents first so children can bind to their row GUIDs
    for (const p of pillars.filter((p) => p.level === 1)) {
      if (p.name.trim() === "") continue;
      p.rowId = await savePillar(p, pillars);
    }
    for (const p of pillars.filter((p) => p.level === 2)) {
      if (p.name.trim() === "") continue;
      p.rowId = await savePillar(p, pillars);
    }
    for (const d of removed) if (d.rowId) await deletePillar(d.rowId);
    dirtyPillars = false;
  });
}

// ---- period + roll-up ratio -------------------------------------------------

async function renderPeriod(body: HTMLElement, ctx: DirtyCtx, saves: (() => Promise<void>)[]) {
  const box = sectionTitle(
    "Period & roll-up rule",
    "Every priority belongs to a period; views default to the current one. The ratio rule turns a priority red when more than X% of its initiatives are red (the strict rule — any red — is the other toggle on the view)."
  );
  body.appendChild(box);
  const s = parsePrioritySettings(await prioritySettingsJson());
  let dirty = false;

  const mode = el("select", "app-input") as HTMLSelectElement;
  for (const [v, l] of [
    ["fy", "Financial year"],
    ["calendar", "Calendar year"],
    ["custom", "Custom label"],
  ] as const) {
    const o = el("option", "", l) as HTMLOptionElement;
    o.value = v;
    if (v === s.period.mode) o.selected = true;
    mode.appendChild(o);
  }
  const start = el("select", "app-input") as HTMLSelectElement;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  MONTHS.forEach((m, i) => {
    const o = el("option", "", m) as HTMLOptionElement;
    o.value = String(i + 1);
    if (i + 1 === s.period.startMonth) o.selected = true;
    start.appendChild(o);
  });
  const prefix = el("input", "app-input app-pr-short") as HTMLInputElement;
  prefix.value = s.period.prefix;
  prefix.placeholder = "FY";
  const custom = el("input", "app-input app-pr-short") as HTMLInputElement;
  custom.value = s.period.currentPeriod;
  custom.placeholder = "e.g. H2 2026";
  const ratio = el("input", "app-input app-pr-short") as HTMLInputElement;
  ratio.type = "number";
  ratio.min = "0";
  ratio.max = "100";
  ratio.value = String(s.ragRatioPct);
  const preview = el("span", "app-field-hint", "");

  const sync = () => {
    s.period.mode = mode.value === "calendar" || mode.value === "custom" ? mode.value : "fy";
    s.period.startMonth = Number(start.value) || 7;
    s.period.prefix = prefix.value;
    s.period.currentPeriod = custom.value;
    s.ragRatioPct = Math.max(0, Math.min(100, Number(ratio.value) || 0));
    startField.style.display = s.period.mode === "fy" ? "" : "none";
    customField.style.display = s.period.mode === "custom" ? "" : "none";
    prefixField.style.display = s.period.mode === "custom" ? "none" : "";
    preview.textContent = `Today falls in “${periodFor(s.period, todayIso())}”`;
  };
  for (const c of [mode, start, prefix, custom, ratio]) {
    c.addEventListener("input", () => {
      sync();
      dirty = true;
      ctx.markDirty();
    });
    c.addEventListener("change", () => {
      sync();
      dirty = true;
      ctx.markDirty();
    });
  }
  const startField = field("Financial year starts in", start);
  const prefixField = field("Label prefix", prefix, "FY → “FY26”; blank → “2026”");
  const customField = field("Current period label", custom);
  const row = el("div", "app-settings-row");
  row.append(field("Period", mode), startField, prefixField, customField, preview);
  box.appendChild(row);
  box.appendChild(field("Ratio rule — red above (%)", ratio, `Default ${DEFAULT_PRIORITY_SETTINGS.ragRatioPct}%.`));
  sync();

  saves.push(async () => {
    if (!dirty) return;
    await savePrioritySettingsJson(serializePrioritySettings(s));
    dirty = false;
  });
}

// ---- vision per company / site / department ---------------------------------

async function renderVisions(
  body: HTMLElement,
  me: RosterPerson,
  ctx: DirtyCtx,
  saves: (() => Promise<void>)[]
) {
  const isSuper = me.role === "superadmin";
  const box = sectionTitle(
    "Vision statements",
    "One per org, shown as the band across the top of its priorities matrix. Who may edit an org's priorities is the org's owner — set on the Organisation tab."
  );
  body.appendChild(box);

  const [tree, coList, siteCo, visions] = await Promise.all([
    orgJson().then(parseOrgTree),
    companies(),
    siteCompanies(),
    orgVisions(),
  ]);
  const sites = isSuper ? tree : tree.filter((s) => s.site === me.site);
  const visionEdits: Record<string, string> = {}; // orgKey → text

  const visionField = (key: string, placeholder: string): HTMLElement => {
    const ta = el("textarea", "app-input app-pr-vision") as HTMLTextAreaElement;
    ta.value = visions[key] ?? "";
    ta.placeholder = placeholder;
    ta.rows = 2;
    ta.addEventListener("input", () => {
      visionEdits[key] = ta.value;
      ctx.markDirty();
    });
    return ta;
  };

  if (isSuper) {
    for (const co of coList) {
      const block = el("div", "app-pr-org app-pr-org-co");
      block.appendChild(el("div", "app-pr-orgname", co));
      block.appendChild(visionField(`${co}|||`, "The company's vision statement…"));
      box.appendChild(block);
    }
  }
  for (const s of sites) {
    const co = siteCo[s.site] ?? "";
    const block = el("div", "app-pr-org");
    block.appendChild(el("div", "app-pr-orgname", s.site));
    block.appendChild(visionField(`${co}|${s.site}||`, "This site's vision statement…"));
    for (const d of s.departments ?? []) {
      const dep = el("div", "app-pr-dept");
      dep.appendChild(el("div", "app-pr-deptname", d.name));
      dep.appendChild(visionField(`${co}|${s.site}|${d.name}|`, "This department's vision (optional)…"));
      block.appendChild(dep);
    }
    box.appendChild(block);
  }
  if (sites.length === 0) {
    box.appendChild(el("div", "app-settings-note", "No sites in the organisation yet — add them on the Organisation tab."));
  }

  saves.push(async () => {
    for (const [key, text] of Object.entries(visionEdits)) {
      const [company = "", site = "", department = ""] = key.split("|");
      await saveOrgVision({ company, site, department }, text.trim());
    }
    for (const k of Object.keys(visionEdits)) delete visionEdits[k];
  });
}
