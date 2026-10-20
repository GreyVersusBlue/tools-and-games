// The QR code under Send to another device (ARCHITECTURE 15): the encoder
// in vendor/qr-encode/ against values published in the standard and in a
// public tutorial, every version and level read back by the decoder, the
// mask chosen by the standard's score, error correction mending what it
// can, and the decoder finding a code in camera-like frames: scaled,
// turned, tilted, unevenly lit and noisy.
//
// The published values, and where they come from:
// - ISO/IEC 18004 (2006 and 2015 editions), Annex I, the symbol encoding
//   example: "01234567" at version 1-M, whose data codewords
//   16 32 12 86 97 128 236 17 236 17 236 17 236 17 236 17 take the error
//   correction codewords 165 36 212 193 237 54 199 135 44 85.
// - Thonky.com's QR Code Tutorial, "Error Correction Coding"
//   (https://www.thonky.com/qr-code-tutorial/error-correction-coding):
//   "HELLO WORLD" at 1-M, data 32 91 11 120 209 114 220 77 67 64 236 17 236
//   17 236 17, error correction 196 35 39 119 235 215 231 226 93 23.
// - ISO/IEC 18004 Annex C's example of the format information (level M,
//   mask 101 gives 100000011001110), and the tutorial's "Format and Version
//   String Tables" (https://www.thonky.com/qr-code-tutorial/format-version-tables)
//   for level L, M, Q and H with masks 0 and 7.
// - ISO/IEC 18004 Annex D's example of the version information (version 7
//   gives 000111110010010100), and the same tutorial table for 8 and 40.
// - ISO/IEC 18004 Table 7, the data capacity in byte mode.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EC_LEVELS, MIN_VERSION, MAX_VERSION, sizeOf, blockLayout, totalCodewords, reedSolomon, formatBits, versionBits, functionPatterns, byteCapacity, dataOrder, gfMul, gfDiv } from '../../vendor/qr-encode/qr-core.js';
import { encodeQr, penalty, qrPathData, QrError, dataCodewords, interleave } from '../../vendor/qr-encode/qr-encode.js';
import { decodeMatrix, decodeLuminance, luminanceOf, correct, formatTable } from '../../vendor/qr-decode/qr-decode.js';
import { seededRandom } from '../../engine/ids.js';

const bits = (value, length) => value.toString(2).padStart(length, '0');

// ---------------------------------------------------------------- the published values

