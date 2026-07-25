// The add-card picker (docs/leanboard-card-studio-plan.md) — what opens when
// a maker taps ＋ Add card on an empty cell. Three sources:
//
//   New card   the catalogue, showing each type's real tile art (it used to
//              be a text list inside the composer's settings pane)
//   Archived   this board's own archived cards, restored with their settings,
//              content and history intact — or deleted for good
//   Copy       any card on any board the viewer can see, copied into an
//              INDEPENDENT new card (a fresh cardId sharing no data), unlike
//              a Linked card, which mirrors its source live and read-only
//
// The result is a union, so a call site handles the three without caring how
// the picker is laid out.

import { sanitizeSvg } from "../../../controls/BoardGrid/types";
import { CARDS, CARD_GROUPS, cardLabel } from "../../../controls/CardSettings/registry";
import { BoardRef } from "../../../controls/CardSettings/types";
import { clear, el } from "../../../shared/ui/dom";
import { ManifestSlot } from "../store/mappers";

export type PickerResult =
  | { kind: "new"; cardType: string }
  | { kind: "archived"; cardId: string }
  | { kind: "copy"; boardId: string; cardId: string; withContent: boolean }
  | null; // dismissed

export interface PickerOptions {
  /** Default tile art per card type, for the option thumbnails. */
  catalogSvg: Record<string, string>;
  /** This board's archived cards, with whatever snapshot they left behind. */
  archived: { slot: ManifestSlot; svg: string }[];
  /** Boards offered as copy sources — this board included, viewer-filtered. */
  copySources: BoardRef[];
  /** Permanent delete from the archive (manifest only; rows are kept). */
  onDeleteArchived: (cardId: string) => Promise<void>;
}

type Tab = "new" | "archived" | "copy";

