// Settings — tabbed, role-gated (v2 slice 2). My profile for everyone;
// Users for admins (super admins assign roles). The bootstrap code path
// promotes to super admin ONLY while the org has none (see
// leanboard-v2-plan.md challenge #1) — the code is public knowledge the
// moment it ships in a client bundle, so the empty-org window is the
// only thing that makes it safe.

import { clear, el } from "../../../shared/ui/dom";
import { currentViewer, detectHost } from "../runtime";
import { listBoards, replicateBoard } from "../store/boards";
import {
  branding,
  meetingCategories,
  orgJson,
  saveMeetingCategories,
  protectedTimesJson,
  saveBranding,
  saveProtectedTimes,
  saveSiteDepartments,
  saveSiteSettings,
  siteSettings,
} from "../store/config";
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
      tabs.push({ key: "org", label: "Organisation", render: () => renderOrg(body, me) });
      tabs.push({ key: "boards", label: "Boards & meetings", render: () => renderBoardsAdmin(body, me) });
    }
    if (me.role === "superadmin") {
      tabs.push({ key: "brand", label: "Branding", render: () => renderBranding(body) });
    }
    if (!isAdmin) {
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

// ---- Organisation: site tree + site settings + protected times ----

interface OrgSiteNode {
  site: string;
  departments: { department: string; areas: string[] }[];
}

async function renderOrg(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";
  const tree = parseOrgTree(await orgJson()) as OrgSiteNode[];
  const sites = tree.map((s) => s.site);
  // site admins manage their own site only
  const editable = isSuper ? sites : sites.filter((s) => s === me.site);

  let currentSite = editable[0] ?? "";

  const picker = el("div", "app-settings-row");
  const siteSel = select(sites, currentSite);
  siteSel.addEventListener("change", () => {
    currentSite = siteSel.value;
    void renderSite();
  });
  picker.append(el("span", "app-settings-label", "Site"), siteSel);
  if (isSuper) {
    const newSite = el("input", "app-input") as HTMLInputElement;
    newSite.placeholder = "New site name";
    const addSite = el("button", "app-btn", "\uFF0B Add site") as HTMLButtonElement;
    addSite.addEventListener("click", () => {
      const name = newSite.value.trim();
      if (name === "" || name === "__app__") return;
      void saveSiteDepartments(name, "[]").then(() => renderOrg(body, me));
    });
    picker.append(newSite, addSite);
  }
  body.appendChild(picker);

  const siteBox = el("div", "app-settings-body");
  siteBox.style.boxShadow = "none";
  siteBox.style.padding = "0";
  body.appendChild(siteBox);

  const renderSite = async () => {
    clear(siteBox);
    if (currentSite === "") {
      siteBox.appendChild(el("div", "app-settings-note", "Add a site to begin."));
      return;
    }
    const canEdit = editable.includes(currentSite);
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
    siteBox.appendChild(sectionTitle("Departments & areas"));
    const treeBox = el("div", "app-org-tree");
    siteBox.appendChild(treeBox);
    const drawTree = () => {
      clear(treeBox);
      for (const d of node.departments) {
        const dr = el("div", "app-org-row app-org-dept");
        dr.appendChild(el("span", "app-org-site", d.department));
        if (canEdit) dr.appendChild(removeBtn(() => {
          node.departments = node.departments.filter((x) => x !== d);
          drawTree();
        }));
        treeBox.appendChild(dr);
        for (const a of d.areas) {
          const ar = el("div", "app-org-row app-org-area");
          ar.appendChild(el("span", "", a));
          if (canEdit) ar.appendChild(removeBtn(() => {
            d.areas = d.areas.filter((x) => x !== a);
            drawTree();
          }));
          treeBox.appendChild(ar);
        }
        if (canEdit) {
          const addA = adder("Add area", (v) => {
            d.areas.push(v);
            drawTree();
          });
          addA.classList.add("app-org-area");
          treeBox.appendChild(addA);
        }
      }
      if (canEdit) {
        treeBox.appendChild(adder("Add department", (v) => {
          node.departments.push({ department: v, areas: [] });
          drawTree();
        }));
      }
    };
    drawTree();

    // --- site settings ---
    siteBox.appendChild(sectionTitle("Site settings"));
    const tz = el("input", "app-input") as HTMLInputElement;
    tz.placeholder = "e.g. Australia/Brisbane";
    tz.value = s.timezone;
    tz.setAttribute("list", "app-tz-list");
    ensureTzDatalist();
    const accent = el("input", "app-input") as HTMLInputElement;
    accent.type = "color";
    accent.value = /^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : "#2563eb";
    const accentOn = el("input", "") as HTMLInputElement;
    accentOn.type = "checkbox";
    accentOn.checked = s.accent !== "";
    const accentWrap = el("span", "app-settings-row");
    accentWrap.append(accentOn, accent, el("span", "app-settings-note", "override app accent"));
    siteBox.append(row("Time zone", tz), row("Accent", accentWrap));

    // --- roster patterns ---
    siteBox.appendChild(sectionTitle("Shift roster patterns"));
    const patBox = el("div", "app-org-tree");
    siteBox.appendChild(patBox);
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
        });
        const r = el("div", "app-org-row");
        r.append(name, pattern, add);
        patBox.appendChild(r);
      }
    };
    drawPatterns();

    // --- protected times ---
    siteBox.appendChild(sectionTitle("Protected times"));
    const ptBox = el("div", "app-org-tree");
    siteBox.appendChild(ptBox);
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
        });
        const r = el("div", "app-org-row");
        r.append(label, days, start, end, add);
        ptBox.appendChild(r);
      }
    };
    drawTimes();

    // --- save ---
    if (canEdit) {
      const save = el("button", "app-btn", "Save site") as HTMLButtonElement;
      const note = el("span", "app-settings-note", "");
      save.addEventListener("click", () => {
        void (async () => {
          await saveSiteDepartments(currentSite, JSON.stringify(node.departments));
          await saveSiteSettings(currentSite, {
            timezone: tz.value.trim(),
            accent: accentOn.checked ? accent.value : "",
            rosterPatternsJson: JSON.stringify(patterns),
          });
          await saveProtectedTimes(currentSite, JSON.stringify(times));
          note.textContent = `saved ${new Date().toLocaleTimeString()}`;
        })();
      });
      const r = el("div", "app-settings-row");
      r.append(save, note);
      siteBox.appendChild(r);
    } else {
      siteBox.appendChild(
        el("div", "app-settings-note", "Read-only — this site is managed by its site admins.")
      );
    }
  };
  await renderSite();
}

