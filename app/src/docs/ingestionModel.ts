// Document ingestion — the pure parts (document-ingestion-proposal-
// 2026-10.md, built 2026-10-08): the task shape and its Dataverse row
// mapping, who may see a task, a task's folder name, what a file is
// still missing before it may move, and how a run log reads. No DOM,
// no SharePoint, no SDK — tested in node.

import { AddFieldValue, sanitizeFileName } from "./model";

export type IngestionStatus = "open" | "running" | "closed";

export interface IngestionAssignee {
  email: string;
  name: string;
}

export interface RunLogEntry {
  /** The file's name in the task folder. */
  file: string;
  outcome: "moved" | "refused";
  /** Why it was refused, or where it landed (server-relative url). */
  detail: string;
  /** ISO time. */
  at: string;
  by: string;
}

export interface IngestionTask {
  rowId: string;
  name: string;
  siteUrl: string;
  sourceListId: string;
  /** The task's sub-folder, server-relative. */
  folder: string;
  destListId: string;
  status: IngestionStatus;
  assignees: IngestionAssignee[];
  /** The task defaults as WRITE-READY values (the add form's shape —
   *  taxonomy keeps its term id, people their claims), one per column;
   *  "Fill blanks from defaults" writes the ones a file lacks. */
  defaults: AddFieldValue[];
  log: RunLogEntry[];
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  closedAt: string;
}

/** The Dataverse row, as the generated service shapes it. */
export interface IngestionTaskRow {
  ben_ltkingestiontaskid?: string;
  ben_name?: string;
  ben_siteurl?: string;
  ben_sourcelistid?: string;
  ben_folder?: string;
  ben_destlistid?: string;
  ben_status?: string;
  ben_assigneesjson?: string;
  ben_defaultsjson?: string;
  ben_logjson?: string;
  ben_createdbyemail?: string;
  ben_createdbyname?: string;
  ben_createdat?: string;
  ben_closedat?: string;
}

const parseJson = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export function taskFromRow(r: IngestionTaskRow): IngestionTask {
  const status = r.ben_status === "running" || r.ben_status === "closed" ? r.ben_status : "open";
  const assignees = parseJson<unknown>(r.ben_assigneesjson, []);
  const log = parseJson<unknown>(r.ben_logjson, []);
  const defaults = parseJson<unknown>(r.ben_defaultsjson, []);
  return {
    rowId: r.ben_ltkingestiontaskid ?? "",
    name: r.ben_name ?? "",
    siteUrl: r.ben_siteurl ?? "",
    sourceListId: (r.ben_sourcelistid ?? "").toLowerCase(),
    folder: r.ben_folder ?? "",
    destListId: (r.ben_destlistid ?? "").toLowerCase(),
    status,
    assignees: Array.isArray(assignees)
      ? assignees
          .filter((a): a is { email?: unknown; name?: unknown } => typeof a === "object" && a !== null)
          .map((a) => ({ email: String(a.email ?? "").toLowerCase(), name: String(a.name ?? "") }))
          .filter((a) => a.email !== "")
      : [],
    defaults: Array.isArray(defaults)
      ? defaults.filter((d): d is AddFieldValue => typeof d === "object" && d !== null && typeof (d as { internal?: unknown }).internal === "string" && typeof (d as { kind?: unknown }).kind === "string")
      : [],
    log: Array.isArray(log)
      ? log
          .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
          .map((e) => ({
            file: String(e.file ?? ""),
            outcome: e.outcome === "moved" ? "moved" : "refused",
            detail: String(e.detail ?? ""),
            at: String(e.at ?? ""),
            by: String(e.by ?? ""),
          }))
      : [],
    createdByEmail: (r.ben_createdbyemail ?? "").toLowerCase(),
    createdByName: r.ben_createdbyname ?? "",
    createdAt: r.ben_createdat ?? "",
    closedAt: r.ben_closedat ?? "",
  };
}

export function rowFromTask(t: IngestionTask): IngestionTaskRow {
  return {
    ben_name: t.name,
    ben_siteurl: t.siteUrl,
    ben_sourcelistid: t.sourceListId,
    ben_folder: t.folder,
    ben_destlistid: t.destListId,
    ben_status: t.status,
    ben_assigneesjson: JSON.stringify(t.assignees),
    ben_defaultsjson: JSON.stringify(t.defaults),
    ben_logjson: JSON.stringify(t.log),
    ben_createdbyemail: t.createdByEmail,
    ben_createdbyname: t.createdByName,
    ben_createdat: t.createdAt,
    ben_closedat: t.closedAt,
  };
}

/** The sub-folder a task gets: its name, made safe for SharePoint. */
export function taskFolderName(name: string): string {
  return sanitizeFileName(name).slice(0, 120);
}

/** Who sees a task: its assignees, its creator, and every controller. */
export function canSeeTask(t: IngestionTask, viewerEmail: string, isController: boolean): boolean {
  if (isController) return true;
  const me = viewerEmail.trim().toLowerCase();
  if (me === "") return false;
  return t.createdByEmail === me || t.assignees.some((a) => a.email === me);
}

/** The tasks a viewer's Document-tasks panel lists: open ones they can
 *  see, newest first. */
export function tasksForPanel(all: IngestionTask[], viewerEmail: string, isController: boolean): IngestionTask[] {
  return all.filter((t) => t.status !== "closed" && canSeeTask(t, viewerEmail, isController)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** What a file still lacks before it may move: the required internals
 *  whose register value is blank, by label. */
export function missingFor(values: Record<string, string>, required: { internal: string; label: string }[]): string[] {
  return required.filter((r) => (values[r.internal] ?? "").trim() === "").map((r) => r.label);
}

/** The defaults that would fill a file's blanks (what "Fill blanks from
 *  defaults" writes for one row): every default whose column the file
 *  has no value in. */
export function blanksToFill(values: Record<string, string>, defaults: AddFieldValue[]): AddFieldValue[] {
  return defaults.filter((d) => (values[d.internal] ?? "").trim() === "");
}

/** "12 moved · 3 refused" for a log; "" for none. */
export function logSummary(log: RunLogEntry[]): string {
  const moved = log.filter((e) => e.outcome === "moved").length;
  const refused = log.filter((e) => e.outcome === "refused").length;
  const parts: string[] = [];
  if (moved > 0) parts.push(`${moved} moved`);
  if (refused > 0) parts.push(`${refused} refused`);
  return parts.join(" · ");
}

/** The last outcome per file, newest wins — a re-run's refusal replaces
 *  the earlier one; a later "moved" closes the story. */
export function latestByFile(log: RunLogEntry[]): Map<string, RunLogEntry> {
  const out = new Map<string, RunLogEntry>();
  for (const e of log) out.set(e.file, e);
  return out;
}

/** The check-in comment the audit view reads. */
export function ingestComment(taskName: string, by: string): string {
  return `Ingested — task "${taskName}" by ${by}`;
}
