// LeanBoard app shell — vanilla TS, hash-routed. Screens mount the
// toolkit's platform-free editor classes through CardHost; data comes
// from the typed Dataverse store inside Power Apps, demo data on a bare
// dev server.

import { el, clear } from "../../shared/ui/dom";
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
  } catch {
    /* branding is cosmetic — never block the shell */
  }
})();

let cleanup: () => void = () => undefined;

// Screens load lazily: the shell paints before any store/SDK module
// evaluates, and a screen that fails to load shows its error instead of
// blanking the whole app (host-side failures stay debuggable).
function route(): void {
  cleanup();
  cleanup = () => undefined;
  clear(outlet);
  const hash = window.location.hash || "#/";
  const parts = hash.slice(2).split("/").filter(Boolean); // drop "#/"

  for (const a of Array.from(nav.querySelectorAll("a"))) {
    a.classList.toggle("app-link-on", a.getAttribute("href") === hash);
  }

  void (async () => {
    try {
      if (parts[0] === "board" && parts[1]) {
        const { mountBoard } = await import("./screens/board");
        cleanup = mountBoard(outlet, parts[1], decodeURIComponent(parts[2] ?? ""));
      } else if (parts[0] === "setup" && parts[1]) {
        const { mountComposer } = await import("./screens/composer");
        cleanup = mountComposer(outlet, parts[1]);
      } else if (parts[0] === "edit" && parts[1] && parts[2] && parts[3]) {
        const { mountCardEditor } = await import("./screens/cardEditor");
        cleanup = mountCardEditor(outlet, parts[1], parts[2], parts[3]);
      } else if (parts[0] === "boards") {
        const { mountBoards } = await import("./screens/boards");
        cleanup = mountBoards(outlet);
      } else if (parts[0] === "wizard") {
        const { mountWizard } = await import("./screens/wizard");
        cleanup = mountWizard(outlet);
      } else if (parts[0] === "people") {
        const { mountPeople } = await import("./screens/people");
        cleanup = mountPeople(outlet);
      } else if (parts[0] === "settings") {
        const { mountSettings } = await import("./screens/settings");
        cleanup = mountSettings(outlet);
      } else {
        const { mountHub } = await import("./screens/hub");
        cleanup = mountHub(outlet);
      }
    } catch (err) {
      const box = el("pre", "app-missing");
      box.textContent = `Screen failed to load:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
      outlet.appendChild(box);
    }
  })();
}

window.addEventListener("hashchange", route);
route();