test('Reed-Solomon gives the error correction of the standard\'s own example, "01234567" at 1-M', () => {
  const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  assert.deepEqual([...reedSolomon(data, 10)], [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

test('Reed-Solomon gives the tutorial\'s error correction for "HELLO WORLD" at 1-M', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual([...reedSolomon(data, 10)], [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('the format information matches Annex C\'s example and the tutorial\'s table', () => {
  assert.equal(bits(formatBits('M', 5), 15), '100000011001110');
  const table = { L: ['111011111000100', '110100101110110'], M: ['101010000010010', '100101010100000'], Q: ['011010101011111', '010101111101101'], H: ['001011010001001', '000100000111011'] };
  for (const level of EC_LEVELS) {
    assert.equal(bits(formatBits(level, 0), 15), table[level][0], level + ' mask 0');
    assert.equal(bits(formatBits(level, 7), 15), table[level][1], level + ' mask 7');
  }
});

test('the version information matches Annex D\'s example and the tutorial\'s table', () => {
  assert.equal(bits(versionBits(7), 18), '000111110010010100');
  assert.equal(bits(versionBits(8), 18), '001000010110111100');
  assert.equal(bits(versionBits(40), 18), '101000110001101001');
});

test('byte capacities match the standard\'s Table 7', () => {
  const table = { 1: { L: 17, M: 14, Q: 11, H: 7 }, 10: { L: 271, M: 213, Q: 151, H: 119 }, 40: { L: 2953, M: 2331, Q: 1663, H: 1273 } };
  for (const [version, levels] of Object.entries(table)) {
    for (const [level, capacity] of Object.entries(levels)) assert.equal(byteCapacity(Number(version), level), capacity, version + '-' + level);
  }
  assert.equal(totalCodewords(1), 26);
  assert.equal(totalCodewords(40), 3706);
});

// ---------------------------------------------------------------- the tables hold together

test('every version and level cuts its codewords into blocks that differ by at most one', () => {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    for (const level of EC_LEVELS) {
      const layout = blockLayout(version, level);
      const lengths = layout.blocks.map((block) => block.data);
      assert.equal(lengths.reduce((a, b) => a + b, 0) + layout.blocks.length * layout.ecPerBlock, layout.total, version + '-' + level);
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1, version + '-' + level);
      assert.ok(layout.blocks[0].data <= layout.blocks[layout.blocks.length - 1].data, 'short blocks first, ' + version + '-' + level);
      // The data order visits every data module once, and there are enough
      // for every codeword (the rest, 0 to 7 bits, stay light).
      const order = dataOrder(version);
      assert.equal(new Set(order).size, order.length);
      assert.ok(order.length - layout.total * 8 >= 0 && order.length - layout.total * 8 < 8, version + ': ' + (order.length - layout.total * 8) + ' bits left over');
    }
    if (version > 1) assert.ok(byteCapacity(version, 'M') > byteCapacity(version - 1, 'M'));
  }
});

test('GF(256) multiplies and divides as inverse operations', () => {
  for (let a = 1; a < 256; a += 17) for (let b = 1; b < 256; b += 13) assert.equal(gfDiv(gfMul(a, b), b), a);
  assert.equal(gfMul(0, 77), 0);
  assert.throws(() => gfDiv(5, 0), RangeError);
});

test('the fixed patterns: three finders, the timing lines and the dark module', () => {
  const { modules } = functionPatterns(7);
  const size = sizeOf(7);
  const at = (x, y) => modules[y * size + x];
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let i = 0; i < 7; i += 1) {
      assert.equal(at(ox + i, oy), 1);
      assert.equal(at(ox + i, oy + 6), 1);
    }
    assert.equal(at(ox + 1, oy + 1), 0);
    assert.equal(at(ox + 3, oy + 3), 1);
  }
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0);
    assert.equal(at(6, i), i % 2 === 0 ? 1 : 0);
  }
  assert.equal(at(8, size - 8), 1);
});

// ---------------------------------------------------------------- the encoder

test('byte mode: the mode, the count, the bytes, the terminator and the pad bytes', () => {
  // "Hi" at 1-M: 0100, 00000010, 01001000 01101001, 0000, then 236 17 …
  const codewords = dataCodewords(new TextEncoder().encode('Hi'), 1, 'M');
  assert.deepEqual([...codewords], [0x40, 0x24, 0x86, 0x90, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
});

test('interleaving takes a column of every block in turn', () => {
  // 5-Q: four blocks, 15, 15, 16 and 16 data codewords.
  const layout = blockLayout(5, 'Q');
  assert.deepEqual(layout.blocks.map((block) => block.data), [15, 15, 16, 16]);
  const data = Uint8Array.from({ length: layout.data }, (_, i) => i);
  const out = interleave(data, 5, 'Q');
  assert.deepEqual([...out.subarray(0, 8)], [0, 15, 30, 46, 1, 16, 31, 47]);
  // The long blocks' last codewords come after every block's 15th.
  assert.deepEqual([...out.subarray(60, 62)], [45, 61]);
  assert.equal(out.length, layout.total);
});

test('the mask chosen scores no worse than any other, by the standard\'s four rules', () => {
  for (const [text, level] of [['SV2:hello', 'L'], ['a longer piece of text to fill a few versions of code', 'M'], ['x'.repeat(300), 'Q']]) {
    const chosen = encodeQr(text, { level });
    const score = penalty(chosen.modules, chosen.size);
    for (let mask = 0; mask < 8; mask += 1) {
      const other = encodeQr(text, { level, mask });
      assert.ok(score <= penalty(other.modules, other.size), level + ': mask ' + chosen.mask + ' scores ' + score + ', mask ' + mask + ' ' + penalty(other.modules, other.size));
    }
  }
});

test('the penalty of an all-light 21 by 21 grid, worked by hand from the four rules', () => {
  // Rule 1: 42 lines, each one run of 21: 3 + 16 = 19 each, 798. Rule 2: 20 × 20
  // blocks at 3, 1200. Rule 3: no dark module, so no 1:1:3:1:1, 0. Rule 4:
  // no dark at all, 50 % from half, ten steps of 5 %, 100. In all 2098.
  assert.equal(penalty(new Uint8Array(21 * 21), 21), 2098);
  // The same grid with one finder-like line, 1011101, in row 10 from column
  // 7. Rule 1: 20 light rows at 19, the row itself 5 + 5 for its two runs of
  // seven light, 16 light columns at 19, and five columns broken in two runs
  // of ten at 8 each: 380 + 10 + 304 + 80 = 774. Rule 2: 16 blocks touch a
  // dark module, so 384 at 3, 1152. Rule 3: the row reads 0000 1011101 0000
  // with the light margin, which matches both ways: 80. Rule 4: 5 dark of
  // 441 is 1.1 %, nine full steps of 5 % from half, 90. In all 2096.
  const grid = new Uint8Array(21 * 21);
  [1, 0, 1, 1, 1, 0, 1].forEach((v, i) => { grid[10 * 21 + 7 + i] = v; });
  assert.equal(penalty(grid, 21), 2096);
});

// Symbols made by another encoder, python-qrcode 8.2 (BSD licence), on
// 2026-10-20, for the same text, version, level and mask, written here as
// the modules row by row in hexadecimal, zero-padded to whole digits. The
// encoder and the decoder share the eight mask patterns, so a wrong pattern
// would still read back; these catch it. Every mask at 1-M, and two
// symbols of version 7 for the version information.
const OTHER_ENCODER = [
  [1, "M", 0, "SV2:golden", "fe0bfc16106e92bb74e5dbafaec13907faafe00400aa6892498c09dce600f2917b148040e3f83e704c1bbac945d39faeac6304f92feb398"],
  [1, "M", 1, "SV2:golden", "fedbfc10906ea6bb7445dba2aec15107faafe00e00a33928e3269c89b2aa58342e41806a4bfb6b3046b1ba1c15d1352eb93704538fee6c8"],
  [1, "M", 2, "SV2:golden", "fe6bfc12d06eaabb75d5dba9aec17507faafe01700be0be4616f87e4058aca72f52c004edbf9b0505f95baaacdd77c2eb48104c1cfed010"],
  [1, "M", 3, "SV2:golden", "feebfc14106e90bb75d5dba42ec10107faafe01c00b7625c616faad2de381112f52c00636ffa06905f95ba71a5d411aeb48104771febda0"],
  [1, "M", 4, "SV2:golden", "feabfc10d06e84bb75a5dbadaec15507faafe010008bcfcfef5764ea3c92bbb5e95d806d57fb53d04889baedd5d144ee9ab904b00fe9708"],
  [1, "M", 5, "SV2:golden", "fe5bfc14d06eaabb7515dba1aec11507faafe01f00828e75a673c7e405aa48742e41806e5bf9b05043e4ba2acdd1742e99370443cfed010"],
  [1, "M", 6, "SV2:golden", "fedbfc14d06ea2bb7415dba8aec10d07faafe00f009facbda673cec097b229f42e41806d57fb221053e4bab885d4f22e9937044fffef480"],
  [1, "M", 7, "SV2:golden", "fe0bfc13106e96bb74e5dba5aec17107faafe0000096fd02498c1b95c249d6017b148052abf877505c1bba6dd5d70dee8c6304b00fea1d0"],
  [7, "L", 3, "SV2:golden, version 7", "fef0e5fb0bfc1295e9c4906ea24cce54bb7502a16f35dbab7cfd43aec1123c664107faaaaaaaafe00eff165d00f2c5ff8a8ceb82a91426c9e7b752b94a631aad999c7938b4e2d481ce489d0b95c9770f6e4645c4a29f6f4e693dfe8440989a73af2a59018344c874238fa0584fd0a9fa47fa4efec8f8147a5471547aeacaaa842abf1a271bef183f885fd1af87ec72699042e2dae6c22cf049a6c12aa278bd5487ede8c2de6f231bfb9d18cb28117b950258be20463284f50cad28476bd96682c8afce26bef2025372b2c9ab95fb7efb004bec6a3c5ff9d1eb32ea50419110891eba732fe75fedd7c426fd002eb98954e51905d030473c9fee396137bc0"],
  [7, "L", 6, "SV2:golden, version 7", "fec63e968bfc127667fc906e9005eac4bb74c5bd1eb5dba7eefc67aec11c0445c107faaaaaaaafe01d711ebe00da0cdf98c20a45b565e1d583a51b9dd82a90957a1241de6f8f625aa3aa133376474d4e4ad40ce025831e89754c6ecd640ad35587c9d73960dfa5c2f8e217d2773327c2aefedcffecfa0c4b946d247cabee2acd2a2719a9130d165fbe8fbc1fd9c491e7a8a146c8afe6beb83861dd5b6561b9c6cec97aa05057c095c22bc3a69eca03368c605daed67ba067458cef5b1a1e7ac2dae6eab4f6f03ab0fc8a29b0f8fda5fe8045d449b467f8f56b7bead04de117951fbaba0ff51fcdd727a8c5e3ae943f8f88af05e8d3c9047feaab28132e0"]
];

function hexOfModules(modules) {
  let bits = Array.from(modules).join('');
  bits += '0'.repeat((4 - (bits.length % 4)) % 4);
  let out = '';
  for (let i = 0; i < bits.length; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return out;
}

test('every mask, and the version information, agree with another encoder module for module', () => {
  for (const [version, level, mask, text, hex] of OTHER_ENCODER) {
    const symbol = encodeQr(text, { level, minVersion: version, maxVersion: version, mask });
    assert.equal(hexOfModules(symbol.modules), hex, version + '-' + level + ' mask ' + mask);
    assert.equal(decodeMatrix(symbol).text, text);
  }
});

test('the smallest version that holds the content is used, within the versions allowed', () => {
  assert.equal(encodeQr('x'.repeat(14)).version, 1);
  assert.equal(encodeQr('x'.repeat(15)).version, 2);
  assert.equal(encodeQr('x'.repeat(14), { minVersion: 5 }).version, 5);
  assert.equal(encodeQr('x'.repeat(2331)).version, 40);
});

test('content too long for the largest version allowed is refused with a sentence', () => {
  assert.throws(() => encodeQr('x'.repeat(2332)), (error) => error instanceof QrError && error.code === 'too-long' && /2332 bytes/.test(error.message) && /2331/.test(error.message));
  assert.throws(() => encodeQr('x'.repeat(100), { maxVersion: 3 }), QrError);
  assert.throws(() => encodeQr('x', { level: 'X' }), RangeError);
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 4, maxVersion: 2 }), RangeError);
});

test('the SVG path draws exactly the dark modules', () => {
  const symbol = encodeQr('SV2:path');
  const path = qrPathData(symbol, 4);
  let area = 0;
  for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) area += Number(match[3]);
  assert.equal(area, symbol.modules.reduce((a, b) => a + b, 0));
  assert.match(path, /^M4 4h7v1h-7z/, 'the top-left finder starts four modules in');
});

