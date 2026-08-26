// The imported model library: the record, the caps, and the catalog row a
// model wears so that eight other modules never learn that files exist.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_PREFIX, MODEL_CATEGORY, MAX_MODELS, MAX_LIBRARY_BYTES, DEFAULT_BOX,
  MIN_DIM, MAX_DIM, FIT_MODES,
  nameFromFile, modelDataURL, modelBytes, modelSize, librarySize, nextModelId,
  makeModel, normalizeModel, normalizeModels,
  modelType, isModelType, modelIdOf, modelRow, modelRows, modelsOf, findModel,
  addModel, removeModel, updateModel, modelUseCount, describeModel, importModel,
} from '../js/models.js';
import { writeGLB, MAX_MODEL_BYTES } from '../js/gltf.js';
import { MOUNTS } from '../js/props.js';
import { CATEGORIES, GEO_KEYS, catalogEntry, catalogByCategory, registerRows, registeredRows } from '../js/catalog.js';

const GLB = new Uint8Array(writeGLB([{
  position: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  index: Uint32Array.from([0, 1, 2]),
}]));

const model = (opts) => makeModel(GLB, opts);

test('a file name becomes a palette label', () => {
  assert.equal(nameFromFile('/downloads/Oak_Chair.glb'), 'Oak Chair');
  assert.equal(nameFromFile('C:\\models\\desk-tall.gltf'), 'desk tall');
  assert.equal(nameFromFile(''), '');
  assert.equal(nameFromFile(null), '');
});

test('a record round-trips its bytes', () => {
  const m = model({ name: 'Chair' });
  assert.ok(m.data.startsWith('data:model/gltf-binary;base64,'));
  const back = modelBytes(m);
  assert.equal(back.length, GLB.length);
  assert.deepEqual(back.subarray(0, 12), GLB.subarray(0, 12));
});

test('bytes out of a hostile record are null, not a throw', () => {
  assert.equal(modelBytes(null), null);
  assert.equal(modelBytes({ data: 'https://example.com/a.glb' }), null);
  assert.equal(modelBytes({ data: 'data:model/gltf-binary,notbase64' }), null);
});

test('dimensions are clamped and named, and a mount decides the default height', () => {
  const big = model({ w: 9999, d: -3, h: 0 });
  assert.equal(big.w, MAX_DIM);
  assert.equal(big.d, MIN_DIM);
  assert.equal(big.h, MIN_DIM);
  const bare = model({});
  assert.equal(bare.w, DEFAULT_BOX.w);
  assert.equal(bare.name, 'Imported Model');
  assert.equal(bare.y, 0);
  assert.equal(model({ mount: 'wall' }).y, 4);
  assert.equal(model({ mount: 'nonsense' }).mount, 'floor');
  for (const mount of MOUNTS) assert.equal(model({ mount }).mount, mount);
});

test('the fit mode is one of the two, and the colour is a hex or the default', () => {
  for (const fit of FIT_MODES) assert.equal(model({ fit }).fit, fit);
  assert.equal(model({ fit: 'squish' }).fit, 'contain');
  assert.equal(model({ color: '#ff0000' }).color, '#ff0000');
  assert.equal(model({ color: 'red' }).color, '#8a8f96');
});

test('a file over the per-file cap is refused at make time', () => {
  assert.throws(() => makeModel(new Uint8Array(MAX_MODEL_BYTES + 1), {}), /the limit is/);
});

// ---------- ids ----------

test('ids count past the highest one in the library, not off its length', () => {
  assert.equal(nextModelId([]), 'm1');
  assert.equal(nextModelId([{ id: 'm1' }, { id: 'm2' }]), 'm3');
  // m2 deleted: the next import must not inherit m2's props
  assert.equal(nextModelId([{ id: 'm1' }, { id: 'm7' }]), 'm8');
  assert.equal(nextModelId([{ id: 'junk' }]), 'm1');
});

test('adding assigns the id and enforces both caps', () => {
  let list = [];
  for (let i = 0; i < 3; i++) list = addModel(list, model({ name: `M${i}` })).models;
  assert.deepEqual(list.map((m) => m.id), ['m1', 'm2', 'm3']);

  let full = [];
  for (let i = 0; i < MAX_MODELS; i++) full = addModel(full, model({})).models;
  assert.throws(() => addModel(full, model({})), /already has/);

  const fat = { ...model({}), data: `data:model/gltf-binary;base64,${'A'.repeat(MAX_LIBRARY_BYTES)}` };
  assert.throws(() => addModel([fat], model({})), /more than/);
});

test('removing leaves the other ids alone', () => {
  let list = [];
  for (let i = 0; i < 3; i++) list = addModel(list, model({})).models;
  const left = removeModel(list, 'm2');
  assert.deepEqual(left.map((m) => m.id), ['m1', 'm3']);
  assert.equal(nextModelId(left), 'm4');
});

