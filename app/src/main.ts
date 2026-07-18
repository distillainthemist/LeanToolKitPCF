// LeanToolKit app shell — vanilla TS, hash-routed. Screens mount the
// toolkit's platform-free editor classes through CardHost; the Dataverse
// store arrives in Phase 3 (demo data until then).

import { el, clear } from "../../shared/ui/dom";
import { mountHub } from "./screens/hub";
import { mountBoard } from "./screens/board";
import { mountCard } from "./screens/card";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;

const bar = el("header", "app-bar");
const brand = el("span", "app-brand", "LeanToolKit");
const nav = el("nav", "app-nav");
const link = (label: string, hash: string) => {
  const a = el("a", "app-link", label) as HTMLAnchorElement;
  a.href = hash;
  nav.appendChild(a);
  return a;
};
link("My day", "#/");
link("Card demo", "#/card/fishbone");
bar.append(brand, nav);
app.appendChild(bar);

const outlet = el("main", "app-outlet");
app.appendChild(outlet);

let cleanup: () => void = () => undefined;

function route(): void {
  cleanup();
  clear(outlet);
  const hash = window.location.hash || "#/";
  const parts = hash.slice(2).split("/").filter(Boolean); // drop "#/"

  for (const a of Array.from(nav.querySelectorAll("a"))) {
    a.classList.toggle("app-link-on", a.getAttribute("href") === hash);
  }

  if (parts[0] === "board" && parts[1]) {
    cleanup = mountBoard(outlet, parts[1], decodeURIComponent(parts[2] ?? ""));
  } else if (parts[0] === "card") {
    cleanup = mountCard(outlet);
  } else {
    cleanup = mountHub(outlet);
  }
}

window.addEventListener("hashchange", route);
route();