// ---------------------------------------------------------------- read back

test('every version from 1 to 40, at every level and every mask, reads back to its bytes', () => {
  const random = seededRandom('qr-round-trip');
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    for (const level of EC_LEVELS) {
      const length = Math.floor(random() * (byteCapacity(version, level) + 1));
      const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
      const mask = (version + EC_LEVELS.indexOf(level)) % 8;
      const symbol = encodeQr(bytes, { level, minVersion: version, maxVersion: version, mask });
      const read = decodeMatrix(symbol);
      assert.ok(read, version + '-' + level + ' was not read');
      assert.deepEqual(read.bytes, bytes, version + '-' + level);
      assert.equal(read.version, version);
      assert.equal(read.level, level);
      assert.equal(read.mask, mask);
      assert.equal(read.corrected, 0);
    }
  }
});

test('text reads back as text, UTF-8 included', () => {
  for (const text of ['SV2:abc-_', 'Room 204 · <b>"Gym"</b>', 'Ms. Okonkwo-Ávila 学校']) assert.equal(decodeMatrix(encodeQr(text)).text, text);
});

test('error correction mends up to half the error codewords in each block, and no more', () => {
  const random = seededRandom('rs');
  for (const n of [7, 10, 16, 22, 30]) {
    for (let trial = 0; trial < 20; trial += 1) {
      const data = Uint8Array.from({ length: 20 + Math.floor(random() * 80) }, () => Math.floor(random() * 256));
      const block = new Uint8Array(data.length + n);
      block.set(data);
      block.set(reedSolomon(data, n), data.length);
      const errors = Math.floor(n / 2);
      const spoiled = block.slice();
      const places = new Set();
      while (places.size < errors) places.add(Math.floor(random() * block.length));
      for (const place of places) spoiled[place] ^= 1 + Math.floor(random() * 255);
      assert.equal(correct(spoiled, n), errors, n + ' codewords, trial ' + trial);
      assert.deepEqual(spoiled, block);
    }
  }
  // One error past the limit on a block whose syndromes then read as no
  // codeword near it: refused, never "mended" into something else unseen.
  const data = Uint8Array.from({ length: 16 }, (_, i) => i * 7);
  const block = new Uint8Array(26);
  block.set(data);
  block.set(reedSolomon(data, 10), 16);
  const spoiled = block.slice();
  for (const place of [0, 3, 6, 9, 12, 15]) spoiled[place] ^= 0x5a;
  assert.equal(correct(spoiled, 10), null);
});

