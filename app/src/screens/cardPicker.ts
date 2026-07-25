// The add-card picker (docs/leanboard-card-studio-plan.md) — what opens when
// a maker taps ＋ Add card on an empty cell. It used to be a text list inside
// the composer's settings pane; here it is an overlay showing each card's
// real tile art, so a maker recognises the card rather than reading about it.
//
// The result is a union so phase 3 can add its other two sources (restore an
// archived card, copy an existing card from any board the viewer can see)
// without changing a single call site.

import { sanitizeSvg } from "../../../controls/BoardGrid/types";
import { CARDS, CARD_GROUPS } from "../../../controls/CardSettings/registry";
import { clear, el } from "../../../shared/ui/dom";

export type PickerResult =
  | { kind: "new"; cardType: string }
  | null; // dismissed

export interface PickerOptions {
  /** Default tile art per card type, for the option thumbnails. */
  catalogSvg: Record<string, string>;
}

export function openCardPicker(opts: PickerOptions): Promise<PickerResult> {
  return new Promise<PickerResult>((resolve) => {
    let search = "";

    const overlay = el("div", "app-picker-overlay");
    const panel = el("div", "app-picker-panel");
    overlay.appendChild(panel);

    const head = el("div", "app-picker-head");
    head.appendChild(el("span", "app-picker-title", "Add a card"));
    const searchInput = el("input", "app-input app-picker-search") as HTMLInputElement;
    searchInput.type = "text";
    searchInput.placeholder = "Search cards…";
    head.appendChild(searchInput);
    const closeBtn = el("button", "app-btn", "Cancel") as HTMLButtonElement;
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const bodyEl = el("div", "app-picker-body");
    panel.appendChild(bodyEl);
    document.body.appendChild(overlay);

    const close = (result: PickerResult) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    closeBtn.addEventListener("click", () => close(null));

    const fill = () => {
      clear(bodyEl);
      const q = search.trim().toLowerCase();
      const hits = CARDS.filter(
        (c) =>
          !c.hidden &&
          (q === "" ||
            c.label.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.type.toLowerCase().includes(q) ||
            c.group.toLowerCase().includes(q))
      );
      if (hits.length === 0) {
        bodyEl.appendChild(el("div", "app-picker-empty", "No cards match."));
        return;
      }
      const groups = [
        ...CARD_GROUPS,
        ...hits.map((c) => c.group).filter((g) => !CARD_GROUPS.includes(g)),
      ];
      for (const group of groups) {
        const inGroup = hits.filter((c) => c.group === group);
        if (inGroup.length === 0) continue;
        bodyEl.appendChild(el("div", "app-picker-group", group));
        const grid = el("div", "app-picker-grid");
        for (const card of inGroup) {
          const opt = el("button", "app-picker-opt") as HTMLButtonElement;
          opt.type = "button";
          const art = el("div", "app-picker-art");
          // catalog art is stored markup — through the same sanitiser the
          // board tiles use, never innerHTML
          const svg = sanitizeSvg(opts.catalogSvg[card.type] ?? "");
          if (svg) {
            svg.removeAttribute("width");
            svg.removeAttribute("height");
            art.appendChild(document.importNode(svg, true));
          }
          opt.append(
            art,
            el("span", "app-picker-opt-label", card.label),
            el("span", "app-picker-opt-desc", card.description)
          );
          opt.addEventListener("click", () => close({ kind: "new", cardType: card.type }));
          grid.appendChild(opt);
        }
        bodyEl.appendChild(grid);
      }
    };

    searchInput.addEventListener("input", () => {
      search = searchInput.value;
      fill();
    });
    fill();
    searchInput.focus();
  });
}
