// EmbedCard PCF lifecycle. This card is display-only — no document, no
// actions, no outputs at all. The contract that matters is the opposite of
// the usual one: updateView fires constantly in a canvas app (resizes, theme
// churn, unrelated bindings) and almost none of it may touch the iframe.
// The frame navigates only when the BUILT url changes or when refreshTrigger
// changes value.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { EmbedView } from "./editor";
import { buildEmbedUrl } from "./types";
import { cfg, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";

/** Standard component proportion when the host doesn't allocate a height. */
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 640;

export class EmbedCard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: EmbedView;
  private lastRefreshTrigger: string | null = null;

  public init(
    context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this.container = container;
    if (context.mode.trackContainerResize) {
      context.mode.trackContainerResize(true);
    }
    this.view = new EmbedView(container);
    this.applyAll(context);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.applyAll(context);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    if (this.view) this.view.destroy();
  }

  /**
   * Respect the host-allocated size; when the host doesn't provide a height
   * (the test harness, or an unset canvas size), default to the toolkit's
   * standard 1.77:1 viewport proportion so the card never renders collapsed.
   */
  private applySize(context: ComponentFramework.Context<IInputs>): void {
    const w = context.mode.allocatedWidth;
    const h = context.mode.allocatedHeight;
    if (w > 0) this.container.style.width = `${w}px`;
    if (h > 0) {
      this.container.style.height = `${h}px`;
    } else {
      const width = w > 0 ? w : this.container.clientWidth || DEFAULT_WIDTH;
      this.container.style.height = `${Math.round(width / ASPECT_RATIO)}px`;
    }
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const s = parseSettings(p.settingsJSON?.raw);

    this.applySize(context);
    this.view.setTheme(readTheme(p, s));
    this.view.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));
    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);

    // the built url is the identity — setUrl no-ops when it is unchanged,
    // so resizes and unrelated churn never touch the frame
    this.view.setUrl(
      buildEmbedUrl({
        url: rawOr(p.embedUrl, cfg(s, "embedUrl")),
        hideFilterPane:
          p.hideFilterPane?.raw === true || s.config.hideFilterPane === true,
        hidePageNav:
          p.hidePageNav?.raw === true || s.config.hidePageNav === true,
        pageName: rawOr(p.pageName, cfg(s, "pageName")),
      })
    );

    // refreshTrigger: change-of-value reloads; first sight is not a change
    const trigger = p.refreshTrigger?.raw ?? "";
    if (this.lastRefreshTrigger !== null && trigger !== this.lastRefreshTrigger) {
      this.view.refresh();
    }
    this.lastRefreshTrigger = trigger;
  }
}
