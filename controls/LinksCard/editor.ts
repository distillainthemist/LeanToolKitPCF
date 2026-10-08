// The LinksCard editor: the pinned working folder (host-supplied) and
// the board's own list of links. Read mode is a list of links opening
// in a new tab; edit mode (not readOnly, and only when the card is open,
// not a tile) is rows of title · url · note · group with ⠿ order and ×.
// Every change emits the envelope; the host saves it like any card.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { draggableRow } from "../../shared/ui/dragList";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { emptyLinks, groupLinks, hostKind, isHttps, LinkItem, LinksEnvelope, linkText, newLinkId, titleFromUrl } from "./types";
import { LINKS_CSS } from "./styles";

export interface LinksEditorCallbacks {
  onChange: (env: LinksEnvelope) => void;
  onSnapshot?: (svgMarkup: string) => void;
}

export interface PinnedLink {
  url: string;
  /** The host offers to set / change the pinned link (the initiative's
   *  working folder) — absent when the viewer may not. */
  onSet?: () => void;
}

const GLYPH: Record<ReturnType<typeof hostKind>, string> = { sharepoint: "SP", onedrive: "OD", teams: "T", web: "www" };

export class LinksEditor {
  private readonly root: HTMLElement;
  private env: LinksEnvelope = emptyLinks();
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private editing = false;
  private pinned: PinnedLink | null = null;
  private readonly snapshots: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: LinksEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-links-css", LINKS_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    this.render();
  }

  // ---- host-facing API ----

  setEnvelope(env: LinksEnvelope): void {
    this.env = env;
    this.render();
    this.snapshots.schedule();
  }

  setPinned(p: PinnedLink | null): void {
    if (JSON.stringify({ u: p?.url ?? "", s: !!p?.onSet }) === JSON.stringify({ u: this.pinned?.url ?? "", s: !!this.pinned?.onSet })) return;
    this.pinned = p;
    this.render();
    this.snapshots.schedule();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      if (ro) this.editing = false;
      this.render();
    }
  }

  destroy(): void {
    this.snapshots.cancel();
    this.root.remove();
  }

  // ---- rendering ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: this.editing ? "Done editing" : "Edit links", onClick: () => this.toggleEditing() },
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }
    const body = el("div", "ltk-lk-body");
    this.root.appendChild(body);

    // the pinned working folder
    if (this.pinned) {
      const band = el("div", "ltk-lk-pinned");
      band.appendChild(el("span", "ltk-lk-pinned-glyph", "📁"));
      const main = el("div", "ltk-lk-pinned-main");
      main.appendChild(el("span", "ltk-lk-pinned-cap", "Working folder"));
      if (this.pinned.url !== "") {
        const a = el("a", undefined, linkText(this.pinned.url)) as HTMLAnchorElement;
        a.href = this.pinned.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = this.pinned.url;
        main.appendChild(a);
      } else {
        main.appendChild(el("span", "ltk-lk-pinned-none", "No working folder set on the initiative"));
      }
      band.appendChild(main);
      if (this.pinned.onSet && !this.readOnly) {
        const set = el("button", "ltk-lk-set", this.pinned.url !== "" ? "Change…" : "Set folder…") as HTMLButtonElement;
        set.type = "button";
        set.addEventListener("click", () => this.pinned?.onSet?.());
        band.appendChild(set);
      }
      body.appendChild(band);
    }

    if (this.editing && !this.readOnly) {
      this.renderEditor(body);
      return;
    }
    const links = this.env.data.links;
    if (links.length === 0) {
      body.appendChild(el("div", "ltk-lk-empty", this.readOnly ? "No links yet." : "No links yet — ⋮ Edit links to add the places this work's documents live."));
      return;
    }
    const list = el("div", "ltk-lk-list");
    for (const g of groupLinks(links)) {
      if (g.group !== "") list.appendChild(el("div", "ltk-lk-group", g.group));
      for (const l of g.links) list.appendChild(this.renderRow(l));
    }
    body.appendChild(list);
    if (links.length > 6) body.appendChild(el("div", "ltk-lk-more", `+${links.length - 6} more`));
  }

  private renderRow(l: LinkItem): HTMLElement {
    const row = el("div", "ltk-lk-row");
    const kind = hostKind(l.url);
    row.appendChild(el("span", `ltk-lk-glyph ltk-lk-glyph-${kind}`, GLYPH[kind]));
    const main = el("div", "ltk-lk-main");
    const title = el("div", "ltk-lk-title");
    const a = el("a", undefined, l.title.trim() !== "" ? l.title : titleFromUrl(l.url)) as HTMLAnchorElement;
    a.href = l.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = l.url;
    title.appendChild(a);
    main.appendChild(title);
    if (l.note.trim() !== "") main.appendChild(el("div", "ltk-lk-note", l.note));
    main.appendChild(el("div", "ltk-lk-where", linkText(l.url)));
    row.appendChild(main);
    return row;
  }

  private renderEditor(body: HTMLElement): void {
    const list = el("div", "ltk-lk-list");
    const links = this.env.data.links;
    links.forEach((l, i) => {
      const row = el("div", "ltk-lk-edit");
      const handle = el("span", "ltk-lk-handle", "⠿");
      handle.title = "Drag to reorder";
      row.appendChild(handle);
      const title = this.input(l.title, "Title", (v) => (l.title = v));
      row.appendChild(title);
      const x = el("button", "ltk-lk-x", "×") as HTMLButtonElement;
      x.type = "button";
      x.title = "Remove this link";
      x.addEventListener("click", () => {
        links.splice(i, 1);
        this.emit();
        this.render();
      });
      row.appendChild(x);
      const url = this.input(l.url, "https://…", (v) => {
        l.url = v.trim();
        url.classList.toggle("ltk-lk-in-bad", l.url !== "" && !isHttps(l.url));
        if (l.title.trim() === "" && isHttps(l.url)) {
          l.title = titleFromUrl(l.url);
          title.value = l.title;
        }
      });
      url.classList.toggle("ltk-lk-in-bad", l.url !== "" && !isHttps(l.url));
      row.appendChild(url);
      const noteRow = el("div", "ltk-lk-edit-noterow");
      noteRow.style.display = "contents";
      row.appendChild(this.input(l.note, "Note (optional)", (v) => (l.note = v)));
      row.appendChild(this.input(l.group, "Group (optional)", (v) => (l.group = v)));
      draggableRow(row, handle, "ltk-links", i, links, () => {
        this.emit();
        this.render();
      });
      list.appendChild(row);
    });
    body.appendChild(list);
    const add = el("button", "ltk-lk-add", "＋ Add link") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => {
      links.push({ id: newLinkId(), title: "", url: "", note: "", group: "" });
      this.render();
      const inputs = this.root.querySelectorAll<HTMLInputElement>(".ltk-lk-edit input");
      inputs[inputs.length - 4]?.focus();
    });
    body.appendChild(add);
  }

  private input(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
    const inp = el("input", "ltk-lk-in") as HTMLInputElement;
    inp.type = "text";
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener("input", () => onChange(inp.value));
    inp.addEventListener("change", () => this.emit());
    return inp;
  }

  private toggleEditing(): void {
    this.editing = !this.editing;
    if (!this.editing) {
      // leaving edit mode drops rows that never got a usable url
      this.env.data.links = this.env.data.links.filter((l) => isHttps(l.url));
      this.emit();
    }
    this.render();
  }

  private emit(): void {
    this.env.meta.updated = new Date().toISOString();
    this.cb.onChange(this.env);
    this.snapshots.schedule();
  }

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, LTK_BASE_CSS + LINKS_CSS, this.theme.background, (svg) => this.cb.onSnapshot!(svg));
  }

  private downloadSvg(): void {
    htmlToSvg(this.root, LTK_BASE_CSS + LINKS_CSS, this.theme.background, (svg) => saveSvg(svg, "links.svg"));
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + LINKS_CSS, this.theme.background, (uri) => {
      const a = document.createElement("a");
      a.href = uri;
      a.download = "links.png";
      a.click();
    });
  }
}
