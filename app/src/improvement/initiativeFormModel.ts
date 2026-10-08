// The initiative header form's pure parts (initiativeForm.ts, 2026-10-08),
// kept SDK-free so the tests import nothing that pulls the Power Apps
// runtime in: which field kinds pair two to a row, the "Also shown in"
// fold's summary line, and the group a validation message belongs to.

import type { FieldKind } from "./templateModel";

/** Field kinds that read well two to a row; text, links and prose stay
 *  full width. */
export function isShortKind(kind: FieldKind): boolean {
  return ["integer", "number", "percent", "date", "daterange", "picklist", "yesno", "rating", "person", "status"].includes(kind);
}

/** Rows of one or two fields: consecutive short kinds pair up, anything
 *  else takes its own row. Order is kept. */
export function pairFields<T extends { kind: FieldKind }>(fields: T[]): T[][] {
  const rows: T[][] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (isShortKind(f.kind) && last && last.length === 1 && isShortKind(last[0].kind)) last.push(f);
    else rows.push([f]);
  }
  return rows;
}

/** The fold's one-line summary of "Also shown in". */
export function alsoSummary(list: { site: string; department: string; area: string }[]): string {
  if (list.length === 0) return "only its own organisation";
  return list.map((o) => o.area || o.department || o.site).filter((s) => s !== "").join(", ");
}

export type FormGroup = "About" | "Organisation" | "Priorities & people" | "Details" | "Metrics" | "Rules";

/** The group a model validation message belongs to, so the error line
 *  can say where to look. */
export function groupFor(message: string): FormGroup {
  if (/^A title/i.test(message)) return "About";
  if (/^Pick the org/i.test(message)) return "Organisation";
  if (/^An owner/i.test(message)) return "Priorities & people";
  if (/metric/i.test(message)) return "Metrics";
  return "Details";
}

