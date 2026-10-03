// The Blender pack wired into the catalog: which rows name a file, that the
// files are the ones on disk and in the precache, and that a row draws at the
// size its row says. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PROP_CATALOG, catalogEntry } from '../js/catalog.js';
import { FIT_MODES } from '../js/models.js';
import { PRECACHE } from '../js/offline.js';
import { parseModelFile, readModel, FT_TO_M } from '../js/gltf.js';
import {
  BUILTIN_MODELS, BUILTIN_IDS, builtinFile, builtinBox, loadBuiltin,
  drawsFromFile, neededBuiltins, fetchBuiltins,
  tintSrgb, hexToSrgb, srgbToHex, builtinPalette,
} from '../js/builtin-models.js';
import * as THREE from '../libs/three.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytesOf = (id) => new Uint8Array(readFileSync(path.join(root, builtinFile(id))));
const budget = JSON.parse(readFileSync(path.join(root, 'tools/blender/budget.json'), 'utf8'));
const wired = PROP_CATALOG.filter((e) => e.file);
const EPS = 1e-6;

// What a row carries that is not about its builder's shape: every other key
// has to agree with the source row's, or the file would draw something the row
// is not. `color` is here since #819 (a file is repainted when it loads) and
// `light` is how easily a prop is shoved, which no builder reads.
const OWN_KEYS = new Set(['type', 'name', 'category', 'icon', 'w', 'd', 'h', 'file', 'fit', 'color', 'light']);

// The colours a loaded file wears, as sRGB hex, and how many vertices wear each.
const toSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function worn(model) {
  const seen = new Map();
  for (const part of model.meshes) {
    for (let i = 0; i < part.color.length; i += 3) {
      const hex = srgbToHex([toSrgb(part.color[i]), toSrgb(part.color[i + 1]), toSrgb(part.color[i + 2])]);
      seen.set(hex, (seen.get(hex) || 0) + 1);
    }
  }
  return seen;
}
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const within1 = (a, b) => rgb(a).every((c, i) => Math.abs(c - rgb(b)[i]) <= 1);

test('the table, the files on disk and budget.json are the same fifteen', () => {
  const onDisk = readdirSync(path.join(root, 'assets/models'))
    .filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, '')).sort();
  assert.deepEqual([...BUILTIN_IDS].sort(), onDisk, 'a file with no id, or an id with no file');
  assert.deepEqual([...BUILTIN_IDS].sort(), Object.keys(budget.items).sort());
  for (const id of BUILTIN_IDS) {
    assert.equal(BUILTIN_MODELS[id].source, budget.items[id].row.type,
      `${id} was built against ${budget.items[id].row.type}`);
    assert.equal(builtinFile(id), budget.items[id].file);
    assert.ok(catalogEntry(BUILTIN_MODELS[id].source), `${id}'s source row is not in the catalog`);
  }
});

test('every file is precached, and nothing else from assets/models is', () => {
  const cached = PRECACHE.filter((p) => p.startsWith('./assets/models/')).sort();
  assert.deepEqual(cached, BUILTIN_IDS.map((id) => `./${builtinFile(id)}`).sort());
});

test('every file parses, and is the box budget.json says it is', () => {
  for (const id of BUILTIN_IDS) {
    // The reader hands back metres; budget.json's box is in the page's feet.
    const { bbox } = readModel(parseModelFile(bytesOf(id)));
    const [w, d, h] = budget.items[id].box;
    // validate.mjs holds the exact box to budget.json's own tolerance; this is
    // the same bound, so the page and the validator cannot disagree about a file.
    const within = (got, want) => Math.abs(got / FT_TO_M - want) <= want * budget.tolerance;
    assert.ok(within(bbox.maxX - bbox.minX, w), `${id} width`);
    assert.ok(within(bbox.maxZ - bbox.minZ, d), `${id} depth`);
    assert.ok(within(bbox.maxY - bbox.minY, h), `${id} height`);
  }
});