export function openCardPicker(opts: PickerOptions): Promise<PickerResult> {
  return new Promise<PickerResult>((resolve) => {
    let search = "";
    let tab: Tab = "new";
    const archived = opts.archived.slice();

    const overlay = el("div", "app-picker-overlay");
    const panel = el("div", "app-picker-panel");
    overlay.appendChild(panel);

    const head = el("div", "app-picker-head");
    head.appendChild(el("span", "app-picker-title", "Add a card"));
    const tabsBar = el("div", "app-picker-tabs");
    head.appendChild(tabsBar);
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

    /** A thumbnail from stored markup, through the tiles' own sanitiser. */
    const artFor = (markup: string): HTMLElement => {
      const art = el("div", "app-picker-art");
      const svg = sanitizeSvg(markup ?? "");
      if (svg) {
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        art.appendChild(document.importNode(svg, true));
      }
      return art;
    };

    const matches = (...fields: string[]): boolean => {
      const q = search.trim().toLowerCase();
      return q === "" || fields.some((f) => f.toLowerCase().includes(q));
    };

    // ---- source 1: a new card from the catalogue ----
    const fillNew = () => {
      const hits = CARDS.filter(
        (c) => !c.hidden && matches(c.label, c.description, c.type, c.group)
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
          opt.append(
            artFor(opts.catalogSvg[card.type] ?? ""),
            el("span", "app-picker-opt-label", card.label),
            el("span", "app-picker-opt-desc", card.description)
          );
          opt.addEventListener("click", () => close({ kind: "new", cardType: card.type }));
          grid.appendChild(opt);
        }
        bodyEl.appendChild(grid);
      }
    };

    // ---- source 2: restore (or delete) one of this board's archived cards ----
    const fillArchived = () => {
      bodyEl.appendChild(
        el(
          "div",
          "app-picker-note",
          "Archived cards keep their settings, saved content and history — putting one back " +
            "picks up exactly where it left off."
        )
      );
      const hits = archived.filter((a) =>
        matches(a.slot.title, a.slot.cardType, cardLabel(a.slot.cardType))
      );
      if (hits.length === 0) {
        bodyEl.appendChild(
          el("div", "app-picker-empty", archived.length === 0 ? "Nothing archived." : "No cards match.")
        );
        return;
      }
      const grid = el("div", "app-picker-grid");
      for (const entry of hits) {
        const opt = el("div", "app-picker-opt app-picker-opt-arch");
        const pick = el("button", "app-picker-pickbtn") as HTMLButtonElement;
        pick.type = "button";
        pick.append(
          artFor(entry.svg !== "" ? entry.svg : (opts.catalogSvg[entry.slot.cardType] ?? "")),
          el("span", "app-picker-opt-label", entry.slot.title || cardLabel(entry.slot.cardType)),
          el("span", "app-picker-opt-desc", cardLabel(entry.slot.cardType))
        );
        pick.addEventListener("click", () =>
          close({ kind: "archived", cardId: entry.slot.cardId })
        );
        const del = el("button", "app-picker-del", "Delete") as HTMLButtonElement;
        del.type = "button";
        del.title = "Remove this card from the archive for good";
        del.addEventListener("click", () => {
          void (async () => {
            const ok = window.confirm(
              `Delete "${entry.slot.title || cardLabel(entry.slot.cardType)}" for good?\n\n` +
                "It leaves the archive and cannot be added back. Its saved content stays " +
                "in the database — including the images past meetings archived — but " +
                "nothing in the app will show it again."
            );
            if (!ok) return;
            await opts.onDeleteArchived(entry.slot.cardId);
            const i = archived.indexOf(entry);
            if (i >= 0) archived.splice(i, 1);
            paintTabs();
            fill();
          })();
        });
        opt.append(pick, del);
        grid.appendChild(opt);
      }
      bodyEl.appendChild(grid);
    };

    // ---- source 3: copy a card from any board the viewer can see ----
    let copyBoardId = opts.copySources[0]?.boardId ?? "";
    let copyWithContent = true;
    const fillCopy = () => {
      bodyEl.appendChild(
        el(
          "div",
          "app-picker-note",
          "A copy is an independent card: it starts from this one's setup, then goes its own " +
            "way. (To mirror a card live instead, add a Linked card.)"
        )
      );
      if (opts.copySources.length === 0) {
        bodyEl.appendChild(el("div", "app-picker-empty", "No boards available."));
        return;
      }
      const controls = el("div", "app-picker-copybar");
      const sel = el("select", "app-input") as HTMLSelectElement;
      for (const ref of opts.copySources) {
        const o = el("option", "", ref.name) as HTMLOptionElement;
        o.value = ref.boardId;
        sel.appendChild(o);
      }
      sel.value = copyBoardId;
      sel.addEventListener("change", () => {
        copyBoardId = sel.value;
        fill();
      });
      const withLabel = el("label", "app-picker-check");
      const withBox = el("input", "") as HTMLInputElement;
      withBox.type = "checkbox";
      withBox.checked = copyWithContent;
      withBox.addEventListener("change", () => {
        copyWithContent = withBox.checked;
      });
      withLabel.append(withBox, el("span", "", "Copy its standard content"));
      withLabel.title =
        "Bring the source's starting content across too. Turn it off to copy only the setup.";
      controls.append(el("span", "app-picker-copylabel", "From board"), sel, withLabel);
      bodyEl.appendChild(controls);

      const ref = opts.copySources.find((b) => b.boardId === copyBoardId);
      const cards = (ref?.cards ?? []).filter((c) =>
        matches(c.title, c.cardType, cardLabel(c.cardType))
      );
      if (cards.length === 0) {
        bodyEl.appendChild(
          el("div", "app-picker-empty", "This board has no cards to copy.")
        );
        return;
      }
      const grid = el("div", "app-picker-grid");
      for (const c of cards) {
        const opt = el("button", "app-picker-opt") as HTMLButtonElement;
        opt.type = "button";
        opt.append(
          artFor(opts.catalogSvg[c.cardType] ?? ""),
          el("span", "app-picker-opt-label", c.title || cardLabel(c.cardType)),
          el("span", "app-picker-opt-desc", cardLabel(c.cardType))
        );
        opt.addEventListener("click", () =>
          close({
            kind: "copy",
            boardId: copyBoardId,
            cardId: c.cardId,
            withContent: copyWithContent,
          })
        );
        grid.appendChild(opt);
      }
      bodyEl.appendChild(grid);
    };

    const fill = () => {
      clear(bodyEl);
      if (tab === "new") fillNew();
      else if (tab === "archived") fillArchived();
      else fillCopy();
    };

    const paintTabs = () => {
      clear(tabsBar);
      const tabs: [Tab, string][] = [["new", "New card"]];
      if (archived.length > 0) tabs.push(["archived", `Archived (${archived.length})`]);
      tabs.push(["copy", "Copy existing"]);
      // the archive can empty out while it is open
      if (tab === "archived" && archived.length === 0) tab = "new";
      for (const [key, label] of tabs) {
        const b = el(
          "button",
          "app-picker-tab" + (tab === key ? " app-picker-tab-on" : ""),
          label
        ) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          tab = key;
          paintTabs();
          fill();
        });
        tabsBar.appendChild(b);
      }
    };

    searchInput.addEventListener("input", () => {
      search = searchInput.value;
      fill();
    });
    paintTabs();
    fill();
    searchInput.focus();
  });
}
