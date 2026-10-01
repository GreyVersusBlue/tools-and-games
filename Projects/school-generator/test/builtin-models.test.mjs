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
} from '../js/builtin-models.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytesOf = (id) => new Uint8Array(readFileSync(path.join(root, builtinFile(id))));
const budget = JSON.parse(readFileSync(path.join(root, 'tools/blender/budget.json'), 'utf8'));
const wired = PROP_CATALOG.filter((e) => e.file);
const EPS = 1e-6;

// What a row carries that is not about its builder: every other key has to
// agree with the source row's, or the file would draw something the row is not.
const OWN_KEYS = new Set(['type', 'name', 'category', 'icon', 'w', 'd', 'h', 'file', 'fit']);

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

test('nineteen rows name a file, each a real id with a real fit', () => {
  assert.equal(wired.length, 19);
  for (const e of wired) {
    assert.ok(BUILTIN_MODELS[e.file], `${e.type} names ${e.file}, which is not in the table`);
    assert.ok(FIT_MODES.includes(e.fit), `${e.type} has fit ${e.fit}`);
  }
  for (const id of BUILTIN_IDS) {
    const source = catalogEntry(BUILTIN_MODELS[id].source);
    assert.equal(source.file, id, `${source.type} is ${id}'s source and does not name it`);
  }
});

test('a row shares a file only with its colour and builder parameters', () => {
  for (const e of wired) {
    const src = catalogEntry(BUILTIN_MODELS[e.file].source);
    assert.equal(e.color, src.color, `${e.type} is painted differently from ${src.type}`);
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
    ['desk-double', 'stool-lab-30', 'table-demo', 'table-seminar-8']);
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
    'chair-lounge', 'beanbag', 'cushion', 'teacher-chair', 'teacher-desk', 'desk-standing',
    'bookshelf-low', 'plant-desk']);
  for (const type of plain) {
    assert.ok(catalogEntry(type), `${type} is not in the catalog`);
    assert.equal(catalogEntry(type).file, undefined, `${type} names a file its shape is not in`);
  }
});

test('a recoloured prop draws procedurally, and a row with no file always does', () => {
  assert.equal(drawsFromFile(catalogEntry('student-desk'), ''), true);
  assert.equal(drawsFromFile(catalogEntry('student-desk'), '#ff0000'), false);
  assert.equal(drawsFromFile(catalogEntry('teacher-desk'), ''), false);
  assert.equal(drawsFromFile(null, ''), false);
});

test('neededBuiltins asks only for files a prop names and the page lacks', () => {
  const types = ['student-desk', 'desk-double', 'teacher-desk', 'sofa', 'nope'];
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
