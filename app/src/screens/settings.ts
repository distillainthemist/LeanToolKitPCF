// Settings — tabbed, role-gated (v2 slice 2). My profile for everyone;
// Users for admins (super admins assign roles). The bootstrap code path
// promotes to super admin ONLY while the org has none (see
// leanboard-v2-plan.md challenge #1) — the code is public knowledge the
// moment it ships in a client bundle, so the empty-org window is the
// only thing that makes it safe.

import { copyText } from "../../../shared/ui/clipboard";
import { clear, el } from "../../../shared/ui/dom";
import { boardHash, boardUrl } from "../links";
import { setLeaveGuard } from "../navGuard";
import { promptText, promptUnsaved } from "../prompts";
import { currentViewer, detectHost } from "../runtime";
import { EmulatedRole, effectivePerson, setViewAsRole, viewAsRole } from "../viewAs";
import {
  accessGroup,
  isGroupOwner,
  listCandidateGroups,
  saveAccessGroup,
  syncAllAccess,
  SyncReport,
} from "../store/accessGroup";
import {
  isConfidentialBoard,
  listBoards,
  renameBoardsDepartment,
  renameBoardsSite,
  replicateBoard,
  setBoardArchived,
} from "../store/boards";
import {
  allSiteOwners,
  APP_ROW,
  branding,
  companies,
  companyOwners,
  meetingCategories,
  orgJson,
  PersonRef,
  renameCompany,
  renameSiteRow,
  rosterPatternLibrary,
  saveCompanies,
  saveCompanyOwners,
  saveMeetingCategories,
  protectedTimesJson,
  saveBranding,
  saveProtectedTimes,
  saveSiteCompany,
  saveSiteDepartments,
  saveSiteOwners,
  saveSiteSettings,
  siteCompanies,
  siteSettings,
  SiteRosterPattern,
} from "../store/config";
import { parseMeetingInfo, parseOrgTree } from "../../../shared/schema/meeting";
import {
  crewStateOn,
  parseCategory,
  parseDaysOfWeek,
  parseLocalDate,
  parseRosterPattern,
  startOfDay,
} from "../../../shared/schema/recurrence";
import { RosterPerson } from "../store/mappers";
import {
  DirectoryProfile,
  directoryProfile,
  listPeople,
  searchEntra,
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

export function mountSettings(parent: HTMLElement, initialTab = ""): () => void {
  let cleanup: () => void = () => undefined;
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(el("div", "app-board-note", "Settings needs the Power Apps host."));
      return;
    }
    const viewer = currentViewer()!;
    const stored = await viewerPerson(viewer.objectId);
    if (!stored) {
      parent.appendChild(el("p", "app-missing", "Open My day once to register, then return."));
      return;
    }
    // gate the whole screen on the effective role (view-as emulation)
    const me = effectivePerson(stored);

    const wrap = el("div", "app-settings");
    parent.appendChild(wrap);
    const tabsRow = el("div", "app-settings-tabsrow");
    const tabsBar = el("div", "app-settings-tabs");
    tabsRow.appendChild(tabsBar);
    // real super admins pick a role to preview; reload re-gates everything
    if (stored.role === "superadmin") {
      const sel = el("select", "app-input app-viewas-select") as HTMLSelectElement;
      for (const [value, label] of [
        ["", "Super admin (you)"],
        ["siteadmin", "Site admin"],
        ["user", "User"],
      ]) {
        const opt = el("option", "", label) as HTMLOptionElement;
        opt.value = value;
        sel.appendChild(opt);
      }
      sel.value = viewAsRole() ?? "";
      sel.addEventListener("change", () => {
        void (async () => {
          // switching role remounts the screen — same guard as leaving it
          if (dirty) {
            const choice = await promptUnsaved();
            if (choice === "cancel") {
              sel.value = viewAsRole() ?? "";
              return;
            }
            if (choice === "save" && saveFn) await saveFn();
          }
          setViewAsRole((sel.value || null) as EmulatedRole | null);
          // no reload — an iframe reload loses the Power Apps host
          // handshake; repaint the shell banner and re-route in place
          window.dispatchEvent(new Event("leanboard:viewas"));
          window.dispatchEvent(new Event("hashchange"));
        })();
      });
      const viewAsWrap = el("label", "app-viewas");
      viewAsWrap.append(el("span", "app-user-field-label", "View as"), sel);
      tabsRow.appendChild(viewAsWrap);
    }
    const saveBar = el("div", "app-save-bar");
    const body = el("div", "app-settings-body");
    // one card: tabs flush on top of the body (same look as the hub)
    const card = el("div", "app-settings-card");
    card.append(tabsRow, saveBar, body);
    wrap.appendChild(card);

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
      tabs.push({
        key: "cadence",
        label: "Site cadence",
        render: () => renderSiteCadence(body, me, ctx),
      });
    }
    // everyone gets Rituals — the tab scopes itself by role (site
    // admins: their site; users: rituals they own)
    tabs.push({ key: "boards", label: "Rituals", render: () => renderBoardsAdmin(body, me) });
    if (me.role === "superadmin") {
      tabs.push({ key: "brand", label: "Branding", render: () => renderBranding(body, ctx) });
    }
    if (!isAdmin) {
      tabs.push({ key: "request", label: "Request admin", render: () => renderRequest(body, me) });
    }
    const tabByKey = (key: string) => tabs.find((t) => t.key === key) ?? tabs[0];

    // deep-link support (#/settings/boards lands on the Rituals tab)
    let current = tabs.some((t) => t.key === initialTab) ? initialTab : tabs[0].key;
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

/**
 * Roster preview: a 28-day crew × day matrix (D/N/off) from today, computed
 * with the same engine that schedules meetings — reads the card's CURRENT
 * values so a pattern can be checked before saving.
 */
export function openRosterPreview(pat: {
  name: string;
  pattern: string;
  baseDate: string;
  crews: string;
  dayStart: string;
}): void {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal app-modal-wide");
  box.appendChild(
    el("div", "app-modal-title", pat.name.trim() || "Roster preview")
  );

  const roster = parseRosterPattern(pat.pattern);
  const crews = pat.crews.split(",").map((c) => c.trim()).filter((c) => c !== "");
  const base = parseLocalDate(pat.baseDate);
  const problems: string[] = [];
  if (roster.length === 0) problems.push("a valid pattern (e.g. 2D-2N-4O)");
  if (crews.length === 0) problems.push("at least one crew");
  if (!base) problems.push("a base date");

  if (problems.length > 0) {
    box.appendChild(
      el("div", "app-modal-note", `To preview, this pattern still needs ${problems.join(", ")}.`)
    );
  } else {
    const dayStart = pat.dayStart || "06:00";
    const nightStart = `${String((Number(dayStart.slice(0, 2)) + 12) % 24).padStart(2, "0")}${dayStart.slice(2)}`;
    box.appendChild(
      el(
        "div",
        "app-modal-note",
        `Next 28 days from today — ${pat.pattern.toUpperCase()}, day shift ${dayStart}` +
          (roster.some((b) => b.type === "N") ? `, night shift ${nightStart}` : "")
      )
    );
    const today = startOfDay(new Date());
    const days = Array.from(
      { length: 28 },
      (_, i) => new Date(today.getTime() + i * 86_400_000)
    );
    const wrap = el("div", "app-roster-preview");
    const table = el("table");
    const head = el("tr");
    head.appendChild(el("th", "app-rp-crew", ""));
    const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    for (const d of days) {
      const th = el("th", "", `${DOW[d.getDay()]} ${d.getDate()}`);
      if (d.getTime() === today.getTime()) th.classList.add("app-rp-today");
      head.appendChild(th);
    }
    table.appendChild(head);
    crews.forEach((crew, idx) => {
      const tr = el("tr");
      tr.appendChild(el("th", "app-rp-crew", crew));
      for (const d of days) {
        const state = crewStateOn(roster, base!, idx, d, crews.length);
        const td = el(
          "td",
          state === "D" ? "app-rp-d" : state === "N" ? "app-rp-n" : "app-rp-o",
          state === "O" ? "" : state
        );
        if (d.getTime() === today.getTime()) td.classList.add("app-rp-today");
        tr.appendChild(td);
      }
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    box.appendChild(
      el(
        "div",
        "app-modal-note",
        "D = day shift, N = night shift, blank = off. Crew 1 starts the sequence on the base date; the other crews are staggered evenly through the cycle and pick up the day shift in listed order — crew 2's days follow crew 1's first day block, and so on."
      )
    );
  }

  const footer = el("div", "app-modal-footer");
  const close = el("button", "app-btn app-btn-primary", "Close") as HTMLButtonElement;
  footer.appendChild(close);
  box.appendChild(footer);
  const done = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      done();
    }
  };
  close.addEventListener("click", done);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
}

