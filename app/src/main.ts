// LeanBoard app shell — vanilla TS, hash-routed. Screens mount the
// toolkit's platform-free editor classes through CardHost; data comes
// from the typed Dataverse store inside Power Apps, demo data on a bare
// dev server.

import { el, clear } from "../../shared/ui/dom";
import { getLeaveGuard, setLeaveGuard } from "./navGuard";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;

const bar = el("header", "app-bar");
const brand = el("span", "app-brand", "LeanBoard");
const nav = el("nav", "app-nav");
const link = (label: string, hash: string) => {
  const a = el("a", "app-link", label) as HTMLAnchorElement;
  a.href = hash;
  nav.appendChild(a);
  return a;
};
link("My day", "#/");
const gap = el("span", "app-bar-gap");
const cog = el("a", "app-link app-link-cog", "\u2699 Settings") as HTMLAnchorElement;
cog.href = "#/settings";
nav.appendChild(gap);
nav.appendChild(cog);
bar.append(brand, nav);
app.appendChild(bar);

const outlet = el("main", "app-outlet");
app.appendChild(outlet);

// Branding: app accent < site accent precedence, name + logo in the bar.
// Loaded lazily so the shell paints before any SDK module evaluates.
void (async () => {
  try {
    const { detectHost, currentViewer } = await import("./runtime");
    if (!(await detectHost())) return;
    const { branding, siteSettings } = await import("./store/config");
    const { viewerPerson } = await import("./store/people");
    const b = await branding();
    if (b.appName.trim() !== "") brand.textContent = b.appName.trim();
    if (b.logo.startsWith("data:image/")) {
      const img = el("img", "app-logo") as HTMLImageElement;
      img.src = b.logo;
      img.alt = "";
      brand.prepend(img);
    }
    let accent = b.accent.trim();
    const viewer = currentViewer();
    const me = viewer ? await viewerPerson(viewer.objectId) : null;
    if (me && me.site !== "") {
      const s = await siteSettings(me.site);
      if (s.accent.trim() !== "") accent = s.accent.trim();
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(accent)) {
      document.documentElement.style.setProperty("--app-accent", accent);
    }
    // view-as banner: a super admin previewing a lesser role always sees
    // it flagged, with a one-click way back. NO page reloads here — a raw
    // iframe reload loses the Power Apps host handshake (getContext never
    // answers), so changes repaint the banner and re-route in place.
    if (me && me.role === "superadmin") {
      const { viewAsRole, setViewAsRole } = await import("./viewAs");
      const paintViewAs = () => {
        document.querySelector(".app-viewas-banner")?.remove();
        const emulated = viewAsRole();
        if (!emulated) return;
        const banner = el("div", "app-viewas-banner");
        banner.append(
          el(
            "span",
            "app-viewas-msg",
            `Viewing as ${emulated === "siteadmin" ? "site admin" : "user"} — admin controls are hidden the way they are for that role.`
          )
        );
        const exit = el("button", "app-btn app-viewas-exit", "Exit view as");
        exit.addEventListener("click", () => {
          setViewAsRole(null);
          paintViewAs();
          window.dispatchEvent(new Event("hashchange")); // re-route in place
        });
        banner.appendChild(exit);
        app.insertBefore(banner, outlet);
      };
      paintViewAs();
      window.addEventListener("leanboard:viewas", paintViewAs);
    }
  } catch {
    /* branding is cosmetic — never block the shell */
  }
})();

let cleanup: () => void = () => undefined;
// a route call is superseded when a newer one starts before its lazy
// import resolves — the stale one must not mount (stacked screens)
let routeToken = 0;

// Screens load lazily: the shell paints before any store/SDK module
// evaluates, and a screen that fails to load shows its error instead of
// blanking the whole app (host-side failures stay debuggable).
function route(): void {
  const token = ++routeToken;
  cleanup();
  cleanup = () => undefined;
  setLeaveGuard(null); // the outgoing screen's guard never outlives it
  clear(outlet);
  const hash = window.location.hash || "#/";
  const parts = hash.slice(2).split("/").filter(Boolean); // drop "#/"

  for (const a of Array.from(nav.querySelectorAll("a"))) {
    a.classList.toggle("app-link-on", a.getAttribute("href") === hash);
  }

  void (async () => {
    try {
      let mount: () => () => void;
      if (parts[0] === "board" && parts[1]) {
        const { mountBoard } = await import("./screens/board");
        mount = () => mountBoard(outlet, parts[1], decodeURIComponent(parts[2] ?? ""));
      } else if (parts[0] === "setup" && parts[1]) {
        const { mountComposer } = await import("./screens/composer");
        mount = () => mountComposer(outlet, parts[1], parts[2] === "new");
      } else if (parts[0] === "adjust" && parts[1] && parts[2]) {
        const { mountInstanceComposer } = await import("./screens/composer");
        mount = () => mountInstanceComposer(outlet, parts[1], parts[2]);
      } else if (parts[0] === "edit" && parts[1] && parts[2] && parts[3]) {
        const { mountCardEditor } = await import("./screens/cardEditor");
        mount = () => mountCardEditor(outlet, parts[1], parts[2], parts[3]);
      } else if (parts[0] === "boards") {
        const { mountBoards } = await import("./screens/boards");
        mount = () => mountBoards(outlet);
      } else if (parts[0] === "wizard") {
        const { mountWizard } = await import("./screens/wizard");
        mount = () => mountWizard(outlet, parts[1] ?? "");
      } else if (parts[0] === "people") {
        const { mountPeople } = await import("./screens/people");
        mount = () => mountPeople(outlet);
      } else if (parts[0] === "settings") {
        const { mountSettings } = await import("./screens/settings");
        mount = () => mountSettings(outlet, parts[1] ?? "");
      } else {
        const { mountHub } = await import("./screens/hub");
        mount = () => mountHub(outlet);
      }
      if (token !== routeToken) return; // superseded — do not mount
      cleanup = mount();
    } catch (err) {
      if (token !== routeToken) return;
      const box = el("pre", "app-missing");
      box.textContent = `Screen failed to load:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
      outlet.appendChild(box);
    }
  })();
}

// Hash routing with a leave-guard. The guarded path never touches the
// hash while deciding (each programmatic hash set queues its OWN
// hashchange event — the old revert-then-proceed dance fired three
// routes and stacked three screens). Only a refused guard reverts the
// hash, and that one event is swallowed via `suppressNext`.
let currentHash = window.location.hash || "#/";
let suppressNext = false;
let guardBusy = false;

async function onHashChange(): Promise<void> {
  if (suppressNext) {
    suppressNext = false;
    return;
  }
  const target = window.location.hash || "#/";
  if (target !== currentHash) {
    const guard = getLeaveGuard();
    if (guard) {
      if (guardBusy) return; // one prompt at a time
      guardBusy = true;
      const ok = await guard();
      guardBusy = false;
      if (!ok) {
        suppressNext = true;
        window.location.hash = currentHash; // stay put
        return;
      }
      setLeaveGuard(null);
    }
  }
  currentHash = window.location.hash || "#/";
  route();
}

window.addEventListener("hashchange", () => void onHashChange());
route();
