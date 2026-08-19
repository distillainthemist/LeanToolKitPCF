// Cascaded priorities — the dialogs (design spec §9 add/edit priority,
// §2.1 org picker, §2.2 edit vision). Centred app modals; the reason
// dialogs and the cascade review list arrive with P2.

import { el, clear } from "../../../shared/ui/dom";
import type { PersonRef } from "../store/config";
import type { RosterPerson } from "../store/mappers";
import {
  OrgRef,
  orgKey,
  orgLevel,
  orgName,
  orgRef,
  Pillar,
  Priority,
  strategyChips,
} from "./model";

/** The org tree as the screen sees it (from the site-settings rows). */
export interface OrgTree {
  companies: { name: string; sites: { name: string; departments: { name: string; areas: string[] }[] }[] }[];
}

export function orgTreeNodes(tree: OrgTree): OrgRef[] {
  const out: OrgRef[] = [];
  for (const c of tree.companies) {
    out.push(orgRef(c.name));
    for (const s of c.sites) {
      out.push(orgRef(c.name, s.name));
      for (const d of s.departments) {
        out.push(orgRef(c.name, s.name, d.name));
        for (const a of d.areas) out.push(orgRef(c.name, s.name, d.name, a));
      }
    }
  }
  return out;
}

/** Children of a node in the tree. */
export function childOrgs(tree: OrgTree, o: OrgRef): OrgRef[] {
  const co = tree.companies.find((c) => c.name === o.company);
  if (!co) return [];
  switch (orgLevel(o)) {
    case "company":
      return co.sites.map((s) => orgRef(o.company, s.name));
    case "site": {
      const s = co.sites.find((x) => x.name === o.site);
      return (s?.departments ?? []).map((d) => orgRef(o.company, o.site, d.name));
    }
    case "department": {
      const s = co.sites.find((x) => x.name === o.site);
      const d = s?.departments.find((x) => x.name === o.department);
      return (d?.areas ?? []).map((a) => orgRef(o.company, o.site, o.department, a));
    }
    default:
      return [];
  }
}

/** Siblings of a node (including itself), for the breadcrumb dropdowns. */
export function siblingOrgs(tree: OrgTree, o: OrgRef): OrgRef[] {
  const level = orgLevel(o);
  if (level === "company") return tree.companies.map((c) => orgRef(c.name));
  const parent =
    level === "site"
      ? orgRef(o.company)
      : level === "department"
        ? orgRef(o.company, o.site)
        : orgRef(o.company, o.site, o.department);
  return childOrgs(tree, parent);
}

// ---- generic modal plumbing -----------------------------------------------

export interface ModalHandle {
  overlay: HTMLElement;
  box: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

export function modal(host: HTMLElement, title: string, note?: string, wide = false): ModalHandle {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal" + (wide ? " app-modal-wide" : ""));
  box.appendChild(el("div", "app-modal-title", title));
  if (note) box.appendChild(el("div", "app-modal-note", note));
  const body = el("div", "app-cp-modal-body");
  const footer = el("div", "app-modal-footer");
  box.append(body, footer);
  overlay.appendChild(box);
  host.appendChild(overlay);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  return { overlay, box, body, footer, close };
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const f = el("div", "app-field");
  f.append(el("span", "app-field-label", label), control);
  if (hint) f.appendChild(el("span", "app-field-hint", hint));
  return f;
}

// ---- org picker (design spec §2.1: the DMS-style tree, for far jumps) --------

export function pickOrg(host: HTMLElement, tree: OrgTree, current: OrgRef): Promise<OrgRef | null> {
  return new Promise((resolve) => {
    const m = modal(host, "Go to an organisation", "Company, sites, departments and areas.");
    const list = el("div", "app-cp-orgtree");
    const done = (o: OrgRef | null) => {
      m.close();
      resolve(o);
    };
    const row = (o: OrgRef, depth: number) => {
      const b = el("button", "app-cp-orgtree-row" + (orgKey(o) === orgKey(current) ? " app-cp-orgtree-on" : "")) as HTMLButtonElement;
      b.type = "button";
      b.style.paddingLeft = `${10 + depth * 18}px`;
      b.textContent = orgName(o);
      b.addEventListener("click", () => done(o));
      list.appendChild(b);
    };
    for (const c of tree.companies) {
      row(orgRef(c.name), 0);
      for (const s of c.sites) {
        row(orgRef(c.name, s.name), 1);
        for (const d of s.departments) {
          row(orgRef(c.name, s.name, d.name), 2);
          for (const a of d.areas) row(orgRef(c.name, s.name, d.name, a), 3);
        }
      }
    }
    m.body.appendChild(list);
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => done(null));
    m.footer.appendChild(cancel);
  });
}

