// glTF, read and written by hand. The suite is mostly round trips — what
// `writeGLB` produces, `parseGLB` + `readModel` must read back as the same
// triangles — plus the two things a hand-written reader gets wrong: strided
// buffer views and a node hierarchy that has to be multiplied down.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MODEL_BYTES, MAX_VERTICES, FT_TO_M, IDENTITY,
  toBytes, base64ToBytes, bytesToBase64,
  parseGLB, isGLB, parseModelFile, mulMat, composeTRS, normalMatrix,
  readAccessor, readModel, computeNormals, modelBBox, fitModel, bakeFit,
  loadModel, writeGLB,
} from '../js/gltf.js';

// A unit triangle standing on the xz plane, in the shape `writeGLB` takes.
const tri = (opts = {}) => ({
  name: opts.name || 'tri',
  position: Float32Array.from(opts.position || [0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normal: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  color: Float32Array.from([1, 0, 0, 1, 0, 0, 1, 0, 0]),
  index: Uint32Array.from([0, 1, 2]),
});

// ---------- bytes ----------

test('base64 survives a round trip, including the chunked path', () => {
  const bytes = new Uint8Array(100000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  const back = base64ToBytes(bytesToBase64(bytes));
  assert.equal(back.length, bytes.length);
  assert.deepEqual(back.subarray(0, 64), bytes.subarray(0, 64));
  assert.deepEqual(back.subarray(99900), bytes.subarray(99900));
});

test('toBytes accepts the three things a browser hands us', () => {
  const arr = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual(toBytes(arr), arr);
  assert.deepEqual(toBytes(arr.buffer), arr);
  assert.deepEqual(toBytes(new Float32Array(arr.buffer, 0, 1)), arr);
  assert.throws(() => toBytes('not bytes'));
});

// ---------- matrices ----------

test('multiplying by the identity changes nothing, either way round', () => {
  const m = composeTRS([3, 4, 5], [0, 0, 0, 1], [2, 2, 2]);
  assert.deepEqual(mulMat(IDENTITY, m), m);
  assert.deepEqual(mulMat(m, IDENTITY), m);
});

test('a composed TRS puts translation in the last column and scale on the diagonal', () => {
  const m = composeTRS([1, 2, 3], [0, 0, 0, 1], [2, 3, 4]);
  assert.deepEqual(m.slice(12, 15), [1, 2, 3]);
  assert.equal(m[0], 2);
  assert.equal(m[5], 3);
  assert.equal(m[10], 4);
});

test('a quarter turn about y sends +x to -z', () => {
  const s = Math.SQRT1_2;
  const m = composeTRS([0, 0, 0], [0, s, 0, s], [1, 1, 1]);
  // column 0 is where the x axis lands
  assert.ok(Math.abs(m[0]) < 1e-9);
  assert.ok(Math.abs(m[2] + 1) < 1e-9);
});

test('the normal matrix of a rotation is the rotation; of a stretch, the inverse stretch', () => {
  const rot = composeTRS([0, 0, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2], [1, 1, 1]);
  const n = normalMatrix(rot);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    assert.ok(Math.abs(n[c * 3 + r] - rot[c * 4 + r]) < 1e-9);
  }
  const stretch = normalMatrix(composeTRS([0, 0, 0], [0, 0, 0, 1], [2, 4, 1]));
  assert.ok(Math.abs(stretch[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(stretch[4] - 0.25) < 1e-9);
  assert.ok(Math.abs(stretch[8] - 1) < 1e-9);
});

test('a degenerate matrix returns the identity rather than NaN', () => {
  const flat = composeTRS([0, 0, 0], [0, 0, 0, 1], [1, 0, 1]);
  assert.deepEqual(normalMatrix(flat), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

// ---------- the container ----------

test('a written glb has the magic, version 2 and a self-consistent length', () => {
  const buf = writeGLB([tri()]);
  const view = new DataView(buf);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), buf.byteLength);
  assert.equal(buf.byteLength % 4, 0);
  assert.ok(isGLB(buf));
});

test('what writeGLB produces, parseGLB reads back', () => {
  const { json, bin } = parseGLB(writeGLB([tri()], { name: 'Test' }));
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes.length, 1);
  assert.equal(json.materials.length, 1);
  assert.ok(bin.byteLength > 0);
  assert.equal(json.buffers[0].byteLength, bin.byteLength);
  // Every bufferView must sit inside the buffer it names.
  for (const bv of json.bufferViews) {
    assert.ok(bv.byteOffset + bv.byteLength <= bin.byteLength);
    assert.equal(bv.byteOffset % 4, 0);
  }
});

test('the export scales feet into metres at one root node', () => {
  const { json } = parseGLB(writeGLB([tri()]));
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.deepEqual(root.scale, [FT_TO_M, FT_TO_M, FT_TO_M]);
  assert.equal(root.children.length, 1);
  // ...and can be told not to.
  const raw = parseGLB(writeGLB([tri()], { unitScale: 1 })).json;
  assert.deepEqual(raw.nodes[raw.scenes[0].nodes[0]].scale, [1, 1, 1]);
});

test('POSITION carries the min/max the spec requires', () => {
  const { json } = parseGLB(writeGLB([tri()]));
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  assert.deepEqual(acc.min, [0, 0, 0]);
  assert.deepEqual(acc.max, [2, 3, 0]);
  assert.equal(acc.count, 3);
});

test('small meshes index as shorts, big ones as ints', () => {
  const small = parseGLB(writeGLB([tri()])).json;
  const smallIdx = small.accessors[small.meshes[0].primitives[0].indices];
  assert.equal(smallIdx.componentType, 5123);

  const n = 70000;
  const position = new Float32Array(n * 3);
  const index = new Uint32Array(n);
  for (let i = 0; i < n; i++) { position[i * 3] = i; index[i] = i; }
  const big = parseGLB(writeGLB([{ position, index }])).json;
  assert.equal(big.accessors[big.meshes[0].primitives[0].indices].componentType, 5125);
});

test('an empty export is refused rather than written', () => {
  assert.throws(() => writeGLB([]), /Nothing to export/);
  assert.throws(() => writeGLB([{ position: new Float32Array([0, 0, 0]) }]), /Nothing to export/);
});

test('a file that is not glTF at all says so', () => {
  assert.throws(() => parseGLB(new Uint8Array(4)), /too short/);
  assert.throws(() => parseGLB(new Uint8Array(64)), /Not a glTF binary/);
  assert.throws(() => parseModelFile(new TextEncoder().encode('hello there')), /Not a glTF file/);
  assert.throws(() => parseModelFile(new TextEncoder().encode('{"nope":1}')), /Not a glTF file/);
});

test('a file over the size cap is refused before it is parsed', () => {
  assert.throws(() => parseModelFile(new Uint8Array(MAX_MODEL_BYTES + 1)), /the limit is/);
});

test('a truncated chunk is an error, not a partial read', () => {
  const buf = writeGLB([tri()]);
  assert.throws(() => parseGLB(new Uint8Array(buf).subarray(0, 40)), /Truncated|no JSON/);
});

// ---------- reading ----------

test('a round trip preserves positions, colours and winding', () => {
  const model = readModel(parseGLB(writeGLB([tri()], { unitScale: 1 })));
  assert.equal(model.meshes.length, 1);
  assert.equal(model.triangles, 1);
  assert.equal(model.vertices, 3);
  const part = model.meshes[0];
  assert.deepEqual(Array.from(part.position), [0, 0, 0, 2, 0, 0, 0, 3, 0]);
  assert.deepEqual(Array.from(part.index), [0, 1, 2]);
  // COLOR_0 times the white base factor is COLOR_0.
  assert.deepEqual(Array.from(part.color.slice(0, 3)), [1, 0, 0]);
});

test('the root node scale is applied when reading, so an export re-imports at metre scale', () => {
  const model = readModel(parseGLB(writeGLB([tri()])));
  assert.ok(Math.abs(model.bbox.maxX - 2 * FT_TO_M) < 1e-6);
});

// A hand-built glTF document, so the reader is tested against something it
// did not write.
function doc(overrides = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 0, 0]); // 6 shorts = 12 bytes, already aligned
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: 6 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    ...overrides,
  };
  return { json, bin };
}

test('a material base colour becomes the vertex colour when the file has none', () => {
  const model = readModel(doc());
  assert.deepEqual(Array.from(model.meshes[0].color.slice(0, 3)), [0.5, 0.25, 0]);
});

test('a primitive with no normals gets flat ones computed', () => {
  const model = readModel(doc());
  const n = model.meshes[0].normal;
  // The triangle lies in the xy plane wound counter-clockwise: +z.
  assert.ok(Math.abs(n[2] - 1) < 1e-6, `got ${Array.from(n.slice(0, 3))}`);
});

test('node transforms multiply down the tree', () => {
  const model = readModel(doc({
    scenes: [{ nodes: [0] }],
    nodes: [
      { children: [1], translation: [10, 0, 0] },
      { mesh: 0, scale: [2, 2, 2], translation: [0, 5, 0] },
    ],
  }));
  const p = model.meshes[0].position;
  // vertex (1,0,0) -> scaled x2 -> (2,0,0) -> +[0,5,0] -> +[10,0,0]
  assert.ok(Math.abs(p[3] - 12) < 1e-6, `got ${p[3]}`);
  assert.ok(Math.abs(p[4] - 5) < 1e-6);
});

test('a cyclic node graph terminates instead of hanging', () => {
  const model = readModel(doc({
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, children: [1] }, { children: [0] }],
  }));
  assert.ok(model.meshes.length >= 1);
});

