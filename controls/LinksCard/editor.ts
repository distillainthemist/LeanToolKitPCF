// The LinksCard editor: the pinned working folder (host-supplied) and
// the board's own list of links. Read mode is a list of links opening
// in a new tab. There is no edit mode (Ben, 2026-10-08: "have the add
// link button permanently available"): when the card is open and not
// readOnly, "＋ Add link" sits under the list and each row offers Edit,
// which turns that row into an inline form (url · title · note · group,
// Save / Remove / Cancel); ⠿ reorders. Every change emits the envelope;
// the host saves it like any card. A draft is not emitted until Add.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { draggableRow } from "../../shared/ui/dragList";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { emptyLinks, folderTarget, FolderItem, groupLinks, hostKind, isHttps, isTokenShare, LinkItem, LinksEnvelope, linkText, newLinkId, titleFromUrl } from "./types";

/** The host's road to a folder's contents (SharePoint REST through the
 *  connector, the viewer's own permissions). Rejects with a message. */
export type FolderLister = (url: string) => Promise<FolderItem[]>;
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
  /** The row being edited inline (by id), or "new" for the draft. */
  private editingId: string | null = null;
  private draft: LinkItem | null = null;
  private pinned: PinnedLink | null = null;
  private lister: FolderLister | null = null;
  /** Links whose contents are open (by url); the pinned folder is "pinned". */
  private readonly open = new Set<string>();
  private readonly contents = new Map<string, { items: FolderItem[] | null; error: string }>();
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

  /** Folder contents (2026-10-08): with a lister, a folder link offers
   *  "Show contents". Tiles never list (readOnly hides the toggle). */
  setFolderLister(fn: FolderLister | null): void {
    this.lister = fn;
    this.render();
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
      if (ro) {
        this.editingId = null;
        this.draft = null;
      }
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
      if (this.pinned.url !== "") this.appendContentsToggle(band, this.pinned.url, "pinned");
      if (this.pinned.onSet && !this.readOnly) {
        const set = el("button", "ltk-lk-set", this.pinned.url !== "" ? "Change…" : "Set folder…") as HTMLButtonElement;
        set.type = "button";
        set.addEventListener("click", () => this.pinned?.onSet?.());
        band.appendChild(set);
      }
      body.appendChild(band);
      if (this.pinned.url !== "") this.appendContents(body, this.pinned.url, "pinned");
    }

    const links = this.env.data.links;
    const editable = !this.readOnly;
    if (links.length === 0 && this.draft === null) {
      body.appendChild(el("div", "ltk-lk-empty", editable ? "No links yet — add the places this work's documents live." : "No links yet."));
    } else {
      const list = el("div", "ltk-lk-list");
      for (const g of groupLinks(links)) {
        if (g.group !== "") list.appendChild(el("div", "ltk-lk-group", g.group));
        for (const l of g.links) {
          if (editable && this.editingId === l.id) {
            list.appendChild(this.renderForm(l, false));
            continue;
          }
          list.appendChild(this.renderRow(l, editable));
          this.appendContents(list, l.url, l.id);
        }
      }
      if (editable && this.draft !== null) list.appendChild(this.renderForm(this.draft, true));
      body.appendChild(list);
      if (links.length > 6) body.appendChild(el("div", "ltk-lk-more", `+${links.length - 6} more`));
    }
    if (editable && this.draft === null) {
      const add = el("button", "ltk-lk-add", "＋ Add link") as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", () => {
        this.draft = { id: newLinkId(), title: "", url: "", note: "", group: "" };
        this.editingId = null;
        this.render();
        this.root.querySelector<HTMLInputElement>(".ltk-lk-form input")?.focus();
      });
      body.appendChild(add);
    }
  }

  private renderRow(l: LinkItem, editable: boolean): HTMLElement {
    const row = el("div", "ltk-lk-row");
    const kind = hostKind(l.url);
    if (editable) {
      const links = this.env.data.links;
      const handle = el("span", "ltk-lk-handle", "⠿");
      handle.title = "Drag to reorder";
      row.appendChild(handle);
      draggableRow(row, handle, "ltk-links", links.indexOf(l), links, () => {
        this.emit();
        this.render();
      });
    }
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
    this.appendContentsToggle(row, l.url, l.id);
    if (editable) {
      const edit = el("button", "ltk-lk-set ltk-lk-editbtn", "Edit") as HTMLButtonElement;
      edit.type = "button";
      edit.addEventListener("click", () => {
        this.editingId = l.id;
        this.draft = null;
        this.render();
        this.root.querySelector<HTMLInputElement>(".ltk-lk-form input")?.focus();
      });
      row.appendChild(edit);
    }
    return row;
  }

  /** "Show contents ▾" on a link that resolves to a folder path; a token
   *  share gets a hint instead. Never on a tile (readOnly) or without a lister. */
  private appendContentsToggle(row: HTMLElement, url: string, key: string): void {
    if (!this.lister || this.readOnly) return;
    const target = folderTarget(url);
    if (target === null) {
      if (isTokenShare(url)) {
        const hint = el("span", "ltk-lk-hint", "ⓘ");
        hint.title = "A sharing link opens the folder but cannot be listed here. To show its contents, open it and paste the folder's address from the address bar (…id=…) instead.";
        row.appendChild(hint);
      }
      return;
    }
    // a file path (an extension on the last segment) is not a folder
    if (/\.[a-z0-9]{2,5}$/i.test(target.path)) return;
    const on = this.open.has(key);
    const t = el("button", "ltk-lk-set ltk-lk-toggle", on ? "Hide contents ▴" : "Show contents ▾") as HTMLButtonElement;
    t.type = "button";
    t.addEventListener("click", () => {
      if (on) this.open.delete(key);
      else {
        this.open.add(key);
        if (!this.contents.has(key)) void this.loadContents(url, key);
      }
      this.render();
    });
    row.appendChild(t);
  }

  private appendContents(host: HTMLElement, url: string, key: string): void {
    if (!this.open.has(key)) return;
    const box = el("div", "ltk-lk-contents");
    const c = this.contents.get(key);
    if (!c) box.appendChild(el("div", "ltk-lk-contents-note", "Reading the folder…"));
    else if (c.error !== "") box.appendChild(el("div", "ltk-lk-contents-note", c.error));
    else if (c.items === null || c.items.length === 0) box.appendChild(el("div", "ltk-lk-contents-note", "Empty folder."));
    else {
      for (const it of c.items) {
        const r = el("div", "ltk-lk-item");
        r.appendChild(el("span", "ltk-lk-item-glyph", it.folder ? "📁" : "📄"));
        const a = el("a", "ltk-lk-item-name", it.name) as HTMLAnchorElement;
        a.href = it.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        r.appendChild(a);
        if (it.modified !== "") r.appendChild(el("span", "ltk-lk-item-when", it.modified.slice(0, 10)));
        box.appendChild(r);
      }
    }
    host.appendChild(box);
  }

  private async loadContents(url: string, key: string): Promise<void> {
    if (!this.lister) return;
    try {
      const items = await this.lister(url);
      this.contents.set(key, { items, error: "" });
    } catch (err) {
      this.contents.set(key, { items: null, error: err instanceof Error ? err.message : String(err) });
    }
    if (this.root.isConnected) this.render();
  }

  /** The inline form for one link: url first (a pasted url titles
   *  itself), then title, note and group; Add / Save, Remove, Cancel.
   *  Edits work on a copy and land only on Save. */
  private renderForm(src: LinkItem, isNew: boolean): HTMLElement {
    const l: LinkItem = { ...src };
    const form = el("div", "ltk-lk-form");
    const title = this.input(l.title, "Title", (v) => (l.title = v));
    const url = this.input(l.url, "https://… (paste the link)", (v) => {
      l.url = v.trim();
      url.classList.toggle("ltk-lk-in-bad", l.url !== "" && !isHttps(l.url));
      if (l.title.trim() === "" && isHttps(l.url)) {
        l.title = titleFromUrl(l.url);
        title.value = l.title;
      }
      ok.disabled = !isHttps(l.url);
    });
    url.classList.toggle("ltk-lk-in-bad", l.url !== "" && !isHttps(l.url));
    url.classList.add("ltk-lk-form-wide");
    title.classList.add("ltk-lk-form-wide");
    form.appendChild(url);
    form.appendChild(title);
    form.appendChild(this.input(l.note, "Note (optional)", (v) => (l.note = v)));
    form.appendChild(this.input(l.group, "Group (optional)", (v) => (l.group = v)));
    const bar = el("div", "ltk-lk-form-bar");
    const ok = el("button", "ltk-lk-btn ltk-lk-btn-primary", isNew ? "Add" : "Save") as HTMLButtonElement;
    ok.type = "button";
    ok.disabled = !isHttps(l.url);
    ok.addEventListener("click", () => this.commit(l, isNew));
    bar.appendChild(ok);
    const cancel = el("button", "ltk-lk-btn", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      this.draft = null;
      this.editingId = null;
      this.render();
    });
    bar.appendChild(cancel);
    if (!isNew) {
      const rm = el("button", "ltk-lk-btn ltk-lk-btn-danger", "Remove") as HTMLButtonElement;
      rm.type = "button";
      rm.addEventListener("click", () => {
        const links = this.env.data.links;
        const i = links.findIndex((x) => x.id === src.id);
        if (i >= 0) links.splice(i, 1);
        this.editingId = null;
        this.emit();
        this.render();
      });
      bar.appendChild(rm);
    }
    form.appendChild(bar);
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement && isHttps(l.url)) {
        e.preventDefault();
        this.commit(l, isNew);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel.click();
      }
    });
    return form;
  }

  private commit(l: LinkItem, isNew: boolean): void {
    if (!isHttps(l.url)) return;
    const links = this.env.data.links;
    if (l.title.trim() === "") l.title = titleFromUrl(l.url);
    if (isNew) links.push(l);
    else {
      const i = links.findIndex((x) => x.id === l.id);
      if (i >= 0) links[i] = l;
      else links.push(l);
    }
    this.draft = null;
    this.editingId = null;
    this.emit();
    this.render();
  }

  private input(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
    const inp = el("input", "ltk-lk-in") as HTMLInputElement;
    inp.type = "text";
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener("input", () => onChange(inp.value));
    return inp;
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