// ---- edit vision ---------------------------------------------------------------

export function editVision(host: HTMLElement, org: OrgRef, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const m = modal(host, `Vision — ${orgName(org)}`, "Shown as the band across the top of this org's priorities.");
    const ta = el("textarea", "app-input app-cp-vision-ta") as HTMLTextAreaElement;
    ta.rows = 3;
    ta.value = current;
    m.body.appendChild(ta);
    const done = (v: string | null) => {
      m.close();
      resolve(v);
    };
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => done(null));
    const save = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
    save.type = "button";
    save.addEventListener("click", () => done(ta.value.trim()));
    m.footer.append(cancel, save);
    ta.focus();
  });
}

// ---- pick a person (owner) ---------------------------------------------------

export function pickOwner(host: HTMLElement, roster: RosterPerson[], current: PersonRef | null): Promise<PersonRef | null | "clear"> {
  return new Promise((resolve) => {
    const m = modal(host, "Choose the owner", "The person accountable for this priority.");
    const filter = el("input", "app-input") as HTMLInputElement;
    filter.type = "search";
    filter.placeholder = "Filter people…";
    const list = el("div", "app-cp-people");
    const paint = () => {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      const hits = roster
        .filter((p) => p.active !== false && (q === "" || p.who.toLowerCase().includes(q)))
        .slice(0, 40);
      for (const p of hits) {
        const b = el("button", "app-cp-person" + (current?.whoId === p.whoId ? " app-cp-person-on" : "")) as HTMLButtonElement;
        b.type = "button";
        b.textContent = p.who;
        b.addEventListener("click", () => {
          m.close();
          resolve({ whoId: p.whoId, who: p.who });
        });
        list.appendChild(b);
      }
      if (hits.length === 0) list.appendChild(el("div", "app-settings-note", "No one matches."));
    };
    filter.addEventListener("input", paint);
    paint();
    m.body.append(filter, list);
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      m.close();
      resolve(null);
    });
    m.footer.appendChild(cancel);
    if (current) {
      const clr = el("button", "app-btn", "Clear owner") as HTMLButtonElement;
      clr.type = "button";
      clr.addEventListener("click", () => {
        m.close();
        resolve("clear");
      });
      m.footer.appendChild(clr);
    }
    filter.focus();
  });
}

// ---- add / edit priority (design spec §9) -----------------------------------

export interface PriorityDialogOpts {
  host: HTMLElement;
  title: string;
  priority: Priority; // a copy the dialog mutates
  pillars: Pillar[];
  /** Pre-select this sub-pillar (the column last interacted with). */
  preselectPillarId?: string;
  periods: string[]; // current + neighbours, for the select
  roster: RosterPerson[];
  /** Cascade targets on offer: children of the org + peers, each with its
   *  owner's name for the row ("Warehouse · K. Lowe"). */
  cascadeTargets: { org: OrgRef; ownerName: string }[];
  /** Orgs already cascaded to (shown ticked and locked). */
  alreadyCascaded: OrgRef[];
  primaryInitiativeLabel: string; // "" = none yet
}

export interface PriorityDialogResult {
  priority: Priority;
  cascadeTo: OrgRef[];
}

