// The EmbedCard view. Unlike every other LeanToolKit editor this one does
// NOT re-render on change: an iframe reloads whenever it is recreated OR
// merely re-attached, so the whole DOM is built exactly once and every
// update mutates it in place. Resizes cost nothing (the frame is sized with
// CSS); the frame only navigates when the built url genuinely changes, when
// the refresh button is pressed, or when the host signals a refresh.
//
// The optional commentary pane (configured headings → rich-text notes +
// an actions list) lives in an aside BESIDE the frame's body, so painting
// it never touches — and never reloads — the iframe. With no headings the
// pane stays hidden and actions ride a chip next to refresh instead.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts } from "../../shared/ui/chrome";
import {
  actionRow,
  openActionDialog,
  openActionManager,
} from "../../shared/ui/actionUi";
import { sanitizeRichHtml } from "./types";
import { EMBED_CSS } from "./styles";
import { closePresentation, isPresenting, present } from "./presentWindow";

export interface EmbedViewCallbacks {
  /** The full notes map (heading → sanitized html) after an edit. */
  onNotes?: (notes: Record<string, string>) => void;
  /** The card's action set after a raise / edit / complete / cancel. */
  onActions?: (actions: LtkAction[]) => void;
}

export class EmbedView {
  private readonly root: HTMLElement;
  private readonly titlebar: HTMLElement;
  private readonly titleText: HTMLElement;
  private readonly body: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly frame: HTMLIFrameElement;
  private readonly veil: HTMLElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly openBtn: HTMLAnchorElement;
  private readonly popBtn: HTMLButtonElement;
  private readonly presentPanel: HTMLElement;
  private readonly actionsChip: HTMLButtonElement;
  private readonly aside: HTMLElement;
  private readonly notesHost: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly actsHost: HTMLElement;

  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private lastPromptsRaw: string | null = null;
  private currentUrl = "";
  /** The host owns the iframe (see useExternalFrame). */
  private externalFrame = false;
  /** "Present in a window": no frame at all — the body is a launch panel
   *  and the report opens in its own top-level window (presentWindow.ts). */
  private presentMode = false;
  private presentKey = "";
  private presentTicker: ReturnType<typeof setInterval> | null = null;
  private readOnly = false;
  private headings: string[] = [];
  private notes: Record<string, string> = {};
  private people: Person[] = [];
  private actions: LtkAction[] = [];
  private canRaise = true;
  private readonly noteEls = new Map<string, HTMLElement>();
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: EmbedViewCallbacks = {}
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-embed-css", EMBED_CSS);

    // built once; never cleared (see the header comment)
    this.root = el("div", "ltk-root ltk-em-notitle");
    this.titlebar = el("div", "ltk-titlebar");
    this.titlebar.style.display = "none";
    this.titleText = el("div", "ltk-titlebar-text");
    this.titlebar.appendChild(this.titleText);
    this.root.appendChild(this.titlebar);

    const main = el("div", "ltk-em-main");
    this.body = el("div", "ltk-em-body");
    this.ghost = el("div", "ltk-ghost");
    this.frame = el("iframe", "ltk-em-frame");
    this.frame.setAttribute("allow", "fullscreen");
    this.frame.setAttribute("allowfullscreen", "true");
    this.frame.style.display = "none";
    this.frame.addEventListener("load", () => this.veil.classList.remove("ltk-em-on"));
    this.veil = el("div", "ltk-em-loading", "Loading…");
    this.body.append(this.ghost, this.frame, this.veil);

    // commentary pane: notes sections above, the actions list pinned below
    this.aside = el("aside", "ltk-em-aside");
    this.aside.style.display = "none";
    this.toolbar = this.buildToolbar();
    this.notesHost = el("div", "ltk-em-notes");
    this.actsHost = el("div", "ltk-em-acts");
    this.aside.append(this.toolbar, this.notesHost, this.actsHost);

    main.append(this.body, this.aside);
    this.root.appendChild(main);

    this.refreshBtn = el("button", "ltk-em-refresh", "⟳") as HTMLButtonElement;
    this.refreshBtn.type = "button";
    this.refreshBtn.title = "Refresh";
    this.refreshBtn.addEventListener("click", () => this.refresh());
    this.root.appendChild(this.refreshBtn);

    // many pages forbid framing (X-Frame-Options / frame-ancestors) — the
    // frame then shows the browser's refusal. This always-there escape
    // hatch opens the page in a real tab, so the card is useful regardless.
    this.openBtn = el("a", "ltk-em-open", "↗") as HTMLAnchorElement;
    this.openBtn.target = "_blank";
    this.openBtn.rel = "noopener noreferrer";
    this.openBtn.title = "Open in a new tab";
    this.openBtn.style.display = "none";
    this.root.appendChild(this.openBtn);