/** Union of crew names across a site's roster patterns, pattern order. */
function crewsForSite(
  lib: Record<string, SiteRosterPattern[]>,
  site: string
): string[] {
  const out: string[] = [];
  for (const p of lib[site] ?? []) {
    for (const c of p.crews) if (c !== "" && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Swap a select's option list in place, keeping the value when it survives. */
function rebuildSelect(sel: HTMLSelectElement, opts: string[]): void {
  const v = sel.value;
  sel.replaceChildren();
  for (const o of ["", ...opts]) {
    const opt = el("option", "", o === "" ? "—" : o) as HTMLOptionElement;
    opt.value = o;
    sel.appendChild(opt);
  }
  sel.value = opts.includes(v) ? v : "";
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
  const crewLib = await rosterPatternLibrary();
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
  const crew = select(crewsForSite(crewLib, me.site), me.crew ?? "");
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
    rebuild(crew, crewsForSite(crewLib, site.value)); // crews are per site
    ctx.markDirty();
  });
  dept.addEventListener("change", () => {
    rebuild(area, areasFor(site.value, dept.value));
    ctx.markDirty();
  });
  area.addEventListener("change", () => ctx.markDirty());
  crew.addEventListener("change", () => ctx.markDirty());

  const doSave = async () => {
    // spread the STORED row, not `me` — under view-as, `me` carries the
    // emulated role and must never be written back
    const fresh = (await viewerPerson(me.whoId)) ?? me;
    await upsertPerson({
      ...fresh,
      site: site.value,
      department: dept.value,
      area: area.value,
      crew: crew.value || undefined,
    });
    me.site = site.value;
    me.department = dept.value;
    me.area = area.value;
    me.crew = crew.value || undefined;
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
    field("Area", area),
    field(
      "Crew",
      crew,
      "From your site's roster patterns — crew-linked meetings only show when your crew is on shift."
    )
  );
}

/** "added 3 members · 1 owner · removed 2" (or "everything in sync"). */
function syncSummary(r: SyncReport): string {
  const bits: string[] = [];
  if (r.membersAdded > 0) bits.push(`added ${r.membersAdded} member${r.membersAdded === 1 ? "" : "s"}`);
  if (r.ownersAdded > 0) bits.push(`${r.ownersAdded} owner${r.ownersAdded === 1 ? "" : "s"}`);
  if (r.membersRemoved > 0) bits.push(`removed ${r.membersRemoved}`);
  if (r.ownersRemoved > 0) bits.push(`ownership removed from ${r.ownersRemoved}`);
  if (r.newcomers.length > 0) {
    bits.push(
      `brought ${r.newcomers.length} group member${r.newcomers.length === 1 ? "" : "s"} onto the roster`
    );
  }
  return bits.length > 0 ? `Synced — ${bits.join(" · ")}.` : "Everything already in sync.";
}

/** Pick a security group; ownership is verified on selection. The
 *  overlay mounts under `host` (inside the routed outlet), so leaving
 *  Settings tears it down with the screen instead of orphaning a
 *  full-screen modal over the next page. */
function pickOwnedGroup(
  host: HTMLElement,
  viewerId: string
): Promise<{ id: string; name: string } | null> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", "Choose the access group"));
    box.appendChild(
      el(
        "div",
        "app-modal-note",
        "Security groups in your organisation (M365 groups can't gate app sharing). You must be an OWNER of the group you pick — that's checked when you select it. Members of the chosen group can open the app; the roster keeps it in sync."
      )
    );
    const search = el("input", "app-input") as HTMLInputElement;
    search.type = "search";
    search.placeholder = "Filter groups…";
    const list = el("div", "app-group-list");
    list.appendChild(el("div", "app-settings-note", "Loading groups…"));
    const status = el("div", "app-settings-note", "");
    box.append(search, list, status);
    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    footer.appendChild(cancel);
    box.appendChild(footer);
    const done = (r: { id: string; name: string } | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    };
    cancel.addEventListener("click", () => done(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", onKey, true);
    overlay.appendChild(box);
    host.appendChild(overlay);

    let groups: { id: string; name: string }[] = [];
    let checking = false;
    const pick = (g: { id: string; name: string }) => {
      if (checking) return;
      checking = true;
      status.textContent = `Checking you own ${g.name}…`;
      void isGroupOwner(g.id, viewerId)
        .then((owner) => {
          if (owner) {
            done({ id: g.id, name: g.name });
          } else {
            checking = false;
            status.textContent = `You're not an owner of ${g.name} — pick a group you own.`;
          }
        })
        .catch((err) => {
          checking = false;
          status.textContent = `Couldn't check ownership: ${err instanceof Error ? err.message : String(err)}`;
        });
    };
    const paint = () => {
      clear(list);
      const q = search.value.trim().toLowerCase();
      const shown = groups.filter((g) => q === "" || g.name.toLowerCase().includes(q));
      if (shown.length === 0) {
        list.appendChild(el("div", "app-settings-note", "No groups match."));
        return;
      }
      for (const g of shown.slice(0, 30)) {
        const rowBtn = el("button", "app-group-row") as HTMLButtonElement;
        rowBtn.type = "button";
        rowBtn.appendChild(el("span", "app-people-name", g.name));
        rowBtn.addEventListener("click", () => pick(g));
        list.appendChild(rowBtn);
      }
      if (shown.length > 30) {
        list.appendChild(el("div", "app-settings-note", `Showing 30 of ${shown.length} — keep typing.`));
      }
    };
    search.addEventListener("input", paint);
    void listCandidateGroups()
      .then((g) => {
        groups = g;
        paint();
      })
      .catch((err) => {
        clear(list);
        list.appendChild(
          el(
            "div",
            "app-settings-note",
            `Couldn't list groups: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      });
  });
}

/** Access-control card: the Entra group the roster keeps in sync. */
function accessControlCard(
  me: RosterPerson,
  getPeople: () => RosterPerson[],
  onRosterChanged: () => void
): HTMLElement {
  const card = el("div", "app-access-card");
  card.appendChild(el("div", "app-section", "Access control"));
  const line = el("div", "app-settings-note", "Loading access group…");
  const row = el("div", "app-settings-row");
  const note = el("div", "app-field-hint", "");
  const choose = el("button", "app-btn", "Choose group…") as HTMLButtonElement;
  const sync = el("button", "app-btn", "Sync now") as HTMLButtonElement;
  const stop = el("button", "app-btn", "Stop managing") as HTMLButtonElement;
  row.append(choose, sync, stop);
  card.append(line, row, note);

  const errText = (err: unknown) =>
    err instanceof Error ? err.message : String(err);
  const paint = async () => {
    try {
      const g = await accessGroup();
      sync.style.display = g ? "" : "none";
      stop.style.display = g ? "" : "none";
      choose.textContent = g ? "Change group…" : "Choose group…";
      line.textContent = g
        ? `Access group: ${g.name}. People added to the roster join it automatically; super and site admins also become owners.`
        : "No access group configured — choose a Microsoft group you own to gate who can open the app.";
    } catch (err) {
      line.textContent = `Couldn't read the access-group setting: ${errText(err)}`;
    }
  };

  const runSync = async () => {
    note.textContent = "Syncing the roster and the group…";
    try {
      const r = await syncAllAccess(getPeople(), me.whoId);
      // two-way: members added directly in Entra join the roster too
      for (const m of r.newcomers) {
        await upsertPerson({
          whoId: m.id,
          who: m.name,
          email: m.email,
          site: "",
          department: "",
          area: "",
          role: "user",
          active: true,
        });
      }
      note.textContent = syncSummary(r);
      if (r.newcomers.length > 0) onRosterChanged(); // show the new rows
    } catch (err) {
      note.textContent = `Sync failed: ${errText(err)} — a group owner can retry.`;
    }
  };

  choose.addEventListener("click", () => {
    void (async () => {
      const g = await pickOwnedGroup(card, me.whoId);
      if (!g) return;
      try {
        await saveAccessGroup(g);
      } catch (err) {
        note.textContent = `Couldn't save the group choice: ${errText(err)}`;
        return;
      }
      await paint();
      await runSync();
    })();
  });
  sync.addEventListener("click", () => void runSync());
  stop.addEventListener("click", () => {
    void (async () => {
      try {
        await saveAccessGroup(null);
        note.textContent = "The app no longer manages any group.";
      } catch (err) {
        note.textContent = `Couldn't clear the setting: ${errText(err)}`;
      }
      await paint();
    })();
  });
  void paint();
  return card;
}

/**
 * Add people proactively from the org directory (Entra search) — no
 * need to wait for a meeting invite. New people land as active users
 * with no site; upsertPerson also syncs them into the access group.
 */
function directoryAddCard(
  getPeople: () => RosterPerson[],
  onAdded: () => void
): HTMLElement {
  const card = el("div", "app-access-card");
  card.appendChild(el("div", "app-section", "Add people"));
  const row = el("div", "app-settings-row");
  const query = el("input", "app-input") as HTMLInputElement;
  query.type = "search";
  query.placeholder = "Search the directory (name or email)…";
  query.style.flex = "1";
  const go = el("button", "app-btn", "Search") as HTMLButtonElement;
  row.append(query, go);
  const hits = el("div", "app-group-list");
  const note = el("div", "app-field-hint", "");
  card.append(row, hits, note);

  const runSearch = () => {
    const q = query.value.trim();
    if (q.length < 2) {
      note.textContent = "Type at least two characters.";
      return;
    }
    note.textContent = "Searching…";
    clear(hits);
    void searchEntra(q)
      .then((found) => {
        note.textContent = found.length === 0 ? "No directory matches." : "";
        const known = new Set(getPeople().map((p) => p.whoId));
        for (const hit of found) {
          const r = el("div", "app-group-row");
          r.appendChild(el("span", "app-people-name", hit.displayName));
          r.appendChild(
            el(
              "span",
              "app-user-email",
              [hit.mail, hit.department].filter(Boolean).join(" · ")
            )
          );
          if (known.has(hit.objectId)) {
            r.appendChild(el("span", "app-status-badge", "on the roster"));
          } else {
            const add = el("button", "app-btn", "＋ Add") as HTMLButtonElement;
            add.addEventListener("click", () => {
              add.disabled = true;
              add.textContent = "Adding…";
              void upsertPerson({
                whoId: hit.objectId,
                who: hit.displayName,
                email: hit.mail,
                site: "",
                department: "",
                area: "",
                role: "user",
                active: true,
              }).then(() => {
                add.textContent = "Added";
                note.textContent = `${hit.displayName} is on the roster — set their site and crew below.`;
                onAdded();
              });
            });
            r.appendChild(add);
          }
          hits.appendChild(r);
        }
      })
      .catch((err) => {
        note.textContent = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      });
  };
  go.addEventListener("click", runSearch);
  query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });
  return card;
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
  const crewLib = await rosterPatternLibrary();
  let people = await listPeople(true);
  // reload the roster and repaint the list in place (keeps the cards'
  // own notes — e.g. the sync summary — on screen)
  const reloadPeople = async () => {
    people = await listPeople(true);
    draw();
  };
  if (canEdit) {
    body.appendChild(
      accessControlCard(me, () => people, () => void reloadPeople())
    );
    body.appendChild(directoryAddCard(() => people, () => void reloadPeople()));
  }

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
    for (const p of shown) list.appendChild(userRow(p, sites, crewLib, canEdit, me, dir, draw));
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
  crewLib: Record<string, SiteRosterPattern[]>,
  canEdit: boolean,
  me: RosterPerson,
  dir: DirectoryLookup,
  onChanged: () => void
): HTMLElement {
  const r = el("div", "app-user-row");
  r.dataset.whoid = p.whoId;
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
  // a revoked person's placement and role are frozen — restore access
  // first, then edit (prevents silent changes to someone locked out)
  const editable = canEdit && p.active;
  // crew: from the site's roster patterns; a site with none offers only —
  const crew = select(crewsForSite(crewLib, p.site), p.crew ?? "");
  crew.disabled = !editable;
  crew.addEventListener("change", () => {
    p.crew = crew.value || undefined;
    void upsertPerson({ ...p });
  });
  // editable site (clearing department/area/crew when the site changes so
  // a stale sub-placement can't outlive its site)
  const site = select(sites, p.site);
  site.value = p.site;
  site.disabled = !editable;
  site.addEventListener("change", () => {
    if (site.value !== p.site) {
      p.department = "";
      p.area = "";
      p.crew = undefined;
      rebuildSelect(crew, crewsForSite(crewLib, site.value));
    }
    p.site = site.value;
    void upsertPerson({ ...p });
  });
  // access-group sync rides every roster write (inside upsertPerson); a
  // failure never blocks the edit — it surfaces on the person's CURRENT
  // row, which may be a fresh element if the list redrew meanwhile
  const syncWarn = (err: unknown) => {
    const live =
      document.querySelector<HTMLElement>(
        `.app-people-list [data-whoid="${CSS.escape(p.whoId)}"]`
      ) ?? r;
    if (!live.querySelector(".app-user-syncwarn")) {
      const detail = err instanceof Error ? ` (${err.message.slice(0, 120)})` : "";
      live.appendChild(
        el(
          "div",
          "app-settings-note app-user-syncwarn",
          `Access-group sync failed${detail} — a group owner can run Sync now above.`
        )
      );
    }
  };
  const role = roleSelect(p.role);
  role.disabled = !editable || p.whoId === me.whoId; // no self-demotion footguns
  role.addEventListener("change", () => {
    p.role = role.value || "user";
    roleBadge.textContent = roleLabel(p.role);
    roleBadge.className = `app-role-badge app-role-${p.role}`;
    void upsertPerson({ ...p }, syncWarn);
  });
  controls.append(
    labelledControl("Site", site),
    labelledControl("Crew", crew),
    labelledControl("Role", role)
  );

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
      // revoke leaves the group / restore rejoins (inside upsertPerson);
      // syncWarn re-finds the row the redraw below creates
      void upsertPerson({ ...p }, syncWarn).then(onChanged);
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

/** Owner-picker result: set a person, clear the owner, or cancel. */
type PickPersonResult =
  | { action: "set"; person: PersonRef }
  | { action: "clear" }
  | null;

/**
 * Choose a person for an org-level owner: the app's user list first,
 * with a directory search for anyone not on the roster yet (picking a
 * directory hit registers them as an app user, like the wizard does).
 */
function pickPerson(host: HTMLElement, allowClear: boolean): Promise<PickPersonResult> {
  return new Promise((resolve) => {
    const overlay = el("div", "app-modal-overlay");
    const box = el("div", "app-modal");
    box.appendChild(el("div", "app-modal-title", "Choose an owner"));
    box.appendChild(
      el(
        "div",
        "app-modal-note",
        "Pick from the app's users, or search the whole directory below."
      )
    );
    const filter = el("input", "app-input") as HTMLInputElement;
    filter.type = "search";
    filter.placeholder = "Filter users\u2026";
    const list = el("div", "app-group-list");
    list.appendChild(el("div", "app-settings-note", "Loading users\u2026"));
    box.append(filter, list);

    const dirRow = el("div", "app-settings-row");
    const dirQuery = el("input", "app-input") as HTMLInputElement;
    dirQuery.type = "search";
    dirQuery.placeholder = "Search the directory (name or email)\u2026";
    dirQuery.style.flex = "1";
    const dirGo = el("button", "app-btn", "Search") as HTMLButtonElement;
    dirRow.append(dirQuery, dirGo);
    const dirList = el("div", "app-group-list");
    const note = el("div", "app-field-hint", "");
    box.append(dirRow, dirList, note);

    const footer = el("div", "app-modal-footer");
    const cancel = el("button", "app-link", "Cancel") as HTMLButtonElement;
    footer.appendChild(cancel);
    if (allowClear) {
      const clearBtn = el("button", "app-btn", "Clear owner") as HTMLButtonElement;
      clearBtn.addEventListener("click", () => done({ action: "clear" }));
      footer.appendChild(clearBtn);
    }
    box.appendChild(footer);

    const done = (r: PickPersonResult) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    };
    cancel.addEventListener("click", () => done(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", onKey, true);
    overlay.appendChild(box);
    host.appendChild(overlay);

    let roster: RosterPerson[] = [];
    const paintRoster = () => {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      const shown = roster.filter(
        (p) => q === "" || `${p.who} ${p.email}`.toLowerCase().includes(q)
      );
      for (const p of shown.slice(0, 20)) {
        const row = el("button", "app-group-row") as HTMLButtonElement;
        row.type = "button";
        row.appendChild(el("span", "app-people-name", p.who));
        row.appendChild(
          el("span", "app-user-email", [p.email, p.site].filter(Boolean).join(" \u00b7 "))
        );
        row.addEventListener("click", () =>
          done({ action: "set", person: { whoId: p.whoId, who: p.who } })
        );
        list.appendChild(row);
      }
      if (shown.length === 0) {
        list.appendChild(el("div", "app-settings-note", "No users match \u2014 try the directory below."));
      } else if (shown.length > 20) {
        list.appendChild(el("div", "app-settings-note", `Showing 20 of ${shown.length} \u2014 keep typing.`));
      }
    };
    filter.addEventListener("input", paintRoster);
    void listPeople()
      .then((p) => {
        roster = p;
        paintRoster();
      })
      .catch(() => {
        clear(list);
        list.appendChild(el("div", "app-settings-note", "Couldn't load the user list."));
      });

    const runDirSearch = () => {
      const q = dirQuery.value.trim();
      if (q.length < 2) {
        note.textContent = "Type at least two characters.";
        return;
      }
      note.textContent = "Searching\u2026";
      clear(dirList);
      void searchEntra(q)
        .then((hits) => {
          note.textContent = hits.length === 0 ? "No directory matches." : "";
          for (const hit of hits) {
            const row = el("button", "app-group-row") as HTMLButtonElement;
            row.type = "button";
            row.appendChild(el("span", "app-people-name", hit.displayName));
            row.appendChild(el("span", "app-user-email", hit.mail));
            const known = roster.some((p) => p.whoId === hit.objectId);
            if (!known) row.appendChild(el("span", "app-status-badge", "new to the app"));
            row.addEventListener("click", () => {
              void (async () => {
                if (!known) {
                  // owners need real app identities \u2014 register them
                  await upsertPerson({
                    whoId: hit.objectId,
                    who: hit.displayName,
                    email: hit.mail,
                    site: "",
                    department: "",
                    area: "",
                    role: "user",
                    active: true,
                  });
                }
                done({ action: "set", person: { whoId: hit.objectId, who: hit.displayName } });
              })();
            });
            dirList.appendChild(row);
          }
        })
        .catch((err) => {
          note.textContent = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
        });
    };
    dirGo.addEventListener("click", runDirSearch);
    dirQuery.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runDirSearch();
      }
    });
  });
}

/**
 * Organisation \u2014 one hierarchical list, company \u2192 site \u2192 department \u2192
 * area, each level carrying an optional owner. Structure edits (add /
 * rename / reorder / drag site between companies) work as before; site
 * cadence (rosters, protected times) lives on its own tab now.
 */
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
  const ownersBySite = await allSiteOwners();
  const coOwners = await companyOwners();
  for (const s of sites) ownersBySite[s] ??= { departments: {}, areas: {} };
  const editableSites = isSuper ? sites : sites.filter((s) => s === me.site);

  const touched = new Set<string>();
  let coOwnersTouched = false;
  const pendingRenames: {
    site: string;
    kind: "dept" | "area";
    department: string;
    oldName: string;
    newName: string;
  }[] = [];

  const guardLeave = async (): Promise<boolean> => {
    if (!ctx.isDirty()) return true;
    const choice = await promptUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save") await ctx.saveCurrent();
    return true;
  };

  body.appendChild(
    el(
      "div",
      "app-settings-note",
      "The whole organisation, top to bottom \u2014 every level can carry an owner." +
        (isSuper ? "" : " You can edit your own site; the rest is view only.")
    )
  );
  const treeBox = el("div", "app-org-tree");
  body.appendChild(treeBox);

  let draggingSite: string | null = null;

  const ownerChip = (
    current: PersonRef | undefined,
    canEdit: boolean,
    apply: (p: PersonRef | null) => void
  ): HTMLElement => {
    const chip = el(
      "button",
      "app-owner" + (current ? "" : " app-owner-none"),
      current ? `Owner \u00b7 ${current.who}` : "\uFF0B Owner"
    ) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !canEdit;
    chip.title = canEdit
      ? current
        ? `Owner: ${current.who} \u2014 click to change`
        : "Set an owner"
      : current
        ? `Owner: ${current.who}`
        : "";
    chip.addEventListener("click", () => {
      void (async () => {
        const res = await pickPerson(body, current !== undefined);
        if (res === null) return;
        apply(res.action === "set" ? res.person : null);
        ctx.markDirty();
        draw();
      })();
    });
    return chip;
  };

  // ---- immediate structural flows (guarded; full re-render) ----

  const renameSite = (site: string) => {
    void (async () => {
      const name = (
        (await promptText({ title: "Rename site", initial: site, confirmLabel: "Rename" })) ??
        ""
      ).trim();
      if (name === "" || name === site || name === APP_ROW || sites.includes(name)) return;
      if (!(await guardLeave())) return;
      await renameSiteRow(site, name); // the owners column travels with the row
      await renameBoardsSite(site, name);
      for (const p of await listPeople(true)) {
        if (p.site === site) await upsertPerson({ ...p, site: name });
      }
      if (me.site === site) me.site = name;
      await renderOrg(body, me, ctx);
    })();
  };

  const renameCompanyFlow = (company: string) => {
    void (async () => {
      const name = (
        (await promptText({ title: "Rename company", initial: company, confirmLabel: "Rename" })) ??
        ""
      ).trim();
      if (name === "" || name === company || companyList.includes(name)) return;
      if (!(await guardLeave())) return;
      await renameCompany(company, name); // moves the owner key too
      await renderOrg(body, me, ctx);
    })();
  };

  const addSiteFlow = (company: string) => {
    void (async () => {
      const name = (
        (await promptText({
          title: "Add site",
          note: `Under ${company}.`,
          placeholder: "Site name",
          confirmLabel: "Add",
        })) ?? ""
      ).trim();
      if (name === "" || name === APP_ROW || sites.includes(name)) return;
      if (!(await guardLeave())) return;
      await saveSiteDepartments(name, "[]");
      await saveSiteCompany(name, company);
      await renderOrg(body, me, ctx);
    })();
  };

  const addCompanyFlow = () => {
    void (async () => {
      const name = (
        (await promptText({ title: "Add company", placeholder: "Company name", confirmLabel: "Add" })) ??
        ""
      ).trim();
      if (name === "" || companyList.includes(name)) return;
      if (!(await guardLeave())) return;
      await saveCompanies([...companyList, name]);
      await renderOrg(body, me, ctx);
    })();
  };

  // ---- deferred renames (cascade to people/boards at save) ----

  const renameDept = (
    site: string,
    node: OrgSiteNode,
    d: OrgSiteNode["departments"][number],
    redraw: () => void
  ) => {
    void (async () => {
      const name = (
        (await promptText({ title: "Rename department", initial: d.department, confirmLabel: "Rename" })) ??
        ""
      ).trim();
      if (name === "" || name === d.department) return;
      if (node.departments.some((x) => x.department === name)) return;
      pendingRenames.push({
        site,
        kind: "dept",
        department: name,
        oldName: d.department,
        newName: name,
      });
      const owners = ownersBySite[site];
      if (owners.departments[d.department]) {
        owners.departments[name] = owners.departments[d.department];
        delete owners.departments[d.department];
      }
      for (const k of Object.keys(owners.areas)) {
        if (k.startsWith(`${d.department}/`)) {
          owners.areas[`${name}/${k.slice(d.department.length + 1)}`] = owners.areas[k];
          delete owners.areas[k];
        }
      }
      d.department = name;
      redraw();
    })();
  };

  const renameArea = (
    site: string,
    d: OrgSiteNode["departments"][number],
    ai: number,
    redraw: () => void
  ) => {
    void (async () => {
      const a = d.areas[ai];
      const name = (
        (await promptText({ title: "Rename area", initial: a, confirmLabel: "Rename" })) ?? ""
      ).trim();
      if (name === "" || name === a || d.areas.includes(name)) return;
      pendingRenames.push({
        site,
        kind: "area",
        department: d.department,
        oldName: a,
        newName: name,
      });
      const owners = ownersBySite[site];
      const oldKey = `${d.department}/${a}`;
      if (owners.areas[oldKey]) {
        owners.areas[`${d.department}/${name}`] = owners.areas[oldKey];
        delete owners.areas[oldKey];
      }
      d.areas[ai] = name;
      redraw();
    })();
  };

  // ---- the hierarchy ----

  const siteCard = (site: string): HTMLElement => {
    const canEdit = editableSites.includes(site);
    const node = tree.find((t) => t.site === site)!;
    const owners = ownersBySite[site];
    const card = el("div", "app-site-card");
    const head = el("div", "app-site-head");
    if (isSuper) {
      card.draggable = true;
      card.title = "Drag to another company to move";
      card.addEventListener("dragstart", (e) => {
        draggingSite = site;
        card.classList.add("app-dragging");
        e.dataTransfer?.setData("text/plain", site);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        draggingSite = null;
        card.classList.remove("app-dragging");
      });
      const handle = el("span", "app-drag-handle", "⠿");
      handle.title = "Drag to another company";
      head.appendChild(handle);
    }
    head.appendChild(el("span", "app-site-name", site));
    if (isSuper) head.appendChild(editBtn("Rename site", () => renameSite(site)));
    head.appendChild(
      ownerChip(owners.site, canEdit, (p) => {
        owners.site = p ?? undefined;
        touched.add(site);
      })
    );
    if (!canEdit) head.appendChild(el("span", "app-status-badge", "view only"));
    card.appendChild(head);

    const deptList = el("div", "app-dept-list");
    card.appendChild(deptList);
    const redraw = () => {
      touched.add(site);
      ctx.markDirty();
      draw();
    };
    node.departments.forEach((d, di) => {
      const dc = el("div", "app-dept-card");
      const dh = el("div", "app-dept-head");
      if (canEdit) {
        const handle = el("span", "app-drag-handle", "⠿");
        handle.title = "Drag to reorder";
        dh.appendChild(handle);
        draggableRow(dc, handle, `dept-${site}`, di, node.departments, redraw);
      }
      dh.appendChild(el("span", "app-dept-name", d.department));
      if (canEdit) dh.appendChild(editBtn("Rename department", () => renameDept(site, node, d, redraw)));
      dh.appendChild(
        ownerChip(owners.departments[d.department], canEdit, (p) => {
          if (p) owners.departments[d.department] = p;
          else delete owners.departments[d.department];
          touched.add(site);
        })
      );
      if (canEdit) {
        dh.appendChild(
          removeBtn(() => {
            node.departments = node.departments.filter((x) => x !== d);
            delete owners.departments[d.department];
            for (const k of Object.keys(owners.areas)) {
              if (k.startsWith(`${d.department}/`)) delete owners.areas[k];
            }
            redraw();
          })
        );
      }
      dc.appendChild(dh);
      const areaBox = el("div", "app-area-list");
      dc.appendChild(areaBox);
      d.areas.forEach((a, ai) => {
        const ar = el("div", "app-area-row");
        if (canEdit) {
          const handle = el("span", "app-drag-handle", "⠿");
          handle.title = "Drag to reorder";
          ar.appendChild(handle);
          draggableRow(ar, handle, `area-${site}-${di}`, ai, d.areas, redraw);
        }
        ar.appendChild(el("span", "app-area-name", a));
        if (canEdit) ar.appendChild(editBtn("Rename area", () => renameArea(site, d, ai, redraw)));
        ar.appendChild(
          ownerChip(owners.areas[`${d.department}/${a}`], canEdit, (p) => {
            const key = `${d.department}/${a}`;
            if (p) owners.areas[key] = p;
            else delete owners.areas[key];
            touched.add(site);
          })
        );
        if (canEdit) {
          ar.appendChild(
            removeBtn(() => {
              d.areas = d.areas.filter((x) => x !== a);
              delete owners.areas[`${d.department}/${a}`];
              redraw();
            })
          );
        }
        areaBox.appendChild(ar);
      });
      if (d.areas.length === 0) areaBox.appendChild(el("div", "app-org-empty", "No areas"));
      if (canEdit) {
        const addA = adder("Add area", (v) => {
          d.areas.push(v);
          redraw();
        });
        addA.classList.add("app-area-adder");
        dc.appendChild(addA);
      }
      deptList.appendChild(dc);
    });
    if (canEdit) {
      deptList.appendChild(
        adder("Add department", (v) => {
          node.departments.push({ department: v, areas: [] });
          redraw();
        })
      );
    }
    return card;
  };

  const draw = () => {
    clear(treeBox);
    const groups: { company: string; sites: string[] }[] = companyList.map((c) => ({
      company: c,
      sites: [],
    }));
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
      const co = el("div", "app-co-card");
      const coHead = el("div", "app-co-head");
      coHead.appendChild(
        el(
          "span",
          "app-co-name",
          g.company === "" ? (companyList.length > 0 ? "No company" : "Sites") : g.company
        )
      );
      if (g.company !== "") {
        if (isSuper) coHead.appendChild(editBtn("Rename company", () => renameCompanyFlow(g.company)));
        coHead.appendChild(
          ownerChip(coOwners[g.company], isSuper, (p) => {
            if (p) coOwners[g.company] = p;
            else delete coOwners[g.company];
            coOwnersTouched = true;
          })
        );
      }
      coHead.appendChild(el("span", "app-bar-gap"));
      if (isSuper && g.company !== "") {
        const addSite = el("button", "app-btn", "\uFF0B Add site") as HTMLButtonElement;
        addSite.addEventListener("click", () => addSiteFlow(g.company));
        coHead.appendChild(addSite);
      }
      co.appendChild(coHead);

      if (isSuper) {
        co.addEventListener("dragover", (e) => {
          if (draggingSite === null) return;
          if ((siteCompany[draggingSite] ?? "") === g.company) return;
          e.preventDefault();
          co.classList.add("app-org-dropco");
        });
        co.addEventListener("dragleave", (e) => {
          if (!co.contains(e.relatedTarget as Node)) co.classList.remove("app-org-dropco");
        });
        co.addEventListener("drop", (e) => {
          co.classList.remove("app-org-dropco");
          if (draggingSite === null) return;
          e.preventDefault();
          const site = draggingSite;
          draggingSite = null;
          if ((siteCompany[site] ?? "") === g.company) return;
          void (async () => {
            if (!(await guardLeave())) return;
            await saveSiteCompany(site, g.company);
            await renderOrg(body, me, ctx);
          })();
        });
      }

      for (const site of g.sites) co.appendChild(siteCard(site));
      if (g.sites.length === 0) co.appendChild(el("div", "app-org-empty", "No sites yet"));
      treeBox.appendChild(co);
    }
    if (isSuper) {
      const addCo = el("button", "app-org-add app-org-addco", "\uFF0B Add company") as HTMLButtonElement;
      addCo.addEventListener("click", addCompanyFlow);
      treeBox.appendChild(addCo);
    }
  };
  draw();

  // ---- save (via the unsaved-changes bar) ----
  ctx.registerSave(async () => {
    for (const site of touched) {
      const node = tree.find((t) => t.site === site);
      if (!node) continue;
      await saveSiteDepartments(site, JSON.stringify(node.departments));
      await saveSiteOwners(site, ownersBySite[site]);
    }
    if (coOwnersTouched) await saveCompanyOwners(coOwners);
    if (pendingRenames.length > 0) {
      const roster = await listPeople(true);
      for (const person of roster) {
        const upd = { ...person };
        let changed = false;
        for (const rn of pendingRenames) {
          if (person.site !== rn.site) continue;
          if (rn.kind === "dept" && upd.department === rn.oldName) {
            upd.department = rn.newName;
            changed = true;
          }
          if (
            rn.kind === "area" &&
            upd.department === rn.department &&
            upd.area === rn.oldName
          ) {
            upd.area = rn.newName;
            changed = true;
          }
        }
        if (changed) await upsertPerson(upd);
      }
      for (const rn of pendingRenames) {
        if (rn.kind === "dept") {
          await renameBoardsDepartment(rn.site, rn.oldName, rn.newName);
        }
      }
      pendingRenames.length = 0;
    }
    touched.clear();
    coOwnersTouched = false;
    ctx.markClean();
  });
}