test('twenty-four rows name a file, each a real id with a real fit', () => {
  assert.equal(wired.length, 24);
  for (const e of wired) {
    assert.ok(BUILTIN_MODELS[e.file], `${e.type} names ${e.file}, which is not in the table`);
    assert.ok(FIT_MODES.includes(e.fit), `${e.type} has fit ${e.fit}`);
  }
  for (const id of BUILTIN_IDS) {
    const source = catalogEntry(BUILTIN_MODELS[id].source);
    assert.equal(source.file, id, `${source.type} is ${id}'s source and does not name it`);
  }
});

test('a row shares a file only with its builder parameters', () => {
  for (const e of wired) {
    const src = catalogEntry(BUILTIN_MODELS[e.file].source);
    for (const k of new Set([...Object.keys(e), ...Object.keys(src)])) {
      if (OWN_KEYS.has(k)) continue;
      assert.deepEqual(e[k], src[k],
        `${e.type} differs from ${src.type} in ${k}, which ${e.file}.glb does not carry`);
    }
  }
});

test('stretch is exactly the rows whose dimensions are not their source row\'s', () => {
  for (const e of wired) {
    const src = catalogEntry(BUILTIN_MODELS[e.file].source);
    const same = e.w === src.w && e.d === src.d && e.h === src.h;
    assert.equal(e.fit, same ? 'contain' : 'stretch', `${e.type}'s fit`);
  }
  assert.deepEqual(wired.filter((e) => e.fit === 'stretch').map((e) => e.type).sort(),
    ['desk-double', 'desk-standing', 'stool-lab-30', 'table-art', 'table-demo', 'table-prep',
      'table-seminar-8', 'teacher-chair', 'teacher-desk']);
});

test('a source row is drawn at the file\'s own scale, sitting on the floor', () => {
  for (const id of BUILTIN_IDS) {
    const src = catalogEntry(BUILTIN_MODELS[id].source);
    const raw = readModel(parseModelFile(bytesOf(id))).bbox;
    const { bbox } = loadBuiltin(bytesOf(id), src, src);
    assert.ok(Math.abs(bbox.maxX - bbox.minX - (raw.maxX - raw.minX) / FT_TO_M) < 1e-4, `${id} width moved`);
    assert.ok(Math.abs(bbox.maxY - bbox.minY - (raw.maxY - raw.minY) / FT_TO_M) < 1e-4, `${id} height moved`);
    assert.ok(Math.abs(bbox.maxZ - bbox.minZ - (raw.maxZ - raw.minZ) / FT_TO_M) < 1e-4, `${id} depth moved`);
    assert.ok(Math.abs(bbox.minY) < EPS, `${id} is not on y = 0`);
  }
});

test('a stretched row is the file\'s box scaled by row over source row', () => {
  for (const e of wired.filter((r) => r.fit === 'stretch')) {
    const src = catalogEntry(BUILTIN_MODELS[e.file].source);
    const raw = readModel(parseModelFile(bytesOf(e.file))).bbox;
    const { bbox } = loadBuiltin(bytesOf(e.file), e, src);
    assert.ok(Math.abs(bbox.maxX - bbox.minX - (raw.maxX - raw.minX) / FT_TO_M * e.w / src.w) < 1e-4, `${e.type} width`);
    assert.ok(Math.abs(bbox.maxZ - bbox.minZ - (raw.maxZ - raw.minZ) / FT_TO_M * e.d / src.d) < 1e-4, `${e.type} depth`);
    assert.ok(Math.abs(bbox.maxY - bbox.minY - (raw.maxY - raw.minY) / FT_TO_M * e.h / src.h) < 1e-4, `${e.type} height`);
  }
  const src = catalogEntry('bench-lab');
  const m = (ft) => ft * FT_TO_M;
  const box = builtinBox(catalogEntry('table-demo'), src,
    { minX: 0, maxX: m(6), minY: 0, maxY: m(3.58), minZ: 0, maxZ: m(2.54) });
  assert.ok(Math.abs(box.w - 8) < EPS && Math.abs(box.h - 3.58) < EPS, 'the tap stays on the bench');
});

