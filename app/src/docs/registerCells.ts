// Register cells — the row anatomy of the Documents register, extracted
// from docsScreen (doc-cards plan B1) so the board's Standard-documents
// card renders THE SAME cells as the screen: consistency by
// construction, not imitation. Pure DOM builders over a small context —
// no SDK, no fetches; the context carries what the screen already knew.
//
// Behaviour is the D6-settled rendering, moved verbatim:
// - status chips are glyph + word (colour-vision), QUIET when approved
//   (R8: approved is the register's normal state — outline, not fill);
// - owner cells are initials avatar + full text (Vault V3);
// - name cells are file-type chip + stem (extension lives in the chip),
//   with the checkout lock — and MINE reads differently, matched by
//   EMAIL (display names collide);
// - columns sit in dictionary order whatever is hidden, Modified last
//   among them, and the set narrows with the pane (status drops first,
//   then everything but name + Modified).

import { el } from "../../../shared/ui/dom";
import { fileTypeChip, withStatusGlyph } from "../../../shared/ui/format";
import { resolvePaletteColor } from "../../../shared/palette";
import { textOn } from "../../../shared/tokens";
import type { ListColumn } from "./listView";
import { DocRow, formatWhen, splitNameForEllipsis } from "./rows";
import {
  SiteDictionary,
  paletteEntryFor,
  sortByDictionary,
  stageOfTerm,
} from "./model";

/** What the cells need to know — the screen owns all of it already. */
export interface RegisterCellCtx {
  dict: SiteDictionary;
  /** The app state palette (paletteMap of the branding row). */
  states: Record<string, string>;
  /** Lowercased status label → term GUID. Filled asynchronously by the
   *  status-vocabulary read and captured BY REFERENCE, so a late answer
   *  reaches every chip painted after it — until then (or if it never
   *  answers) matching falls back to the label stored beside each
   *  palette entry, and colours are never withheld on a round trip. */
  labelToId: Map<string, string>;
  /** The status column ("found whether one library is in view or
   *  five" — C3); null = no status role mapped. Structural, so the
   *  screen's SiteColumn and a library's ColumnConfig both fit. */
  statusCol: { internal: string; termSetId: string } | null;
  /** The signed-in viewer's email, "" when unknown — MINE by email. */
  myEmail: string;
}

/** The palette's verdict on one status value — colour, glyph, and the
 *  R8 quiet/loud call. The chip AND the tile snapshot resolve through
 *  this one function, so they cannot disagree. */
export function statusTone(
  ctx: RegisterCellCtx,
  value: string
): { color: string; glyph: string; quiet: boolean } {
  const col = ctx.statusCol;
  const entry = paletteEntryFor(
    ctx.dict,
    col?.termSetId ?? "",
    col?.internal ?? "",
    value,
    ctx.labelToId
  );
  const color = resolvePaletteColor(ctx.states, entry?.color ?? "", "");
  const termId = ctx.labelToId.get(value.split(";")[0].trim().toLowerCase()) ?? "";
  return {
    color,
    glyph: entry?.glyph ?? "",
    quiet: termId !== "" && stageOfTerm(ctx.dict, termId) === "approved",
  };
}

/**
 * Status pill: glyph + word so status reads under any colour-vision;
 * both come from the site palette, falling back to the built-in
 * vocabulary when a site has not set a glyph of its own.
 * R8, the quiet/loud rule: APPROVED renders as an OUTLINE; only
 * exception states keep the fill. Tiles and cards share this function,
 * so the rule holds in every view by construction.
 */
export function makeStatusChip(ctx: RegisterCellCtx): (value: string) => HTMLElement {
  return (value: string): HTMLElement => {
    const { color, glyph, quiet } = statusTone(ctx, value);
    const chip = el(
      "span",
      "app-docs-chip",
      glyph !== "" ? `${glyph} ${value}` : withStatusGlyph(value)
    );
    if (quiet) {
      chip.classList.add("app-docs-chip-quiet");
      if (color !== "") chip.style.borderColor = color;
    } else if (color !== "") {
      chip.style.background = color;
      chip.style.color = textOn(color);
    }
    return chip;
  };
}

/** Initials avatar + the full owner text (Vault V3 row anatomy). */
export function ownerCell(v: string): HTMLElement {
  const first = v.split(";")[0].trim();
  const initials = first
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const cell = el("span", "app-docs-ownercell");
  cell.title = v;
  cell.append(
    el("span", "app-docs-avatar", initials === "" ? "•" : initials),
    el("span", "app-docs-ownername", v)
  );
  return cell;
}

/** Mine by EMAIL. Display names collide, and two people called Ben
 *  would each be offered the other's check-in. */
const isMine = (ctx: RegisterCellCtx, row: DocRow): boolean =>
  ctx.myEmail !== "" && (row.checkoutEmail ?? "") === ctx.myEmail;

