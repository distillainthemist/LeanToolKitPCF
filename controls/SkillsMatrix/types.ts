// SkillsMatrix document — the classic quadrant skills matrix, transposed:
// SKILLS are the rows (grouped under categories), PEOPLE are the columns (fed
// from the standard peopleJSON input, not the document). Each cell holds a
// proficiency 1–4 drawn as a quarter-filled disc. Categories, skills and
// targets live in the board data and are editable + reorderable in-card.

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

export interface Skill {
  id: string;
  name: string;
  target: number; // 0 (no target) .. 4
}

export interface SkillCategory {
  id: string;
  name: string;
  skills: Skill[];
}

export interface SkillsData {
  categories: SkillCategory[];
  // skillId -> personId -> level 1..4
  levels: Record<string, Record<string, number>>;
}

export type SkillsEnvelope = Envelope<SkillsData>;

export const DEFAULT_CATEGORIES: SkillCategory[] = [
  {
    id: "c1",
    name: "Production",
    skills: [
      { id: "s1", name: "Mashing", target: 3 },
      { id: "s2", name: "Distillation", target: 3 },
    ],
  },
  {
    id: "c2",
    name: "Packaging",
    skills: [
      { id: "s3", name: "Bottling line", target: 2 },
      { id: "s4", name: "Quality checks", target: 2 },
    ],
  },
];

function clampLevel(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(n)));
}

function parseSkill(raw: unknown): Skill | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<Skill>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name === "") return null;
  return {
    id: typeof o.id === "string" && o.id !== "" ? o.id : newId("s"),
    name,
    target: clampLevel(o.target),
  };
}

function parseData(data: unknown): SkillsData {
  const fallback: SkillsData = {
    categories: DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      skills: c.skills.map((s) => ({ ...s })),
    })),
    levels: {},
  };
  if (!data || typeof data !== "object") return fallback;
  const d = data as { categories?: unknown; levels?: unknown };

  const categories: SkillCategory[] = [];
  if (Array.isArray(d.categories)) {
    for (const raw of d.categories) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<SkillCategory> & { skills?: unknown };
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name === "") continue;
      const skills: Skill[] = [];
      if (Array.isArray(o.skills)) {
        for (const rs of o.skills) {
          const s = parseSkill(rs);
          if (s) skills.push(s);
        }
      }
      categories.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("c"),
        name,
        skills,
      });
    }
  }

  const levels: Record<string, Record<string, number>> = {};
  if (d.levels && typeof d.levels === "object") {
    for (const [sid, row] of Object.entries(d.levels as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const out: Record<string, number> = {};
      for (const [pid, lvl] of Object.entries(row as Record<string, unknown>)) {
        const v = clampLevel(lvl);
        if (v >= 1) out[pid] = v;
      }
      if (Object.keys(out).length > 0) levels[sid] = out;
    }
  }

  return {
    categories: categories.length > 0 ? categories : fallback.categories,
    levels,
  };
}

export function parseSkills(raw: string | null | undefined): ParsedEnvelope<SkillsData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeSkills(env: SkillsEnvelope): string {
  return serializeEnvelope(env);
}

export function levelOf(data: SkillsData, skillId: string, personId: string): number {
  return data.levels[skillId]?.[personId] ?? 0;
}

export function setLevel(
  data: SkillsData,
  skillId: string,
  personId: string,
  level: number
): void {
  const row = data.levels[skillId] ?? {};
  if (level >= 1) row[personId] = level;
  else delete row[personId];
  if (Object.keys(row).length > 0) data.levels[skillId] = row;
  else delete data.levels[skillId];
}

/** People (by id) at or above a skill's target — coverage for the row. */
export function coverage(
  data: SkillsData,
  skill: Skill,
  personIds: string[]
): { met: number; of: number } {
  if (skill.target <= 0) return { met: 0, of: 0 };
  let met = 0;
  for (const pid of personIds) {
    if (levelOf(data, skill.id, pid) >= skill.target) met++;
  }
  return { met, of: personIds.length };
}
