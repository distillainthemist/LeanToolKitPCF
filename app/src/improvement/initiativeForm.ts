// The ONE initiative header form (edit-details-proposal-2026-10.md,
// built 2026-10-08): six named groups as section cards on the settings
// ground — About · Organisation · Priorities & people · Details ·
// Metrics · Rules — rendered for both the create flow's second step and
// "Edit details…", so the two can no longer drift. Period is not here:
// it is the initiative's start period, stamped at creation and read by
// the register's period filter, not a detail anyone edits.
//
// Pure helpers (field pairing, the fold's summary, the group an error
// belongs to) live in initiativeFormModel.ts (SDK-free, tested); the renderer takes its
// data in (no store imports beyond the sub-renderers it reuses), so the
// harness mounts it with stubs.

import { el, clear } from "../../../shared/ui/dom";
import type { OrgSite } from "../../../shared/schema/meeting";
import { settingsSection } from "../settingsSection";
import { renderAlsoOrgs, InitOrg } from "./alsoOrgs";
import { fieldInput, FieldInputContext } from "./fieldInput";
import { isFieldEmpty } from "./fieldCodec";
import { renderMetricsList } from "./metricsList";
import { pickOwner } from "../priorities/dialogs";
import { groupPrioritiesForPicker, isDescendant, OrgRef, orgRef, sameOrg } from "../priorities/model";
import { validateNewInitiative } from "./initiativeModel";
import { ImprovementSettings, MetricRule, normalizeMetrics, RolePerson, roleFillersAt, TemplateField, TemplateMetric, TemplateRole } from "./templateModel";
import type { RosterPerson } from "../store/mappers";

export { alsoSummary, groupFor, isShortKind, pairFields } from "./initiativeFormModel";
export type { FormGroup } from "./initiativeFormModel";
import { alsoSummary, FormGroup, groupFor, pairFields } from "./initiativeFormModel";

// ---- the form -------------------------------------------------------------------

export interface LinkDraft {
  priorityId: string;
  primary: boolean;
  label: string;
  /** A handoff from a priority arrives pre-linked and cannot be removed. */
  locked?: boolean;
}

export interface InitiativeDraft {
  title: string;
  description: string;
  org: InitOrg;
  alsoOrgs: InitOrg[];
  priorities: LinkDraft[];
  roles: Record<string, RolePerson[]>;
  fieldValues: Record<string, string>;
  metrics: TemplateMetric[];
  confidential: boolean;
  endorsement: boolean;
}

export interface PriorityLite {
  id: string;
  statement: string;
  status: string;
  org: OrgRef;
}

export interface InitiativeFormOpts {
  /** Where the groups render (the modal body). */
  host: HTMLElement;
  /** Where pickers open (the screen's wrap). */
  dialogHost: HTMLElement;
  mode: "create" | "edit";
  sites: OrgSite[];
  siteCo: Record<string, string>;
  roster: RosterPerson[];
  imp: ImprovementSettings;
  /** The roles the form offers (template roles, or the snapshot's). */
  roleDefs: TemplateRole[];
  /** Standard then template fields. */
  fields: TemplateField[];
  singleAction: boolean;
  metricRule: MetricRule;
  initial: InitiativeDraft;
  fiCtx: FieldInputContext;
  canPromote: boolean;
  /** The company's priorities, for the picker (loadCascade behind it). */
  loadPriorities: (company: string) => Promise<PriorityLite[]>;
  /** Edit only: linking an own metric migrates its card's series. */
  onMetricLinked?: (m: TemplateMetric) => Promise<void>;
}

export interface InitiativeFormHandle {
  /** The draft as it stands (copies of the working state). */
  read(): InitiativeDraft;
  /** Group-prefixed messages; the first failing control is scrolled into
   *  view and focused. Empty = good to save. */
  validate(): string[];
  showError(message: string): void;
  /** The title field. */
  focus(): void;
  /** The chosen site, read live. */
  site(): string;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export function renderInitiativeForm(o: InitiativeFormOpts): InitiativeFormHandle {
  const body = o.host;
  body.classList.add("app-if-body");
  const d: InitiativeDraft = {
    ...o.initial,
    org: { ...o.initial.org },
    alsoOrgs: o.initial.alsoOrgs.map((x) => ({ ...x })),
    priorities: o.initial.priorities.map((x) => ({ ...x })),
    roles: Object.fromEntries(Object.entries(o.initial.roles).map(([k, v]) => [k, v.map((p) => ({ ...p }))])),
    fieldValues: { ...o.initial.fieldValues },
    metrics: o.initial.metrics.map((m) => ({ ...m })),
  };

  const group = (title: FormGroup, note?: string): HTMLElement => {
    const card = el("div", "app-settings-sectioncard app-if-group");
    card.appendChild(settingsSection(title, note));
    body.appendChild(card);
    return card;
  };
  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const fEl = el("div", "app-field");
    fEl.append(el("span", "app-field-label", label), control);
    if (hint) fEl.appendChild(el("span", "app-field-hint", hint));
    return fEl;
  };
  const row = (...cells: HTMLElement[]): HTMLElement => {
    const r = el("div", "app-if-row" + (cells.length === 1 ? " app-if-row-1" : ""));
    r.append(...cells);
    return r;
  };

