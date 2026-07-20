// Settings — tabbed, role-gated (v2 slice 2). My profile for everyone;
// Users for admins (super admins assign roles). The bootstrap code path
// promotes to super admin ONLY while the org has none (see
// leanboard-v2-plan.md challenge #1) — the code is public knowledge the
// moment it ships in a client bundle, so the empty-org window is the
// only thing that makes it safe.

import { clear, el } from "../../../shared/ui/dom";
import { setLeaveGuard } from "../navGuard";
import { currentViewer, detectHost } from "../runtime";
import { listBoards, replicateBoard } from "../store/boards";
import {
  APP_ROW,
  branding,
  companies,
  meetingCategories,
  orgJson,
  saveCompanies,
  saveMeetingCategories,
  protectedTimesJson,
  saveBranding,
  saveProtectedTimes,
  saveSiteCompany,
  saveSiteDepartments,
  saveSiteSettings,
  siteCompanies,
  siteSettings,
} from "../store/config";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { RosterPerson } from "../store/mappers";
import {
  DirectoryProfile,
  directoryProfile,
  listPeople,
  superAdminExists,
  upsertPerson,
  viewerPerson,
} from "../store/people";

const BOOTSTRAP_CODE = "Taiichi_Ohno_1943";
const ROLES = ["user", "siteadmin", "superadmin"] as const;

/** Friendly label + one-line description for each role. */
const ROLE_META: Record<string, { label: string; blurb: string }> = {
  user: {
    label: "User",
    blurb: "Runs meetings and manages their own actions. No admin settings.",
  },
  siteadmin: {
    label: "Site admin",
    blurb:
      "Everything a user can do, plus manages their own site: its departments, meetings, boards and people.",
  },
  superadmin: {
    label: "Super admin",
    blurb:
      "Full control across every site — users, roles, organisation, categories and app branding.",
  },
};
const roleLabel = (role: string) => ROLE_META[role]?.label ?? role;

/**
 * Passed to the editable tabs so they can flag unsaved edits and expose a
 * save. The orchestrator shows a prominent save bar while dirty and, on
 * tab switch, prompts to save or discard rather than silently losing work.
 */
interface DirtyCtx {
  markDirty: () => void;
  markClean: () => void;
  /** The current tab's save; re-registered whenever the tab re-renders. */
  registerSave: (fn: () => Promise<void>) => void;
  isDirty: () => boolean;
  saveCurrent: () => Promise<void>;
}