test('a file with no scene still draws every node', () => {
  const d = doc();
  delete d.json.scenes;
  delete d.json.scene;
  assert.equal(readModel(d).triangles, 1);
});

test('a strided buffer view is read at its stride, not packed', () => {
  // Two vertices interleaved with a padding float each.
  const raw = new Float32Array([1, 2, 3, 99, 4, 5, 6, 99]);
  const bin = new Uint8Array(raw.buffer.slice(0));
  const model = readModel({
    json: {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, byteStride: 16 }],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  });
  assert.deepEqual(Array.from(model.meshes[0].position), [1, 2, 3, 4, 5, 6]);
});

test('a normalized unsigned-byte COLOR_0 comes back as 0..1 floats', () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cols = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]); // padded to 12
  const bin = new Uint8Array(pos.byteLength + cols.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(cols, pos.byteLength);
  const model = readModel({
    json: {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5121, count: 3, type: 'VEC3', normalized: true },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
        { buffer: 0, byteOffset: pos.byteLength, byteLength: 9 },
      ],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  });
  assert.deepEqual(Array.from(model.meshes[0].color.slice(0, 3)), [1, 0, 0]);
});

test('a buffer with a base64 data uri needs no binary chunk', () => {
  const d = doc();
  d.json.buffers = [{ byteLength: d.bin.byteLength, uri: `data:application/octet-stream;base64,${bytesToBase64(d.bin)}` }];
  assert.equal(readModel({ json: d.json, bin: null }).triangles, 1);
});

