// The parts of a QR code (ISO/IEC 18004) that writing one and reading one
// share: arithmetic in GF(256), the tables of versions and error correction,
// where the fixed patterns go, the format and version bits, the eight masks
// and the order the data modules are read in. Written for Schedule
// Visualizer 2 from the published standard; no code was copied from another
// QR library. vendor/qr-encode/qr-encode.js writes a symbol and
// vendor/qr-decode/qr-decode.js reads one; both import this file.
//
// A symbol is { size, modules }: `modules` is a Uint8Array of size × size,
// row by row, 1 for a dark module and 0 for a light one. (x, y) is column x
// of row y, with (0, 0) the top-left corner.

export const EC_LEVELS = ['L', 'M', 'Q', 'H'];

// The two bits each level writes into the format information (Table 12).
export const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Table 9: error correction codewords in each block, and the number of
// blocks, for versions 1 to 40 (index 0 unused).
const EC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const EC_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// Annex E: the row and column centres of the alignment patterns.
const ALIGNMENT = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

export function sizeOf(version) {
  return 17 + 4 * version;
}

export function versionOfSize(size) {
  const version = (size - 17) / 4;
  return Number.isInteger(version) && version >= MIN_VERSION && version <= MAX_VERSION ? version : null;
}

export function alignmentCentres(version) {
  return ALIGNMENT[version].slice();
}

// How the codewords of a version and level are cut into blocks:
// { total, data, ecPerBlock, blocks: [{ data }] } with the short blocks first.
export function blockLayout(version, level) {
  const total = totalCodewords(version);
  const ecPerBlock = EC_PER_BLOCK[level][version];
  const count = EC_BLOCKS[level][version];
  const shortLength = Math.floor(total / count);
  const longCount = total % count;
  const blocks = [];
  for (let i = 0; i < count; i += 1) blocks.push({ data: shortLength - ecPerBlock + (i >= count - longCount ? 1 : 0) });
  const data = blocks.reduce((sum, block) => sum + block.data, 0);
  return { total, data, ecPerBlock, blocks };
}

// Every codeword the symbol holds, data and error correction: the modules
// left over once the fixed patterns and the format and version areas are
// taken, in whole bytes (the remainder bits are left light).
export function totalCodewords(version) {
  return Math.floor(dataModuleCount(version) / 8);
}

export function dataModuleCount(version) {
  const size = sizeOf(version);
  const reserved = functionMask(version);
  let count = 0;
  for (let i = 0; i < size * size; i += 1) if (!reserved[i]) count += 1;
  return count;
}

// ---------------------------------------------------------------- GF(256)

// The field the standard uses: polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d),
// with 2 as the generator.
export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

export function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a, b) {
  if (b === 0) throw new RangeError('division by zero in GF(256)');
  return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

// The generator polynomial for n error correction codewords:
// (x - 2^0)(x - 2^1)…(x - 2^(n-1)), highest power first, leading 1 dropped.
const generators = new Map();
export function generator(n) {
  if (generators.has(n)) return generators.get(n);
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  const result = Uint8Array.from(poly.slice(1));
  generators.set(n, result);
  return result;
}

// The n error correction codewords for one block of data codewords: the
// remainder of data × x^n divided by the generator.
export function reedSolomon(data, n) {
  const gen = generator(n);
  const rest = new Uint8Array(n);
  for (const byte of data) {
    const factor = byte ^ rest[0];
    rest.copyWithin(0, 1);
    rest[n - 1] = 0;
    if (factor !== 0) for (let i = 0; i < n; i += 1) rest[i] ^= gfMul(gen[i], factor);
  }
  return rest;
}

// ---------------------------------------------------------------- format and version bits

// The remainder of value × x^(degree of poly) divided by poly, over GF(2).
function bchRemainder(value, poly) {
  const degree = 31 - Math.clz32(poly);
  let rest = value << degree;
  for (let bit = 31 - Math.clz32(rest); bit >= degree; bit -= 1) if (rest & (1 << bit)) rest ^= poly << (bit - degree);
  return rest;
}

// 15 bits: level and mask, a BCH(15,5) code, masked with 101010000010010.
export function formatBits(level, mask) {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  return ((data << 10) | bchRemainder(data, 0x537)) ^ 0x5412;
}

// 18 bits for versions 7 and up: the version and a BCH(18,6) code.
export function versionBits(version) {
  return (version << 12) | bchRemainder(version, 0x1f25);
}

// Where bit i (0 the least significant) of the format bits goes, in each of
// the two copies: [[x, y], [x, y]].
export function formatPositions(size) {
  const first = [];
  const second = [];
  for (let i = 0; i < 15; i += 1) {
    if (i <= 5) first.push([8, i]);
    else if (i === 6) first.push([8, 7]);
    else if (i === 7) first.push([8, 8]);
    else if (i === 8) first.push([7, 8]);
    else first.push([14 - i, 8]);
    if (i < 8) second.push([size - 1 - i, 8]);
    else second.push([8, size - 15 + i]);
  }
  return [first, second];
}

// Where bit i of the version bits goes, in each copy: the one above the
// bottom-left finder and the one left of the top-right finder.
export function versionPositions(size) {
  const first = [];
  const second = [];
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    first.push([b, a]);
    second.push([a, b]);
  }
  return [first, second];
}