/**
 * Site cadence \u2014 per-site operating rhythm: time zone and accent,
 * shift roster patterns, protected times. Super admins pick the site;
 * site admins land on their own.
 */
async function renderSiteCadence(
  body: HTMLElement,
  me: RosterPerson,
  ctx: DirtyCtx
): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";
  const tree = parseOrgTree(await orgJson()) as OrgSiteNode[];
  const sites = tree.map((s) => s.site);
  const mySites = isSuper ? sites : sites.filter((s) => s === me.site);
  if (sites.length === 0) {
    body.appendChild(
      el("div", "app-settings-note", "No sites yet \u2014 add one under Organisation first.")
    );
    return;
  }
  let currentSite = mySites[0] ?? sites[0];

  const guardLeave = async (): Promise<boolean> => {
    if (!ctx.isDirty()) return true;
    const choice = await promptUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save") await ctx.saveCurrent();
    return true;
  };

  const bar = el("div", "app-settings-row");
  body.appendChild(bar);
  const pane = el("div", "app-cadence-pane");
  body.appendChild(pane);

  if (isSuper && sites.length > 1) {
    const sel = select(sites, currentSite);
    sel.value = currentSite;
    sel.addEventListener("change", () => {
      void (async () => {
        if (sel.value === "" || sel.value === currentSite) {
          sel.value = currentSite;
          return;
        }
        if (!(await guardLeave())) {
          sel.value = currentSite;
          return;
        }
        currentSite = sel.value;
        await renderPane();
      })();
    });
    bar.append(el("span", "app-user-field-label", "Site"), sel);
  } else {
    bar.appendChild(el("span", "app-profile-name", currentSite));
  }

  const renderPane = async () => {
    clear(pane);
    ctx.markClean();
    const canEdit = mySites.includes(currentSite);
    const s = await siteSettings(currentSite);

    interface ProtectedRow {
      label: string;
      color?: string;
      days: string; // "Mon,Tue" CSV; "" = every day
      start: string;
      end: string;
    }
    let times: ProtectedRow[] = [];
    try {
      const arr = JSON.parse(await protectedTimesJson(currentSite));
      if (Array.isArray(arr)) {
        times = arr.map((o: Record<string, unknown>) => ({
          label: typeof o.label === "string" ? o.label : "",
          color: typeof o.color === "string" ? o.color : undefined,
          days: typeof o.days === "string" ? o.days : "",
          start: typeof o.start === "string" ? o.start : "",
          end: typeof o.end === "string" ? o.end : "",
        }));
      }
    } catch {
      /* fresh */
    }
    interface RosterPatternRow {
      name: string;
      pattern: string;
      baseDate: string;
      crews: string; // display CSV, stored as array
      dayStart: string; // day shift start "HH:MM"; nights assumed +12h
    }
    let patterns: RosterPatternRow[] = [];
    try {
      const arr = JSON.parse(s.rosterPatternsJson || "[]");
      if (Array.isArray(arr)) {
        patterns = arr.map((o: Record<string, unknown>) => ({
          name: typeof o.name === "string" ? o.name : "",
          pattern: typeof o.pattern === "string" ? o.pattern : "",
          baseDate: typeof o.baseDate === "string" ? o.baseDate : "",
          crews: Array.isArray(o.crews) ? o.crews.map(String).join(", ") : "",
          dayStart:
            typeof o.dayStart === "string"
              ? o.dayStart
              : Array.isArray(o.handovers) && typeof o.handovers[0] === "string"
                ? o.handovers[0]
                : "",
        }));
      }
    } catch {
      /* fresh */
    }

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
      field("Time zone", tz, "IANA zone \u2014 sets how occurrence times display"),
      field("Accent colour", accentGroup.el, "Overrides the app accent for this site")
    );

    // --- roster patterns (editable cards) ---
    pane.appendChild(sectionTitle("Shift roster patterns"));
    const patBox = el("div", "app-dept-list");
    pane.appendChild(patBox);
    const patInput = (
      value: string,
      placeholder: string,
      apply: (v: string) => void
    ): HTMLInputElement => {
      const input = el("input", "app-input") as HTMLInputElement;
      input.value = value;
      input.placeholder = placeholder;
      input.disabled = !canEdit;
      input.addEventListener("input", () => {
        apply(input.value);
        ctx.markDirty();
      });
      return input;
    };
    const drawPatterns = () => {
      clear(patBox);
      for (const pat of patterns) {
        const card = el("div", "app-dept-card");
        const headRow = el("div", "app-dept-head");
        headRow.appendChild(
          patInput(pat.name, "Name (e.g. 4-crew rotating)", (v) => (pat.name = v))
        );
        const preview = el("button", "app-btn", "Preview") as HTMLButtonElement;
        preview.title = "Check the next 28 days of this roster";
        preview.addEventListener("click", () => openRosterPreview(pat));
        headRow.appendChild(preview);
        if (canEdit) {
          headRow.appendChild(
            removeBtn(() => {
              patterns = patterns.filter((x) => x !== pat);
              drawPatterns();
              ctx.markDirty();
            })
          );
        }
        card.appendChild(headRow);
        const grid = el("div", "app-pattern-grid");
        const baseDate = el("input", "app-input") as HTMLInputElement;
        baseDate.type = "date";
        baseDate.value = pat.baseDate;
        baseDate.disabled = !canEdit;
        baseDate.addEventListener("input", () => {
          pat.baseDate = baseDate.value;
          ctx.markDirty();
        });
        const dayStart = el("input", "app-input") as HTMLInputElement;
        dayStart.type = "time";
        dayStart.value = pat.dayStart;
        dayStart.disabled = !canEdit;
        dayStart.addEventListener("input", () => {
          pat.dayStart = dayStart.value;
          ctx.markDirty();
        });
        grid.append(
          field(
            "Pattern",
            patInput(pat.pattern, "e.g. 2D-2N-4O", (v) => (pat.pattern = v.toUpperCase()))
          ),
          field("Base date", baseDate, "Day 1 of the pattern for crew 1"),
          field("Crews", patInput(pat.crews, "e.g. A, B, C, D", (v) => (pat.crews = v)), "In rotation order"),
          field(
            "Day shift start",
            dayStart,
            "Night shift (if the pattern has one) starts 12 hours later"
          )
        );
        card.appendChild(grid);
        patBox.appendChild(card);
      }
      if (patterns.length === 0) {
        patBox.appendChild(el("div", "app-org-empty", "No patterns yet"));
      }
      if (canEdit) {
        const add = el("button", "app-org-add", "\uFF0B Add roster pattern") as HTMLButtonElement;
        add.addEventListener("click", () => {
          patterns.push({ name: "", pattern: "", baseDate: "", crews: "", dayStart: "" });
          drawPatterns();
          ctx.markDirty();
        });
        patBox.appendChild(add);
      }
    };
    drawPatterns();

    // --- protected times (editable; days are a multi-select) ---
    pane.appendChild(sectionTitle("Protected times"));
    const ptBox = el("div", "app-dept-list");
    pane.appendChild(ptBox);
    const drawTimes = () => {
      clear(ptBox);
      for (const pt of times) {
        const card = el("div", "app-dept-card");
        const headRow = el("div", "app-dept-head");
        const label = el("input", "app-input") as HTMLInputElement;
        label.value = pt.label;
        label.placeholder = "Label (e.g. Morning handover)";
        label.disabled = !canEdit;
        label.addEventListener("input", () => {
          pt.label = label.value;
          ctx.markDirty();
        });
        headRow.appendChild(label);
        if (canEdit) {
          headRow.appendChild(
            removeBtn(() => {
              times.splice(times.indexOf(pt), 1);
              drawTimes();
              ctx.markDirty();
            })
          );
        }
        card.appendChild(headRow);
        const timesRow = el("div", "app-timespan");
        const start = el("input", "app-input") as HTMLInputElement;
        start.type = "time";
        start.value = pt.start;
        start.disabled = !canEdit;
        start.addEventListener("input", () => {
          pt.start = start.value;
          ctx.markDirty();
        });
        const end = el("input", "app-input") as HTMLInputElement;
        end.type = "time";
        end.value = pt.end;
        end.disabled = !canEdit;
        end.addEventListener("input", () => {
          pt.end = end.value;
          ctx.markDirty();
        });
        timesRow.append(start, el("span", "app-field-hint", "to"), end);
        card.append(
          field(
            "Days",
            dayChips(pt.days, canEdit, (csv) => {
              pt.days = csv;
              ctx.markDirty();
            }),
            "None selected = every day"
          ),
          field("Between", timesRow)
        );
        ptBox.appendChild(card);
      }
      if (times.length === 0) {
        ptBox.appendChild(el("div", "app-org-empty", "No protected times yet"));
      }
      if (canEdit) {
        const add = el("button", "app-org-add", "\uFF0B Add protected time") as HTMLButtonElement;
        add.addEventListener("click", () => {
          times.push({ label: "", days: "", start: "", end: "" });
          drawTimes();
          ctx.markDirty();
        });
        ptBox.appendChild(add);
      }
    };
    drawTimes();

    if (canEdit) {
      const csv = (v: string) =>
        v.split(",").map((x) => x.trim()).filter((x) => x !== "");
      ctx.registerSave(async () => {
        await saveSiteSettings(currentSite, {
          timezone: tz.value.trim(),
          accent: accentGroup.value(),
          rosterPatternsJson: JSON.stringify(
            patterns
              .filter((p) => p.name.trim() !== "" || p.pattern.trim() !== "")
              .map((p) => ({
                name: p.name.trim(),
                pattern: p.pattern.trim(),
                baseDate: p.baseDate,
                crews: csv(p.crews),
                dayStart: p.dayStart,
              }))
          ),
        });
        await saveProtectedTimes(
          currentSite,
          JSON.stringify(times.filter((t) => t.start !== "" && t.end !== ""))
        );
        ctx.markClean();
      });
    } else {
      pane.appendChild(
        el("div", "app-settings-note", "Read-only \u2014 this site is managed by its site admins.")
      );
    }
  };
  await renderPane();
}