test('a symbol with damaged modules and damaged format bits is still read', () => {
  const text = 'SV2:' + 'k'.repeat(120);
  const symbol = encodeQr(text, { level: 'M' });
  const modules = symbol.modules.slice();
  // Three wrong bits in each copy of the format information.
  const size = symbol.size;
  for (const [x, y] of [[8, 0], [8, 2], [3, 8], [size - 1, 8], [size - 3, 8], [8, size - 2]]) modules[y * size + x] ^= 1;
  // And a scratch across the data.
  for (let x = 20; x < 26; x += 1) modules[30 * size + x] ^= 1;
  const read = decodeMatrix({ size, modules });
  assert.equal(read && read.text, text);
  assert.ok(read.corrected > 0);
});

test('every pair of format codes is at least seven bits apart, so three wrong bits never read as another', () => {
  const table = formatTable();
  for (let i = 0; i < table.length; i += 1) {
    for (let j = i + 1; j < table.length; j += 1) {
      let d = 0;
      for (let v = table[i].bits ^ table[j].bits; v; v &= v - 1) d += 1;
      assert.ok(d >= 7, table[i].level + table[i].mask + ' and ' + table[j].level + table[j].mask);
    }
  }
});

test('what is not a symbol reads as null', () => {
  assert.equal(decodeMatrix(null), null);
  assert.equal(decodeMatrix({ size: 20, modules: new Uint8Array(400) }), null);
  assert.equal(decodeMatrix({ size: 21, modules: new Uint8Array(441) }), null);
  const random = seededRandom('noise');
  assert.equal(decodeMatrix({ size: 25, modules: Uint8Array.from({ length: 625 }, () => (random() < 0.5 ? 1 : 0)) }), null);
});