test('the shapes a file leaves out keep the procedural builder', () => {
  const plain = new Set(['table-round-4', 'table-round-5', 'table-trapezoid', 'table-kidney',
    'table-cafeteria', 'bench-robotics', 'tote-rack', 'mail-cubbies', 'locker-bank-half',
    'printer-3d', 'table-sewing', 'counter-serving', 'tray-return', 'counter-reception',
    'chair-lounge', 'beanbag', 'cushion', 'bookshelf-low', 'plant-desk']);
  for (const type of plain) {
    assert.ok(catalogEntry(type), `${type} is not in the catalog`);
    assert.equal(catalogEntry(type).file, undefined, `${type} names a file its shape is not in`);
  }
});

test('a row with a file draws from it, and a row with none does not', () => {
  assert.equal(drawsFromFile(catalogEntry('student-desk')), true);
  assert.equal(drawsFromFile(catalogEntry('teacher-desk')), true);
  assert.equal(drawsFromFile(catalogEntry('table-round-4')), false);
  assert.equal(drawsFromFile(null), false);
});

// #818. The numbers are written out, not recomputed: a leg at -0.25 on the
// student chair's blue is a dark blue, and in three.js's linear working space
// (what render.js did before) it is 000000.
test('a tint is HSL in sRGB, so a darker leg is not a black one', () => {
  const t = (hex, dl, ds) => srgbToHex(tintSrgb(hexToSrgb(hex), dl, ds));
  assert.equal(t('#3f6fae', -0.25), '1d3350');
  assert.equal(t('#7a5230', -0.12), '4e341f');
  assert.equal(t('#b08a5f', -0.45, -0.2), '181512');
  assert.equal(t('#3f6fae', 0), '3f6fae');
  assert.deepEqual(tintSrgb(hexToSrgb('#20242a'), -0.3), [0, 0, 0], 'a tint still clamps at black');
  assert.deepEqual(tintSrgb(hexToSrgb('#e6e8ea'), 0.3), [1, 1, 1], 'and at white');
  assert.equal(t('#808080', 0.1), '9a9a9a', 'a grey has no hue to keep');
});

