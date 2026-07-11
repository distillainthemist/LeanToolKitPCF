// RaciCard document — a responsibility-assignment matrix. Rows are the
// deliverables/tasks (the substance, held in the document); columns are the
// roles/people (configured by the `roles` input). Each cell holds one RACI
// letter. Assignments are nested by task id → role → letter so a role rename
// only clears that one column.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/raci@1";

export type RaciLetter = "R" | "A" | "C" | "I";

export interface RaciDef {
  letter: RaciLetter;
  label: string;
  color: string;
}

/** The four RACI roles, with default colours (overridable via legendColors). */
export const RACI_DEFS: RaciDef[] = [
  { letter: "R", label: "Responsible", color: "#2b88d8" },
  { letter: "A", label: "Accountable", color: "#107c10" },
  { letter: "C", label: "Consulted", color: "#f2c811" },
  { letter: "I", label: "Informed", color: "#8a8a8a" },
];

/** Tap order: unset → R → A → C → I → unset. */
export const RACI_CYCLE: RaciLetter[] = ["R", "A", "C", "I"];

export function isRaciLetter(v: unknown): v is RaciLetter {
  return v === "R" || v === "A" || v === "C" || v === "I";
}

export interface RaciTask {
  id: string;
  label: string;
}

export interface RaciData {
  tasks: RaciTask[];
  // taskId -> role -> letter
  assign: Record<string, Record<string, RaciLetter>>;
}

export type RaciEnvelope = Envelope<RaciData>;

export const DEFAULT_ROLES = ["Sponsor", "Lead", "Team", "QA"];

export const DEFAULT_TASKS: RaciTask[] = [
  { id: "t1", label: "Define scope" },
  { id: "t2", label: "Approve budget" },
  { id: "t3", label: "Deliver work" },
];

function parseData(data: unknown): RaciData {
  const fallback: RaciData = { tasks: DEFAULT_TASKS.slice(), assign: {} };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { tasks?: unknown; assign?: unknown };

  const tasks: RaciTask[] = [];
  if (Array.isArray(d.tasks)) {
    for (const raw of d.tasks) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<RaciTask>;
      tasks.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("t"),
        label: typeof o.label === "string" ? o.label : "",
      });
    }
  }

  const assign: Record<string, Record<string, RaciLetter>> = {};
  if (d.assign && typeof d.assign === "object") {
    for (const [taskId, roles] of Object.entries(d.assign as Record<string, unknown>)) {
      if (!roles || typeof roles !== "object") continue;
      const row: Record<string, RaciLetter> = {};
      for (const [role, letter] of Object.entries(roles as Record<string, unknown>)) {
        if (isRaciLetter(letter)) row[role] = letter;
      }
      if (Object.keys(row).length > 0) assign[taskId] = row;
    }
  }

  return {
    tasks: tasks.length > 0 ? tasks : fallback.tasks,
    assign,
  };
}

export function parseRaci(raw: string | null | undefined): ParsedEnvelope<RaciData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeRaci(env: RaciEnvelope): string {
  return serializeEnvelope(env);
}

/** Parse the roles input (CSV or JSON array) into the matrix columns. */
export function parseRoles(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (t === "") return DEFAULT_ROLES.slice();
  let items: string[];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      items = Array.isArray(arr) ? arr.map((v) => String(v).trim()) : [];
    } catch {
      items = t.split(",").map((v) => v.trim());
    }
  } else {
    items = t.split(",").map((v) => v.trim());
  }
  const clean = items.filter((v) => v !== "");
  return clean.length > 0 ? clean : DEFAULT_ROLES.slice();
}

/** Count how many roles are marked Accountable for a task (should be 1). */
export function accountableCount(
  data: RaciData,
  taskId: string,
  roles: string[]
): number {
  const row = data.assign[taskId];
  if (!row) return 0;
  return roles.filter((r) => row[r] === "A").length;
}
