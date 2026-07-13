// The EmbedCard view. Unlike every other LeanToolKit editor this one does
// NOT re-render on change: an iframe reloads whenever it is recreated OR
// merely re-attached, so the whole DOM is built exactly once and every
// update mutates it in place. Resizes cost nothing (the frame is sized with
// CSS); the frame only navigates when the built url genuinely changes, when
// the refresh button is pressed, or when the host signals a refresh.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts } from "../../shared/ui/chrome";
import { EMBED_CSS } from "./styles";

export class EmbedView {
  private readonly root: HTMLElement;
  private readonly titlebar: HTMLElement;
  private readonly titleText: HTMLElement;
  private readonly body: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly frame: HTMLIFrameElement;
  private readonly veil: HTMLElement;
  private readonly refreshBtn: HTMLButtonElement;

  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private lastPromptsRaw: string | null = null;
  private currentUrl = "";

  constructor(host: HTMLElement) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-embed-css", EMBED_CSS);

    // built once; never cleared (see the header comment)
    this.root = el("div", "ltk-root ltk-em-notitle");
    this.titlebar = el("div", "ltk-titlebar");
    this.titlebar.style.display = "none";
    this.titleText = el("div", "ltk-titlebar-text");
    this.titlebar.appendChild(this.titleText);
    this.root.appendChild(this.titlebar);

    this.body = el("div", "ltk-em-body");
    this.ghost = el("div", "ltk-ghost");
    this.frame = el("iframe", "ltk-em-frame");
    this.frame.setAttribute("allow", "fullscreen");
    this.frame.setAttribute("allowfullscreen", "true");
    this.frame.style.display = "none";
    this.frame.addEventListener("load", () => this.veil.classList.remove("ltk-em-on"));
    this.veil = el("div", "ltk-em-loading", "Loading…");
    this.body.append(this.ghost, this.frame, this.veil);
    this.root.appendChild(this.body);

    this.refreshBtn = el("button", "ltk-em-refresh", "⟳") as HTMLButtonElement;
    this.refreshBtn.type = "button";
    this.refreshBtn.title = "Refresh";
    this.refreshBtn.addEventListener("click", () => this.refresh());
    this.root.appendChild(this.refreshBtn);

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
    this.refreshBtn.style.display = ro ? "none" : "";
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
      return;
    }
    this.ghost.style.display = "none";
    this.frame.style.display = "";
    this.veil.classList.add("ltk-em-on");
    this.frame.src = url;
  }

  /** Reload the frame against the same url (the ⟳ button / refreshTrigger). */
  refresh(): void {
    if (this.currentUrl === "") return;
    this.veil.classList.add("ltk-em-on");
    this.frame.src = this.currentUrl;
  }

  destroy(): void {
    this.root.remove();
  }

  // ---- internals ----

  private paintGhost(): void {
    while (this.ghost.firstChild) this.ghost.removeChild(this.ghost.firstChild);
    const prompts = parsePrompts(this.lastPromptsRaw ?? "");
    const lines =
      prompts.general.length > 0
        ? prompts.general
        : ["Nothing to show yet", "Set Embed URL to a Power BI embed link or any https page"];
    for (const line of lines) {
      this.ghost.appendChild(el("div", "ltk-ghost-line", line));
    }
  }
}