export function mountSettings(parent: HTMLElement): () => void {
  let cleanup: () => void = () => undefined;
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
    const saveBar = el("div", "app-save-bar");
    const body = el("div", "app-settings-body");
    wrap.append(tabsBar, saveBar, body);

    // ---- unsaved-changes tracking ----
    let dirty = false;
    let saveFn: (() => Promise<void>) | null = null;
    const resetDirty = () => {
      dirty = false;
      saveFn = null;
      paintSaveBar();
    };
    const ctx: DirtyCtx = {
      markDirty: () => {
        dirty = true;
        paintSaveBar();
      },
      markClean: () => {
        dirty = false;
        paintSaveBar();
      },
      registerSave: (fn) => {
        saveFn = fn;
      },
      isDirty: () => dirty,
      saveCurrent: async () => {
        if (saveFn) await saveFn();
      },
    };

    const saveMsg = el("span", "app-save-bar-msg", "You have unsaved changes.");
    const saveBtn = el("button", "app-btn app-btn-primary", "Save now") as HTMLButtonElement;
    const discardBtn = el("button", "app-btn", "Discard") as HTMLButtonElement;
    saveBar.append(saveMsg, el("span", "app-bar-gap"), discardBtn, saveBtn);
    saveBtn.addEventListener("click", () => {
      void (async () => {
        if (saveFn) await saveFn();
      })();
    });
    discardBtn.addEventListener("click", () => {
      void (async () => {
        resetDirty();
        clear(body);
        await tabByKey(current).render();
      })();
    });

    const paintSaveBar = () => {
      saveBar.classList.toggle("app-save-bar-on", dirty);
      for (const btn of Array.from(tabsBar.querySelectorAll("button"))) {
        btn.classList.toggle(
          "app-settings-tab-dirty",
          dirty && btn.dataset.key === current
        );
      }
    };

    const isAdmin = me.role === "superadmin" || me.role === "siteadmin";
    const tabs: { key: string; label: string; render: () => Promise<void> }[] = [
      { key: "profile", label: "My profile", render: () => renderProfile(body, me, ctx) },
    ];
    if (isAdmin) {
      tabs.push({ key: "users", label: "Users", render: () => renderUsers(body, me) });
      tabs.push({ key: "org", label: "Organisation", render: () => renderOrg(body, me, ctx) });
      tabs.push({ key: "boards", label: "Boards & meetings", render: () => renderBoardsAdmin(body, me) });
    }
    if (me.role === "superadmin") {
      tabs.push({ key: "brand", label: "Branding", render: () => renderBranding(body, ctx) });
    }
    if (!isAdmin) {
      tabs.push({ key: "request", label: "Request admin", render: () => renderRequest(body, me) });
    }
    const tabByKey = (key: string) => tabs.find((t) => t.key === key) ?? tabs[0];

    let current = tabs[0].key;
    const switchTo = async (key: string) => {
      if (key === current) return;
      if (dirty) {
        const choice = await promptUnsaved();
        if (choice === "cancel") return;
        if (choice === "save" && saveFn) await saveFn();
      }
      resetDirty();
      current = key;
      renderTabs();
      clear(body);
      await tabByKey(key).render();
    };
    const renderTabs = () => {
      clear(tabsBar);
      for (const t of tabs) {
        const btn = el("button", "app-settings-tab", t.label) as HTMLButtonElement;
        btn.dataset.key = t.key;
        if (t.key === current) btn.classList.add("app-settings-tab-on");
        btn.addEventListener("click", () => void switchTo(t.key));
        tabsBar.appendChild(btn);
      }
      paintSaveBar();
    };
    renderTabs();
    await tabByKey(current).render();

    // leaving the whole Settings screen (header links, any route change)
    // goes through the same save/discard prompt as a tab switch
    setLeaveGuard(async () => {
      if (!dirty) return true;
      const choice = await promptUnsaved();
      if (choice === "cancel") return false;
      if (choice === "save" && saveFn) await saveFn();
      return true;
    });

    // safety net for a full reload / tab close while dirty (best-effort;
    // some hosts ignore beforeunload inside an iframe)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanup = () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setLeaveGuard(null);
    };
  })();
  return () => cleanup();
}

/** Save / Discard / Cancel prompt for leaving a tab with unsaved edits. */
function promptUnsaved(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    box.append(
      el("div", "app-modal-title", "Unsaved changes"),
      el(
        "div",
        "app-modal-note",
        "You've made changes on this tab that haven't been saved. Save them before leaving, or discard them?"
      )
    );
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    const discard = el("button", "app-btn app-btn-danger", "Discard") as HTMLButtonElement;
    const save = el("button", "app-btn app-btn-primary", "Save changes") as HTMLButtonElement;
    footer.append(cancel, discard, save);
    box.appendChild(footer);
    const done = (r: "save" | "discard" | "cancel") => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done("cancel");
      }
    };
    cancel.addEventListener("click", () => done("cancel"));
    discard.addEventListener("click", () => done("discard"));
    save.addEventListener("click", () => done("save"));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
  });
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = el("div", "app-settings-row");
  r.append(el("span", "app-settings-label", label), control);
  return r;
}

/** A stacked form field: caption above the control, optional hint below. */
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const f = el("div", "app-field");
  f.append(el("span", "app-field-label", label), control);
  if (hint) f.appendChild(el("span", "app-field-hint", hint));
  return f;
}

/**
 * Accent picker: an "override" checkbox paired with a colour swatch. The
 * swatch is disabled until the override is ticked; value() is "" when off.
 */
function accentToggle(
  current: string,
  onChange: () => void
): { el: HTMLElement; value: () => string } {
  const on = el("input") as HTMLInputElement;
  on.type = "checkbox";
  on.checked = current !== "";
  const swatch = el("input", "app-color") as HTMLInputElement;
  swatch.type = "color";
  swatch.value = /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#2563eb";
  swatch.disabled = !on.checked;
  const check = el("label", "app-check");
  check.append(on, document.createTextNode("Override with"));
  const wrap = el("div", "app-accent-group");
  wrap.append(check, swatch);
  on.addEventListener("change", () => {
    swatch.disabled = !on.checked;
    onChange();
  });
  swatch.addEventListener("input", () => onChange());
  return { el: wrap, value: () => (on.checked ? swatch.value : "") };
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
async function renderProfile(
  body: HTMLElement,
  me: RosterPerson,
  ctx: DirtyCtx
): Promise<void> {
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
    ctx.markDirty();
  });
  dept.addEventListener("change", () => {
    rebuild(area, areasFor(site.value, dept.value));
    ctx.markDirty();
  });
  area.addEventListener("change", () => ctx.markDirty());

  const doSave = async () => {
    await upsertPerson({
      ...me,
      site: site.value,
      department: dept.value,
      area: area.value,
    });
    me.site = site.value;
    me.department = dept.value;
    me.area = area.value;
    ctx.markClean();
  };
  ctx.registerSave(doSave);

  const head = el("div", "app-profile-head");
  head.append(
    el("span", "app-profile-name", me.who),
    el("span", `app-role-badge app-role-${me.role}`, roleLabel(me.role))
  );

  body.append(
    head,
    el("div", "app-field-hint", me.email || "no email on file"),
    el(
      "div",
      "app-settings-note",
      "Set where you sit so your meetings and actions find you — changes save from the bar above."
    ),
    field("Site", site),
    field("Department", dept),
    field("Area", area)
  );
}

