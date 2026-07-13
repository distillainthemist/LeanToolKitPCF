// AgendaCard document — a traditional meeting agenda in three sections:
//   • pre-work: items to arrive prepared with (title, optional link, who),
//     checked off as they are confirmed done
//   • agenda: the meeting running order (title, prompt, who, minutes, links);
//     actions can be captured against each item
//   • outputs: a simple checklist of what the meeting must produce
//
// Everything lives in the document — the card has no card-specific config
// inputs. Section collapse is UI state, not document state (toggling a
// section must not dirty the document).

import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";
import { newId } from "../../shared/schema/id";

export const SCHEMA_ID = "ltk/agenda@1";

/** A titled link — the title is displayed, the url opens in a new tab. */
export interface AgendaLink {
  title: string;
  url: string;
}

/** A pre-work item: do this before the meeting. */
export interface PreworkItem {
  id: string;
  title: string;
  link?: AgendaLink;
  whoId: string;
  who: string;
  done: boolean;
}

/** One agenda item — a segment of the running order. */
export interface AgendaItem {
  id: string;
  title: string;
  prompt: string;
  whoId: string;
  who: string;
  minutes: number; // 0 = untimed
  links: AgendaLink[];
}

/** An expected output of the meeting, checked off when produced. */
export interface OutputItem {
  id: string;
  text: string;
  done: boolean;
}

export interface AgendaData {
  prework: PreworkItem[];
  items: AgendaItem[];
  outputs: OutputItem[];
}

export type AgendaEnvelope = Envelope<AgendaData>;

export function newPrework(): PreworkItem {
  return { id: newId("p"), title: "", whoId: "", who: "", done: false };
}

export function newAgendaItem(): AgendaItem {
  return {
    id: newId("g"),
    title: "",
    prompt: "",
    whoId: "",
    who: "",
    minutes: 0,
    links: [],
  };
}

export function newOutput(): OutputItem {
  return { id: newId("o"), text: "", done: false };
}

// ---- defensive parsing ------------------------------------------------------

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseLink(v: unknown): AgendaLink | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const url = asStr(o.url).trim();
  if (url === "") return undefined;
  const title = asStr(o.title).trim();
  return { title: title !== "" ? title : url, url };
}

function parseLinks(v: unknown): AgendaLink[] {
  if (!Array.isArray(v)) return [];
  const out: AgendaLink[] = [];
  for (const item of v) {
    const link = parseLink(item);
    if (link) out.push(link);
  }
  return out;
}

function parseData(data: unknown): AgendaData {
  const fallback: AgendaData = { prework: [], items: [], outputs: [] };
  if (!data || typeof data !== "object") return fallback;
  const d = data as Record<string, unknown>;

  const prework: PreworkItem[] = [];
  if (Array.isArray(d.prework)) {
    for (const item of d.prework) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const title = asStr(o.title).trim();
      if (title === "") continue;
      prework.push({
        id: asStr(o.id) !== "" ? asStr(o.id) : newId("p"),
        title,
        link: parseLink(o.link),
        whoId: asStr(o.whoId),
        who: asStr(o.who).trim(),
        done: o.done === true,
      });
    }
  }

  const items: AgendaItem[] = [];
  if (Array.isArray(d.items)) {
    for (const item of d.items) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const title = asStr(o.title).trim();
      if (title === "") continue;
      const mins = typeof o.minutes === "number" ? o.minutes : Number(o.minutes);
      items.push({
        id: asStr(o.id) !== "" ? asStr(o.id) : newId("g"),
        title,
        prompt: asStr(o.prompt).trim(),
        whoId: asStr(o.whoId),
        who: asStr(o.who).trim(),
        minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : 0,
        links: parseLinks(o.links),
      });
    }
  }

  const outputs: OutputItem[] = [];
  if (Array.isArray(d.outputs)) {
    for (const item of d.outputs) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const text = asStr(o.text ?? o.title).trim();
      if (text === "") continue;
      outputs.push({
        id: asStr(o.id) !== "" ? asStr(o.id) : newId("o"),
        text,
        done: o.done === true,
      });
    }
  }

  return { prework, items, outputs };
}

export function parseAgenda(
  raw: string | null | undefined
): ParsedEnvelope<AgendaData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeAgenda(env: AgendaEnvelope): string {
  return serializeEnvelope(env);
}

/**
 * Normalise a link url for safe opening: trims, requires http(s) — anything
 * without a scheme is treated as https, anything with another scheme (e.g.
 * javascript:) is rejected. Returns "" when unusable.
 */
export function safeUrl(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ""; // some other scheme — reject
  return `https://${t}`;
}

/** Total planned minutes across the agenda (0 when nothing is timed). */
export function totalMinutes(items: AgendaItem[]): number {
  return items.reduce((sum, it) => sum + (it.minutes > 0 ? it.minutes : 0), 0);
}
