// Helpers for the standard LeanToolKit property surface. Controls differ in
// their generated IInputs types, so these helpers work off the structural
// shape of the standard parameters that every manifest declares.

import { defaultTheme, parseLegend, Theme } from "../tokens";

interface StringProp {
  raw?: string | null;
}
interface BoolProp {
  raw?: boolean | null;
}

/** The standard parameters every LeanToolKit manifest declares. */
export interface StandardParams {
  inputJSON?: StringProp;
  actionsInputJSON?: StringProp;
  instanceId?: StringProp;
  resetTrigger?: StringProp;
  peopleJSON?: StringProp;
  cardTitle?: StringProp;
  prompts?: StringProp;
  backgroundColor?: StringProp;
  foregroundColor?: StringProp;
  accentColor?: StringProp;
  legendColors?: StringProp;
  fontFamily?: StringProp;
  readOnly?: BoolProp;
}

export function str(p: StringProp | undefined, fallback = ""): string {
  const v = (p?.raw ?? "").trim();
  return v !== "" ? v : fallback;
}

/** Build a Theme from the standard styling inputs. */
export function readTheme(params: StandardParams): Theme {
  const d = defaultTheme();
  return {
    background: str(params.backgroundColor, d.background),
    foreground: str(params.foregroundColor, d.foreground),
    accent: str(params.accentColor, d.accent),
    legend: parseLegend(params.legendColors?.raw),
    fontFamily: str(params.fontFamily, d.fontFamily),
  };
}

/**
 * Tracks the load-gating inputs: inputJSON, actionsInputJSON and
 * resetTrigger. Reload fires on the first sight of the inputs, whenever
 * resetTrigger changes value (the maker's "reset to loaded data" signal —
 * change-of-value, not boolean, so it can fire any number of times), and
 * whenever either input genuinely changes.
 *
 * Echo guard: apps commonly wire OnChange to Patch the table / set the
 * variable that feeds the inputs back in. An input change that exactly
 * matches what this control last emitted is that write coming home, not new
 * data — it must not trigger a reload, or Patch → reload → OnChange → Patch
 * loops. Call recordEmitted() with every emission.
 */
export class LoadGate {
  private lastInput: string | null = null;
  private lastActionsInput: string | null = null;
  private lastReset: string | null = null;
  private emittedDoc = "";
  private emittedActions = "";

  recordEmitted(doc: string, actions: string): void {
    this.emittedDoc = doc;
    this.emittedActions = actions;
  }

  shouldReload(params: StandardParams): boolean {
    const input = params.inputJSON?.raw ?? "";
    const actionsInput = params.actionsInputJSON?.raw ?? "";
    const reset = params.resetTrigger?.raw ?? "";

    const first = this.lastInput === null;
    let reload = first;
    if (!first) {
      if (reset !== this.lastReset) {
        reload = true;
      } else {
        const docChanged =
          input !== this.lastInput && input !== this.emittedDoc;
        const actionsChanged =
          actionsInput !== this.lastActionsInput &&
          actionsInput !== this.emittedActions;
        reload = docChanged || actionsChanged;
      }
    }

    this.lastInput = input;
    this.lastActionsInput = actionsInput;
    this.lastReset = reset;
    return reload;
  }
}
