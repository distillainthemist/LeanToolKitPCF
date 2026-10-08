// Document ingestion — the grid's DRAFT model (proposal §9, decision:
// "draft + Save changes", Ben 2026-10-09). Cells change locally; a
// file is dirty while it holds a draft value that differs from what
// SharePoint shows; "Save changes" writes each dirty file once, with
// every changed cell in one bracket. Pure and SDK-free — tested.

import type { AddFieldValue } from "./model";
import { taxonomyTermsOf } from "./model";

/** uniqueId → internal → the value to write. */
export type Draft = Map<string, Map<string, AddFieldValue>>;

/** What a draft value reads as in a cell — the register's own strings:
 *  term labels and people names ";"-joined, text as typed, a date as
 *  yyyy-mm-dd. */
export function draftDisplay(v: AddFieldValue): string {
  if (v.kind === "taxonomy") return taxonomyTermsOf(v).map((t) => t.label).join("; ");
  if (v.kind === "person") return (v.people ?? []).map((p) => p.name || p.email).filter((s) => s !== "").join("; ");
  return (v.text ?? "").trim();
}

/** A value with nothing in it writes nothing (the forms' rule: v1
 *  changes values, it does not clear them). */
export function isBlank(v: AddFieldValue): boolean {
  return draftDisplay(v) === "";
}

/** The saved display of a column for a row, dates by their ISO twin. */
export function savedDisplay(values: Record<string, string>, internal: string, kind: AddFieldValue["kind"]): string {
  if (kind === "date") return (values[`${internal}.`] ?? values[internal] ?? "").slice(0, 10);
  return (values[internal] ?? "").trim();
}

/** Set (or, when blank or unchanged from the saved value, clear) one
 *  cell's draft. Returns true when the row is dirty afterwards. */
export function setCell(d: Draft, uniqueId: string, saved: Record<string, string>, v: AddFieldValue): boolean {
  let row = d.get(uniqueId);
  const same = draftDisplay(v) === savedDisplay(saved, v.internal, v.kind);
  if (isBlank(v) || same) {
    row?.delete(v.internal);
    if (row && row.size === 0) d.delete(uniqueId);
    return (d.get(uniqueId)?.size ?? 0) > 0;
  }
  if (!row) {
    row = new Map();
    d.set(uniqueId, row);
  }
  row.set(v.internal, v);
  return true;
}

/** The row's values as they WOULD read after a save: saved strings
 *  overlaid by the draft's displays. */
export function effectiveValues(saved: Record<string, string>, row: Map<string, AddFieldValue> | undefined): Record<string, string> {
  if (!row || row.size === 0) return saved;
  const out = { ...saved };
  for (const [internal, v] of row) {
    out[internal] = draftDisplay(v);
    if (v.kind === "date") out[`${internal}.`] = v.text ?? "";
  }
  return out;
}

export function dirtyRows(d: Draft): string[] {
  return [...d.entries()].filter(([, row]) => row.size > 0).map(([id]) => id);
}

export function writesFor(d: Draft, uniqueId: string): AddFieldValue[] {
  return [...(d.get(uniqueId)?.values() ?? [])];
}

/** Apply values to many rows into the draft — "Set for selected" (every
 *  row) or "Fill blanks from defaults" (only where the row reads
 *  blank). Returns the rows that changed. */
export function applyToRows(
  d: Draft,
  rows: { uniqueId: string; values: Record<string, string> }[],
  values: AddFieldValue[],
  onlyBlanks: boolean
): number {
  let touched = 0;
  for (const r of rows) {
    let changed = false;
    const eff = effectiveValues(r.values, d.get(r.uniqueId));
    for (const v of values) {
      if (isBlank(v)) continue;
      if (onlyBlanks && (eff[v.internal] ?? "").trim() !== "") continue;
      const before = d.get(r.uniqueId)?.get(v.internal);
      setCell(d, r.uniqueId, r.values, v);
      if (d.get(r.uniqueId)?.get(v.internal) !== before) changed = true;
    }
    if (changed) touched++;
  }
  return touched;
}
