// Improvement — "Edit details…" for an existing initiative (the create
// flow's header form, pre-filled): title · org · linked priorities with
// one ★ primary · roles (template + standard, people pickers) · standard
// and template custom fields · metric targets · confidentiality · period.
// Saves back to the header row (and renames the initiative's board when
// the title changes); History gets an "edited" event. Reached from the
// Improvement row kebab and the board header's ⋮.

import { el, clear } from "../../../shared/ui/dom";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { improvementSettingsJson, orgJson, siteCompanies } from "../store/config";
import { listPeople } from "../store/people";
import { loadCascade } from "../store/priorities";
import { groupPrioritiesForPicker, isDescendant, orgRef, sameOrg } from "../priorities/model";
import { getTemplate } from "../store/templates";
import { appendInitiativeEvent, saveInitiative } from "../store/initiatives";
import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { eq, upsertWhere } from "../store/dv";
import { pickOwner } from "../priorities/dialogs";
import { Initiative, validateNewInitiative } from "./initiativeModel";
import { FieldKind, parseImprovementSettings, roleFillersAt, TemplateField, TemplateRole } from "./templateModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface EditDetailsOpts {
  host: HTMLElement;
  initiative: Initiative;
  actor: { whoId: string; who: string };
  onSaved: () => void;
}