test('updating keeps the id and re-validates the patch', () => {
  const list = addModel([], model({ name: 'A', w: 2 })).models;
  const next = updateModel(list, 'm1', { name: 'B', w: 9999 });
  assert.equal(next[0].id, 'm1');
  assert.equal(next[0].name, 'B');
  assert.equal(next[0].w, MAX_DIM);
  assert.equal(next[0].data, list[0].data, 'the file itself is untouched');
});

test('how many props a model is holding up', () => {
  const state = { props: [
    { type: 'model:m1' }, { type: 'model:m1' }, { type: 'model:m2' }, { type: 'student-desk' },
  ] };
  assert.equal(modelUseCount(state, 'm1'), 2);
  assert.equal(modelUseCount(state, 'm9'), 0);
  assert.equal(modelUseCount({}, 'm1'), 0);
});

// ---------- normalizing a save file ----------

test('an unreadable model is a model that is not there', () => {
  assert.equal(normalizeModel(null), null);
  assert.equal(normalizeModel({ id: 'm1' }), null);
  assert.equal(normalizeModel({ id: 'm1', data: 'http://example.com/x.glb' }), null);
  assert.equal(normalizeModel({ id: 'nope', data: 'data:model/gltf-binary;base64,AAAA' }), null);
  assert.ok(normalizeModel({ ...model({ id: 'm4' }) }));
});

test('the library is held to both caps, and duplicates are dropped', () => {
  const many = [];
  for (let i = 0; i < MAX_MODELS + 5; i++) many.push({ ...model({}), id: `m${i + 1}` });
  assert.equal(normalizeModels(many).length, MAX_MODELS);
  const dup = [{ ...model({}), id: 'm1' }, { ...model({}), id: 'm1' }];
  assert.equal(normalizeModels(dup).length, 1);
  assert.deepEqual(normalizeModels('nope'), []);
  assert.deepEqual(normalizeModels(undefined), []);
});

test('a library over the byte cap loses its last import rather than all of them', () => {
  const half = `data:model/gltf-binary;base64,${'A'.repeat(Math.floor(MAX_LIBRARY_BYTES * 0.6))}`;
  const list = [
    { ...model({}), id: 'm1', data: half },
    { ...model({}), id: 'm2', data: half },
    { ...model({}), id: 'm3' },
  ];
  const out = normalizeModels(list);
  assert.deepEqual(out.map((m) => m.id), ['m1', 'm3']);
  assert.ok(librarySize(out) <= MAX_LIBRARY_BYTES);
});

// ---------- the catalog row ----------

test('a model type is namespaced and reversible', () => {
  assert.equal(modelType('m3'), 'model:m3');
  assert.ok(isModelType('model:m3'));
  assert.ok(!isModelType('student-desk'));
  assert.ok(!isModelType(null));
  assert.equal(modelIdOf('model:m3'), 'm3');
  assert.equal(modelIdOf('student-desk'), null);
  assert.ok(MODEL_PREFIX.endsWith(':'));
});

test('a row has every field the built-in rows have', () => {
  const row = modelRow(model({ name: 'Oak Chair', w: 2, d: 2, h: 3, color: '#123456' }));
  assert.equal(row.type, 'model:m1');
  assert.equal(row.name, 'Oak Chair');
  assert.ok(CATEGORIES.includes(row.category));
  assert.equal(row.category, MODEL_CATEGORY);
  assert.ok(GEO_KEYS.includes(row.geo));
  assert.ok(MOUNTS.includes(row.mount));
  assert.equal(row.color, '#123456');
  assert.ok(row.icon);
  assert.equal(row.model, 'm1');
  assert.equal(modelRow(null), null);
  assert.equal(modelRows([model({})]).length, 1);
});

test('an outdoor model keeps the site flag the ground storey reads', () => {
  assert.ok(modelRow(model({ site: true })).site);
  assert.equal(modelRow(model({})).site, undefined);
});

test('registered rows answer catalogEntry and appear in the palette', () => {
  const rows = modelRows([{ ...model({ name: 'Oak Chair' }), id: 'm1' }]);
  registerRows(rows);
  try {
    const entry = catalogEntry('model:m1');
    assert.ok(entry, 'an imported row is a catalog entry like any other');
    assert.equal(entry.name, 'Oak Chair');
    const groups = catalogByCategory();
    const imported = groups.find((g) => g.category === MODEL_CATEGORY);
    assert.ok(imported && imported.entries.length === 1);
    assert.equal(registeredRows().length, 1);
    // ...and the built-ins still answer.
    assert.ok(catalogEntry('student-desk'));
  } finally {
    registerRows([]);
  }
  assert.equal(catalogEntry('model:m1'), null, 'and they go away when the design does');
  assert.ok(!catalogByCategory().some((g) => g.category === MODEL_CATEGORY));
});

