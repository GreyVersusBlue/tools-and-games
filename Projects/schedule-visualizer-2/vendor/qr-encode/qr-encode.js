// Writes a QR code (ISO/IEC 18004) in byte mode: versions 1 to 40, error
// correction L, M, Q or H, the mask chosen by the standard's penalty score
// unless one is asked for. Written for Schedule Visualizer 2; no code was
// copied from another QR library.
//
//   encodeQr(content, { level, minVersion, maxVersion, mask }) → { version, size, level, mask, modules }
//   qrPathData(symbol, margin) → an SVG path, one unit a module
//
// `content` is text (written as UTF-8) or a Uint8Array. `modules` is a
// Uint8Array of size × size, row by row, 1 dark. A content too long for the
// largest version allowed throws QrError with a sentence.

import { EC_LEVELS, MIN_VERSION, MAX_VERSION, MODES, sizeOf, blockLayout, reedSolomon, functionPatterns, dataOrder, maskHits, formatBits, versionBits, formatPositions, versionPositions, countBits, byteCapacity } from './qr-core.js';

export class QrError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'QrError';
    this.code = code;
  }
}

export function encodeQr(content, options) {
  const opts = options || {};
  const level = opts.level === undefined ? 'M' : opts.level;
  if (!EC_LEVELS.includes(level)) throw new RangeError('no error correction level ' + level);
  const minVersion = opts.minVersion === undefined ? MIN_VERSION : opts.minVersion;
  const maxVersion = opts.maxVersion === undefined ? MAX_VERSION : opts.maxVersion;
  if (!(Number.isInteger(minVersion) && Number.isInteger(maxVersion) && MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION)) throw new RangeError('versions must run from 1 to 40, smallest first');
  if (opts.mask !== undefined && !(Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7)) throw new RangeError('a mask is 0 to 7');
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('content is text or a Uint8Array');

  let version = minVersion;
  while (version <= maxVersion && byteCapacity(version, level) < bytes.length) version += 1;
  if (version > maxVersion) {
    throw new QrError('This is too long for one QR code: ' + bytes.length + ' bytes, and a code at this size holds at most ' + byteCapacity(maxVersion, level) + '.', 'too-long');
  }

  const codewords = interleave(dataCodewords(bytes, version, level), version, level);
  const size = sizeOf(version);
  const placed = placeData(codewords, version);

  let mask = opts.mask;
  let modules = null;
  if (mask === undefined) {
    let best = Infinity;
    for (let m = 0; m < 8; m += 1) {
      const candidate = finish(placed, version, level, m);
      const score = penalty(candidate, size);
      if (score < best) {
        best = score;
        mask = m;
        modules = candidate;
      }
    }
  } else {
    modules = finish(placed, version, level, mask);
  }
  return { version, size, level, mask, modules };
}

// The data codewords: mode, count, the bytes, the terminator, the pad bytes.
export function dataCodewords(bytes, version, level) {
  const capacity = blockLayout(version, level).data;
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  put(MODES.byte, 4);
  put(bytes.length, countBits(MODES.byte, version));
  for (const byte of bytes) put(byte, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out[i / 8] = byte;
  }
  for (let i = bits.length / 8, pad = 0; i < capacity; i += 1, pad += 1) out[i] = pad % 2 === 0 ? 0xec : 0x11;
  return out;
}

// Cut the data into blocks, add each block's error correction, and take the
// codewords a column at a time: every block's first data codeword, then
// every block's second, and so on, then the error correction the same way.
export function interleave(data, version, level) {
  const layout = blockLayout(version, level);
  const blocks = [];
  let at = 0;
  for (const block of layout.blocks) {
    const part = data.subarray(at, at + block.data);
    at += block.data;
    blocks.push({ data: part, ec: reedSolomon(part, layout.ecPerBlock) });
  }
  const out = new Uint8Array(layout.total);
  let k = 0;
  const longest = Math.max(...layout.blocks.map((block) => block.data));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.data.length) out[k++] = block.data[i];
  for (let i = 0; i < layout.ecPerBlock; i += 1) for (const block of blocks) out[k++] = block.ec[i];
  return out;
}

// The codewords' bits in the data modules, before any mask.
function placeData(codewords, version) {
  const order = dataOrder(version);
  const size = sizeOf(version);
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < order.length; i += 1) {
    const byte = i >> 3;
    if (byte < codewords.length) modules[order[i]] = (codewords[byte] >> (7 - (i & 7))) & 1;
  }
  return modules;
}

// The symbol with mask m on its data modules and every fixed pattern drawn.
function finish(placed, version, level, mask) {
  const size = sizeOf(version);
  const { modules: fixed, reserved } = functionPatterns(version);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      out[i] = reserved[i] ? fixed[i] : placed[i] ^ (maskHits(mask, x, y) ? 1 : 0);
    }
  }
  const format = formatBits(level, mask);
  for (const copy of formatPositions(size)) copy.forEach(([x, y], bit) => { out[y * size + x] = (format >> bit) & 1; });
  if (version >= 7) {
    const bits = versionBits(version);
    for (const copy of versionPositions(size)) copy.forEach(([x, y], bit) => { out[y * size + x] = (bits >> bit) & 1; });
  }
  return out;
}

// The standard's four penalty rules (8.8.2): runs of five or more, 2 × 2
// blocks, the finder-like 1:1:3:1:1 with four light modules beside it, and
// the share of dark modules away from half.
export function penalty(modules, size) {
  let score = 0;
  const at = (x, y) => modules[y * size + x];
  const line = new Uint8Array(size + 8);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let a = 0; a < size; a += 1) {
      // The line with the four light modules of the margin on each side.
      for (let b = 0; b < size; b += 1) line[b + 4] = pass === 0 ? at(b, a) : at(a, b);
      let run = 0;
      for (let b = 4; b < size + 4; b += 1) {
        run = b > 4 && line[b] === line[b - 1] ? run + 1 : 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      }
      let window = 0;
      for (let b = 0; b < size + 8; b += 1) {
        window = ((window << 1) | line[b]) & 0x7ff;
        if (b >= 10 && (window === 0x05d || window === 0x5d0)) score += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }
  }
  let dark = 0;
  for (const value of modules) dark += value;
  const total = size * size;
  // 10 points for each full 5 % the dark share is away from half.
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

// An SVG path drawing every dark module as a unit square, the symbol starting
// `margin` units in (the standard asks for four light modules round it).
export function qrPathData(symbol, margin) {
  const m = margin === undefined ? 4 : margin;
  const parts = [];
  for (let y = 0; y < symbol.size; y += 1) {
    let x = 0;
    while (x < symbol.size) {
      if (!symbol.modules[y * symbol.size + x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < symbol.size && symbol.modules[y * symbol.size + end]) end += 1;
      parts.push('M' + (x + m) + ' ' + (y + m) + 'h' + (end - x) + 'v1h' + (x - end) + 'z');
      x = end;
    }
  }
  return parts.join('');
}