  // ---- About --------------------------------------------------------------------
  const about = group("About");
  const title = el("input", "app-input") as HTMLInputElement;
  title.value = d.title;
  title.placeholder = "What this initiative delivers, in a line";
  const desc = el("textarea", "app-input") as HTMLTextAreaElement;
  desc.rows = 2;
  desc.value = d.description;
  desc.placeholder = "The problem or opportunity, in a sentence or two";
  about.append(row(field("Title", title)), row(field("Description", desc)));

  // ---- Organisation -------------------------------------------------------------
  const orgCard = group("Organisation", "Where it is owned. Other departments it belongs to list it too.");
  const siteSel = el("select", "app-input") as HTMLSelectElement;
  for (const s of o.sites) {
    const opt = el("option", "", s.site) as HTMLOptionElement;
    opt.value = s.site;
    if (s.site === d.org.site) opt.selected = true;
    siteSel.appendChild(opt);
  }
  const deptSel = el("select", "app-input") as HTMLSelectElement;
  const areaSel = el("select", "app-input") as HTMLSelectElement;
  const rebuildArea = (keep: boolean) => {
    clear(areaSel);
    const site = o.sites.find((s) => s.site === siteSel.value);
    const dep = site?.departments.find((x) => x.department === deptSel.value);
    const aOpt = el("option", "", "Whole department") as HTMLOptionElement;
    aOpt.value = "";
    areaSel.appendChild(aOpt);
    for (const a of dep?.areas ?? []) {
      const opt = el("option", "", a) as HTMLOptionElement;
      opt.value = a;
      if (keep && a === d.org.area) opt.selected = true;
      areaSel.appendChild(opt);
    }
  };
  const rebuildOrg = (keep: boolean) => {
    clear(deptSel);
    const site = o.sites.find((s) => s.site === siteSel.value);
    const dOpt = el("option", "", "Whole site") as HTMLOptionElement;
    dOpt.value = "";
    deptSel.appendChild(dOpt);
    for (const dep of site?.departments ?? []) {
      const opt = el("option", "", dep.department) as HTMLOptionElement;
      opt.value = dep.department;
      if (keep && dep.department === d.org.department) opt.selected = true;
      deptSel.appendChild(opt);
    }
    rebuildArea(keep);
  };
  siteSel.addEventListener("change", () => rebuildOrg(false));
  deptSel.addEventListener("change", () => rebuildArea(false));
  rebuildOrg(true);
  const orgRow = el("div", "app-im-orgrow");
  orgRow.append(siteSel, deptSel, areaSel);
  orgCard.appendChild(row(field("Site · department · area", orgRow)));
  const primaryOrg = (): InitOrg => ({ company: o.siteCo[siteSel.value] ?? "", site: siteSel.value, department: deptSel.value, area: areaSel.value });
  // the fold: rarely touched, with an honest one-line summary; open by
  // default whenever it holds entries, so nothing set is ever hidden
  const fold = el("div", "app-if-fold");
  let foldOpen = d.alsoOrgs.length > 0;
  const foldBtn = btn("", "app-link app-if-foldbtn");
  const foldBody = el("div", "app-if-foldbody");
  const paintFold = () => {
    foldBtn.textContent = `${foldOpen ? "▾" : "▸"} Also shown in: ${alsoSummary(d.alsoOrgs)}`;
    foldBody.hidden = !foldOpen;
  };
  foldBtn.addEventListener("click", () => {
    foldOpen = !foldOpen;
    paintFold();
  });
  renderAlsoOrgs({ host: foldBody, sites: o.sites, siteCo: o.siteCo, list: d.alsoOrgs, primary: primaryOrg });
  new MutationObserver(() => paintFold()).observe(foldBody, { childList: true, subtree: true });
  paintFold();
  fold.append(foldBtn, foldBody);
  orgCard.appendChild(fold);

