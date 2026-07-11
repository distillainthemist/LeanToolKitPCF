// SkillsMatrix document — the classic quadrant skills matrix. Rows are the
// team members, columns are the skills (each with a 0–4 target level), and
// each cell holds a proficiency 1–4 drawn as a quarter-filled disc. People,
// skills, targets and levels all live in the board data and are editable
// in-card.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/skills@1";

/** Proficiency quadrants, in cycle order. Level 0 = unset (not stored). */
export const LEVEL_LABELS = [
  "", // 0 unset
  "Learning",
  "Assisted",
  "Independent",
  "Can teach",
];

export const MAX_LEVEL = 4;

export interface SkillPerson {
  id: string;
  name: string;
}

export interface Skill {
  id: string;
  name: string;
  target: number; // 0 (no target) .. 4
}

export interface SkillsData {
  people: SkillPerson[];
  skills: Skill[];
  // personId -> skillId -> level 1..4
  levels: Record<string, Record<string, number>>;
}

export type SkillsEnvelope = Envelope<SkillsData>;

export const DEFAULT_PEOPLE: SkillPerson[] = [
  { id: "p1", name: "Alex" },
  { id: "p2", name: "Sam" },
  { id: "p3", name: "Jordan" },
];

export const DEFAULT_SKILLS: Skill[] = [
  { id: "s1", name: "Setup", target: 3 },
  { id: "s2", name: "Operation", target: 3 },
  { id: "s3", name: "Quality checks", target: 2 },
  { id: "s4", name: "Maintenance", target: 2 },
];

function clampLevel(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(n)));
}

function parseData(data: unknown): SkillsData {
  const fallback: SkillsData = {
    people: DEFAULT_PEOPLE.map((p) => ({ ...p })),
    skills: DEFAULT_SKILLS.map((s) => ({ ...s })),
    levels: {},
  };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { people?: unknown; skills?: unknown; levels?: unknown };

  const people: SkillPerson[] = [];
  if (Array.isArray(d.people)) {
    for (const raw of d.people) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<SkillPerson>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name === "") continue;
      people.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("p"),
        name,
      });
    }
  }

  const skills: Skill[] = [];
  if (Array.isArray(d.skills)) {
    for (const raw of d.skills) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<Skill>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name === "") continue;
      skills.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("s"),
        name,
        target: clampLevel(o.target),
      });
    }
  }

  const levels: Record<string, Record<string, number>> = {};
  if (d.levels && typeof d.levels === "object") {
    for (const [pid, row] of Object.entries(d.levels as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const out: Record<string, number> = {};
      for (const [sid, lvl] of Object.entries(row as Record<string, unknown>)) {
        const v = clampLevel(lvl);
        if (v >= 1) out[sid] = v;
      }
      if (Object.keys(out).length > 0) levels[pid] = out;
    }
  }

  return {
    people: people.length > 0 ? people : fallback.people,
    skills: skills.length > 0 ? skills : fallback.skills,
    levels,
  };
}

export function parseSkills(raw: string | null | undefined): ParsedEnvelope<SkillsData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeSkills(env: SkillsEnvelope): string {
  return serializeEnvelope(env);
}

export function levelOf(data: SkillsData, personId: string, skillId: string): number {
  return data.levels[personId]?.[skillId] ?? 0;
}

/** People at or above a skill's target (only counted when a target is set). */
export function coverage(data: SkillsData, skill: Skill): { met: number; of: number } {
  if (skill.target <= 0) return { met: 0, of: 0 };
  let met = 0;
  for (const p of data.people) {
    if (levelOf(data, p.id, skill.id) >= skill.target) met++;
  }
  return { met, of: data.people.length };
}
