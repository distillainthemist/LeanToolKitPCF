// The AgendaCard editor: a meeting run-sheet in three collapsible sections —
// pre-work (checkable, with an optional link and a who), the agenda itself
// (title / prompt / who / minutes / links, with actions captured per item),
// and outputs (a simple checkable list). Pre-work and outputs start
// collapsed; the agenda starts open. Collapse is view state only — toggling
// a section never dirties the document.

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { hintFor, parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import {
  checkItem,
  checklist,
  fieldRow,
  openDialog,
  sectionLabel,
  textArea,
  textInput,
  DialogButton,
} from "../../shared/ui/dialog";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { makeInteractive } from "../../shared/interact/drag";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  AgendaEnvelope,
  AgendaItem,
  AgendaLink,
  newAgendaItem,
  newOutput,
  newPrework,
  OutputItem,
  PreworkItem,
  safeUrl,
  SCHEMA_ID,
  totalMinutes,
} from "./types";
import { AGENDA_CSS } from "./styles";

export interface AgendaEditorCallbacks {
  onChange: (env: AgendaEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

type SectionKey = "prework" | "agenda" | "outputs";

/** The who selector: people chips as a radio group, or/and a free-text name. */
interface WhoPicker {
  el: HTMLElement;
  apply: (target: { whoId: string; who: string }) => void;
}

export class AgendaEditor {
  private readonly root: HTMLElement;
  private env: AgendaEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private disableActions = false; // hide the raise-action affordances
  // view state only — never part of the document
  private open: Record<SectionKey, boolean> = {
    prework: false,
    agenda: true,
    outputs: false,
  };
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: AgendaEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-agenda-css", AGENDA_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { prework: [], items: [], outputs: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  // ---- host-facing API (setters no-op when unchanged) ----

  setEnvelope(env: AgendaEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setPeople(people: Person[]): void {
    this.people = people;
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) {
      return;
    }
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  setDisableActions(on: boolean): void {
    if (this.disableActions !== on) {
      this.disableActions = on;
      this.render();
    }
  }

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  // ---- helpers ----

  private doneColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }

  private actionsFor(itemId: string): LtkAction[] {
    return this.actions.filter(
      (a) => a.context.sourceId === itemId && a.status !== "cancelled"
    );
  }

  // ---- rendering ----

  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-ag-body");
    this.root.appendChild(body);

    const d = this.env.data;

    body.appendChild(
      this.renderSection("prework", "Pre-work", this.preworkSummary(), {
        renderList: (list) => {
          for (const item of d.prework) list.appendChild(this.preworkRow(item));
          if (d.prework.length === 0) {
            list.appendChild(
              el("div", "ltk-ag-empty", "No pre-work yet.")
            );
          }
        },
        onAdd: () => this.openPreworkDialog(newPrework(), true),
        addLabel: "＋ Pre-work",
      })
    );

    body.appendChild(
      this.renderSection("agenda", "Agenda", this.agendaSummary(), {
        renderList: (list) => {
          d.items.forEach((item, i) =>
            list.appendChild(this.agendaRow(item, i))
          );
          if (d.items.length === 0) {
            list.appendChild(
              el(
                "div",
                "ltk-ag-empty",
                this.prompts.general[0] ?? "No agenda items yet."
              )
            );
          }
        },
        onAdd: () => this.openAgendaDialog(newAgendaItem(), true),
        addLabel: "＋ Item",
      })
    );

    body.appendChild(
      this.renderSection("outputs", "Outputs", this.outputsSummary(), {
        renderList: (list) => {
          for (const item of d.outputs) list.appendChild(this.outputRow(item));
          if (d.outputs.length === 0) {
            list.appendChild(el("div", "ltk-ag-empty", "No outputs yet."));
          }
        },
        onAdd: () => this.openOutputDialog(newOutput(), true),
        addLabel: "＋ Output",
      })
    );
  }

  private preworkSummary(): string {
    const items = this.env.data.prework;
    if (items.length === 0) return "";
    const done = items.filter((p) => p.done).length;
    return `${done}/${items.length} done`;
  }

  private agendaSummary(): string {
    const items = this.env.data.items;
    if (items.length === 0) return "";
    const mins = totalMinutes(items);
    const count = `${items.length} item${items.length === 1 ? "" : "s"}`;
    return mins > 0 ? `${count} · ${mins} min` : count;
  }

  private outputsSummary(): string {
    const items = this.env.data.outputs;
    if (items.length === 0) return "";
    const done = items.filter((o) => o.done).length;
    return `${done}/${items.length} done`;
  }

  private renderSection(
    key: SectionKey,
    label: string,
    summary: string,
    opts: {
      renderList: (list: HTMLElement) => void;
      onAdd: () => void;
      addLabel: string;
    }
  ): HTMLElement {
    const section = el("div", "ltk-ag-section");
    if (this.open[key]) section.classList.add("ltk-ag-open");

    const head = el("button", "ltk-ag-head");
    head.type = "button";
    head.appendChild(el("span", "ltk-ag-chevron", "▶"));
    head.appendChild(el("span", "ltk-ag-head-label", label));
    if (summary !== "") {
      head.appendChild(el("span", "ltk-ag-head-summary", summary));
    }
    head.appendChild(el("span", "ltk-ag-head-spacer"));
    if (!this.readOnly) {
      const add = el("span", "ltk-ag-add", opts.addLabel);
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.open[key]) {
          this.open[key] = true;
          this.render();
        }
        opts.onAdd();
      });
      head.appendChild(add);
    }
    head.addEventListener("click", () => {
      this.open[key] = !this.open[key];
      this.render(); // view state only — no commit
    });
    section.appendChild(head);

    if (this.open[key]) {
      const list = el("div", "ltk-ag-list");
      opts.renderList(list);
      section.appendChild(list);
    }
    return section;
  }

  /** The shared check circle (colours inline — Safari rule). */
  private checkCircle(done: boolean, onToggle: () => void): HTMLButtonElement {
    const circle = el("button", "ltk-ag-circle") as HTMLButtonElement;
    circle.type = "button";
    circle.textContent = done ? "✓" : "";
    circle.title = done ? "Mark not done" : "Mark done";
    if (done) {
      circle.style.background = this.doneColor();
      circle.style.borderColor = this.doneColor();
      circle.style.color = textOn(this.doneColor());
    }
    if (!this.readOnly) {
      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle();
      });
    }
    return circle;
  }

  private linkAnchor(link: AgendaLink): HTMLElement {
    const url = safeUrl(link.url);
    if (url === "") return el("span", "ltk-ag-link", link.title);
    const a = el("a", "ltk-ag-link", link.title || url);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", (e) => e.stopPropagation()); // never opens the row dialog
    return a;
  }

  // ---- pre-work ----

  private preworkRow(item: PreworkItem): HTMLElement {
    const row = el("div", "ltk-ag-row");
    if (this.readOnly) row.classList.add("ltk-readonly");

    row.appendChild(
      this.checkCircle(item.done, () => {
        item.done = !item.done;
        this.commit();
      })
    );

    const main = el("div", "ltk-ag-main");
    const title = el("div", "ltk-ag-title", item.title);
    if (item.done) title.classList.add("ltk-ag-done");
    main.appendChild(title);
    if (item.link) {
      const links = el("div", "ltk-ag-links");
      links.appendChild(this.linkAnchor(item.link));
      main.appendChild(links);
    }
    row.appendChild(main);

    if (item.who !== "") {
      const right = el("div", "ltk-ag-right");
      right.appendChild(el("div", "ltk-ag-who", item.who));
      row.appendChild(right);
    }

    if (!this.readOnly) {
      row.addEventListener("click", () => this.openPreworkDialog(item, false));
    }
    return row;
  }

  private openPreworkDialog(item: PreworkItem, isNew: boolean): void {
    const title = textInput(item.title, {
      placeholder: hintFor(this.prompts, "prework", "What must be ready before the meeting?"),
    });
    const linkTitle = textInput(item.link?.title ?? "", {
      placeholder: "e.g. Last month pack",
    });
    const linkUrl = textInput(item.link?.url ?? "", {
      placeholder: "https://",
    });
    const who = this.buildWhoPicker({ whoId: item.whoId, who: item.who });

    const save = () => {
      const t = title.value.trim();
      if (t === "") return;
      item.title = t;
      const url = linkUrl.value.trim();
      item.link =
        url !== ""
          ? { title: linkTitle.value.trim() || url, url }
          : undefined;
      who.apply(item);
      if (isNew) this.env.data.prework.push(item);
      dlg.close();
      this.commit();
    };

    const buttons: DialogButton[] = [];
    if (!isNew) {
      buttons.push({
        label: "Delete",
        kind: "danger",
        onClick: () => {
          this.env.data.prework = this.env.data.prework.filter(
            (p) => p.id !== item.id
          );
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary", onClick: () => dlg.close() });
    buttons.push({ label: isNew ? "Add" : "Save", kind: "primary", onClick: save });

    const dlg = openDialog({
      host: this.root,
      title: isNew ? "Add pre-work" : "Edit pre-work",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Pre-work", title));
    dlg.body.appendChild(fieldRow("Link title (optional)", linkTitle));
    dlg.body.appendChild(fieldRow("Link URL (optional)", linkUrl));
    dlg.body.appendChild(sectionLabel("Who"));
    dlg.body.appendChild(who.el);
    title.focus();
  }

  // ---- agenda ----

  private agendaRow(item: AgendaItem, index: number): HTMLElement {
    const row = el("div", "ltk-ag-row");
    row.dataset.itemId = item.id;
    if (this.readOnly) row.classList.add("ltk-readonly");

    if (!this.readOnly) {
      // drag handle — reorder by dragging; the rest of the row still taps
      // (opens the editor) and scrolls (touch), so dragging never fights the
      // list's own vertical scroll
      row.classList.add("ltk-ag-drag");
      const grip = el("div", "ltk-ag-grip", "⠿");
      grip.title = "Drag to reorder";
      this.setupRowDrag(row, grip);
      row.appendChild(grip);
    }

    row.appendChild(el("div", "ltk-ag-num", String(index + 1)));

    const main = el("div", "ltk-ag-main");
    main.appendChild(el("div", "ltk-ag-title", item.title));
    if (item.prompt !== "") {
      main.appendChild(el("div", "ltk-ag-prompt", item.prompt));
    }
    if (item.links.length > 0) {
      const links = el("div", "ltk-ag-links");
      for (const link of item.links) links.appendChild(this.linkAnchor(link));
      main.appendChild(links);
    }
    row.appendChild(main);

    const right = el("div", "ltk-ag-right");
    if (item.who !== "") right.appendChild(el("div", "ltk-ag-who", item.who));
    if (item.minutes > 0) {
      right.appendChild(el("div", "ltk-ag-mins", `${item.minutes} min`));
    }
    row.appendChild(right);

    // actions column — a single chip. With actions on the item it shows the
    // count (⚑ N) and opens the manage dialog; with none it is a quiet "＋ 0"
    // that raises one directly. Hidden entirely only when there is nothing to
    // show and nothing can be added.
    const acts = this.actionsFor(item.id);
    const canAdd = !this.readOnly && !this.disableActions;
    if (acts.length > 0 || canAdd) {
      const actionsCol = el("div", "ltk-ag-actions");
      const chip = el("button", "ltk-ag-actionchip") as HTMLButtonElement;
      chip.type = "button";
      if (acts.length > 0) {
        chip.textContent = `⚑ ${acts.length}`;
        chip.title = `${acts.length} action${acts.length === 1 ? "" : "s"} — view or manage`;
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openItemActions(item);
        });
      } else {
        chip.textContent = "＋ 0";
        chip.classList.add("ltk-ag-actionchip-empty");
        chip.title = "Add an action";
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          this.raiseActionFor(item);
        });
      }
      actionsCol.appendChild(chip);
      row.appendChild(actionsCol);
    }

    if (!this.readOnly) {
      row.addEventListener("click", () => this.openAgendaDialog(item, false));
    }
    return row;
  }

  /** The item-id order of the agenda rows as they currently sit in the DOM. */
  private rowOrder(row: HTMLElement): string[] {
    const list = row.parentElement;
    if (!list) return [];
    return Array.from(list.querySelectorAll(".ltk-ag-row")).map(
      (r) => (r as HTMLElement).dataset.itemId ?? ""
    );
  }

  /**
   * Drag-to-reorder via a row's grip handle. The row is moved live among its
   * siblings as the pointer passes their midpoints (classic insert-before);
   * on drop the item order is rebuilt from the DOM order and committed. A
   * drop in the same place just re-renders to clear the drag styling.
   */
  private setupRowDrag(row: HTMLElement, grip: HTMLElement): void {
    let originalOrder: string[] = [];
    makeInteractive(grip, {
      onStart: () => {
        originalOrder = this.rowOrder(row);
        row.classList.add("ltk-ag-dragrow");
        row.parentElement?.classList.add("ltk-ag-draglist");
        // suppress the text selection a pointer-drag would otherwise paint
        // across the rows (the .ltk-ag-draglist class sets user-select:none;
        // this clears any selection already begun before the threshold)
        const sel = typeof window !== "undefined" ? window.getSelection() : null;
        if (sel) sel.removeAllRanges();
      },
      onMove: (e) => {
        const list = row.parentElement;
        if (!list) return;
        let ref: Element | null = null;
        for (const rEl of Array.from(list.querySelectorAll(".ltk-ag-row"))) {
          if (rEl === row) continue;
          const rect = rEl.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            ref = rEl;
            break;
          }
        }
        if (ref !== row) {
          if (ref) list.insertBefore(row, ref);
          else list.appendChild(row);
        }
      },
      onEnd: () => {
        const order = this.rowOrder(row);
        row.classList.remove("ltk-ag-dragrow");
        row.parentElement?.classList.remove("ltk-ag-draglist");
        if (order.join("|") !== originalOrder.join("|")) {
          const byId = new Map(this.env.data.items.map((i) => [i.id, i]));
          const reordered = order
            .map((id) => byId.get(id))
            .filter((x): x is AgendaItem => x !== undefined);
          if (reordered.length === this.env.data.items.length) {
            this.env.data.items = reordered;
            this.commit();
            return;
          }
        }
        this.render(); // unchanged (or a guard failed) — restore a clean DOM
      },
    });
    // a bare tap on the grip must not fall through to the row's editor click
    grip.addEventListener("click", (e) => e.stopPropagation());
  }

  private openAgendaDialog(item: AgendaItem, isNew: boolean): void {
    const title = textInput(item.title, {
      placeholder: hintFor(this.prompts, "agenda", "Agenda item"),
    });
    const prompt = textArea(item.prompt, {
      placeholder: "Coaching prompt shown under the item",
      rows: 2,
    });
    const who = this.buildWhoPicker({ whoId: item.whoId, who: item.who });
    const minutes = textInput(item.minutes > 0 ? String(item.minutes) : "", {
      type: "number",
      placeholder: "e.g. 10",
    });
    minutes.min = "0";

    // links: editable rows (title + url), grown by an add affordance
    const linksWrap = el("div");
    linksWrap.style.display = "flex";
    linksWrap.style.flexDirection = "column";
    linksWrap.style.gap = "8px";
    const linkRows: { title: HTMLInputElement; url: HTMLInputElement }[] = [];
    const addLinkRow = (link?: AgendaLink) => {
      const rowEl = el("div", "ltk-ag-linkrow");
      const t = textInput(link?.title ?? "", { placeholder: "Link title" });
      const u = textInput(link?.url ?? "", { placeholder: "https://" });
      const entry = { title: t, url: u };
      linkRows.push(entry);
      const del = el("button", "ltk-ag-linkrow-del", "✕");
      del.type = "button";
      del.title = "Remove link";
      del.addEventListener("click", () => {
        linkRows.splice(linkRows.indexOf(entry), 1);
        rowEl.remove();
      });
      rowEl.append(t, u, del);
      linksWrap.appendChild(rowEl);
    };
    for (const link of item.links) addLinkRow(link);
    const addLink = el("button", "ltk-btn ltk-btn-secondary", "＋ Add link");
    addLink.type = "button";
    addLink.addEventListener("click", () => addLinkRow());

    const save = () => {
      const t = title.value.trim();
      if (t === "") return;
      item.title = t;
      item.prompt = prompt.value.trim();
      who.apply(item);
      const mins = Number(minutes.value);
      item.minutes = Number.isFinite(mins) && mins > 0 ? Math.round(mins) : 0;
      item.links = linkRows
        .filter((r) => r.url.value.trim() !== "")
        .map((r) => ({
          title: r.title.value.trim() || r.url.value.trim(),
          url: r.url.value.trim(),
        }));
      if (isNew) this.env.data.items.push(item);
      dlg.close();
      this.commit();
    };

    const buttons: DialogButton[] = [];
    if (!isNew) {
      buttons.push({
        label: "Delete",
        kind: "danger",
        onClick: () => {
          this.deleteAgendaItem(item);
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary", onClick: () => dlg.close() });
    buttons.push({ label: isNew ? "Add" : "Save", kind: "primary", onClick: save });

    const dlg = openDialog({
      host: this.root,
      title: isNew ? "Add agenda item" : "Edit agenda item",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Title", title));
    dlg.body.appendChild(fieldRow("Prompt", prompt));
    dlg.body.appendChild(sectionLabel("Who"));
    dlg.body.appendChild(who.el);
    const minsRow = fieldRow("Timing (minutes)", minutes);
    minsRow.classList.add("ltk-field-half");
    dlg.body.appendChild(minsRow);
    dlg.body.appendChild(sectionLabel("Links"));
    dlg.body.appendChild(linksWrap);
    dlg.body.appendChild(addLink);

    // existing actions on this item + raise a new one (existing items only —
    // a brand-new item has no id in the document yet for actions to hang off)
    if (!isNew) {
      const existing = this.actionsFor(item.id);
      dlg.body.appendChild(
        sectionLabel(
          existing.length > 0 ? `Actions (${existing.length})` : "Actions"
        )
      );
      for (const a of existing) {
        dlg.body.appendChild(
          actionRow(a, {
            doneColor: this.doneColor(),
            onChanged: () => this.commitActions(),
            onEdit: (act) =>
              openActionDialog({
                host: this.root,
                action: act,
                people: this.people,
                isNew: false,
                onCommit: () => this.commitActions(),
              }),
          })
        );
      }
      if (!this.disableActions) {
        const raise = el("button", "ltk-btn ltk-btn-secondary", "＋ Raise action");
        raise.type = "button";
        raise.addEventListener("click", () => {
          dlg.close();
          this.raiseActionFor(item);
        });
        dlg.body.appendChild(raise);
      }
    }
    title.focus();
  }

  /**
   * Raise a new action for an agenda item straight from the main view — the
   * ＋ action affordance in the row's actions column, so an action can be
   * captured without opening the item editor first.
   */
  private raiseActionFor(item: AgendaItem): void {
    if (this.disableActions) return;
    const action = newAction({ source: "agenda", sourceId: item.id });
    action.issue = item.title;
    openActionDialog({
      host: this.root,
      action,
      people: this.people,
      isNew: true,
      onCommit: () => {
        this.actions.push(action);
        this.commitActions();
      },
    });
  }

  /**
   * View / manage the actions already on an agenda item (the ⚑ chip). An
   * action-focused dialog — complete, comment, edit or cancel existing
   * actions, or raise another — without touching the item's own fields.
   */
  private openItemActions(item: AgendaItem): void {
    const dlg = openDialog({
      host: this.root,
      title: item.title || "Actions",
      buttons: [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }],
    });
    const list = el("div");
    const paint = () => {
      clear(list);
      const existing = this.actionsFor(item.id);
      list.appendChild(
        sectionLabel(
          existing.length > 0 ? `Actions (${existing.length})` : "Actions"
        )
      );
      for (const a of existing) {
        list.appendChild(
          actionRow(a, {
            doneColor: this.doneColor(),
            readOnly: this.readOnly,
            onChanged: () => this.commitActions(),
            onEdit: (act) =>
              openActionDialog({
                host: this.root,
                action: act,
                people: this.people,
                isNew: false,
                onCommit: () => {
                  this.commitActions();
                  paint();
                },
              }),
          })
        );
      }
      if (existing.length === 0) {
        list.appendChild(el("div", "ltk-ag-empty", "No actions yet."));
      }
      if (!this.readOnly && !this.disableActions) {
        const raise = el("button", "ltk-btn ltk-btn-secondary", "＋ Raise action");
        raise.type = "button";
        raise.addEventListener("click", () => {
          dlg.close();
          this.raiseActionFor(item);
        });
        list.appendChild(raise);
      }
    };
    paint();
    dlg.body.appendChild(list);
  }

  /**
   * Delete an agenda item. Its actions are CANCELLED, never removed — they
   * live in a central register and silent disappearance would orphan real
   * commitments.
   */
  private deleteAgendaItem(item: AgendaItem): void {
    this.env.data.items = this.env.data.items.filter((i) => i.id !== item.id);
    for (const a of this.actions) {
      if (a.context.sourceId === item.id && a.status !== "done") {
        a.status = "cancelled";
      }
    }
  }

  // ---- outputs ----

  private outputRow(item: OutputItem): HTMLElement {
    const row = el("div", "ltk-ag-row");
    if (this.readOnly) row.classList.add("ltk-readonly");

    row.appendChild(
      this.checkCircle(item.done, () => {
        item.done = !item.done;
        this.commit();
      })
    );

    const main = el("div", "ltk-ag-main");
    const title = el("div", "ltk-ag-title", item.text);
    if (item.done) title.classList.add("ltk-ag-done");
    main.appendChild(title);
    row.appendChild(main);

    if (!this.readOnly) {
      row.addEventListener("click", () => this.openOutputDialog(item, false));
    }
    return row;
  }

  private openOutputDialog(item: OutputItem, isNew: boolean): void {
    const text = textInput(item.text, {
      placeholder: hintFor(this.prompts, "outputs", "What must this meeting produce?"),
    });

    const save = () => {
      const t = text.value.trim();
      if (t === "") return;
      item.text = t;
      if (isNew) this.env.data.outputs.push(item);
      dlg.close();
      this.commit();
    };

    const buttons: DialogButton[] = [];
    if (!isNew) {
      buttons.push({
        label: "Delete",
        kind: "danger",
        onClick: () => {
          this.env.data.outputs = this.env.data.outputs.filter(
            (o) => o.id !== item.id
          );
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary", onClick: () => dlg.close() });
    buttons.push({ label: isNew ? "Add" : "Save", kind: "primary", onClick: save });

    const dlg = openDialog({
      host: this.root,
      title: isNew ? "Add output" : "Edit output",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Output", text));
    text.focus();
  }

  // ---- who picker ----

  /**
   * Select a who from the people list (chips act as a radio group) or type a
   * free-text name. A typed name wins over a ticked chip; everything clear
   * means unassigned.
   */
  private buildWhoPicker(current: { whoId: string; who: string }): WhoPicker {
    const wrap = el("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "8px";

    const checks: { box: HTMLInputElement; wrap: HTMLElement; person: Person }[] = [];
    const inList = this.people.some(
      (p) => p.whoId === current.whoId || p.who === current.who
    );
    if (this.people.length > 0) {
      const chips = checklist();
      for (const person of this.people) {
        const chip = checkItem(person.who);
        if (
          current.who !== "" &&
          (current.whoId === person.whoId || current.who === person.who)
        ) {
          chip.box.checked = true;
          chip.wrap.classList.add("ltk-check-on");
        }
        chip.box.addEventListener("change", () => {
          if (!chip.box.checked) return;
          for (const other of checks) {
            if (other.box !== chip.box && other.box.checked) {
              other.box.checked = false;
              other.wrap.classList.remove("ltk-check-on");
            }
          }
        });
        chips.appendChild(chip.wrap);
        checks.push({ box: chip.box, wrap: chip.wrap, person });
      }
      wrap.appendChild(chips);
    }
    const free = textInput(
      !inList && current.who !== "" ? current.who : "",
      { placeholder: this.people.length > 0 ? "Or type a name" : "Who" }
    );
    wrap.appendChild(free);

    return {
      el: wrap,
      apply: (target) => {
        const typed = free.value.trim();
        if (typed !== "") {
          target.whoId = "";
          target.who = typed;
          return;
        }
        const picked = checks.find((c) => c.box.checked);
        if (picked) {
          target.whoId = picked.person.whoId;
          target.who = picked.person.who;
        } else {
          target.whoId = "";
          target.who = "";
        }
      },
    };
  }

  // ---- mutations ----

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.emit();
  }

  private commitActions(): void {
    this.emit();
  }

  private emit(): void {
    this.render();
    this.cb.onChange(this.env, this.actions);
    this.png.schedule();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + AGENDA_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

  private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + AGENDA_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "agenda.svg")
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + AGENDA_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "agenda.png";
      link.click();
    });
  }
}
