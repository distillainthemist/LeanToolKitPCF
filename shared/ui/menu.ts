// The kebab menu — the standard home for secondary actions (export PNG,
// reset to loaded, settings) so the primary canvas stays clean.

import { el } from "./dom";

export interface MenuItem {
  label: string;
  onClick: () => void;
}

export function renderKebab(host: HTMLElement, items: MenuItem[]): HTMLElement {
  const wrap = el("div", "ltk-kebab");
  const btn = el("button", "ltk-kebab-btn", "⋮");
  btn.type = "button";
  btn.setAttribute("aria-label", "More actions");
  const menu = el("div", "ltk-kebab-menu");
  menu.style.display = "none";

  for (const item of items) {
    const mi = el("button", "ltk-kebab-item", item.label);
    mi.type = "button";
    mi.addEventListener("click", () => {
      menu.style.display = "none";
      item.onClick();
    });
    menu.appendChild(mi);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target as Node)) menu.style.display = "none";
  });

  wrap.append(btn, menu);
  host.appendChild(wrap);
  return wrap;
}
