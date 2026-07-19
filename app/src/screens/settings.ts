// Settings — tabbed, role-gated (v2 slice 2). My profile for everyone;
// Users for admins (super admins assign roles). The bootstrap code path
// promotes to super admin ONLY while the org has none (see
// leanboard-v2-plan.md challenge #1) — the code is public knowledge the
// moment it ships in a client bundle, so the empty-org window is the
// only thing that makes it safe.

import { clear, el } from "../../../shared/ui/dom";
import { currentViewer, detectHost } from "../runtime";
import { orgJson } from "../store/config";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { RosterPerson } from "../store/mappers";
import {
  listPeople,
  superAdminExists,
  upsertPerson,
  viewerPerson,
} from "../store/people";

const BOOTSTRAP_CODE = "Taiichi_Ohno_1943";
const ROLES = ["user", "siteadmin", "superadmin"] as const;

export function mountSettings(parent: HTMLElement): () => void {
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(el("div", "app-board-note", "Settings needs the Power Apps host."));
      return;
    }
    const viewer = currentViewer()!;
    const me = await viewerPerson(viewer.objectId);
    if (!me) {
      parent.appendChild(el("p", "app-missing", "Open My day once to register, then return."));
      return;
    }

    const wrap = el("div", "app-settings");
    parent.appendChild(wrap);
    const tabsBar = el("div", "app-settings-tabs");
    const body = el("div", "app-settings-body");
    wrap.append(tabsBar, body);

    const isAdmin = me.role === "superadmin" || me.role === "siteadmin";
    const tabs: { key: string; label: string; render: () => Promise<void> }[] = [
      { key: "profile", label: "My profile", render: () => renderProfile(body, me) },
    ];
    if (isAdmin) {
      tabs.push({ key: "users", label: "Users", render: () => renderUsers(body, me) });
    } else {
      tabs.push({ key: "request", label: "Request admin", render: () => renderRequest(body, me) });
    }

    let current = tabs[0].key;
    const renderTabs = () => {
      clear(tabsBar);
      for (const t of tabs) {
        const btn = el("button", "app-settings-tab", t.label) as HTMLButtonElement;
        if (t.key === current) btn.classList.add("app-settings-tab-on");
        btn.addEventListener("click", () => {
          current = t.key;
          renderTabs();
          clear(body);
          void t.render();
        });
        tabsBar.appendChild(btn);
      }
    };
    renderTabs();
    void tabs[0].render();
  })();
  return () => undefined;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = el("div", "app-settings-row");
  r.append(el("span", "app-settings-label", label), control);
  return r;
}

function select(options: string[], value: string): HTMLSelectElement {
  const s = el("select", "app-input") as HTMLSelectElement;
  for (const o of ["", ...options.filter((v) => v !== "")]) {
    const opt = el("option", "", o === "" ? "—" : o) as HTMLOptionElement;
    opt.value = o;
    s.appendChild(opt);
  }
  s.value = options.includes(value) ? value : value === "" ? "" : value;
  if (value !== "" && !options.includes(value)) {
    const opt = el("option", "", value) as HTMLOptionElement;
    opt.value = value;
    s.appendChild(opt);
    s.value = value;
  }
  return s;
}

/** My profile: site → department → area from the org tree. */
async function renderProfile(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const tree = parseOrgTree(await orgJson());
  const sites = tree.map((s) => s.site);
  const deptsFor = (site: string) =>
    tree.find((s) => s.site === site)?.departments.map((d) => d.department) ?? [];
  const areasFor = (site: string, dept: string) =>
    tree
      .find((s) => s.site === site)
      ?.departments.find((d) => d.department === dept)?.areas ?? [];

  const site = select(sites, me.site);
  const dept = select(deptsFor(me.site), me.department);
  const area = select(areasFor(me.site, me.department), me.area);
  const rebuild = (sel: HTMLSelectElement, opts: string[]) => {
    const v = sel.value;
    sel.replaceChildren();
    for (const o of ["", ...opts]) {
      const opt = el("option", "", o === "" ? "—" : o) as HTMLOptionElement;
      opt.value = o;
      sel.appendChild(opt);
    }
    sel.value = opts.includes(v) ? v : "";
  };
  site.addEventListener("change", () => {
    rebuild(dept, deptsFor(site.value));
    rebuild(area, []);
  });
  dept.addEventListener("change", () => rebuild(area, areasFor(site.value, dept.value)));

  const save = el("button", "app-btn", "Save") as HTMLButtonElement;
  const note = el("span", "app-settings-note", "");
  save.addEventListener("click", () => {
    void upsertPerson({
      ...me,
      site: site.value,
      department: dept.value,
      area: area.value,
    }).then(() => {
      me.site = site.value;
      me.department = dept.value;
      me.area = area.value;
      note.textContent = `saved ${new Date().toLocaleTimeString()}`;
    });
  });

  body.append(
    el("div", "app-settings-note", `${me.who} · ${me.email || "no email"} · role: ${me.role}`),
    row("Site", site),
    row("Department", dept),
    row("Area", area),
    row("", save),
    note
  );
}

/** Users: role + site assignment (super admins edit; site admins view). */
async function renderUsers(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const canEdit = me.role === "superadmin";
  if (!canEdit) {
    body.appendChild(
      el("div", "app-settings-note", "Site admins can view the roster; role changes need a super admin.")
    );
  }
  const people = await listPeople(true);
  for (const p of people) {
    const r = el("div", "app-settings-row");
    r.append(
      el("span", "app-people-name", p.who),
      el("span", "app-people-meta", [p.email, p.site, p.department].filter(Boolean).join(" · "))
    );
    const role = select([...ROLES], p.role);
    role.value = p.role;
    role.disabled = !canEdit || p.whoId === me.whoId; // no self-demotion footguns
    role.addEventListener("change", () => {
      void upsertPerson({ ...p, role: role.value || "user" });
    });
    r.appendChild(role);
    body.appendChild(r);
  }
}

/** Request admin: the one-time bootstrap path (only while no super admin). */
async function renderRequest(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const open = !(await superAdminExists());
  if (!open) {
    body.appendChild(
      el(
        "div",
        "app-settings-note",
        "Ask an existing super admin to grant you a role (Settings → Users)."
      )
    );
    return;
  }
  body.appendChild(
    el("div", "app-settings-note", "Initial setup: enter the setup code to become the first super admin.")
  );
  const code = el("input", "app-input") as HTMLInputElement;
  code.type = "password";
  code.placeholder = "Setup code";
  const go = el("button", "app-btn", "Submit") as HTMLButtonElement;
  const note = el("span", "app-settings-note", "");
  go.addEventListener("click", () => {
    void (async () => {
      // re-check at submit time: first-in wins, the window then closes
      if (await superAdminExists()) {
        note.textContent = "A super admin already exists — the setup window has closed.";
        return;
      }
      if (code.value !== BOOTSTRAP_CODE) {
        note.textContent = "That code is not recognised.";
        return;
      }
      await upsertPerson({ ...me, role: "superadmin" });
      note.textContent = "You are now the super admin. Reload to see the admin tabs.";
    })();
  });
  body.append(row("Setup code", code), row("", go), note);
}
