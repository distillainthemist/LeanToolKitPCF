// CardHost — what the PCF wrappers do, minus the string channels. Screens
// instantiate an editor class into a host div, call its setters with real
// objects, and wire callbacks straight to the store. This module carries
// the shared bits: the app theme and the screen container.

import { defaultTheme, Theme } from "../../shared/tokens";
import { el } from "../../shared/ui/dom";

/** The LeanBoard app theme, applied to every mounted editor. */
export function appTheme(): Theme {
  const theme = defaultTheme();
  theme.accent = "#8b1e1e";
  theme.titleBar = "#8b1e1e";
  return theme;
}

/**
 * A full-height host div for one editor instance. Editors size to their
 * container; the shell gives them the viewport below the app bar.
 */
export function editorHost(parent: HTMLElement): HTMLDivElement {
  const host = el("div", "app-editor-host");
  parent.appendChild(host);
  return host;
}