export function openEditDetails(o: EditDetailsOpts): void {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal app-modal-wide app-im-create");
  overlay.appendChild(box);
  o.host.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  box.appendChild(el("div", "app-modal-title", "Edit details"));
  const body = el("div", "app-cp-modal-body");
  box.appendChild(body);
  body.appendChild(el("div", "app-settings-note", "Loading…"));

  void (async () => {
    const i = o.initiative;
    const [treeRaw, siteCo, roster, impRaw, template] = await Promise.all([
      orgJson(),
      siteCompanies(),
      listPeople(),
      improvementSettingsJson(),
      i.templateId !== "" ? getTemplate(i.templateId).catch(() => null) : Promise.resolve(null),
    ]);
    clear(body);
    const sites = parseOrgTree(treeRaw);
    const imp = parseImprovementSettings(impRaw);

    const field = (label: string, control: HTMLElement, hint?: string) => {
      const fEl = el("div", "app-field");
      fEl.append(el("span", "app-field-label", label), control);
      if (hint) fEl.appendChild(el("span", "app-field-hint", hint));
      body.appendChild(fEl);
    };

    // title + description + period
    const title = el("input", "app-input") as HTMLInputElement;
    title.value = i.title;
    field("Title", title);
    const desc = el("textarea", "app-input") as HTMLTextAreaElement;
    desc.rows = 2;
    desc.value = i.description;
    field("Description", desc);
    const period = el("input", "app-input app-pr-short") as HTMLInputElement;
    period.value = i.period;
    field("Period", period);

    // org selects, pre-filled
    const siteSel = el("select", "app-input") as HTMLSelectElement;
    for (const s of sites) {
      const opt = el("option", "", s.site) as HTMLOptionElement;
      opt.value = s.site;
      if (s.site === i.org.site) opt.selected = true;
      siteSel.appendChild(opt);
    }
    const deptSel = el("select", "app-input") as HTMLSelectElement;
    const areaSel = el("select", "app-input") as HTMLSelectElement;
    const rebuildOrg = (keep: boolean) => {
      clear(deptSel);
      const site = sites.find((s) => s.site === siteSel.value);
      const dOpt = el("option", "", "Whole site") as HTMLOptionElement;
      dOpt.value = "";
      deptSel.appendChild(dOpt);
      for (const d of site?.departments ?? []) {
        const opt = el("option", "", d.department) as HTMLOptionElement;
        opt.value = d.department;
        if (keep && d.department === i.org.department) opt.selected = true;
        deptSel.appendChild(opt);
      }
      rebuildArea(keep);
    };
    const rebuildArea = (keep: boolean) => {
      clear(areaSel);
      const site = sites.find((s) => s.site === siteSel.value);
      const d = site?.departments.find((x) => x.department === deptSel.value);
      const aOpt = el("option", "", "Whole department") as HTMLOptionElement;
      aOpt.value = "";
      areaSel.appendChild(aOpt);
      for (const a of d?.areas ?? []) {
        const opt = el("option", "", a) as HTMLOptionElement;
        opt.value = a;
        if (keep && a === i.org.area) opt.selected = true;
        areaSel.appendChild(opt);
      }
    };
    siteSel.addEventListener("change", () => rebuildOrg(false));
    deptSel.addEventListener("change", () => rebuildArea(false));
    rebuildOrg(true);
    const orgRow = el("div", "app-im-orgrow");
    orgRow.append(siteSel, deptSel, areaSel);
    field("Organisation", orgRow);

    // linked priorities: pre-filled with real statements
    const links: { priorityId: string; primary: boolean; label: string }[] = i.priorities.map((l) => ({ ...l, label: l.priorityId }));
    const priBox = el("div", "app-im-links");
    const priAdd = btn("＋ Link a priority");
    const paintLinks = () => {
      clear(priBox);
      links.forEach((l, li) => {
        const chip = el("span", "app-im-link" + (l.primary ? " app-im-link-primary" : ""));
        chip.appendChild(el("span", undefined, (l.primary ? "★ " : "") + l.label));
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
        const x = btn("×", "app-im-link-x");
        x.addEventListener("click", () => {
          links.splice(li, 1);
          if (l.primary && links.length > 0) links[0].primary = true;
          paintLinks();
        });
        chip.appendChild(x);
        priBox.appendChild(chip);
      });
      priBox.appendChild(priAdd);
    };
    priAdd.addEventListener("click", () => {
      void (async () => {
        const company = siteCo[siteSel.value] ?? "";
        const data = await loadCascade(company);
        // the initiative's org or above only (Ben, 2026-08-29)
        const at = orgRef(company, siteSel.value, deptSel.value, areaSel.value);
        const open = data.priorities.filter(
          (p) => p.status === "active" && !links.some((l) => l.priorityId === p.id) && (sameOrg(p.org, at) || isDescendant(at, p.org))
        );
        if (open.length === 0) return;
        const menu = el("div", "app-cp-menu app-im-primenu");
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
    void (async () => {
      // resolve statements for the chips (best effort)
      try {
        const company = siteCo[i.org.site] ?? "";
        const data = await loadCascade(company);
        for (const l of links) l.label = data.priorities.find((p) => p.id === l.priorityId)?.statement.slice(0, 40) ?? l.label;
        paintLinks();
      } catch {
        /* ids stay as labels */
      }
    })();
    field("Linked priorities", priBox, "One is the primary — its charter and metric headline the priority.");

    // roles: template roles when the template survives, else the roles the
    // initiative carries (snapshot labels)
    const roleDefs: TemplateRole[] =
      template?.roles ??
      Object.keys({ ...i.snapshot.roleLabels, ...i.roles }).map((key) => ({
        key,
        label: i.snapshot.roleLabels[key] ?? key,
        standard: true,
        multi: true,
        timeCommitment: false,
      }));
    const rolePeople: Record<string, { whoId: string; who: string }[]> = Object.fromEntries(
      Object.entries(i.roles).map(([k, v]) => [k, v.map((p) => ({ ...p }))])
    );
    const rolesBox = el("div", "app-im-roles");
    const paintRoles = () => {
      clear(rolesBox);
      for (const role of roleDefs) {
        const line = el("div", "app-im-rolerow");
        line.appendChild(el("span", "app-im-rolename", role.label));
        const std = imp.standardRoles.find((sr) => sr.key === role.key);
        if (std) {
          const fillers = roleFillersAt(std, siteSel.value);
          if (fillers.length > 0 && (rolePeople[role.key] ?? []).length === 0) {
            const hint = el("span", "app-field-hint", `site standard: ${fillers.map((p) => p.who).join(", ")}`);
            line.appendChild(hint);
          }
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
            void pickOwner(o.host, roster, null).then((res) => {
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
    field("Roles", rolesBox);

    // custom fields (standard + template), pre-filled
    const fieldValues: Record<string, string> = { ...i.fieldValues };
    const allFields: TemplateField[] = [...imp.standardFields, ...(template?.fields ?? [])];
    for (const cf of allFields) {
      const cur = fieldValues[cf.key] ?? "";
      if (cf.kind === "picklist") {
        const sel = el("select", "app-input") as HTMLSelectElement;
        const blank = el("option", "", cf.required ? "Choose…" : "—") as HTMLOptionElement;
        blank.value = "";
        sel.appendChild(blank);
        for (const opt of cf.options) {
          const oEl = el("option", "", opt) as HTMLOptionElement;
          oEl.value = opt;
          if (opt === cur) oEl.selected = true;
          sel.appendChild(oEl);
        }
        sel.addEventListener("change", () => (fieldValues[cf.key] = sel.value));
        field(cf.label + (cf.required ? " *" : ""), sel);
      } else if ((cf.kind as FieldKind) === "longtext") {
        const ta = el("textarea", "app-input") as HTMLTextAreaElement;
        ta.rows = 3;
        ta.value = cur;
        ta.addEventListener("change", () => (fieldValues[cf.key] = ta.value.trim()));
        field(cf.label + (cf.required ? " *" : ""), ta);
      } else {
        const inp = el("input", "app-input") as HTMLInputElement;
        inp.type = cf.kind === "number" ? "number" : cf.kind === "date" ? "date" : "text";
        inp.value = cur;
        inp.addEventListener("change", () => (fieldValues[cf.key] = inp.value.trim()));
        field(cf.label + (cf.required ? " *" : ""), inp);
      }
    }

    // metric targets (definitions read-only)
    const metrics = i.metrics.map((m) => ({ ...m }));
    if (metrics.length > 0) {
      const mBox = el("div", "app-im-metrics");
      for (const m of metrics) {
        const line = el("div", "app-im-rolerow");
        line.appendChild(el("span", "app-im-rolename", `${m.name}${m.unit ? ` (${m.unit})` : ""}`));
        const tgt = el("input", "app-input app-im-target") as HTMLInputElement;
        tgt.type = "number";
        tgt.value = m.target === null ? "" : String(m.target);
        tgt.addEventListener("change", () => {
          const n = Number(tgt.value);
          m.target = tgt.value === "" || !Number.isFinite(n) ? null : n;
        });
        line.appendChild(tgt);
            const linkB = el("button", "app-link app-im-metriclink", m.driverId ? `⛓ linked · ${m.driverLink ?? "drives"}` : "⛓ Link to a value driver") as HTMLButtonElement;
            linkB.type = "button";
            linkB.addEventListener("click", () => {
              void import("./vdt/linkPicker").then(async ({ openDriverLinkPicker }) => {
                const r = await openDriverLinkPicker(document.body, siteSel.value, { name: m.name, unit: m.unit }, m.driverId ? { driverId: m.driverId, mode: m.driverLink ?? "drives" } : null);
                if (r === null) return;
                if (r === "clear") {
                  delete m.driverId;
                  delete m.driverLink;
                } else {
                  m.driverId = r.driverId;
                  m.driverLink = r.mode;
                }
                linkB.textContent = m.driverId ? `⛓ linked · ${m.driverLink ?? "drives"}` : "⛓ Link to a value driver";
              });
            });
            line.appendChild(linkB);
        mBox.appendChild(line);
      }
      field("Metric targets", mBox, "The definitions come from the template; the seeded KPI card's in-card target wins for colour when set. ⛓ links a metric to the site's value driver tree.");
    }

    // confidential
    const conf = el("label", "app-cp-cascade-row") as HTMLLabelElement;
    const confCb = el("input") as HTMLInputElement;
    confCb.type = "checkbox";
    confCb.checked = i.confidential;
    conf.append(confCb, el("span", undefined, "Confidential — visible to its roles and org owners only"));
    body.appendChild(conf);

    const err = el("div", "app-cp-err", "");
    body.appendChild(err);
    const footer = el("div", "app-modal-footer");
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", close);
    const save = btn("Save details", "app-btn app-btn-primary");
    save.addEventListener("click", () => {
      void (async () => {
        const next: Initiative = {
          ...i,
          title: title.value.trim(),
          description: desc.value.trim(),
          period: period.value.trim(),
          org: { company: siteCo[siteSel.value] ?? "", site: siteSel.value, department: deptSel.value, area: areaSel.value },
          confidential: confCb.checked,
          roles: rolePeople,
          priorities: links.map((l) => ({ priorityId: l.priorityId, primary: l.primary })),
          fieldValues,
          metrics,
        };
        const errs = validateNewInitiative({ title: next.title, org: next.org, metrics, singleAction: i.singleAction, roles: rolePeople });
        const missingReq = allFields.filter((cf) => cf.required && !(fieldValues[cf.key] ?? "").trim()).map((cf) => `"${cf.label}" is needed.`);
        const allErrs = [...errs, ...missingReq];
        if (allErrs.length > 0) {
          err.textContent = allErrs.join(" ");
          return;
        }
        save.disabled = true;
        Object.assign(i, next);
        await saveInitiative(i);
        // the board carries the title as its name — keep them together
        if (i.boardId !== "" && i.title !== "") {
          await upsertWhere(
            Ben_ltkboardsService,
            eq("ben_boardid", i.boardId),
            (row) => row.ben_ltkboardid,
            { ben_boardid: i.boardId, ben_name: i.title }
          ).catch(() => undefined);
        }
        await appendInitiativeEvent(i, "edited", { fields: "details" }, o.actor);
        close();
        o.onSaved();
      })().catch((e) => {
        err.textContent = e instanceof Error ? e.message : String(e);
        save.disabled = false;
      });
    });
    footer.append(cancel, save);
    box.appendChild(footer);
    title.focus();
  })().catch((e) => {
    clear(body);
    body.appendChild(el("div", "app-board-note", `Could not load: ${e instanceof Error ? e.message : String(e)}`));
  });
}