test('tintSrgb is three.js\'s own HSL in sRGB, which is what render.js draws', () => {
  for (const hex of ['#3f6fae', '#20242a', '#c9a06a', '#ffffff', '#000000', '#808080', '#a24a3f']) {
    for (const [dl, ds] of [[-0.25, 0], [0.18, 0], [-0.45, -0.2], [0.15, 0.1], [0, 0]]) {
      const hsl = {};
      new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
      const clamp = (v) => Math.min(1, Math.max(0, v));
      const want = {};
      new THREE.Color().setHSL(hsl.h, clamp(hsl.s + ds), clamp(hsl.l + dl), THREE.SRGBColorSpace)
        .getRGB(want, THREE.SRGBColorSpace);
      const got = tintSrgb(hexToSrgb(hex), dl, ds);
      assert.ok(Math.abs(got[0] - want.r) < 1e-4 && Math.abs(got[1] - want.g) < 1e-4 && Math.abs(got[2] - want.b) < 1e-4,
        `${hex} ${dl} ${ds}`);
    }
  }
  const src = readFileSync(path.join(root, 'js/render.js'), 'utf8');
  const body = src.slice(src.indexOf('function tint(hex, dl, ds = 0)'), src.indexOf('function box('));
  assert.match(body, /tintSrgb\(/, 'render.js\'s tint no longer goes through tintSrgb');
  assert.doesNotMatch(body, /setHSL|getHSL/, 'render.js\'s tint does its own HSL again');
});

test('budget.json\'s palette is each role\'s recipe on the source row\'s colour', () => {
  for (const id of BUILTIN_IDS) {
    const src = catalogEntry(BUILTIN_MODELS[id].source);
    assert.deepEqual(builtinPalette(id, src.color), budget.items[id].palette, id);
  }
});

// #819. Held against the palette a builder would give the row, role by role
// and vertex count by vertex count, so a role that was not repainted, or was
// repainted as another role, fails here.
test('a row of another colour wears the file in its own colour', () => {
  const others = wired.filter((e) => e.color !== catalogEntry(BUILTIN_MODELS[e.file].source).color);
  assert.deepEqual(others.map((e) => e.type).sort(),
    ['desk-standing', 'table-art', 'table-prep', 'teacher-chair', 'teacher-desk']);
  for (const e of others) {
    const src = catalogEntry(BUILTIN_MODELS[e.file].source);
    const before = worn(loadBuiltin(bytesOf(e.file), src, src));
    const after = worn(loadBuiltin(bytesOf(e.file), e, src));
    const from = builtinPalette(e.file, src.color), to = builtinPalette(e.file, e.color);
    for (const hex of after.keys()) {
      assert.ok(Object.values(to).some((p) => within1(p, hex)), `${e.type} wears ${hex}, which is no role of ${e.color}`);
    }
    for (const role of Object.keys(to)) {
      const count = (seen, want) => [...seen].filter(([hex]) => within1(hex, want)).reduce((n, [, c]) => n + c, 0);
      // roles that tint to one colour (two blacks) are counted together on both sides
      const twins = Object.keys(to).filter((r) => to[r] === to[role]);
      const was = new Set(twins.map((r) => from[r]));
      const had = [...was].reduce((n, hex) => n + count(before, hex), 0);
      assert.ok(had > 0, `${e.file}.glb has no vertex in role ${role}`);
      assert.equal(count(after, to[role]), had, `${e.type}: role ${role} should be ${to[role]} on ${had} vertices`);
    }
    assert.ok([...after.keys()].some((hex) => within1(hex, e.color.slice(1))), `${e.type} wears its own ${e.color} nowhere`);
  }
});

test('a recoloured prop keeps the file\'s shape and takes the paint', () => {
  const e = catalogEntry('student-chair');
  const plain = loadBuiltin(bytesOf(e.file), e, e);
  const red = loadBuiltin(bytesOf(e.file), e, e, '#b0503f');
  assert.deepEqual(red.meshes.map((m) => m.position.length), plain.meshes.map((m) => m.position.length));
  assert.deepEqual([...worn(plain).keys()].sort(), Object.values(builtinPalette('chair-basic', e.color)).sort());
  const want = Object.values(builtinPalette('chair-basic', '#b0503f'));
  for (const hex of worn(red).keys()) assert.ok(want.some((p) => within1(p, hex)), `${hex} is not a red chair's colour`);
  assert.equal(worn(red).size, 3);
  // a fixed colour is not the row's to repaint: the plant's pot stays terracotta
  const plant = catalogEntry('plant-floor');
  const blue = worn(loadBuiltin(bytesOf('plant'), plant, plant, '#3f6fae'));
  assert.ok([...blue.keys()].some((hex) => within1(hex, 'a9623f')), 'the pot was repainted');
  assert.ok(![...blue.keys()].some((hex) => within1(hex, '3f7a48')), 'the leaves kept their green');
});

test('neededBuiltins asks only for files a prop names and the page lacks', () => {
  const types = ['student-desk', 'desk-double', 'table-round-4', 'sofa', 'nope'];
  assert.deepEqual(neededBuiltins(types, catalogEntry, new Set()).sort(), ['desk', 'sofa']);
  assert.deepEqual(neededBuiltins(types, catalogEntry, new Set(['desk'])), ['sofa']);
});

test('a file that cannot be fetched comes back as a failure, not a fallback', async () => {
  const served = async (url) => ({
    ok: !url.includes('sofa'), status: url.includes('sofa') ? 404 : 200,
    arrayBuffer: async () => bytesOf('desk').buffer,
  });
  const { bytes, failed } = await fetchBuiltins(['desk', 'sofa'], served, './');
  assert.deepEqual([...bytes.keys()], ['desk']);
  assert.deepEqual(failed, [{ id: 'sofa', message: 'HTTP 404' }]);
  const thrown = await fetchBuiltins(['desk'], async () => { throw new Error('offline'); });
  assert.equal(thrown.failed[0].message, 'offline');
});