  // ---- Priorities & people ------------------------------------------------------
  const ppCard = group(
    "Priorities & people",
    o.mode === "create"
      ? "One priority is the primary — its charter and metric headline it. Standard roles pre-fill from the site's people (Settings → Improvement); adjust per initiative."
      : "One priority is the primary — its charter and metric headline it."
  );
  const links = d.priorities;
  const priBox = el("div", "app-im-links");
  const priAdd = btn("＋ Link a priority");
  const paintLinks = () => {
    clear(priBox);
    links.forEach((l, li) => {
      const chip = el("span", "app-im-link" + (l.primary ? " app-im-link-primary" : ""));
      chip.appendChild(el("span", undefined, (l.primary ? "★ " : "") + l.label));
      chip.title = l.primary ? "Primary" : "Click ★ to make primary";
      if (!l.primary) {
        const star = btn("★", "app-im-link-x");
        star.title = "Make primary";
        star.addEventListener("click", () => {
          links.forEach((x) => (x.primary = false));
          l.primary = true;
          paintLinks();
        });
        chip.appendChild(star);
      }
      if (!l.locked) {
        const x = btn("×", "app-im-link-x");
        x.title = "Unlink";
        x.addEventListener("click", () => {
          links.splice(li, 1);
          if (l.primary && links.length > 0) links[0].primary = true;
          paintLinks();
        });
        chip.appendChild(x);
      }
      priBox.appendChild(chip);
    });
    priBox.appendChild(priAdd);
  };
  priAdd.addEventListener("click", () => {
    void (async () => {
      const company = o.siteCo[siteSel.value] ?? "";
      const all = await o.loadPriorities(company).catch(() => [] as PriorityLite[]);
      // the initiative's org or above only (Ben, 2026-08-29)
      const at = orgRef(company, siteSel.value, deptSel.value, areaSel.value);
      const open = all.filter((p) => p.status === "active" && !links.some((l) => l.priorityId === p.id) && (sameOrg(p.org, at) || isDescendant(at, p.org)));
      document.querySelectorAll(".app-im-primenu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu app-im-primenu");
      if (open.length === 0) menu.appendChild(el("div", "app-cp-menu-h", "No open priorities at this org or above"));
      for (const g of groupPrioritiesForPicker(open, at)) {
        menu.appendChild(el("div", "app-cp-menu-h", g.label));
        for (const p of g.items) {
          const item = btn(p.statement.slice(0, 70), "app-cp-menu-item");
          item.addEventListener("click", () => {
            menu.remove();
            links.push({ priorityId: p.id, primary: links.length === 0, label: p.statement.slice(0, 40) });
            paintLinks();
          });
          menu.appendChild(item);
        }
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
  paintLinks();
  // chips that arrived as ids read their statements (best effort)
  if (links.some((l) => l.label === l.priorityId)) {
    void o
      .loadPriorities(o.siteCo[d.org.site] ?? "")
      .then((all) => {
        for (const l of links) l.label = all.find((p) => p.id === l.priorityId)?.statement.slice(0, 40) ?? l.label;
        paintLinks();
      })
      .catch(() => undefined);
  }
  ppCard.appendChild(row(field("Linked priorities", priBox)));

  const rolesBox = el("div", "app-im-roles");
  const paintRoles = () => {
    clear(rolesBox);
    for (const role of o.roleDefs) {
      const line = el("div", "app-im-rolerow");
      line.appendChild(el("span", "app-im-rolename", role.label));
      const std = o.imp.standardRoles.find((sr) => sr.key === role.key);
      if (std) {
        const fillers = roleFillersAt(std, siteSel.value);
        // create: the site's standard people pre-fill a role nobody has
        // touched; edit: they are offered as a hint only
        if (o.mode === "create" && !(role.key in d.roles) && fillers.length > 0) d.roles[role.key] = fillers.map((p) => ({ ...p }));
        else if (o.mode === "edit" && fillers.length > 0 && (d.roles[role.key] ?? []).length === 0) {
          line.appendChild(el("span", "app-field-hint", `site standard: ${fillers.map((p) => p.who).join(", ")}`));
        }
      }
      const people = d.roles[role.key] ?? [];
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
        add.title = `Add ${role.label.toLowerCase()}`;
        add.addEventListener("click", () => {
          void pickOwner(o.dialogHost, o.roster, null).then((res) => {
            if (res === null || res === "clear") return;
            const cur = d.roles[role.key] ?? [];
            if (cur.some((p) => p.whoId === res.whoId)) return;
            d.roles[role.key] = [...cur, { whoId: res.whoId, who: res.who }];
            paintRoles();
          });
        });
        line.appendChild(add);
      }
      rolesBox.appendChild(line);
    }
  };
  paintRoles();
  if (o.mode === "create") siteSel.addEventListener("change", paintRoles);
  ppCard.appendChild(row(field("Roles", rolesBox)));

  // ---- Details ------------------------------------------------------------------
  const controls = new Map<string, HTMLElement>();
  if (o.fields.length > 0) {
    const det = group("Details");
    for (const pair of pairFields(o.fields)) {
      det.appendChild(
        row(
          ...pair.map((cf) => {
            const ctl = fieldInput(cf, d.fieldValues[cf.key] ?? "", (raw) => (d.fieldValues[cf.key] = raw), o.fiCtx);
            controls.set(cf.key, ctl);
            return field(cf.label + (cf.required ? " ✱" : ""), ctl);
          })
        )
      );
    }
  }

  // ---- Metrics ------------------------------------------------------------------
  if (!o.singleAction) {
    const rule =
      o.metricRule === "fromTree"
        ? "This template requires metrics from the value driver tree."
        : o.metricRule === "atLeastOne"
          ? "This template asks for at least one metric."
          : "Optional — a driver the initiative moves, or a measure of its own.";
    const met = group("Metrics", `${rule} ★ = the primary; it headlines the register and the roll-up.${o.mode === "edit" ? " Own metrics can be linked or promoted into the value driver tree." : ""}`);
    const mBox = el("div");
    renderMetricsList({ host: mBox, metrics: d.metrics, site: () => siteSel.value, canPromote: o.canPromote, onLinked: o.onMetricLinked });
    met.appendChild(mBox);
  }

  // ---- Rules --------------------------------------------------------------------
  const rules = group("Rules");
  const rule = (label: string, checked: boolean, note: string): HTMLInputElement => {
    const wrap = el("div", "app-if-rule");
    const lab = el("label", "app-cp-cascade-row") as HTMLLabelElement;
    const cb = el("input") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = checked;
    lab.append(cb, el("span", undefined, label));
    wrap.append(lab, el("span", "app-field-hint", note));
    rules.appendChild(wrap);
    return cb;
  };
  const confCb = rule("Confidential", d.confidential, "Visible to its roles and the org's owners only.");
  const endorseCb = rule("Endorsement", d.endorsement, "An action closed by anyone else waits until the owner, the sponsor or an admin endorses it. Switching this off closes whatever is waiting.");

  const err = el("div", "app-cp-err", "");
  body.appendChild(err);

  const read = (): InitiativeDraft => ({
    title: title.value.trim(),
    description: desc.value.trim(),
    org: primaryOrg(),
    alsoOrgs: d.alsoOrgs.map((x) => ({ ...x })),
    priorities: links.map((l) => ({ ...l })),
    roles: Object.fromEntries(Object.entries(d.roles).map(([k, v]) => [k, v.map((p) => ({ ...p }))])),
    fieldValues: { ...d.fieldValues },
    metrics: normalizeMetrics(d.metrics.map((m) => ({ ...m }))),
    confidential: confCb.checked,
    endorsement: endorseCb.checked,
  });
  const reveal = (node: HTMLElement | null) => {
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    (node.matches("input, select, textarea, button") ? node : node.querySelector<HTMLElement>("input, select, textarea, button"))?.focus();
  };
  return {
    read,
    validate: () => {
      const v = read();
      const model = validateNewInitiative({ title: v.title, org: v.org, metrics: v.metrics, singleAction: o.singleAction, roles: v.roles }, o.metricRule).map((m) => `${groupFor(m)}: ${m}`);
      const missing = o.fields.filter((cf) => cf.required && isFieldEmpty(cf.kind, v.fieldValues[cf.key]));
      const msgs = [...model, ...missing.map((cf) => `Details: "${cf.label}" is needed.`)];
      err.textContent = msgs.join(" ");
      if (msgs.length > 0) {
        if (v.title === "") reveal(title);
        else if (model.some((m) => m.startsWith("Priorities"))) reveal(rolesBox);
        else if (missing.length > 0) reveal(controls.get(missing[0].key) ?? null);
        else if (model.some((m) => m.startsWith("Metrics"))) reveal(body.querySelector(".app-im-metricslist"));
      }
      return msgs;
    },
    showError: (message) => {
      err.textContent = message;
    },
    focus: () => title.focus(),
    site: () => siteSel.value,
  };
}