// ---------------------------------------------------------------- the fixed patterns

// The modules every symbol of a version has in the same place: the three
// finders with their separators, the timing lines, the alignment patterns
// and the dark module. Returns { modules, reserved }: the pattern's colours,
// and which modules data may not use (these and the format and version areas).
const patterns = new Map();
export function functionPatterns(version) {
  if (patterns.has(version)) return patterns.get(version);
  const size = sizeOf(version);
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  const set = (x, y, dark) => {
    modules[y * size + x] = dark ? 1 : 0;
    reserved[y * size + x] = 1;
  };
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const centres = ALIGNMENT[version];
  const last = centres.length - 1;
  for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j <= last; j += 1) {
      // The three corners a finder already holds have none.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) set(centres[i] + dx, centres[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  for (const copy of formatPositions(size)) for (const [x, y] of copy) set(x, y, false);
  set(8, size - 8, true);
  if (version >= 7) for (const copy of versionPositions(size)) for (const [x, y] of copy) set(x, y, false);
  const result = { modules, reserved };
  patterns.set(version, result);
  return result;
}

function functionMask(version) {
  return functionPatterns(version).reserved;
}

// ---------------------------------------------------------------- data order and masks

// The data modules in the order the codewords' bits fill them: column pairs
// from the right, up then down in turn, skipping the vertical timing line.
// An Int32Array of module indexes (y * size + x).
const orders = new Map();
export function dataOrder(version) {
  if (orders.has(version)) return orders.get(version);
  const size = sizeOf(version);
  const reserved = functionMask(version);
  const order = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) if (!reserved[y * size + x]) order.push(y * size + x);
    }
    upward = !upward;
  }
  const result = Int32Array.from(order);
  orders.set(version, result);
  return result;
}

// Table 10: whether mask m turns the module in row y, column x.
export function maskHits(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new RangeError('no mask ' + mask);
  }
}

// ---------------------------------------------------------------- character counts

// Table 3: the length of the character count for each mode, by version range.
export const MODES = { numeric: 1, alphanumeric: 2, byte: 4, kanji: 8, eci: 7 };
export function countBits(mode, version) {
  const range = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  switch (mode) {
    case MODES.numeric: return [10, 12, 14][range];
    case MODES.alphanumeric: return [9, 11, 13][range];
    case MODES.byte: return [8, 16, 16][range];
    case MODES.kanji: return [8, 10, 12][range];
    default: throw new RangeError('no mode ' + mode);
  }
}

export const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// The most bytes one symbol of this version and level holds in byte mode.
export function byteCapacity(version, level) {
  const bits = blockLayout(version, level).data * 8 - 4 - countBits(MODES.byte, version);
  return Math.floor(bits / 8);
}