test('a buffer pointing at a sibling file is refused with advice', () => {
  const d = doc();
  d.json.buffers = [{ byteLength: d.bin.byteLength, uri: 'model.bin' }];
  assert.throws(() => readModel({ json: d.json, bin: null }), /export it as \.glb/);
});

test('lines and points are skipped, and a file of nothing else says why', () => {
  const d = doc();
  d.json.meshes[0].primitives[0].mode = 1; // LINES
  assert.throws(() => readModel(d), /no triangles/);
});

test('a file with no meshes says so rather than returning nothing', () => {
  assert.throws(() => readModel({ json: { asset: { version: '2.0' } }, bin: null }), /no meshes/);
});

test('sparse accessors are refused out loud', () => {
  const d = doc();
  d.json.accessors[0].sparse = { count: 1 };
  assert.throws(() => readModel(d), /Sparse/);
});

test('an accessor that runs past its buffer is caught', () => {
  const d = doc();
  d.json.accessors[0].count = 400;
  assert.throws(() => readModel(d), /past the end/);
});

test('a model denser than the cap is refused', () => {
  const d = doc();
  assert.throws(() => readModel(d, { maxVertices: 2 }), /too dense/);
});

// ---------- fitting a model into a catalog row ----------

test('a contained fit puts the model on the floor, centred, inside its box', () => {
  const model = readModel(parseGLB(writeGLB([tri()], { unitScale: 1 })));
  bakeFit(model, fitModel(model.bbox, { w: 4, d: 4, h: 6 }));
  const b = model.bbox;
  assert.ok(Math.abs(b.minY) < 1e-6, 'sits on y = 0');
  assert.ok(Math.abs(b.minX + b.maxX) < 1e-6, 'centred on x');
  assert.ok(Math.abs(b.minZ + b.maxZ) < 1e-6, 'centred on z');
  assert.ok(b.maxX - b.minX <= 4 + 1e-6);
  assert.ok(b.maxY - b.minY <= 6 + 1e-6);
});