function sectionTitle(text: string): HTMLElement {
  return el("div", "app-section", text);
}

function removeBtn(onClick: () => void): HTMLButtonElement {
  const b = el("button", "app-org-x", "\u00d7") as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

/** Small pencil button for rename/edit affordances. */
function editBtn(title: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "app-org-edit", "\u270e") as HTMLButtonElement;
  b.type = "button";
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/** Mon\u2013Sun toggle chips; emits a "Mon,Tue" CSV ("" = every day). */
function dayChips(
  csv: string,
  enabled: boolean,
  onChange: (csv: string) => void
): HTMLElement {
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const selected = new Set(
    csv.split(",").map((v) => v.trim()).filter((v) => DAYS.includes(v))
  );
  const wrap = el("div", "app-day-chips");
  for (const d of DAYS) {
    const chip = el("button", "app-day-chip", d) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled;
    if (selected.has(d)) chip.classList.add("app-day-chip-on");
    chip.addEventListener("click", () => {
      if (selected.has(d)) selected.delete(d);
      else selected.add(d);
      chip.classList.toggle("app-day-chip-on", selected.has(d));
      onChange(DAYS.filter((x) => selected.has(x)).join(","));
    });
    wrap.appendChild(chip);
  }
  return wrap;
}

/**
 * HTML5 drag-to-reorder for one list. The row only becomes draggable
 * while the pointer is on its handle (so text/inputs inside stay
 * selectable), `group` isolates lists from each other, and the drop
 * reorders `list` in place before `onDone` repaints. Nested lists work
 * because dragstart stops propagating at the row that owns it.
 */
let dragState: { group: string; index: number } | null = null;
function draggableRow(
  rowEl: HTMLElement,
  handle: HTMLElement,
  group: string,
  index: number,
  list: unknown[],
  onDone: () => void
): void {
  handle.addEventListener("pointerdown", () => {
    rowEl.draggable = true;
  });
  handle.addEventListener("pointerup", () => {
    rowEl.draggable = false;
  });
  rowEl.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    dragState = { group, index };
    rowEl.classList.add("app-dragging");
    e.dataTransfer?.setData("text/plain", group); // Firefox needs payload
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  rowEl.addEventListener("dragend", () => {
    dragState = null;
    rowEl.draggable = false;
    rowEl.classList.remove("app-dragging");
  });
  const clearMarks = () => rowEl.classList.remove("app-drop-before", "app-drop-after");
  rowEl.addEventListener("dragover", (e) => {
    if (dragState === null || dragState.group !== group || dragState.index === index) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = rowEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    rowEl.classList.toggle("app-drop-after", after);
    rowEl.classList.toggle("app-drop-before", !after);
  });
  rowEl.addEventListener("dragleave", clearMarks);
  rowEl.addEventListener("drop", (e) => {
    if (dragState === null || dragState.group !== group) return;
    e.preventDefault();
    e.stopPropagation();
    clearMarks();
    const rect = rowEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const from = dragState.index;
    let to = index + (after ? 1 : 0);
    if (from < to) to -= 1;
    dragState = null;
    if (from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onDone();
  });
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

/** A colour-cycling default so new categories are born distinct. */
const CATEGORY_PALETTE = [
  "#2563eb", "#0b6b3a", "#b3261e", "#b45309", "#6d28d9", "#0e7490", "#be185d",
];

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Weekly \u00b7 Mon Wed \u00b7 06:00" from a ritual's occurrence blob. */
function cadenceSummary(blobRaw: string): string {
  try {
    const blob = JSON.parse(blobRaw) as Record<string, unknown>;
    const cfg = (blob.config ?? {}) as Record<string, unknown>;
    const cat = parseCategory(String(cfg.category ?? ""));
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
    const time = String(cfg.timeOfDay ?? "").trim();
    if (cat === "shiftly") {
      return ["Every shift", time !== "" ? `from ${time}` : ""].filter(Boolean).join(" \u00b7 ");
    }
    const days = parseDaysOfWeek(String(cfg.daysOfWeek ?? ""));
    const dayStr =
      days.length === 7 ? "every day" : days.map((i) => DAY_SHORT[i]).join(" ");
    return [catLabel, dayStr, time].filter((v) => v !== "").join(" \u00b7 ");
  } catch {
    return "";
  }
}

async function renderBoardsAdmin(body: HTMLElement, me: RosterPerson): Promise<void> {
  clear(body);
  const isSuper = me.role === "superadmin";
  const isAdmin = isSuper || me.role === "siteadmin";

  // ritual categories (admins see them; super admins manage) \u2014 each has
  // a colour used to code rituals in the calendar and lists
  let cats = await meetingCategories();
  if (isAdmin) {
    body.appendChild(sectionTitle("Ritual categories"));
    const catBox = el("div", "app-org-tree");
    body.appendChild(catBox);
    const drawCats = () => {
      clear(catBox);
      const rowEl = el("div", "app-org-row");
      for (const c of cats) {
        const chip = el("span", "app-btn app-cat-chip");
        const swatch = el("input", "app-color app-cat-swatch") as HTMLInputElement;
        swatch.type = "color";
        swatch.value = /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#8a847a";
        swatch.disabled = !isSuper;
        swatch.title = "Category colour";
        swatch.addEventListener("input", () => {
          c.color = swatch.value;
          void saveMeetingCategories(cats);
        });
        chip.append(swatch, document.createTextNode(c.name));
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
            if (!cats.some((c) => c.name === v)) {
              cats.push({ name: v, color: CATEGORY_PALETTE[cats.length % CATEGORY_PALETTE.length] });
              void saveMeetingCategories(cats).then(drawCats);
            }
          })
        );
      } else if (cats.length === 0) {
        catBox.appendChild(el("div", "app-settings-note", "No categories defined yet."));
      }
    };
    drawCats();
  }

  // ---- rituals, scoped by role ----
  body.appendChild(sectionTitle("Rituals"));
  if (isAdmin) {
    const newBtn = el("a", "app-btn", "\uFF0B New ritual") as HTMLAnchorElement;
    newBtn.href = "#/wizard";
    body.appendChild(newBtn);
  }

  const roster = await listPeople(true);
  const personBy = new Map(roster.map((p) => [p.whoId, p]));
  const colorByCategory = Object.fromEntries(
    cats.filter((c) => c.color !== "").map((c) => [c.name, c.color])
  );

  const all = await listBoards(true); // archived included; hidden below
  const withInfo = all.map((b) => ({
    board: b,
    owner: parseMeetingInfo(b.occurrenceSettingsRaw)?.owner ?? null,
    cadence: cadenceSummary(b.occurrenceSettingsRaw),
  }));
  // super admins see everything; site admins their site; users what they own
  const scoped = isSuper
    ? withInfo
    : isAdmin
      ? withInfo.filter((x) => x.board.site === me.site)
      : withInfo.filter((x) => x.owner?.whoId === me.whoId);
  body.appendChild(
    el(
      "div",
      "app-settings-note",
      isSuper
        ? "All rituals across every site."
        : isAdmin
          ? `Rituals at ${me.site || "your site"}.`
          : "Rituals you own \u2014 you can adjust them; ask an admin to create a new one."
    )
  );

  // ---- filters: title, category, site (super only) ----
  let query = "";
  let catFilter = "";
  let siteFilter = "";
  const filterBar = el("div", "app-settings-row app-users-filters");
  const search = el("input", "app-input") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search rituals";
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  });
  filterBar.appendChild(search);
  const catSel = labelledFilter(
    "Any category",
    cats.map((c) => ({ value: c.name, label: c.name }))
  );
  catSel.addEventListener("change", () => {
    catFilter = catSel.value;
    draw();
  });
  filterBar.appendChild(catSel);
  if (isSuper) {
    const sites = [...new Set(all.map((b) => b.site).filter((s) => s !== ""))].sort();
    const siteSel = labelledFilter("Any site", sites.map((s) => ({ value: s, label: s })));
    siteSel.addEventListener("change", () => {
      siteFilter = siteSel.value;
      draw();
    });
    filterBar.appendChild(siteSel);
  }
  let showArchived = false;
  if (isAdmin) {
    const archToggle = el("label", "app-check");
    const box = el("input") as HTMLInputElement;
    box.type = "checkbox";
    box.addEventListener("change", () => {
      showArchived = box.checked;
      draw();
    });
    archToggle.append(box, document.createTextNode("Show archived"));
    filterBar.appendChild(archToggle);
  }
  body.appendChild(filterBar);

  const count = el("div", "app-settings-note", "");
  body.appendChild(count);
  const grid = el("div", "app-ritual-grid");
  body.appendChild(grid);

  const draw = () => {
    clear(grid);
    const shown = scoped.filter((x) => {
      if (!showArchived && x.board.isArchived) return false;
      if (catFilter !== "" && x.board.category !== catFilter) return false;
      if (siteFilter !== "" && x.board.site !== siteFilter) return false;
      if (query !== "" && !x.board.name.toLowerCase().includes(query)) return false;
      return true;
    });
    count.textContent = `${shown.length} of ${scoped.length} ${scoped.length === 1 ? "ritual" : "rituals"}`;
    if (shown.length === 0) {
      grid.appendChild(el("div", "app-settings-note", "No rituals match."));
      return;
    }
    for (const { board: b, owner, cadence } of shown) {
      const card = el("div", "app-ritual-card");
      const catColor = colorByCategory[b.category] ?? "";
      if (catColor !== "") card.style.borderTopColor = catColor;

      const titleRow = el("div", "app-ritual-title");
      titleRow.appendChild(el("span", "", b.name));
      if (b.isArchived) {
        titleRow.appendChild(el("span", "app-status-badge app-status-revoked", "Archived"));
      }
      // admins keep management visibility of confidential rituals; the
      // meeting content itself stays owner/participant-only
      if (isConfidentialBoard(b.occurrenceSettingsRaw)) {
        titleRow.appendChild(el("span", "app-status-badge", "🔒 Confidential"));
      }
      if (b.category !== "") {
        const chip = el("span", "app-ritual-cat", b.category);
        if (catColor !== "") {
          chip.style.background = catColor;
          chip.style.color = "#fff";
        }
        titleRow.appendChild(chip);
      }
      card.appendChild(titleRow);
      const place = [b.site, b.department].filter(Boolean).join(" \u00b7 ");
      if (place !== "") card.appendChild(el("div", "app-ritual-meta", place));
      if (cadence !== "") card.appendChild(el("div", "app-ritual-meta", cadence));

      const ownerPerson = owner ? personBy.get(owner.whoId) : undefined;
      const ownerLine = el("div", "app-ritual-owner");
      ownerLine.append(
        el("span", "app-user-field-label", "Owner"),
        el(
          "span",
          "app-ritual-meta",
          owner
            ? `${ownerPerson?.who ?? owner.who}${ownerPerson?.email ? ` \u00b7 ${ownerPerson.email}` : ""}`
            : "not set"
        )
      );
      card.appendChild(ownerLine);

      const actions = el("div", "app-ritual-actions");
      const open = el("a", "app-btn", "Open") as HTMLAnchorElement;
      open.href = boardHash(b.boardId);
      actions.appendChild(open);
      // the same link, for pasting into a channel or a calendar invite
      const copy = el("button", "app-btn", "Copy link") as HTMLButtonElement;
      copy.title = "Copy a link that opens the latest meeting";
      copy.addEventListener("click", () => {
        const link = boardUrl(b.boardId);
        void copyText(link).then((ok) => {
          if (!ok) {
            // the host refused the clipboard — hand over the raw URL
            const box = el("input", "app-input app-ritual-link") as HTMLInputElement;
            box.value = link;
            box.readOnly = true;
            copy.replaceWith(box);
            box.select();
            box.addEventListener("blur", () => box.replaceWith(copy));
            return;
          }
          copy.textContent = "Copied";
          window.setTimeout(() => (copy.textContent = "Copy link"), 1600);
        });
      });
      actions.appendChild(copy);
      if (isAdmin || owner?.whoId === me.whoId) {
        // Edit meeting covers the board too (wizard step 7)
        const edit = el("a", "app-btn", "Edit meeting") as HTMLAnchorElement;
        edit.href = `#/wizard/${b.boardId}`;
        actions.appendChild(edit);
      }
      if (isAdmin) {
        const rep = el("button", "app-btn", "Replicate") as HTMLButtonElement;
        rep.addEventListener("click", () => {
          void (async () => {
            const name = (
              (await promptText({
                title: `Replicate "${b.name}"`,
                initial: `${b.name} (copy)`,
                confirmLabel: "Replicate",
              })) ?? ""
            ).trim();
            if (name === "") return;
            const newId = await replicateBoard(b.boardId, name);
            window.location.hash = `#/wizard/${newId}`;
          })();
        });
        actions.appendChild(rep);
        // archiving hides the ritual from every list (calendar, My day,
        // rituals) but keeps its data; restore brings it straight back
        const arch = el(
          "button",
          "app-btn",
          b.isArchived ? "Restore" : "Archive"
        ) as HTMLButtonElement;
        arch.addEventListener("click", () => {
          void setBoardArchived(b.id, !b.isArchived).then(() =>
            renderBoardsAdmin(body, me)
          );
        });
        actions.appendChild(arch);
      }
      card.appendChild(actions);
      grid.appendChild(card);
    }
  };
  draw();
}
