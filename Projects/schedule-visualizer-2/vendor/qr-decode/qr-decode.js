// Reads a QR code (ISO/IEC 18004). Written for Schedule Visualizer 2; no
// code was copied from another QR library.
//
//   decodeLuminance(luminance, width, height) → { text, bytes, version, level, mask, corrected } or null
//   decodeMatrix({ size, modules })            → the same, or null
//   luminanceOf(rgba, width, height)           → Uint8Array, one byte a pixel
//
// `luminance` is a Uint8Array of width × height, row by row, 0 black and 255
// white: a camera frame drawn into a canvas and passed through luminanceOf,
// or anything else of that shape. `modules` is the shape qr-encode.js makes.
// Null means no code could be read; a code is read whole or not at all.
// `corrected` is how many codewords the error correction mended.
//
// Modes read: numeric, alphanumeric and byte, with an ECI header skipped
// (byte mode is taken as UTF-8 when it is valid UTF-8, else ISO 8859-1).
// Kanji and structured append are refused.

import { EC_LEVELS, EC_FORMAT_BITS, MODES, ALPHANUMERIC, EXP, LOG, gfMul, sizeOf, versionOfSize, blockLayout, functionPatterns, dataOrder, maskHits, formatBits, versionBits, formatPositions, versionPositions, countBits } from '../qr-encode/qr-core.js';
import { locate, sampleGrid } from './qr-locate.js';

export function luminanceOf(rgba, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) {
    // Rec. 601 weights in integers; the alpha is ignored.
    out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
  }
  return out;
}

export function decodeLuminance(luminance, width, height) {
  if (!(luminance && luminance.length >= width * height && width > 0 && height > 0)) return null;
  // Blurred first, against sensor noise; then as it is, for small modules.
  for (const blur of [true, false]) {
    for (const candidate of locate(luminance, width, height, { blur })) {
      for (const size of candidate.sizes) {
        for (const grid of sampleGrid(candidate, size)) {
          const result = decodeMatrix(grid) || decodeMatrix(transposed(grid));
          if (result) return result;
        }
      }
    }
  }
  return null;
}

function transposed(symbol) {
  const { size, modules } = symbol;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) out[x * size + y] = modules[y * size + x];
  return { size, modules: out };
}

// ---------------------------------------------------------------- the matrix

const FORMATS = [];
for (const level of EC_LEVELS) for (let mask = 0; mask < 8; mask += 1) FORMATS.push({ level, mask, bits: formatBits(level, mask) });
const VERSIONS = [];
for (let version = 7; version <= 40; version += 1) VERSIONS.push({ version, bits: versionBits(version) });

function popcount(value) {
  let count = 0;
  for (let v = value; v; v &= v - 1) count += 1;
  return count;
}

function readBits(symbol, positions) {
  let bits = 0;
  positions.forEach(([x, y], bit) => { if (symbol.modules[y * symbol.size + x]) bits |= 1 << bit; });
  return bits;
}

// The nearest valid code to either copy, if it is within `most` bits.
function nearest(table, copies, most) {
  let best = null;
  let distance = most + 1;
  for (const entry of table) {
    for (const bits of copies) {
      const d = popcount(entry.bits ^ bits);
      if (d < distance) {
        distance = d;
        best = entry;
      }
    }
  }
  return best;
}

export function decodeMatrix(symbol) {
  if (!symbol || !(symbol.modules instanceof Uint8Array)) return null;
  const { size } = symbol;
  let version = versionOfSize(size);
  if (version === null || symbol.modules.length !== size * size) return null;
  if (version >= 7) {
    const found = nearest(VERSIONS, versionPositions(size).map((copy) => readBits(symbol, copy)), 3);
    if (!found || found.version !== version) return null;
  }
  const format = nearest(FORMATS, formatPositions(size).map((copy) => readBits(symbol, copy)), 3);
  if (!format) return null;
  const { level, mask } = format;

  // The codewords, unmasked, in the order they were placed.
  const order = dataOrder(version);
  const layout = blockLayout(version, level);
  const raw = new Uint8Array(layout.total);
  for (let i = 0; i < layout.total * 8; i += 1) {
    const at = order[i];
    const x = at % size;
    const y = (at - x) / size;
    const bit = symbol.modules[at] ^ (maskHits(mask, x, y) ? 1 : 0);
    raw[i >> 3] |= bit << (7 - (i & 7));
  }

  // Undo the interleaving, then mend each block.
  const blocks = layout.blocks.map((block) => new Uint8Array(block.data + layout.ecPerBlock));
  let k = 0;
  const longest = Math.max(...layout.blocks.map((block) => block.data));
  for (let i = 0; i < longest; i += 1) blocks.forEach((block, b) => { if (i < layout.blocks[b].data) block[i] = raw[k++]; });
  for (let i = 0; i < layout.ecPerBlock; i += 1) blocks.forEach((block, b) => { block[layout.blocks[b].data + i] = raw[k++]; });

  const data = new Uint8Array(layout.data);
  let at = 0;
  let corrected = 0;
  for (let b = 0; b < blocks.length; b += 1) {
    const mended = correct(blocks[b], layout.ecPerBlock);
    if (mended === null) return null;
    corrected += mended;
    data.set(blocks[b].subarray(0, layout.blocks[b].data), at);
    at += layout.blocks[b].data;
  }
  const bytes = segments(data, version);
  if (!bytes) return null;
  return { text: textOf(bytes), bytes, version, level, mask, corrected };
}

// ---------------------------------------------------------------- Reed-Solomon, corrected