function sectionTitle(text: string): HTMLElement {
  const t = el("div", "app-settings-label", text);
  t.style.width = "auto";
  t.style.marginTop = "12px";
  return t;
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

async function renderBranding(body: HTMLElement): Promise<void> {
  clear(body);
  const b = await branding();
  const name = el("input", "app-input") as HTMLInputElement;
  name.placeholder = "LeanBoard";
  name.value = b.appName;
  const accent = el("input", "app-input") as HTMLInputElement;
  accent.type = "color";
  accent.value = /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : "#2563eb";
  const accentOn = el("input", "") as HTMLInputElement;
  accentOn.type = "checkbox";
  accentOn.checked = b.accent !== "";
  const accentWrap = el("span", "app-settings-row");
  accentWrap.append(accentOn, accent, el("span", "app-settings-note", "override default blue"));

  let logo = b.logo;
  const preview = el("img", "app-logo") as HTMLImageElement;
  if (logo !== "") preview.src = logo;
  const file = el("input", "") as HTMLInputElement;
  file.type = "file";
  file.accept = "image/png,image/svg+xml,image/jpeg";
  const logoNote = el("span", "app-settings-note", "PNG/SVG, ≤150 KB");
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
    };
    reader.readAsDataURL(f);
  });
  const clearLogo = el("button", "app-btn", "Remove logo") as HTMLButtonElement;
  clearLogo.addEventListener("click", () => {
    logo = "";
    preview.removeAttribute("src");
    logoNote.textContent = "logo removed";
  });
  const logoWrap = el("span", "app-settings-row");
  logoWrap.append(file, clearLogo, preview, logoNote);

  const save = el("button", "app-btn", "Save branding") as HTMLButtonElement;
  const note = el("span", "app-settings-note", "");
  save.addEventListener("click", () => {
    void saveBranding({
      appName: name.value.trim(),
      logo,
      accent: accentOn.checked ? accent.value : "",
    }).then(() => {
      note.textContent = "saved — reload to see it applied";
    });
  });

  body.append(
    el("div", "app-settings-note", "Applies to everyone; site accents override the app accent."),
    row("App name", name),
    row("Accent", accentWrap),
    row("Logo", logoWrap),
    row("", save),
    note
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
