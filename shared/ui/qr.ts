// Minimal QR encoder — byte mode, ECC level M, FIXED mask 0. The app is
// zero-dependency and the player CSP blocks external image services, so
// share-by-QR (5I) needs its own encoder. Fixing the mask is spec-legal
// (a scanner honours whatever the format info declares; mask choice only
// tunes worst-case contrast patterns) and removes the whole penalty
// machinery. Structure follows the well-known compact implementation
// approach: capacities computed from the raw-module formula + the two
// per-version ECC tables, Reed-Solomon over GF(256) (poly 0x11D).

/** ECC codewords per block, level M, index = version (1..40). */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
  26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
/** Error-correction block count, level M, index = version (1..40). */
const NUM_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
  16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Total modules available for codewords in a version-v symbol. */
const rawDataModules = (v: number): number => {
  let result = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const numAlign = Math.floor(v / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (v >= 7) result -= 36;
  }
  return result;
};

const dataCodewords = (v: number): number =>
  Math.floor(rawDataModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];

// ---- GF(256), poly 0x11D ----------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

/** Reed-Solomon remainder of `data` against the degree-`ecLen` generator. */
const rsRemainder = (data: number[], ecLen: number): number[] => {
  // generator polynomial ∏ (x − α^i), i = 0..ecLen-1
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gfMul(gen[j], GF_EXP[i]);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }
  // gen is little-endian by construction above; polynomial division
  // wants the leading coefficient first
  gen.reverse();
  const rem = new Array<number>(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
};

// ---- format / version info --------------------------------------------

/** 15 format bits for (level M, mask) — BCH(15,5) + the fixed XOR. */
export const formatBits = (mask: number): number => {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
};

/** 18 version bits (v ≥ 7) — BCH(18,6). */
const versionBits = (v: number): number => {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | rem;
};

/** Alignment pattern centre coordinates for a version. */
const alignmentPositions = (v: number): number[] => {
  if (v === 1) return [];
  const numAlign = Math.floor(v / 7) + 2;
  const size = v * 4 + 17;
  const step = Math.floor((v * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < numAlign; pos -= step) out.splice(1, 0, pos);
  return out;
};

// ---- the encoder -------------------------------------------------------

/**
 * Encode text (UTF-8, byte mode, ECC M, mask 0) into a module matrix.
 * true = dark. Null when the text exceeds version 40's capacity —
 * callers show the link text alone instead of a broken symbol.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);

  // smallest version that fits: 4 mode bits + 8/16 count bits + data
  let version = 0;
  for (let v = 1; v <= 40; v++) {
    const bits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= dataCodewords(v) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) return null;

  // bit stream → codewords
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let pad = 0xec; data.length < dataCodewords(version); pad ^= 0xec ^ 0x11) {
    data.push(pad);
  }

  // split into blocks (short blocks FIRST), append RS codewords
  const numBlocks = NUM_BLOCKS[version];
  const ecLen = ECC_PER_BLOCK[version];
  const shortLen = Math.floor(dataCodewords(version) / numBlocks);
  const numLong = dataCodewords(version) % numBlocks;
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i >= numBlocks - numLong ? 1 : 0);
    const chunk = data.slice(at, at + len);
    at += len;
    blocks.push({ data: chunk, ec: rsRemainder(chunk, ecLen) });
  }
  // interleave: data column-wise (long blocks contribute the extra
  // trailing byte), then EC column-wise
  const codewords: number[] = [];
  for (let i = 0; i < shortLen + 1; i++) {
    for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i]);
  }
  for (let i = 0; i < ecLen; i++) for (const b of blocks) codewords.push(b.ec[i]);

  // ---- the matrix ------------------------------------------------------
  const size = version * 4 + 17;
  const dark: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => {
    dark[y][x] = v;
    isFn[y][x] = true;
  };

  // finder patterns (+ separators) at three corners
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFn[6][i]) set(i, 6, i % 2 === 0);
    if (!isFn[i][6]) set(6, i, i % 2 === 0);
  }

  // alignment patterns (skipping the three finder corners)
  const aligns = alignmentPositions(version);
  for (let i = 0; i < aligns.length; i++) {
    for (let j = 0; j < aligns.length; j++) {
      const last = aligns.length - 1;
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      ) {
        continue;
      }
      const cx = aligns[j];
      const cy = aligns[i];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // format bits (mask 0, level M) — both copies + the dark module
  const fmt = formatBits(0);
  const fbit = (i: number) => ((fmt >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, fbit(i));
  set(8, 7, fbit(6));
  set(8, 8, fbit(7));
  set(7, 8, fbit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, fbit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fbit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fbit(i));
  set(8, size - 8, true); // the dark module

  // version info (v ≥ 7), both copies
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // data placement: the standard upward/downward zigzag over column
  // pairs from the right, skipping the timing column, mask 0 applied to
  // data modules only
  let bitIndex = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y][x]) continue;
        let bit = false;
        if (bitIndex < total) {
          bit = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
        if ((x + y) % 2 === 0) bit = !bit; // mask 0
        dark[y][x] = bit;
      }
    }
  }
  return dark;
}

/** The matrix as an SVG (dark on light, 4-module quiet zone). */
export function qrSvg(text: string, sizePx = 220): SVGElement | null {
  const m = qrMatrix(text);
  if (m === null) return null;
  const n = m.length;
  const total = n + 8; // quiet zone
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${total} ${total}`);
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", String(total));
  bg.setAttribute("height", String(total));
  bg.setAttribute("fill", "#fff");
  svg.appendChild(bg);
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.appendChild(path);
  return svg;
}