// ---------------------------------------------------------------- camera-like frames

// The scene a camera would see: the symbol on a light background, its
// corners where a turn, a scale and a keystone tilt put them, each pixel
// the share of dark module it covers (3 × 3 samples), light falling off
// across the frame, and Gaussian noise. This draws the picture; it knows
// nothing of how the decoder looks for one.
function frame(symbol, { width, height, scale, angle = 0, tilt = 0, noise = 0, dim = 0, shiftX = 0, shiftY = 0, seed = 1 }) {
  const random = seededRandom(seed);
  const n = symbol.size;
  const half = (n * scale) / 2;
  const cx = width / 2 + shiftX;
  const cy = height / 2 + shiftY;
  const turn = (angle * Math.PI) / 180;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v], k) => {
    const x = u * half * (k < 2 ? 1 - tilt : 1 + tilt);
    const y = v * half;
    return { x: cx + x * Math.cos(turn) - y * Math.sin(turn), y: cy + x * Math.sin(turn) + y * Math.cos(turn) };
  });
  const toModule = inverseOf(projective(corners), n);
  const out = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let dark = 0;
      for (let sy = 0; sy < 3; sy += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          const [mx, my] = toModule(px + (sx + 0.5) / 3, py + (sy + 0.5) / 3);
          const x = Math.floor(mx);
          const y = Math.floor(my);
          if (x >= 0 && y >= 0 && x < n && y < n && symbol.modules[y * n + x]) dark += 1;
        }
      }
      const light = 215 - (dim * px) / width;
      let value = light - ((light - 35) * dark) / 9;
      if (noise) value += noise * Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
      out[py * width + px] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return out;
}