// Mend one block in place: data then n error correction codewords, the
// generator's roots 2^0 … 2^(n-1). Returns how many codewords were changed,
// or null when there are more errors than the block can mend (at most n/2).
// Berlekamp-Massey finds the error locator, a Chien search its roots and
// Forney's formula the size of each error.
export function correct(block, n) {
  const length = block.length;
  const syndromes = new Uint8Array(n);
  let clean = true;
  for (let i = 0; i < n; i += 1) {
    let value = 0;
    for (let j = 0; j < length; j += 1) value = gfMul(value, EXP[i]) ^ block[j];
    syndromes[i] = value;
    if (value !== 0) clean = false;
  }
  if (clean) return 0;

  // Berlekamp-Massey: lambda is the error locator, lowest power first.
  let lambda = [1];
  let previous = [1];
  let errors = 0;
  let shift = 1;
  let lastDiscrepancy = 1;
  for (let r = 0; r < n; r += 1) {
    let discrepancy = syndromes[r];
    for (let i = 1; i <= errors; i += 1) discrepancy ^= gfMul(lambda[i] || 0, syndromes[r - i]);
    if (discrepancy === 0) {
      shift += 1;
      continue;
    }
    const factor = gfMul(discrepancy, EXP[255 - LOG[lastDiscrepancy]]);
    const next = lambda.slice();
    for (let i = 0; i < previous.length; i += 1) {
      while (next.length <= i + shift) next.push(0);
      next[i + shift] ^= gfMul(factor, previous[i]);
    }
    if (2 * errors <= r) {
      previous = lambda;
      errors = r + 1 - errors;
      lastDiscrepancy = discrepancy;
      shift = 1;
    } else {
      shift += 1;
    }
    lambda = next;
  }
  while (lambda.length > 1 && lambda[lambda.length - 1] === 0) lambda.pop();
  const degree = lambda.length - 1;
  if (degree !== errors || 2 * errors > n) return null;

  // Chien search: position p (counted from the end of the block, so the
  // codeword's power of x) is in error when lambda(2^-p) = 0.
  const positions = [];
  for (let p = 0; p < length; p += 1) {
    const inverse = EXP[(255 - (p % 255)) % 255];
    let value = 0;
    for (let i = degree; i >= 0; i -= 1) value = gfMul(value, inverse) ^ lambda[i];
    if (value === 0) positions.push(p);
  }
  if (positions.length !== degree) return null;

  // Forney: omega = S(x) lambda(x) mod x^n; the error at X = 2^p is
  // X · omega(1/X) / lambda'(1/X).
  const omega = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    let value = 0;
    for (let j = 0; j <= Math.min(i, degree); j += 1) value ^= gfMul(syndromes[i - j], lambda[j]);
    omega[i] = value;
  }
  for (const p of positions) {
    const x = EXP[p % 255];
    const inverse = EXP[(255 - (p % 255)) % 255];
    let top = 0;
    for (let i = n - 1; i >= 0; i -= 1) top = gfMul(top, inverse) ^ omega[i];
    let bottom = 0;
    // The formal derivative keeps the odd powers only.
    for (let i = degree - (degree % 2 === 0 ? 1 : 0); i >= 1; i -= 2) {
      bottom = gfMul(gfMul(bottom, inverse), inverse) ^ lambda[i];
    }
    if (bottom === 0) return null;
    const size = gfMul(x, gfMul(top, EXP[255 - LOG[bottom]]));
    block[length - 1 - p] ^= size;
  }

  // Check the mended block reads clean.
  for (let i = 0; i < n; i += 1) {
    let value = 0;
    for (let j = 0; j < length; j += 1) value = gfMul(value, EXP[i]) ^ block[j];
    if (value !== 0) return null;
  }
  return degree;
}

// ---------------------------------------------------------------- the content

function segments(data, version) {
  let position = 0;
  const total = data.length * 8;
  const take = (count) => {
    if (position + count > total) return null;
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = value * 2 + ((data[(position + i) >> 3] >> (7 - ((position + i) & 7))) & 1);
    }
    position += count;
    return value;
  };
  const out = [];
  while (position + 4 <= total) {
    const mode = take(4);
    if (mode === 0) break;
    if (mode === MODES.eci) {
      // An ECI designator: one, two or three bytes by its first bits.
      const first = take(8);
      if (first === null) return null;
      if ((first & 0x80) !== 0 && take((first & 0x40) === 0 ? 8 : 16) === null) return null;
      continue;
    }
    if (mode !== MODES.numeric && mode !== MODES.alphanumeric && mode !== MODES.byte) return null;
    const count = take(countBits(mode, version));
    if (count === null) return null;
    if (mode === MODES.byte) {
      for (let i = 0; i < count; i += 1) {
        const byte = take(8);
        if (byte === null) return null;
        out.push(byte);
      }
    } else if (mode === MODES.numeric) {
      let left = count;
      while (left > 0) {
        const digits = Math.min(3, left);
        const value = take([0, 4, 7, 10][digits]);
        if (value === null || value >= 10 ** digits) return null;
        for (const ch of String(value).padStart(digits, '0')) out.push(ch.charCodeAt(0));
        left -= digits;
      }
    } else {
      let left = count;
      while (left > 0) {
        if (left >= 2) {
          const value = take(11);
          if (value === null || value >= 45 * 45) return null;
          out.push(ALPHANUMERIC.charCodeAt(Math.floor(value / 45)), ALPHANUMERIC.charCodeAt(value % 45));
          left -= 2;
        } else {
          const value = take(6);
          if (value === null || value >= 45) return null;
          out.push(ALPHANUMERIC.charCodeAt(value));
          left -= 1;
        }
      }
    }
  }
  return Uint8Array.from(out);
}

function textOf(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }
}

// For tests: the format table, so a case can check every entry is apart.
export function formatTable() {
  return FORMATS.map((entry) => ({ ...entry }));
}

export { sizeOf, functionPatterns, EC_FORMAT_BITS };