/** The Document cell: file-type chip + name stem + the checkout lock. */
export function makeNameCell(ctx: RegisterCellCtx): (row: DocRow) => HTMLElement {
  return (row: DocRow): HTMLElement => {
    const cell = el("span", "app-docs-namecell");
    // extension dropped from the display (Ben, 2026-08-02) — the
    // file-type chip carries it; the full filename stays in title
    const { stem } = splitNameForEllipsis(row.name);
    const nm = el("span", "app-docs-name");
    nm.title = row.name;
    nm.append(el("span", "app-docs-namestem", stem));
    cell.append(fileTypeChip(row.ext), nm);
    // checked out is a state worth seeing without opening anything,
    // and MINE is the only actionable case — so it reads differently
    if ((row.checkoutName ?? "") !== "") {
      const mine = isMine(ctx, row);
      const lock = el(
        "span",
        `app-docs-lock${mine ? " app-docs-lock-mine" : ""}`,
        mine ? "✎ you" : `🔒 ${row.checkoutName}`
      );
      lock.title = mine
        ? "You have this checked out"
        : `Checked out by ${row.checkoutName}`;
      cell.append(lock);
    }
    return cell;
  };
}

export type WidthBucket = "full" | "mid" | "narrow";

export interface RegisterColumnOpts {
  /** Column internals to show (already availability-filtered by the
   *  caller — which columns is a VIEW question); sorted into dictionary
   *  order here, so two callers never disagree about sequence.
   *  "Modified" is the one non-dictionary passenger and lands last
   *  among them; it is appended even when absent. */
  wanted: string[];
  /** The pane-width bucket (Vault V3): the status column drops out
   *  first as the pane narrows, then every configured column — name
   *  and Modified always survive. */
  bucket: WidthBucket;
  /** Renders a "Library" column after the name when set — the screen
   *  shows it when more than one library is in view, so a row says
   *  which one it came from. Suppressed in the narrow bucket. */
  libraryLabel?: (row: DocRow) => string;
  /** Appended after Modified (the screen's kebab; cards pass none). */
  trailing?: ListColumn<DocRow>[];
}

/**
 * The register's column set. Which columns to show is the caller's
 * (view) question; what each one means is the dictionary's answer, so
 * this holds for any number of libraries — and for the screen and the
 * board card alike.
 */
export function buildRegisterColumns(
  ctx: RegisterCellCtx,
  opts: RegisterColumnOpts
): ListColumn<DocRow>[] {
  const dictBy = new Map(ctx.dict.columns.map((c) => [c.internal, c]));
  const roleOf = (internal: string): string => dictBy.get(internal)?.role ?? "";
  const labelOf = (internal: string): string => {
    const c = dictBy.get(internal);
    return c && c.label !== "" ? c.label : internal;
  };
  const statusChip = makeStatusChip(ctx);
  const nameCell = makeNameCell(ctx);

  const nameCol: ListColumn<DocRow> = {
    key: "name",
    label: "Document",
    width: "minmax(190px, 3fr)",
    sortKey: "name",
    render: nameCell,
  };
  const modifiedCol: ListColumn<DocRow> = {
    key: "modified",
    label: "Modified",
    width: "124px",
    sortKey: "modified",
    render: (row) => formatWhen(row.modified),
  };

  const columns: ListColumn<DocRow>[] = [nameCol];
  // the caller decides WHICH columns show; the dictionary decides their
  // ORDER, so columns sit in the same relative sequence whatever is
  // hidden (Ben, 2026-08-04). Modified is unknown to the dictionary,
  // so it lands last.
  const wanted = sortByDictionary(opts.wanted, [...dictBy.keys()]);
  const libraryLabel = opts.libraryLabel;
  if (libraryLabel !== undefined && opts.bucket !== "narrow") {
    columns.push({
      key: "library",
      label: "Library",
      width: "minmax(110px, 1fr)",
      render: libraryLabel,
    });
  }
  for (const internal of wanted) {
    if (internal === "Modified") {
      columns.push(modifiedCol);
      continue;
    }
    const role = roleOf(internal);
    if (opts.bucket !== "full" && role === "status") continue;
    if (opts.bucket === "narrow") continue;
    columns.push({
      key: internal,
      label: labelOf(internal),
      render: (row) => {
        const v = row.values[internal] ?? "";
        if (v === "") return "";
        if (role === "status") return statusChip(v);
        if (role === "owner") return ownerCell(v);
        // RLDAS date fields arrive as ISO — humanize them
        return /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatWhen(v) : v;
      },
    });
  }
  if (!wanted.includes("Modified")) columns.push(modifiedCol);
  for (const t of opts.trailing ?? []) columns.push(t);
  return columns;
}