// The map from the unit square onto four corners (Heckbert's), as a function.
function projective(p) {
  const dx3 = p[0].x - p[1].x + p[2].x - p[3].x;
  const dy3 = p[0].y - p[1].y + p[2].y - p[3].y;
  const dx1 = p[1].x - p[2].x;
  const dx2 = p[3].x - p[2].x;
  const dy1 = p[1].y - p[2].y;
  const dy2 = p[3].y - p[2].y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [p[1].x - p[0].x + g * p[1].x, p[3].x - p[0].x + h * p[3].x, p[0].x, p[1].y - p[0].y + g * p[1].y, p[3].y - p[0].y + h * p[3].y, p[0].y, g, h, 1];
}

// Its inverse, from an image point to module coordinates (0 to n).
function inverseOf(m, n) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const inv = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  return (x, y) => {
    const w = inv[6] * x + inv[7] * y + inv[8];
    return [((inv[0] * x + inv[1] * y + inv[2]) / w) * n, ((inv[3] * x + inv[4] * y + inv[5]) / w) * n];
  };
}

function frameOf(symbol, settings) {
  const width = Math.ceil(symbol.size * settings.scale * 1.65) + 60;
  const height = Math.round(width * 0.9);
  return { luminance: frame(symbol, { width, height, ...settings }), width, height };
}

const SCENES = [
  { name: 'square on, 4 px a module', scale: 4 },
  { name: 'turned 7°', scale: 4, angle: 7 },
  { name: 'turned 12°, 3 px a module, noise 15', scale: 3, angle: 12, noise: 15 },
  { name: 'turned −9°, tilted 6 %, noise 25, light falling off', scale: 5, angle: -9, noise: 25, tilt: 0.06, dim: 60 },
  { name: 'turned 30°, tilted 4 %, noise 20', scale: 4, angle: 30, noise: 20, tilt: 0.04, dim: 40 },
  { name: 'turned 45°, tilted 8 %, noise 30', scale: 6, angle: 45, noise: 30, tilt: 0.08, dim: 60 },
  { name: 'upside down and off centre', scale: 4.5, angle: 177, noise: 10, shiftX: 12, shiftY: -8 },
  { name: '2.5 px a module, noise 10', scale: 2.5, angle: 3, noise: 10 },
];