    // present-in-window: a chip left of open-in-tab pops the report into
    // its own top-level window on demand (the fallback where the embedded
    // sign-in is blocked by the frame chain — see presentWindow.ts)
    this.popBtn = el("button", "ltk-em-pop", "⧉") as HTMLButtonElement;
    this.popBtn.type = "button";
    this.popBtn.title = "Present in its own window";
    this.popBtn.style.display = "none";
    this.popBtn.addEventListener("click", () => this.presentNow());
    this.root.appendChild(this.popBtn);

    // present mode's body: the launch panel (built once, painted on state)
    this.presentPanel = el("div", "ltk-em-present");
    this.presentPanel.style.display = "none";
    this.body.appendChild(this.presentPanel);

    // actions with no commentary pane: a chip beside refresh opens the
    // shared manager (hidden whenever the pane carries the actions list)
    this.actionsChip = el("button", "ltk-em-actchip", "Actions") as HTMLButtonElement;
    this.actionsChip.type = "button";
    this.actionsChip.title = "Actions on this card";
    this.actionsChip.style.display = "none";
    this.actionsChip.addEventListener("click", () => this.manageActions());
    this.root.appendChild(this.actionsChip);

    applyThemeVars(this.root, this.theme);
    this.paintGhost();
    host.appendChild(this.root);
  }

  // ---- host-facing API (every setter mutates in place; no re-renders) ----

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    applyThemeVars(this.root, this.theme);
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle !== this.cardTitle) {
      this.cardTitle = cardTitle;
      const t = cardTitle.trim();
      this.titleText.textContent = t;
      this.titlebar.style.display = t === "" ? "none" : "";
      this.root.classList.toggle("ltk-em-notitle", t === "");
    }
    if (promptsRaw !== this.lastPromptsRaw) {
      this.lastPromptsRaw = promptsRaw;
      this.paintGhost();
    }
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly === ro) return;
    this.readOnly = ro;
    this.refreshBtn.style.display = ro || this.presentMode ? "none" : "";
    this.popBtn.style.display = ro || this.currentUrl === "" ? "none" : "";
    this.paintNotes();
    this.paintActions();
  }

  /** The configured commentary headings — [] hides the pane entirely. */
  setCommentary(headings: string[]): void {
    if (JSON.stringify(headings) === JSON.stringify(this.headings)) return;
    this.headings = headings.slice();
    this.aside.style.display = headings.length === 0 ? "none" : "";
    this.paintNotes();
    this.paintActions();
  }

  /** The stored notes (heading → sanitized html), from the card document. */
  setNotes(notes: Record<string, string>): void {
    this.notes = { ...notes };
    this.paintNotes();
  }

  /** The roster for the action assignee picker. */
  setPeople(people: Person[]): void {
    this.people = people;
  }

  /** This card's actions from the central table. */
  setActions(actions: LtkAction[]): void {
    this.actions = actions;
    this.paintActions();
  }

  /** The card's "Disable actions" setting (raise hidden, existing stay). */
  setCanRaise(on: boolean): void {
    if (this.canRaise === on) return;
    this.canRaise = on;
    this.paintActions();
  }

  /**
   * Point the frame at a (built) url. A no-op when the url is unchanged —
   * this is what makes resizes and unrelated updateView churn free. An empty
   * url swaps the frame for the ghost.
   */
  setUrl(url: string): void {
    if (url === this.currentUrl) return;
    this.currentUrl = url;
    if (url === "") {
      this.frame.style.display = "none";
      this.ghost.style.display = "";
      this.veil.classList.remove("ltk-em-on");
      this.frame.removeAttribute("src");
      this.openBtn.style.display = "none";
      this.openBtn.removeAttribute("href");
      this.popBtn.style.display = "none";
      this.paintPresent();
      return;
    }
    this.ghost.style.display = "none";
    this.openBtn.href = url;
    this.openBtn.style.display = "";
    this.popBtn.style.display = this.readOnly ? "none" : "";
    if (this.presentMode) {
      // never a frame: the panel is the body
      this.frame.style.display = "none";
      this.frame.removeAttribute("src");
      this.veil.classList.remove("ltk-em-on");
      this.paintPresent();
      return;
    }
    if (this.externalFrame) return; // the host's frame is already showing it
    this.frame.style.display = "";
    this.veil.classList.add("ltk-em-on");
    this.frame.src = url;
  }

  /**
   * "Present in a window" mode: the card holds no frame; its body is a
   * launch panel and the report lives in its own top-level window (outside
   * the frame chain, so frame-chain permission blocks can't reach it).
   * `key` identifies the window across screens (board|card).
   */
  setPresentMode(on: boolean, key: string): void {
    if (this.presentMode === on && this.presentKey === key) return;
    this.presentMode = on;
    this.presentKey = key;
    this.presentPanel.style.display = on ? "" : "none";
    this.refreshBtn.style.display = on || this.readOnly ? "none" : "";
    if (on) {
      this.frame.style.display = "none";
      this.frame.removeAttribute("src");
      this.veil.classList.remove("ltk-em-on");
      if (this.currentUrl !== "") this.ghost.style.display = "none";
      this.paintPresent();
      // the window's open/closed state is polled: there is no event for a
      // popup the user closes with its own ✕
      if (this.presentTicker === null) {
        this.presentTicker = setInterval(() => this.paintPresent(), 1500);
      }
    } else {
      if (this.presentTicker !== null) {
        clearInterval(this.presentTicker);
        this.presentTicker = null;
      }
      if (this.currentUrl !== "" && !this.externalFrame) {
        this.frame.style.display = "";
        this.veil.classList.add("ltk-em-on");
        this.frame.src = this.currentUrl;
      }
    }
  }

  private presentNow(): void {
    if (this.currentUrl === "") return;
    const key = this.presentKey !== "" ? this.presentKey : this.currentUrl;
    const ok = present(key, this.currentUrl);
    if (!ok) {
      // the browser refused the popup — the tab link is the way through
      window.open(this.currentUrl, "_blank", "noopener,noreferrer");
    }
    this.paintPresent();
  }

  private paintPresent(): void {
    if (!this.presentMode) return;
    const panel = this.presentPanel;
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    if (this.currentUrl === "") return; // the ghost is showing instead
    const key = this.presentKey !== "" ? this.presentKey : this.currentUrl;
    const open = isPresenting(key);
    panel.appendChild(el("div", "ltk-em-present-title", open ? "Presenting" : "Shown in its own window"));
    panel.appendChild(
      el(
        "div",
        "ltk-em-present-text",
        open
          ? "The report is open in a separate window."
          : "This card opens its report in a separate window — outside the app, where it signs in like any tab."
      )
    );
    const row = el("div", "ltk-em-present-row");
    const go = el("button", "ltk-em-present-btn", open ? "Bring to front" : "▶ Present in window") as HTMLButtonElement;
    go.type = "button";
    go.addEventListener("click", () => this.presentNow());
    row.appendChild(go);
    if (open) {
      const close = el("button", "ltk-em-present-sec", "Close window") as HTMLButtonElement;
      close.type = "button";
      close.addEventListener("click", () => {
        closePresentation(key);
        this.paintPresent();
      });
      row.appendChild(close);
    }
    panel.appendChild(row);
  }

  /**
   * Hand the frame over to the host, which supplies a persistent iframe of
   * its own and parks it over frameSlot(). Used so an embed survives moving
   * between screens: any iframe this card owned would reload the moment the
   * screen it lives in is torn down. The card still owns everything else —
   * chrome, commentary, actions, the open-in-new-tab link.
   */
  useExternalFrame(on: boolean): void {
    this.externalFrame = on;
    if (!on) return;
    this.frame.style.display = "none";
    this.frame.removeAttribute("src");
    this.veil.classList.remove("ltk-em-on");
  }

  /** The element a host-supplied frame should be parked over. */
  frameSlot(): HTMLElement {
    return this.body;
  }

  /** Reload the frame against the same url (the ⟳ button / refreshTrigger). */
  refresh(): void {
    if (this.currentUrl === "" || this.externalFrame) return;
    this.veil.classList.add("ltk-em-on");
    this.frame.src = this.currentUrl;
  }

  destroy(): void {
    if (this.presentTicker !== null) {
      clearInterval(this.presentTicker);
      this.presentTicker = null;
    }
    if (this.noteTimer !== null) clearTimeout(this.noteTimer);
    this.root.remove();
  }

  // ---- commentary pane ----

  /** One compact formatting row for whichever note has the caret. */
  private buildToolbar(): HTMLElement {
    const bar = el("div", "ltk-em-fmtbar");
    const btn = (label: string, cmd: string, title: string) => {
      const b = el("button", "ltk-em-fmt", label) as HTMLButtonElement;
      b.type = "button";
      b.title = title;
      // mousedown (not click) so the note keeps its selection
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        document.execCommand(cmd);
      });
      return b;
    };
    bar.append(
      btn("B", "bold", "Bold"),
      btn("I", "italic", "Italic"),
      btn("•", "insertUnorderedList", "Bullet list")
    );
    return bar;
  }

  /** Rebuild the note sections (never touches the frame). A note the user
   *  is typing in is left alone — repainting it would eat the caret. */
  private paintNotes(): void {
    this.toolbar.style.display =
      this.readOnly || this.headings.length === 0 ? "none" : "";
    const focused = document.activeElement;
    if (focused && this.notesHost.contains(focused)) {
      // just sync read-only state; structure changes wait for blur
      for (const eln of this.noteEls.values()) {
        eln.setAttribute("contenteditable", this.readOnly ? "false" : "true");
      }
      return;
    }
    this.noteEls.clear();
    while (this.notesHost.firstChild) {
      this.notesHost.removeChild(this.notesHost.firstChild);
    }
    for (const heading of this.headings) {
      this.notesHost.appendChild(el("div", "ltk-em-h", heading));
      const note = el("div", "ltk-em-note");
      note.setAttribute("contenteditable", this.readOnly ? "false" : "true");
      note.setAttribute("data-heading", heading);
      note.innerHTML = sanitizeRichHtml(this.notes[heading] ?? "");
      note.addEventListener("input", () => {
        if (this.noteTimer !== null) clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => this.flushNote(heading, note), 500);
      });
      note.addEventListener("blur", () => this.flushNote(heading, note));
      // pasted markup goes through the sanitizer BEFORE it touches the
      // DOM — raw paste would execute inline handlers in this session
      note.addEventListener("paste", (e) => {
        e.preventDefault();
        const dt = e.clipboardData;
        if (!dt) return;
        const html = dt.getData("text/html");
        const safe =
          html !== ""
            ? sanitizeRichHtml(html)
            : dt
                .getData("text/plain")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\r?\n/g, "<br>");
        document.execCommand("insertHTML", false, safe);
      });
      this.notesHost.appendChild(note);
      this.noteEls.set(heading, note);
    }
  }

  private flushNote(heading: string, note: HTMLElement): void {
    if (this.noteTimer !== null) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
    const html = sanitizeRichHtml(note.innerHTML);
    if (html === (this.notes[heading] ?? "")) return;
    this.notes[heading] = html;
    this.cb.onNotes?.({ ...this.notes });
  }

  // ---- actions ----

  /** Card-level actions, live ones first (cancelled hidden). */
  private liveActions(): LtkAction[] {
    return this.actions.filter(
      (a) => a.context.sourceId === "" && a.status !== "cancelled"
    );
  }

  private commitActions(): void {
    this.cb.onActions?.(this.actions);
    this.paintActions();
  }

  /** The pane's actions section + the no-pane chip, kept in step. */
  private paintActions(): void {
    const live = this.liveActions();
    const open = live.filter((a) => a.status !== "done").length;

    // chip (no-pane mode): visible when the pane is hidden and there is
    // either something to see or something raisable
    const paneOn = this.headings.length > 0;
    const chipOn =
      this.cb.onActions !== undefined &&
      !paneOn &&
      (live.length > 0 || (this.canRaise && !this.readOnly));
    this.actionsChip.style.display = chipOn ? "" : "none";
    this.actionsChip.textContent = open > 0 ? `Actions (${open})` : "Actions";

    // pane section
    while (this.actsHost.firstChild) {
      this.actsHost.removeChild(this.actsHost.firstChild);
    }
    if (!paneOn || this.cb.onActions === undefined) return;
    this.actsHost.appendChild(el("div", "ltk-em-h", "Actions"));
    for (const a of live) {
      this.actsHost.appendChild(
        actionRow(a, {
          doneColor: this.theme.legend[1] ?? "#107c10",
          readOnly: this.readOnly,
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
    if (this.canRaise && !this.readOnly) {
      const add = el("button", "ltk-btn ltk-btn-secondary ltk-em-addact", "＋ Add action");
      (add as HTMLButtonElement).type = "button";
      add.addEventListener("click", () => this.raiseAction());
      this.actsHost.appendChild(add);
    } else if (live.length === 0) {
      this.actsHost.appendChild(el("div", "ltk-em-noacts", "No actions"));
    }
  }

  private raiseAction(): void {
    const action = newAction({ source: "embed", sourceId: "" });
    action.issue = this.cardTitle;
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

  /** The chip's route: the shared list-with-raise dialog. */
  private manageActions(): void {
    openActionManager({
      host: this.root,
      actions: this.actions,
      source: "embed",
      sourceId: "",
      seedIssue: this.cardTitle,
      people: this.people,
      doneColor: this.theme.legend[1] ?? "#107c10",
      readOnly: this.readOnly,
      canRaise: this.canRaise,
      onChanged: () => this.commitActions(),
    });
  }

  // ---- internals ----

  private paintGhost(): void {
    while (this.ghost.firstChild) this.ghost.removeChild(this.ghost.firstChild);
    const prompts = parsePrompts(this.lastPromptsRaw ?? "");
    const lines =
      prompts.general.length > 0
        ? prompts.general
        : [
            "Nothing to show yet",
            "Set Embed URL to a Power BI embed link or any https page that allows framing",
          ];
    for (const line of lines) {
      this.ghost.appendChild(el("div", "ltk-ghost-line", line));
    }
  }
}
