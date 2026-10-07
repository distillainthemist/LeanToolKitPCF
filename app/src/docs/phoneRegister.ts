// The limited phone register (feedback round 1, Tranche D — reports 43
// and 20). On a phone the Documents register is a search box, three
// basic filters as native selects (organisation, type, status), a
// single-column list, and the viewer. Folders, the column set, the
// Filters popover, tiles and the row actions stay desktop: a phone is
// for FINDING and OPENING a document on the floor, not for managing
// the register.
//
// The DOM lives in docsScreen; what is here is pure — which width
// counts as a phone, how a term walk becomes select options, and what a
// select shows for the filter that is on its column — so the rules test
// without a DOM (the suite's convention).

import type { TermNode } from "./sp";

/** Below this many CSS pixels of REGISTER width (the pane, not the
 *  window — the hub can split the screen) the phone layout applies.
 *  The desktop layout needs the 276px folders pane beside a list that
 *  is worth reading; under 600 neither has room. */
export const PHONE_MAX_WIDTH = 600;

export const isPhoneWidth = (width: number): boolean => width > 0 && width < PHONE_MAX_WIDTH;

export interface PhoneOption {
  /** The term id — the select's option value. */
  id: string;
  /** The option text: the leaf label, indented by depth so the
   *  hierarchy reads inside a native select (which takes no markup). */
  label: string;
  depth: number;
}

/** The select's value when the column's filter cannot be shown as one
 *  option: several picks (the approved default is several approved
 *  terms), or a pick deeper than the options go. The caller adds a
 *  synthetic option with that value and the picks' labels. */
export const PHONE_SEVERAL = "__several__";

const INDENT = "   ";

const comparePaths = (a: string[], b: string[]): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = a[i].localeCompare(b[i], undefined, { numeric: true, sensitivity: "base" });
    if (c !== 0) return c;
  }
  return a.length - b.length;
};

/**
 * A term walk as select options: parents before their children, siblings
 * in label order, each leaf indented by its depth; terms deeper than
 * `maxDepth` levels are left out (a phone select is a wheel — the top of
 * the hierarchy is what a thumb can pick; a deeper pick made on the
 * desktop still shows, see phoneSelectState).
 */
export function phoneOptions(nodes: TermNode[], maxDepth = 3): PhoneOption[] {
  return nodes
    .filter((n) => n.labels.length > 0 && n.labels.length <= maxDepth)
    .sort((a, b) => comparePaths(a.labels, b.labels))
    .map((n) => {
      const depth = n.labels.length - 1;
      return { id: n.id, label: `${INDENT.repeat(depth)}${n.labels[n.labels.length - 1]}`, depth };
    });
}

/**
 * What one column's select shows for the filter on it: "" (nothing
 * picked — the "Any …" option), the picked term's id when it is one of
 * the options, else PHONE_SEVERAL with a label naming the picks — so a
 * filter the phone cannot express is still SEEN and can be cleared,
 * never silently misreported as "Any".
 */
export function phoneSelectState(
  picked: TermNode[],
  options: PhoneOption[]
): { value: string; severalLabel: string } {
  if (picked.length === 0) return { value: "", severalLabel: "" };
  if (picked.length === 1 && options.some((o) => o.id === picked[0].id)) {
    return { value: picked[0].id, severalLabel: "" };
  }
  return {
    value: PHONE_SEVERAL,
    severalLabel: picked.map((n) => n.labels[n.labels.length - 1]).join(" · "),
  };
}

/**
 * What the phone's Library select shows: "*" when every library is in
 * view, the one library's id when one is, else PHONE_SEVERAL with the
 * names — the desktop's ticked subset is seen, not misreported.
 */
export const PHONE_ALL_LIBRARIES = "*";
export function phoneLibraryState(
  selected: { id: string; label: string }[],
  total: number
): { value: string; severalLabel: string } {
  if (selected.length === 0 || selected.length >= total) return { value: PHONE_ALL_LIBRARIES, severalLabel: "" };
  if (selected.length === 1) return { value: selected[0].id, severalLabel: "" };
  return { value: PHONE_SEVERAL, severalLabel: selected.map((l) => l.label).join(" · ") };
}