test('a contained fit keeps the model square; a stretched one fills the box', () => {
  const wide = { minX: 0, maxX: 10, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
  const c = fitModel(wide, { w: 5, d: 5, h: 5 });
  assert.equal(c.scale.x, c.scale.y);
  assert.equal(c.scale.y, c.scale.z);
  assert.equal(c.scale.x, 0.5);
  const s = fitModel(wide, { w: 5, d: 5, h: 5 }, 'stretch');
  assert.equal(s.scale.x, 0.5);
  assert.equal(s.scale.y, 5);
  assert.equal(s.scale.z, 5);
});

test('a stretched fit renormalizes the normals it skews', () => {
  const model = readModel(parseGLB(writeGLB([{
    position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normal: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: Uint32Array.from([0, 1, 2]),
  }], { unitScale: 1 })));
  bakeFit(model, fitModel(model.bbox, { w: 8, d: 2, h: 1 }, 'stretch'));
  const n = model.meshes[0].normal;
  for (let i = 0; i < n.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-6);
  }
});

test('a zero-extent model does not divide by zero', () => {
  const flat = { minX: 3, maxX: 3, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  const fit = fitModel(flat, { w: 2, d: 2, h: 2 });
  assert.ok(Number.isFinite(fit.scale.x) && Number.isFinite(fit.offset.x));
});

test('loadModel is parse, read and fit in one call', () => {
  const model = loadModel(writeGLB([tri()], { unitScale: 1 }), { w: 2, d: 2, h: 2 });
  assert.ok(Math.abs(model.bbox.minY) < 1e-6);
  assert.ok(model.bbox.maxY - model.bbox.minY <= 2 + 1e-6);
});

test('an empty mesh list has a bounding box rather than infinities', () => {
  const b = modelBBox([]);
  assert.deepEqual(b, { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
});

test('computeNormals never leaves a zero normal behind', () => {
  const part = {
    position: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    normal: new Float32Array(9),
    index: Uint32Array.from([0, 1, 2]),
  };
  computeNormals(part);
  for (let i = 0; i < 9; i += 3) {
    assert.ok(Math.hypot(part.normal[i], part.normal[i + 1], part.normal[i + 2]) > 0.9);
  }
});

test('readAccessor with no bufferView reads as zeroes, per the spec', () => {
  const zeros = readAccessor({ accessors: [{ componentType: 5126, count: 2, type: 'VEC3' }] }, [], 0);
  assert.equal(zeros.length, 6);
  assert.ok(zeros.every((v) => v === 0));
});

test('the caps are the ones the UI quotes', () => {
  assert.equal(MAX_MODEL_BYTES, 8 * 1024 * 1024);
  assert.ok(MAX_VERTICES >= 100000);
});
