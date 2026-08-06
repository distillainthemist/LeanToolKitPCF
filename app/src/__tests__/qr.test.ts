// The QR encoder's structural invariants. A wrong module pattern can't
// be fully proven without a decoder, but the parts with KNOWN answers
// are pinned: the format bits for (M, mask 0) are the classic table
// value 101010000010010, the symbol sizes follow 4v+17, and the finder/
// timing geometry is fixed by the spec.

import { describe, expect, it } from "vitest";
import { formatBits, qrMatrix } from "../../../shared/ui/qr";

describe("qr encoder", () => {
  it("format bits for level M, mask 0 match the published table", () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    // and the BCH is not degenerate for other masks
    expect(formatBits(1)).not.toBe(formatBits(0));
  });

  it("sizes follow 4v+17 and grow with content", () => {
    const small = qrMatrix("A");
    expect(small).not.toBeNull();
    expect((small!.length - 17) % 4).toBe(0);
    const big = qrMatrix("https://apps.powerapps.com/play/e/x/app/y?" + "p=".repeat(120));
    expect(big).not.toBeNull();
    expect(big!.length).toBeGreaterThan(small!.length);
    expect((big!.length - 17) % 4).toBe(0);
    // every row is square
    for (const row of big!) expect(row.length).toBe(big!.length);
  });

  it("draws the three finder patterns and the timing track", () => {
    const m = qrMatrix("LeanBoard")!;
    const n = m.length;
    // finder centres dark, the white ring at distance 2, corners dark
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ] as const) {
      expect(m[cy][cx]).toBe(true); // centre
      expect(m[cy][cx - 2]).toBe(false); // white ring
      expect(m[cy - 3][cx - 3]).toBe(true); // outer border corner
    }
    // fourth corner has NO finder: its 7x7 can't be all-dark border
    // (weak check: the exact cell of a would-be centre is data, so just
    // assert the timing track instead)
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it("the dark module is dark and long text exceeds capacity to null", () => {
    const m = qrMatrix("LeanBoard")!;
    const n = m.length;
    expect(m[n - 8][8]).toBe(true);
    expect(qrMatrix("x".repeat(4000))).toBeNull();
  });
});
