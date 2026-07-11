// CaptureCard — a config-driven capture grid. Columns come from the
// columnsJSON input: typed text / number / decimal / yesno / list, with
// list options optionally multi-select, icon-carrying (emoji or data URI),
// and two-layer dependent (a child column declares `parent` and its options
// carry `when` values matched against the parent's selection). Rows are
// free (add/delete) or fixed via rowsJSON headers. The simple capture card
// is just the default single-text-column config.

import { newId } from "../../shared/schema/id";
import {
  Envelope,
  ParsedEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../../shared/schema/envelope";

export const SCHEMA_ID = "ltk/capture@1";

export type ColumnType = "text" | "number" | "decimal" | "yesno" | "list";

export interface ListOption {
  value: string;
  label: string;
  icon: string; // emoji/short glyph, or a data URI rendered as an image
  when: string; // for dependent lists: parent value this option belongs to ("" = always)
}

export interface CaptureColumn {
  key: string;
  label: string;
  type: ColumnType;
  multi: boolean; // list columns: allow multiple selections
  parent: string; // key of the parent column for dependent lists ("" = none)
  options: ListOption[];
}

export interface RowHeader {
  key: string;
  label: string;
}

export type CellValue = string | number | boolean | string[];

export interface CaptureRow {
  id: string;
  rowKey: string; // matches a RowHeader key when rows are fixed ("" = free row)
  cells: Record<string, CellValue>;
}

export interface CaptureData {
  rows: CaptureRow[];
}

export type CaptureEnvelope = Envelope<CaptureData>;

export const DEFAULT_COLUMNS: CaptureColumn[] = [
  { key: "entry", label: "Entry", type: "text", multi: false, parent: "", options: [] },
];

/** Parse the columnsJSON input defensively; falls back to the simple card. */
export function parseColumns(raw: string | null | undefined): CaptureColumn[] {
  const t = (raw ?? "").trim();
  if (t === "") return DEFAULT_COLUMNS;
  try {
    const data = JSON.parse(t) as unknown;
    if (!Array.isArray(data)) return DEFAULT_COLUMNS;
    const out: CaptureColumn[] = [];
    for (const raw2 of data) {
      if (!raw2 || typeof raw2 !== "object") continue;
      const o = raw2 as Partial<CaptureColumn> & { options?: unknown };
      const key = typeof o.key === "string" ? o.key.trim() : "";
      if (key === "") continue;
      const type: ColumnType =
        o.type === "number" || o.type === "decimal" || o.type === "yesno" || o.type === "list"
          ? o.type
          : "text";
      const options: ListOption[] = [];
      if (Array.isArray(o.options)) {
        for (const op of o.options) {
          if (op === null || op === undefined) continue;
          if (typeof op === "string") {
            options.push({ value: op, label: op, icon: "", when: "" });
            continue;
          }
          if (typeof op !== "object") continue;
          const oo = op as Partial<ListOption>;
          const value =
            typeof oo.value === "string" && oo.value !== ""
              ? oo.value
              : typeof oo.label === "string"
                ? oo.label
                : "";
          if (value === "") continue;
          options.push({
            value,
            label: typeof oo.label === "string" && oo.label !== "" ? oo.label : value,
            icon: typeof oo.icon === "string" ? oo.icon : "",
            when: typeof oo.when === "string" ? oo.when : "",
          });
        }
      }
      out.push({
        key,
        label: typeof o.label === "string" && o.label !== "" ? o.label : key,
        type,
        multi: o.multi === true,
        parent: typeof o.parent === "string" ? o.parent : "",
        options,
      });
    }
    return out.length > 0 ? out : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** The parsed rows input: fixed row headers, and whether they carry titles. */
export interface RowConfig {
  headers: RowHeader[];
  titled: boolean; // false = a fixed count of untitled rows (no row-head column)
}

/**
 * Parse the rowsJSON input into a row configuration:
 *   • "" (empty)                → free rows (add/delete)
 *   • a single number, e.g. "5" → 5 fixed, untitled rows (no row-head column)
 *   • [{key,label}] / [labels]  → fixed rows with titles (row-head column)
 */
export function parseRows(raw: string | null | undefined): RowConfig {
  const t = (raw ?? "").trim();
  if (t === "") return { headers: [], titled: true };

  if (/^\d+$/.test(t)) {
    const n = Math.max(1, Math.min(200, parseInt(t, 10)));
    const headers: RowHeader[] = [];
    for (let i = 1; i <= n; i++) headers.push({ key: `r${i}`, label: "" });
    return { headers, titled: false };
  }

  try {
    const data = JSON.parse(t) as unknown;
    if (!Array.isArray(data)) return { headers: [], titled: true };
    const headers: RowHeader[] = [];
    for (const raw2 of data) {
      if (typeof raw2 === "string" && raw2.trim() !== "") {
        headers.push({ key: raw2.trim(), label: raw2.trim() });
      } else if (raw2 && typeof raw2 === "object") {
        const o = raw2 as Partial<RowHeader>;
        const key = typeof o.key === "string" ? o.key.trim() : "";
        if (key === "") continue;
        headers.push({
          key,
          label: typeof o.label === "string" && o.label !== "" ? o.label : key,
        });
      }
    }
    return { headers, titled: true };
  } catch {
    return { headers: [], titled: true };
  }
}

function parseData(data: unknown): CaptureData {
  if (!data || typeof data !== "object") return { rows: [] };
  const d = data as { rows?: unknown };
  const rows: CaptureRow[] = [];
  if (Array.isArray(d.rows)) {
    for (const raw of d.rows) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Partial<CaptureRow> & { cells?: unknown };
      const cells: Record<string, CellValue> = {};
      if (o.cells && typeof o.cells === "object") {
        for (const [k, v] of Object.entries(o.cells as Record<string, unknown>)) {
          if (
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean"
          ) {
            cells[k] = v;
          } else if (Array.isArray(v)) {
            cells[k] = v.map((x) => String(x));
          }
        }
      }
      rows.push({
        id: typeof o.id === "string" && o.id !== "" ? o.id : newId("row"),
        rowKey: typeof o.rowKey === "string" ? o.rowKey : "",
        cells,
      });
    }
  }
  return { rows };
}

export function parseCapture(
  raw: string | null | undefined
): ParsedEnvelope<CaptureData> {
  return parseEnvelope(raw, SCHEMA_ID, parseData);
}

export function serializeCapture(env: CaptureEnvelope): string {
  return serializeEnvelope(env);
}