export function priorityDialog(o: PriorityDialogOpts): Promise<PriorityDialogResult | null> {
  return new Promise((resolve) => {
    const m = modal(o.host, o.title, undefined, false);
    const p = o.priority;

    const statement = el("textarea", "app-input app-cp-statement") as HTMLTextAreaElement;
    statement.rows = 3;
    statement.placeholder = "What must this org achieve? One short statement.";
    statement.value = p.statement;
    statement.spellcheck = true;

    // pillar: sub-pillars grouped under their pillars
    const pillar = el("select", "app-input") as HTMLSelectElement;
    const none = el("option", "", "Choose a sub-pillar…") as HTMLOptionElement;
    none.value = "";
    pillar.appendChild(none);
    for (const l1 of strategyChips(o.pillars)) {
      const group = el("optgroup") as HTMLOptGroupElement;
      group.label = l1.name;
      const subs = o.pillars.filter((x) => x.level === 2 && x.parentId === l1.id && x.active).sort((a, b) => a.order - b.order);
      for (const s of subs) {
        const opt = el("option", "", s.name) as HTMLOptionElement;
        opt.value = s.id;
        if (s.id === (p.pillarId || o.preselectPillarId)) opt.selected = true;
        group.appendChild(opt);
      }
      pillar.appendChild(group);
    }

    // owner
    let owner: PersonRef | null = p.ownerId !== "" ? { whoId: p.ownerId, who: p.ownerName } : null;
    const ownerRow = el("div", "app-cp-ownerrow");
    const ownerName = el("span", "app-cp-ownername", "");
    const ownerBtn = el("button", "app-btn", "Choose…") as HTMLButtonElement;
    ownerBtn.type = "button";
    const paintOwner = () => {
      ownerName.textContent = owner ? owner.who : "No owner";
      ownerName.classList.toggle("app-cp-muted", !owner);
    };
    ownerBtn.addEventListener("click", () => {
      void pickOwner(o.host, o.roster, owner).then((r) => {
        if (r === null) return;
        owner = r === "clear" ? null : r;
        paintOwner();
      });
    });
    paintOwner();
    ownerRow.append(ownerName, ownerBtn);

    // period
    const period = el("select", "app-input") as HTMLSelectElement;
    const periods = o.periods.includes(p.period) || p.period === "" ? o.periods : [p.period, ...o.periods];
    for (const per of periods) {
      const opt = el("option", "", per) as HTMLOptionElement;
      opt.value = per;
      if (per === p.period) opt.selected = true;
      period.appendChild(opt);
    }

    // primary initiative (initiatives arrive with P5)
    const primary = el("div", "app-cp-muted", o.primaryInitiativeLabel !== "" ? o.primaryInitiativeLabel : "None yet — link one when initiatives exist.");

    // cascade to
    const cascadeBox = el("div", "app-cp-cascade");
    const picked = new Set<string>();
    const already = new Set(o.alreadyCascaded.map(orgKey));
    for (const t of o.cascadeTargets) {
      const key = orgKey(t.org);
      const lab = el("label", "app-cp-cascade-row") as HTMLLabelElement;
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      if (already.has(key)) {
        cb.checked = true;
        cb.disabled = true;
      }
      cb.addEventListener("change", () => {
        if (cb.checked) picked.add(key);
        else picked.delete(key);
        paintConfirm();
      });
      lab.append(
        cb,
        el("span", "app-cp-cascade-org", orgName(t.org)),
        el("span", "app-cp-muted", t.ownerName !== "" ? ` · ${t.ownerName}` : " · no owner")
      );
      cascadeBox.appendChild(lab);
    }
    if (o.cascadeTargets.length === 0) {
      cascadeBox.appendChild(el("div", "app-cp-muted", "No child or peer orgs to cascade to from here."));
    }
    const confirm = el("div", "app-cp-confirm", "");
    const paintConfirm = () => {
      const n = picked.size;
      confirm.textContent = n > 0 ? `This will send the priority to ${n} org${n === 1 ? "" : "s"} for acceptance.` : "";
    };

    const notes = el("textarea", "app-input") as HTMLTextAreaElement;
    notes.rows = 2;
    notes.value = p.notes;
    notes.placeholder = "Optional notes";

    m.body.append(
      field("Statement", statement),
      field("Sub-pillar", pillar),
      field("Owner", ownerRow),
      field("Period", period),
      field("Primary initiative", primary),
      field("Cascade to", cascadeBox, "Child orgs and peers. Each receives it as a request to accept."),
      confirm,
      field("Notes", notes)
    );

    const err = el("div", "app-cp-err", "");
    m.body.appendChild(err);

    const done = (r: PriorityDialogResult | null) => {
      m.close();
      resolve(r);
    };
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => done(null));
    const save = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
    save.type = "button";
    save.addEventListener("click", () => {
      const st = statement.value.trim();
      if (st === "") {
        err.textContent = "A statement is needed.";
        statement.focus();
        return;
      }
      if (pillar.value === "") {
        err.textContent = "Choose a sub-pillar — it decides the column.";
        pillar.focus();
        return;
      }
      p.statement = st;
      p.pillarId = pillar.value;
      p.ownerId = owner?.whoId ?? "";
      p.ownerName = owner?.who ?? "";
      p.period = period.value;
      p.notes = notes.value.trim();
      done({
        priority: p,
        cascadeTo: o.cascadeTargets.map((t) => t.org).filter((org) => picked.has(orgKey(org))),
      });
    });
    m.footer.append(cancel, save);
    statement.focus();
  });
}