test('a registered row cannot shadow a built-in one', () => {
  const desk = catalogEntry('student-desk');
  registerRows([{ type: 'student-desk', name: 'Imposter', category: MODEL_CATEGORY, geo: 'model' }]);
  try {
    assert.equal(catalogEntry('student-desk'), desk);
    assert.equal(registeredRows().length, 0);
  } finally {
    registerRows([]);
  }
});

// ---------- the rest ----------

test('modelsOf and findModel survive a state that has neither', () => {
  assert.deepEqual(modelsOf(null), []);
  assert.deepEqual(modelsOf({}), []);
  assert.equal(modelsOf({ models: [1] }).length, 1);
  assert.equal(findModel([{ id: 'm1' }], 'm1').id, 'm1');
  assert.equal(findModel([], 'm1'), null);
});

test('the panel line says how big it stands and what it costs', () => {
  const line = describeModel(model({ w: 2, d: 2, h: 3 }), 4);
  assert.match(line, /2\.0 × 2\.0 × 3\.0 ft/);
  assert.match(line, /KB|MB/);
  assert.match(line, /4 placed/);
  assert.ok(!describeModel(model({}), null).includes('placed'));
  assert.equal(describeModel(null), '');
});

test('importing parses the file, so a broken one fails at the file input', () => {
  const { model: m } = importModel(GLB, 'Oak Chair.glb', {});
  assert.equal(m.name, 'Oak Chair');
  assert.ok(modelSize(m) > 0);
  assert.throws(() => importModel(new TextEncoder().encode('nope'), 'a.glb', {}), /Not a glTF file/);
});

test('a data URL is enough to remake a record without re-encoding', () => {
  const first = model({ name: 'Chair', w: 2 });
  const again = makeModel(first.data, first);
  assert.deepEqual(again, first);
});

test('modelDataURL and modelSize agree about what a record costs', () => {
  const url = modelDataURL(GLB);
  assert.equal(modelSize({ data: url }), url.length);
  assert.equal(modelSize(null), 0);
  assert.equal(librarySize(null), 0);
});

// ---------- the save format ----------

test('a design with no imported models writes no models key', async () => {
  const { serialize, SAVE_VERSION } = await import('../js/save-load.js');
  const { createState } = await import('../js/grid.js');
  assert.equal(SAVE_VERSION, 11);
  const json = JSON.parse(serialize(createState(10, 10)));
  assert.ok(!('models' in json));
});

test('an imported model survives a save round trip, bytes and all', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const { createState } = await import('../js/grid.js');
  const state = createState(10, 10);
  state.models = addModel([], model({ name: 'Oak Chair', w: 2, d: 2, h: 3, mount: 'floor' })).models;
  state.props = [{ id: 1, type: 'model:m1', floor: 0, x: 10, z: 10, y: 0, rotationY: 0, scale: 1, mount: 'floor' }];

  const back = deserialize(serialize(state));
  assert.equal(back.models.length, 1);
  assert.equal(back.models[0].id, 'm1');
  assert.equal(back.models[0].name, 'Oak Chair');
  assert.equal(back.models[0].data, state.models[0].data);
  assert.deepEqual(modelBytes(back.models[0]).subarray(0, 8), GLB.subarray(0, 8));
  assert.equal(back.props[0].type, 'model:m1', 'the prop still points at it');
});

test('omitModels sheds the files and keeps the props that were placed from them', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const { createState } = await import('../js/grid.js');
  const state = createState(10, 10);
  state.models = addModel([], model({ name: 'Oak Chair' })).models;
  state.props = [{ id: 1, type: 'model:m1', floor: 0, x: 10, z: 10, y: 0, rotationY: 0, scale: 1, mount: 'floor' }];

  const lean = serialize(state, { omitModels: true });
  assert.ok(lean.length < serialize(state).length);
  const back = deserialize(lean);
  assert.equal(back.models, undefined);
  assert.equal(back.props.length, 1);
  assert.equal(back.props[0].type, 'model:m1', 'an unknown type survives, as it always has');
});

test('a hostile models key cannot stop a design from opening', async () => {
  const { deserialize, serialize } = await import('../js/save-load.js');
  const { createState } = await import('../js/grid.js');
  const base = JSON.parse(serialize(createState(10, 10)));
  for (const models of ['nope', 7, [null], [{}], [{ id: 'm1' }], [{ data: 'x' }]]) {
    assert.equal(deserialize(JSON.stringify({ ...base, models })).models, undefined);
  }
});

test('a v9 file loads as a design with nothing imported', async () => {
  const { deserialize } = await import('../js/save-load.js');
  const state = deserialize(JSON.stringify({
    version: 9, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [],
  }));
  assert.equal(state.models, undefined);
  assert.equal(state.version, 11);
});