/** Users: search + site/role filters, role + site assignment. */
async function renderUsers(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const canEdit = me.role === "superadmin";
  if (!canEdit) {
    body.appendChild(
      el("div", "app-settings-note", "Site admins can view the roster; role and site changes need a super admin.")
    );
  }
  const sites = parseOrgTree(await orgJson()).map((s) => s.site);
  const people = await listPeople(true);

  // directory reads (job title + account status) are lazy and cached, so
  // re-filtering never refetches and large rosters aren't hit all at once
  const dirResolved = new Map<string, DirectoryProfile>();
  const dirInflight = new Map<string, Promise<DirectoryProfile>>();
  const dir = {
    get: (whoId: string) => dirResolved.get(whoId),
    load: (whoId: string) => {
      if (dirResolved.has(whoId)) return Promise.resolve(dirResolved.get(whoId)!);
      let pr = dirInflight.get(whoId);
      if (!pr) {
        pr = directoryProfile(whoId).then((d) => {
          dirResolved.set(whoId, d);
          dirInflight.delete(whoId);
          return d;
        });
        dirInflight.set(whoId, pr);
      }
      return pr;
    },
  };

  // --- filter bar: search, site, role, status ---
  let query = "";
  let siteFilter = "";
  let roleFilter = "";
  let statusFilter = "";

  const search = el("input", "app-input") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search name, email or job title";
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  });
  const siteSel = labelledFilter("Any site", sites.map((s) => ({ value: s, label: s })));
  siteSel.addEventListener("change", () => {
    siteFilter = siteSel.value;
    draw();
  });
  const roleSel = labelledFilter(
    "Any role",
    ROLES.map((rk) => ({ value: rk, label: roleLabel(rk) }))
  );
  roleSel.addEventListener("change", () => {
    roleFilter = roleSel.value;
    draw();
  });
  const statusSel = labelledFilter("Any status", [
    { value: "active", label: "Active" },
    { value: "revoked", label: "Revoked" },
  ]);
  statusSel.addEventListener("change", () => {
    statusFilter = statusSel.value;
    draw();
  });
  const bar = el("div", "app-settings-row app-users-filters");
  bar.append(search, siteSel, roleSel, statusSel);
  body.appendChild(bar);

  const count = el("div", "app-settings-note", "");
  body.appendChild(count);
  const list = el("div", "app-people-list");
  body.appendChild(list);
  body.appendChild(roleLegend());

  const draw = () => {
    clear(list);
    const shown = people.filter((p) => {
      if (siteFilter !== "" && p.site !== siteFilter) return false;
      if (roleFilter !== "" && p.role !== roleFilter) return false;
      if (statusFilter === "active" && !p.active) return false;
      if (statusFilter === "revoked" && p.active) return false;
      if (query !== "") {
        const title = dir.get(p.whoId)?.jobTitle ?? "";
        const hay = `${p.who} ${p.email} ${title}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    const revoked = people.filter((p) => !p.active).length;
    count.textContent =
      `${shown.length} of ${people.length} ${people.length === 1 ? "person" : "people"}` +
      (revoked > 0 ? ` · ${revoked} revoked` : "");
    for (const p of shown) list.appendChild(userRow(p, sites, canEdit, me, dir, draw));
    if (shown.length === 0) {
      list.appendChild(el("div", "app-settings-note", "No users match those filters."));
    }
  };
  draw();
}

interface DirectoryLookup {
  get: (whoId: string) => DirectoryProfile | undefined;
  load: (whoId: string) => Promise<DirectoryProfile>;
}

/** A "Any …" default option followed by {value,label} choices. */
function labelledFilter(
  placeholder: string,
  options: { value: string; label: string }[]
): HTMLSelectElement {
  const s = el("select", "app-input") as HTMLSelectElement;
  const any = el("option", "", placeholder) as HTMLOptionElement;
  any.value = "";
  s.appendChild(any);
  for (const o of options) {
    const opt = el("option", "", o.label) as HTMLOptionElement;
    opt.value = o.value;
    s.appendChild(opt);
  }
  return s;
}

/** Role picker with friendly labels (no blank option). */
function roleSelect(value: string): HTMLSelectElement {
  const s = el("select", "app-input") as HTMLSelectElement;
  for (const rk of ROLES) {
    const opt = el("option", "", roleLabel(rk)) as HTMLOptionElement;
    opt.value = rk;
    if (rk === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

/** A control preceded by a small caption ("Site", "Role"). */
function labelledControl(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "app-user-field");
  wrap.append(el("span", "app-user-field-label", label), control);
  return wrap;
}

/** The three role definitions, shown under the roster as a key. */
function roleLegend(): HTMLElement {
  const box = el("div", "app-role-legend");
  box.appendChild(el("div", "app-user-field-label", "What the roles mean"));
  for (const rk of ROLES) {
    const item = el("div", "app-role-legend-item");
    item.append(
      el("span", `app-role-badge app-role-${rk}`, roleLabel(rk)),
      el("span", "app-role-legend-blurb", ROLE_META[rk].blurb)
    );
    box.appendChild(item);
  }
  return box;
}

/** One roster row: identity + status, job title, and labelled controls. */
function userRow(
  p: RosterPerson,
  sites: string[],
  canEdit: boolean,
  me: RosterPerson,
  dir: DirectoryLookup,
  onChanged: () => void
): HTMLElement {
  const r = el("div", "app-user-row");
  if (!p.active) r.classList.add("app-user-revoked");

  const main = el("div", "app-user-main");
  const nameLine = el("div", "app-user-nameline");
  const roleBadge = el("span", `app-role-badge app-role-${p.role}`, roleLabel(p.role));
  const statusBadge = el(
    "span",
    `app-status-badge app-status-${p.active ? "active" : "revoked"}`,
    p.active ? "Active" : "Revoked"
  );
  nameLine.append(el("span", "app-people-name", p.who), roleBadge, statusBadge);

  // job title + directory account status, filled once the directory read
  // resolves (Office 365 Users). A missing/disabled account is surfaced.
  const titleLine = el("div", "app-user-title", "…");
  const emailLine = el("div", "app-user-email", p.email || "no email on file");
  main.append(nameLine, titleLine, emailLine);
  r.appendChild(main);

  const paintDirectory = (d: DirectoryProfile) => {
    if (!d.found) {
      titleLine.textContent = "No directory account (removed from Entra)";
      titleLine.classList.add("app-user-dirwarn");
    } else if (!d.accountEnabled) {
      titleLine.textContent =
        (d.jobTitle ? `${d.jobTitle} · ` : "") + "Entra account disabled";
      titleLine.classList.add("app-user-dirwarn");
    } else {
      titleLine.textContent = d.jobTitle || "No job title set";
      titleLine.classList.toggle("app-settings-note", d.jobTitle === "");
    }
  };
  const cached = dir.get(p.whoId);
  if (cached) paintDirectory(cached);
  else void dir.load(p.whoId).then(paintDirectory);

  const controls = el("div", "app-user-controls");
  // editable site (clearing department/area when the site changes so a
  // stale sub-placement can't outlive its site)
  const site = select(sites, p.site);
  site.value = p.site;
  site.disabled = !canEdit;
  site.addEventListener("change", () => {
    if (site.value !== p.site) {
      p.department = "";
      p.area = "";
    }
    p.site = site.value;
    void upsertPerson({ ...p });
  });
  const role = roleSelect(p.role);
  role.disabled = !canEdit || p.whoId === me.whoId; // no self-demotion footguns
  role.addEventListener("change", () => {
    p.role = role.value || "user";
    roleBadge.textContent = roleLabel(p.role);
    roleBadge.className = `app-role-badge app-role-${p.role}`;
    void upsertPerson({ ...p });
  });
  controls.append(labelledControl("Site", site), labelledControl("Role", role));

  // revoke / restore app access (removes them from meeting rosters and
  // people pickers while keeping the row so it can be restored)
  if (canEdit && p.whoId !== me.whoId) {
    const access = el(
      "button",
      `app-btn ${p.active ? "app-btn-danger" : ""}`,
      p.active ? "Revoke access" : "Restore access"
    ) as HTMLButtonElement;
    access.addEventListener("click", () => {
      p.active = !p.active;
      void upsertPerson({ ...p }).then(onChanged); // re-filter (status may change)
    });
    controls.append(labelledControl("Access", access));
  }

  r.appendChild(controls);
  return r;
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

// ---- Organisation: site tree + site settings + protected times ----

interface OrgSiteNode {
  site: string;
  departments: { department: string; areas: string[] }[];
}

async function renderOrg(
  body: HTMLElement,
  me: RosterPerson,
  ctx: DirtyCtx
): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";
  const tree = parseOrgTree(await orgJson()) as OrgSiteNode[];
  const sites = tree.map((s) => s.site);
  const companyList = await companies();
  const siteCompany = await siteCompanies();
  // every admin sees the whole org; site admins edit their own site only
  const editable = isSuper ? sites : sites.filter((s) => s === me.site);

  let currentSite = editable[0] ?? sites[0] ?? "";

  // switching site (or adding one) discards the current site's edits \u2014
  // gate it through the same save/discard prompt as a tab switch
  const guardLeave = async (): Promise<boolean> => {
    if (!ctx.isDirty()) return true;
    const choice = await promptUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save") await ctx.saveCurrent();
    return true;
  };

  // two panes: company \u2192 site browser on the left, site editor right
  const split = el("div", "app-org-split");
  const rail = el("div", "app-org-rail");
  const pane = el("div", "app-org-pane");
  split.append(rail, pane);
  body.appendChild(split);

  const selectSite = (site: string) => {
    void (async () => {
      if (site === currentSite) return;
      if (!(await guardLeave())) return;
      currentSite = site;
      renderRail();
      await renderSite();
    })();
  };

  const renderRail = () => {
    clear(rail);
    const groups: { company: string; sites: string[] }[] = companyList.map(
      (c) => ({ company: c, sites: [] })
    );
    const unassigned: string[] = [];
    for (const site of sites) {
      const g = groups.find((x) => x.company === (siteCompany[site] ?? ""));
      if (g) g.sites.push(site);
      else unassigned.push(site);
    }
    if (unassigned.length > 0 || groups.length === 0) {
      groups.push({ company: "", sites: unassigned });
    }
    for (const g of groups) {
      rail.appendChild(
        el(
          "div",
          "app-org-company",
          g.company === "" ? (companyList.length > 0 ? "No company" : "Sites") : g.company
        )
      );
      for (const site of g.sites) {
        const item = el("button", "app-org-siteitem") as HTMLButtonElement;
        if (site === currentSite) item.classList.add("app-org-siteitem-on");
        const deptCount = tree.find((t) => t.site === site)?.departments.length ?? 0;
        item.append(
          el("span", "app-org-sitename", site),
          el(
            "span",
            "app-org-sitemeta",
            `${deptCount} department${deptCount === 1 ? "" : "s"}` +
              (editable.includes(site) ? "" : " \u00B7 view only")
          )
        );
        item.addEventListener("click", () => selectSite(site));
        rail.appendChild(item);
      }
      if (g.sites.length === 0) {
        rail.appendChild(el("div", "app-org-empty", "No sites yet"));
      }
      if (isSuper && g.company !== "") {
        const addSite = el("button", "app-org-add", "\uFF0B Add site") as HTMLButtonElement;
        addSite.addEventListener("click", () => {
          const name = (window.prompt(`New site under ${g.company}:`) ?? "").trim();
          if (name === "" || name === APP_ROW || sites.includes(name)) return;
          void (async () => {
            if (!(await guardLeave())) return;
            await saveSiteDepartments(name, "[]");
            await saveSiteCompany(name, g.company);
            await renderOrg(body, me, ctx);
          })();
        });
        rail.appendChild(addSite);
      }
    }
    if (isSuper) {
      const addCo = el("button", "app-org-add app-org-addco", "\uFF0B Add company") as HTMLButtonElement;
      addCo.addEventListener("click", () => {
        const name = (window.prompt("New company name:") ?? "").trim();
        if (name === "" || companyList.includes(name)) return;
        void (async () => {
          if (!(await guardLeave())) return;
          await saveCompanies([...companyList, name]);
          await renderOrg(body, me, ctx);
        })();
      });
      rail.appendChild(addCo);
    }
  };
  renderRail();

  const renderSite = async () => {
    clear(pane);
    ctx.markClean(); // freshly loaded from the store
    if (currentSite === "") {
      pane.appendChild(
        el(
          "div",
          "app-settings-note",
          isSuper
            ? "Add a company, then a site under it to begin."
            : "No sites yet \u2014 ask a super admin to add one."
        )
      );
      return;
    }
    const canEdit = editable.includes(currentSite);

    // heading + company assignment
    const head = el("div", "app-org-panehead");
    head.appendChild(el("span", "app-profile-name", currentSite));
    if (!canEdit) {
      head.appendChild(el("span", "app-status-badge app-status-revoked", "View only"));
    }
    pane.appendChild(head);
    const companySel = labelledFilter(
      "No company",
      companyList.map((c) => ({ value: c, label: c }))
    );
    companySel.value = siteCompany[currentSite] ?? "";
    companySel.disabled = !isSuper;
    companySel.addEventListener("change", () => ctx.markDirty());
    pane.appendChild(
      field(
        "Company",
        companySel,
        isSuper ? undefined : "Only super admins move sites between companies"
      )
    );
    const node = tree.find((s) => s.site === currentSite) ?? {
      site: currentSite,
      departments: [],
    };
    const s = await siteSettings(currentSite);
    const times = JSON.parse(await protectedTimesJson(currentSite)) as {
      label?: string;
      color?: string;
      days?: string;
      start?: string;
      end?: string;
    }[];
    let patterns: { name: string; pattern: string }[] = [];
    try {
      const arr = JSON.parse(s.rosterPatternsJson || "[]");
      if (Array.isArray(arr)) patterns = arr;
    } catch { /* fresh */ }

    // --- departments & areas tree ---
    pane.appendChild(sectionTitle("Departments & areas"));
    const treeBox = el("div", "app-org-tree");
    pane.appendChild(treeBox);
    const drawTree = () => {
      clear(treeBox);
      for (const d of node.departments) {
        const dr = el("div", "app-org-row app-org-dept");
        dr.appendChild(el("span", "app-org-site", d.department));
        if (canEdit) dr.appendChild(removeBtn(() => {
          node.departments = node.departments.filter((x) => x !== d);
          drawTree();
          ctx.markDirty();
        }));
        treeBox.appendChild(dr);
        for (const a of d.areas) {
          const ar = el("div", "app-org-row app-org-area");
          ar.appendChild(el("span", "", a));
          if (canEdit) ar.appendChild(removeBtn(() => {
            d.areas = d.areas.filter((x) => x !== a);
            drawTree();
            ctx.markDirty();
          }));
          treeBox.appendChild(ar);
        }
        if (canEdit) {
          const addA = adder("Add area", (v) => {
            d.areas.push(v);
            drawTree();
            ctx.markDirty();
          });
          addA.classList.add("app-org-area");
          treeBox.appendChild(addA);
        }
      }
      if (canEdit) {
        treeBox.appendChild(adder("Add department", (v) => {
          node.departments.push({ department: v, areas: [] });
          drawTree();
          ctx.markDirty();
        }));
      }
    };
    drawTree();

    // --- site settings ---
    pane.appendChild(sectionTitle("Site settings"));
    const tz = el("input", "app-input") as HTMLInputElement;
    tz.placeholder = "e.g. Australia/Brisbane";
    tz.value = s.timezone;
    tz.setAttribute("list", "app-tz-list");
    tz.disabled = !canEdit;
    ensureTzDatalist();
    tz.addEventListener("input", () => ctx.markDirty());
    const accentGroup = accentToggle(s.accent, () => ctx.markDirty());
    pane.append(
      field("Time zone", tz, "IANA zone — sets how occurrence times display"),
      field("Accent colour", accentGroup.el, "Overrides the app accent for this site")
    );

    // --- roster patterns ---
    pane.appendChild(sectionTitle("Shift roster patterns"));
    const patBox = el("div", "app-org-tree");
    pane.appendChild(patBox);
    const drawPatterns = () => {
      clear(patBox);
      for (const pat of patterns) {
        const r = el("div", "app-org-row");
        r.append(
          el("span", "app-org-site", pat.name),
          el("span", "app-settings-note", pat.pattern)
        );
        if (canEdit) r.appendChild(removeBtn(() => {
          patterns = patterns.filter((x) => x !== pat);
          drawPatterns();
          ctx.markDirty();
        }));
        patBox.appendChild(r);
      }
      if (canEdit) {
        const name = el("input", "app-input") as HTMLInputElement;
        name.placeholder = "Name (e.g. 4-crew rotating)";
        const pattern = el("input", "app-input") as HTMLInputElement;
        pattern.placeholder = "Pattern (e.g. 2D-2N-4O)";
        const add = el("button", "app-btn", "\uFF0B") as HTMLButtonElement;
        add.addEventListener("click", () => {
          if (name.value.trim() === "" || pattern.value.trim() === "") return;
          patterns.push({ name: name.value.trim(), pattern: pattern.value.trim().toUpperCase() });
          drawPatterns();
          ctx.markDirty();
        });
        const r = el("div", "app-org-row");
        r.append(name, pattern, add);
        patBox.appendChild(r);
      }
    };
    drawPatterns();

    // --- protected times ---
    pane.appendChild(sectionTitle("Protected times"));
    const ptBox = el("div", "app-org-tree");
    pane.appendChild(ptBox);
    const drawTimes = () => {
      clear(ptBox);
      for (const pt of times) {
        const r = el("div", "app-org-row");
        r.append(
          el("span", "app-org-site", pt.label ?? ""),
          el("span", "app-settings-note", `${pt.days ?? "all days"} ${pt.start ?? ""}\u2013${pt.end ?? ""}`)
        );
        if (canEdit) r.appendChild(removeBtn(() => {
          times.splice(times.indexOf(pt), 1);
          drawTimes();
          ctx.markDirty();
        }));
        ptBox.appendChild(r);
      }
      if (canEdit) {
        const label = el("input", "app-input") as HTMLInputElement;
        label.placeholder = "Label";
        const days = el("input", "app-input") as HTMLInputElement;
        days.placeholder = "Days (e.g. Mon-Fri)";
        days.style.width = "120px";
        const start = el("input", "app-input") as HTMLInputElement;
        start.type = "time";
        const end = el("input", "app-input") as HTMLInputElement;
        end.type = "time";
        const add = el("button", "app-btn", "\uFF0B") as HTMLButtonElement;
        add.addEventListener("click", () => {
          if (label.value.trim() === "" || start.value === "" || end.value === "") return;
          times.push({ label: label.value.trim(), days: days.value.trim(), start: start.value, end: end.value });
          drawTimes();
          ctx.markDirty();
        });
        const r = el("div", "app-org-row");
        r.append(label, days, start, end, add);
        ptBox.appendChild(r);
      }
    };
    drawTimes();

    // --- save (via the unsaved-changes bar) ---
    if (canEdit) {
      ctx.registerSave(async () => {
        await saveSiteDepartments(currentSite, JSON.stringify(node.departments));
        await saveSiteSettings(currentSite, {
          timezone: tz.value.trim(),
          accent: accentGroup.value(),
          rosterPatternsJson: JSON.stringify(patterns),
        });
        await saveProtectedTimes(currentSite, JSON.stringify(times));
        if (isSuper) {
          await saveSiteCompany(currentSite, companySel.value);
          siteCompany[currentSite] = companySel.value; // rail regroups on next paint
          renderRail();
        }
        ctx.markClean();
      });
    } else {
      pane.appendChild(
        el("div", "app-settings-note", "Read-only — this site is managed by its site admins.")
      );
    }
  };
  await renderSite();
}

function sectionTitle(text: string): HTMLElement {
  return el("div", "app-section", text);
}

function removeBtn(onClick: () => void): HTMLButtonElement {
  const b = el("button", "app-org-x", "\u00d7") as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

function adder(placeholder: string, onAdd: (v: string) => void): HTMLElement {
  const r = el("div", "app-org-row");
  const input = el("input", "app-input") as HTMLInputElement;
  input.placeholder = placeholder;
  const b = el("button", "app-btn", "\uFF0B") as HTMLButtonElement;
  b.addEventListener("click", () => {
    const v = input.value.trim();
    if (v !== "") onAdd(v);
  });
  r.append(input, b);
  return r;
}

function ensureTzDatalist(): void {
  if (document.getElementById("app-tz-list")) return;
  const dl = document.createElement("datalist");
  dl.id = "app-tz-list";
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  for (const z of zones) {
    const o = document.createElement("option");
    o.value = z;
    dl.appendChild(o);
  }
  document.body.appendChild(dl);
}

// ---- Branding (super admins) ----

async function renderBranding(body: HTMLElement, ctx: DirtyCtx): Promise<void> {
  clear(body);
  const b = await branding();
  const name = el("input", "app-input") as HTMLInputElement;
  name.placeholder = "LeanBoard";
  name.value = b.appName;
  name.addEventListener("input", () => ctx.markDirty());
  const accentGroup = accentToggle(b.accent, () => ctx.markDirty());

  let logo = b.logo;
  const preview = el("img", "app-logo app-logo-preview") as HTMLImageElement;
  if (logo !== "") preview.src = logo;
  const file = el("input", "app-file") as HTMLInputElement;
  file.type = "file";
  file.accept = "image/png,image/svg+xml,image/jpeg";
  const logoNote = el("span", "app-field-hint", "");
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 150_000) {
      logoNote.textContent = "Too big — keep the logo under 150 KB.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      logo = String(reader.result ?? "");
      preview.src = logo;
      logoNote.textContent = f.name;
      ctx.markDirty();
    };
    reader.readAsDataURL(f);
  });
  const clearLogo = el("button", "app-btn", "Remove") as HTMLButtonElement;
  clearLogo.addEventListener("click", () => {
    logo = "";
    preview.removeAttribute("src");
    logoNote.textContent = "logo removed";
    ctx.markDirty();
  });
  const logoWrap = el("div", "app-logo-row");
  logoWrap.append(preview, file, clearLogo);

  ctx.registerSave(async () => {
    await saveBranding({
      appName: name.value.trim(),
      logo,
      accent: accentGroup.value(),
    });
    ctx.markClean();
  });

  body.append(
    el(
      "div",
      "app-settings-note",
      "Applies to everyone; site accents override the app accent. Changes take effect after a reload."
    ),
    field("App name", name),
    field("Accent colour", accentGroup.el, "Overrides the default blue"),
    field("Logo", logoWrap, "PNG or SVG, ≤150 KB"),
    logoNote
  );
}

// ---- Boards & meetings (admins): categories, create, edit, replicate ----

async function renderBoardsAdmin(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";

  // categories (super admins manage the app-wide list)
  body.appendChild(sectionTitle("Meeting categories"));
  let cats = await meetingCategories();
  const catBox = el("div", "app-org-tree");
  body.appendChild(catBox);
  const drawCats = () => {
    clear(catBox);
    const rowEl = el("div", "app-org-row");
    for (const c of cats) {
      const chip = el("span", "app-btn", c);
      if (isSuper) {
        const x = removeBtn(() => {
          cats = cats.filter((v) => v !== c);
          void saveMeetingCategories(cats).then(drawCats);
        });
        chip.appendChild(x);
      }
      rowEl.appendChild(chip);
    }
    catBox.appendChild(rowEl);
    if (isSuper) {
      catBox.appendChild(
        adder("Add category", (v) => {
          if (!cats.includes(v)) {
            cats.push(v);
            void saveMeetingCategories(cats).then(drawCats);
          }
        })
      );
    } else if (cats.length === 0) {
      catBox.appendChild(el("div", "app-settings-note", "No categories defined yet."));
    }
  };
  drawCats();

  // boards: create / edit / replicate / configure
  body.appendChild(sectionTitle("Boards"));
  const newBtn = el("a", "app-btn", "\uFF0B New meeting") as HTMLAnchorElement;
  newBtn.href = "#/wizard";
  body.appendChild(newBtn);

  const list = el("div", "app-org-tree");
  body.appendChild(list);
  const boards = await listBoards();
  for (const b of boards) {
    const r = el("div", "app-org-row");
    r.append(
      el("span", "app-people-name", b.name),
      el("span", "app-people-meta", [b.category, b.site, b.department].filter(Boolean).join(" \u00b7 "))
    );
    const open = el("a", "app-btn", "Open") as HTMLAnchorElement;
    open.href = `#/board/${b.boardId}`;
    const edit = el("a", "app-btn", "Edit meeting") as HTMLAnchorElement;
    edit.href = `#/wizard/${b.boardId}`;
    const setup = el("a", "app-btn", "Board setup") as HTMLAnchorElement;
    setup.href = `#/setup/${b.boardId}`;
    const rep = el("button", "app-btn", "Replicate") as HTMLButtonElement;
    rep.addEventListener("click", () => {
      const name = window.prompt(`Replicate "${b.name}" as:`, `${b.name} (copy)`);
      if (!name || name.trim() === "") return;
      void replicateBoard(b.boardId, name.trim()).then((newId) => {
        window.location.hash = `#/wizard/${newId}`;
      });
    });
    r.append(open, edit, setup, rep);
    list.appendChild(r);
  }
}
