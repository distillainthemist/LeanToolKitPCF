// The in-editor fishbone model — kept in the original Fishbone PCF's shape so
// the proven SVG editor ports unchanged. The LeanToolKit envelope (types.ts)
// maps to/from this via the shared CauseNode model in index.ts.

export type CauseStatus = "Hypothesis" | "Confirmed" | "Rejected";

export const STATUSES: CauseStatus[] = ["Hypothesis", "Confirmed", "Rejected"];

/** Hard cap on a root-cause description's length (shared toolkit limit). */
export const MAX_CAUSE_CHARS = 140;

export const DEFAULT_CATEGORIES: string[] = [
  "Measurements",
  "Materials",
  "People",
  "Environment",
  "Methods",
  "Machines",
];

/** Visual styling, driven by the toolkit Theme (not persisted). */
export interface StyleConfig {
  fontFamily: string;
  diagramColor: string;
  backgroundColor: string;
  accentColor: string;
  effectLabel: string; // heading of the effect box (e.g. "Problem")
  statusColors: Record<CauseStatus, string>;
}

export function defaultStyle(): StyleConfig {
  return {
    fontFamily: "Segoe UI, system-ui, sans-serif",
    diagramColor: "#141414",
    backgroundColor: "#ffffff",
    accentColor: "#141414",
    effectLabel: "Problem",
    statusColors: {
      Hypothesis: "#f2c811",
      Confirmed: "#107c10",
      Rejected: "#d13438",
    },
  };
}

export interface Cause {
  id: string;
  category: string; // name of the category (bone) this cause hangs off
  text: string; // the root-cause description
  votes: number; // vote tally (non-negative integer)
  status: CauseStatus;
}

/** The in-memory model the editor works on. */
export interface FishboneModel {
  problem: string;
  categories: string[]; // ordered category (bone) names
  causes: Cause[];
}

export function emptyModel(): FishboneModel {
  return { problem: "", categories: DEFAULT_CATEGORIES.slice(), causes: [] };
}

export function newId(): string {
  return "c" + Math.random().toString(36).slice(2, 9);
}