for (const [label, length] of [['version 9', 150], ['version 21', 700], ['version 36', 1900]]) {
  test('a ' + label + ' code is read from camera-like frames: ' + SCENES.map((s) => s.name).join('; '), () => {
    const random = seededRandom(label);
    const text = 'SV2:' + Array.from({ length }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(random() * 64)]).join('');
    const symbol = encodeQr(text, { level: 'M' });
    assert.equal('version ' + symbol.version, label);
    SCENES.forEach((scene, k) => {
      const { luminance, width, height } = frameOf(symbol, { ...scene, seed: k + 1 });
      const read = decodeLuminance(luminance, width, height);
      assert.equal(read && read.text, text, label + ', ' + scene.name);
    });
  });
}

test('heavy noise on the light background is not read as detail round the finders', () => {
  // Noise of 25 to 35 on a 180-step contrast gives an 8 × 8 block of plain
  // background a range near 50: judged flat only beside the frame's own
  // contrast, not by a fixed number.
  for (const [length, scale, noise, seed] of [[60, 4.3, 35, 1], [150, 4.3, 30, 1], [150, 4.3, 30, 2], [300, 3.5, 25, 1]]) {
    const random = seededRandom('flat' + length);
    const text = 'SV2:' + Array.from({ length }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
    const symbol = encodeQr(text, { level: 'M' });
    const { luminance, width, height } = frameOf(symbol, { scale, angle: -4, noise, tilt: 0.064, dim: 50, seed });
    assert.equal(decodeLuminance(luminance, width, height)?.text, text, 'version ' + symbol.version + ', noise ' + noise + ', seed ' + seed);
  }
});

test('every level is read from a turned, noisy frame', () => {
  for (const level of EC_LEVELS) {
    const text = 'SV2:level-' + level + '-' + 'q'.repeat(60);
    const symbol = encodeQr(text, { level });
    const { luminance, width, height } = frameOf(symbol, { scale: 4, angle: -17, noise: 18, tilt: 0.03, seed: 9 });
    assert.equal(decodeLuminance(luminance, width, height)?.text, text, level);
  }
});

test('a frame from a canvas reads through luminanceOf, its alpha ignored', () => {
  const symbol = encodeQr('SV2:canvas');
  const { luminance, width, height } = frameOf(symbol, { scale: 4, angle: 5 });
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < luminance.length; i += 1) {
    // A warm cast: the channels differ, the weighted sum is the luminance.
    rgba.set([Math.min(255, luminance[i] + 12), luminance[i], Math.max(0, luminance[i] - 30), i % 7 === 0 ? 0 : 255], i * 4);
  }
  const grey = luminanceOf(rgba, width, height);
  assert.equal(grey.length, width * height);
  assert.ok(Math.abs(grey[0] - Math.round(0.299 * (luminance[0] + 12) + 0.587 * luminance[0] + 0.114 * (luminance[0] - 30))) <= 1);
  assert.equal(decodeLuminance(grey, width, height)?.text, 'SV2:canvas');
});

test('a mirrored frame (a front camera\'s picture) is read too', () => {
  const symbol = encodeQr('SV2:mirror');
  const { luminance, width, height } = frameOf(symbol, { scale: 4, angle: 10 });
  const mirrored = new Uint8Array(luminance.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) mirrored[y * width + x] = luminance[y * width + (width - 1 - x)];
  assert.equal(decodeLuminance(mirrored, width, height)?.text, 'SV2:mirror');
});

test('a frame with no code in it reads as null', () => {
  const random = seededRandom('empty');
  const width = 160;
  const height = 120;
  assert.equal(decodeLuminance(new Uint8Array(width * height).fill(200), width, height), null);
  assert.equal(decodeLuminance(Uint8Array.from({ length: width * height }, () => Math.floor(random() * 256)), width, height), null);
  assert.equal(decodeLuminance(new Uint8Array(10), width, height), null, 'too short for its size');
  // Half a code: the top half of a frame that held one.
  const symbol = encodeQr('SV2:half');
  const shot = frameOf(symbol, { scale: 4 });
  const cut = shot.luminance.slice();
  cut.fill(200, Math.floor(shot.height / 2) * shot.width);
  assert.equal(decodeLuminance(cut, shot.width, shot.height), null);
});
