// node tools/blender/validate.mjs [budget.json]
//
// Checks every model budget.json names against The Fourth Quarter's style
// sheet (WISHLIST.md "Blender assets" B1), with no dependency and no Blender,
// so .github/workflows/fourth-quarter-ci.yml runs it. Exits 1 on any failure
// (#13):
//
//   - the file is missing, is not a glTF 2.0 binary, or is over its bytes
//   - triangles over the class cap, counted per mesh per node that uses it
//   - the piece's box: its base more than 1 cm off y = 0, its centre more than
//     1 cm off x = 0 or z = 0, its longest side over the class extent, or any
//     side more than 10% off the box js/world.js gives what it replaces
//   - an embedded image bigger than the cap (read from its PNG or JPEG header),
//     or any image at all where the cap is 0, or one that is not embedded
//   - an extension the vendored GLTFLoader does not know, or one it can only
//     read with a decoder this project does not vendor
//   - a material the game cannot put on by name: every material is either a
//     key of MATS in js/textures.js (the game swaps in its own tiered mat()) or
//     `flat-<what>` (the colour is in the vertices, as flat() would paint it)
//   - a keyed material whose placeholder colour, roughness or metalness is not
//     MATS's, or whose faces carry no UVs for the game's texture to land on,
//     or carry a vertex colour
//   - a flat- material that is not white, or whose faces carry no vertex
//     colour, or a vertex colour that is not in the palette
//   - a primitive with no material
//   - a .glb under models/ that budget.json does not name
//
// The optional argument points it at another budget file; paths in it still
// resolve from the project folder. That is how the guard-rails were broken on
// purpose (#34) without touching the real one.
//
// The Fourth Quarter's own copy of Blue Hour's validator at commit 0038881
// (#643), less the clip and node checks (nothing in the bar moves on its own)
// and with the material rules above in place of Blue Hour's palette of
// material colours.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..', '..');
const budgetPath = path.resolve(process.argv[2] || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { MATS } = await import(pathToFileURL(path.join(PROJECT, budget.mats)).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

// ---------------------------------------------------------------- the loader

const loaderSrc = fs.readFileSync(path.join(PROJECT, budget.loader), 'utf8');
const extBlock = loaderSrc.match(/const EXTENSIONS = \{([\s\S]*?)\};/);
const known = new Set(extBlock ? [...extBlock[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]) : []);
console.log(`loader: ${known.size} extensions in ${budget.loader}, ${budget.needsDecoder.length} of them need a decoder`);
ok(known.size > 0, 'the loader\'s EXTENSIONS table was found');
const readable = new Set([...known].filter(e => !budget.needsDecoder.includes(e)));
console.log(`mats: ${Object.keys(MATS).length} keys in ${budget.mats}`);
ok(Object.keys(MATS).length > 0, 'MATS was read from the game');

// ---------------------------------------------------------------- colour

const toSrgb = c => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
};
const rgbOf = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const palette = Object.entries(budget.palette).map(([name, h]) => ({
  name, rgb: [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)),
}));
const hex = rgb => rgb.map(c => c.toString(16).padStart(2, '0')).join('');
const near = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= 1);
const inPalette = rgb => palette.some(p => near(p.rgb, rgb));

// ---------------------------------------------------------------- glb

function readGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a glTF binary (no glTF magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error(`glTF binary version ${buf.readUInt32LE(4)}, not 2`);
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = {
  5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767],
  5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 1], 5126: [4, 'getFloat32', 1],
};

// Every element of an accessor, as arrays of numbers (normalized ints scaled to 0..1).
function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const n = COMPONENTS[acc.type];
  const [size, getter, norm] = TYPES[acc.componentType];
  const stride = view.byteStride || size * n;
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0));
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const el = [];
    for (let k = 0; k < n; k++) {
      let v = dv[getter](i * stride + k * size, true);
      if (acc.normalized || (acc.componentType !== 5126 && norm !== 1)) v /= norm;
      el.push(v);
    }
    out.push(el);
  }
  return out;
}

// Column-major 4x4, as glTF writes them.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function local(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, [x, y, z]) => [0, 1, 2].map(r => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') {
    return { kind: 'png', w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { kind: 'jpeg', w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

// ---------------------------------------------------------------- one item

function check(name, item) {
  console.log(`\n${name}  (${item.file})`);
  const cls = budget.classes[item.class];
  if (!ok(!!cls, `${name}: its class is in budget.json`, item.class)) return;
  const file = path.resolve(PROJECT, item.file);
  if (!ok(fs.existsSync(file), `${name}: the file exists`, item.file)) return;

  const buf = fs.readFileSync(file);
  ok(buf.length <= cls.bytes, `${name}: bytes`, `${buf.length} of ${cls.bytes}`);
  let gltf, bin;
  try { ({ json: gltf, bin } = readGlb(buf)); }
  catch (e) { ok(false, `${name}: reads as a glTF binary`, e.message); return; }

  // Extensions.
  for (const e of new Set([...(gltf.extensionsUsed || []), ...(gltf.extensionsRequired || [])])) {
    ok(known.has(e), `${name}: extension ${e} is one the vendored GLTFLoader knows`);
    if (known.has(e)) ok(readable.has(e), `${name}: extension ${e} needs no decoder this project lacks`);
  }

  // Walk the default scene: triangles and the piece's box.
  let tris = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (ni, parent) => {
    const node = gltf.nodes[ni];
    const m = mul(parent, local(node));
    if (node.mesh !== undefined) {
      for (const p of gltf.meshes[node.mesh].primitives) {
        const mode = p.mode ?? 4;
        const count = p.indices !== undefined ? gltf.accessors[p.indices].count
          : gltf.accessors[p.attributes.POSITION].count;
        tris += mode === 4 ? count / 3 : (mode === 5 || mode === 6) ? Math.max(0, count - 2) : 0;
        // Every vertex, not the accessor's min/max corners, which a rotated
        // node swings past its geometry (#674).
        for (const v of readAccessor(gltf, bin, p.attributes.POSITION)) {
          const w = apply(m, v);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
        }
      }
    }
    for (const c of node.children || []) walk(c, m);
  };
  for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) walk(ni, IDENTITY);
  ok(tris <= cls.triangles, `${name}: triangles`, `${tris} of ${cls.triangles}`);

  const size = [0, 1, 2].map(k => hi[k] - lo[k]);
  const f = v => v.toFixed(3);
  ok(Math.abs(lo[1]) <= 0.01, `${name}: base on y = 0`, `lowest y ${f(lo[1])}`);
  ok(Math.abs(lo[0] + hi[0]) / 2 <= 0.01 && Math.abs(lo[2] + hi[2]) / 2 <= 0.01,
     `${name}: centred on x = 0, z = 0`, `centre ${f((lo[0] + hi[0]) / 2)}, ${f((lo[2] + hi[2]) / 2)}`);
  ok(Math.max(...size) <= cls.extent, `${name}: longest side`, `${f(Math.max(...size))} m of ${cls.extent}`);
  if (ok(Array.isArray(item.box) && item.box.length === 3, `${name}: budget.json gives the world.js box it replaces`)) {
    'xyz'.split('').forEach((axis, k) => {
      const off = size[k] / item.box[k] - 1;
      ok(Math.abs(off) <= 0.10, `${name}: ${axis} within 10% of world.js's ${item.box[k]} m`,
         `${f(size[k])} m, ${(off * 100).toFixed(1)}%`);
    });
  }

  // Textures.
  const cap = item.texture ?? cls.texture;
  for (const [i, img] of (gltf.images || []).entries()) {
    if (!ok(img.bufferView !== undefined, `${name}: image ${i} is embedded`, img.uri ? img.uri.slice(0, 40) : '')) continue;
    const v = gltf.bufferViews[img.bufferView];
    const dim = imageSize(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
    if (!ok(!!dim, `${name}: image ${i} is a PNG or JPEG`, img.mimeType || '')) continue;
    ok(cap > 0, `${name}: a texture is allowed`, `image ${i} is a ${dim.w}x${dim.h} ${dim.kind}, and the cap is 0`);
    if (cap > 0) ok(Math.max(dim.w, dim.h) <= cap, `${name}: image ${i} under ${cap} px`, `${dim.w}x${dim.h}`);
  }

  // Materials: a MATS key the game fills, or flat- with the colour in the
  // vertices. Everything is checked per primitive, since that is where the
  // UVs and the colours live.
  const mats = gltf.materials || [];
  for (const mat of mats) {
    const keyed = Object.hasOwn(MATS, mat.name);
    ok(keyed || mat.name.startsWith('flat-'), `${name}: material ${mat.name} is a MATS key or flat-<what>`,
       `the keys are ${Object.keys(MATS).join(', ')}`);
    const pbr = mat.pbrMetallicRoughness || {};
    const rgb = (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map(toSrgb);
    const rough = pbr.roughnessFactor ?? 1, metal = pbr.metallicFactor ?? 1;
    if (keyed) {
      const def = MATS[mat.name];
      ok(near(rgb, rgbOf(def.color)), `${name}: material ${mat.name} carries MATS's placeholder colour`,
         `#${hex(rgb)}, MATS has #${hex(rgbOf(def.color))}`);
      ok(Math.abs(rough - (def.rough ?? 0.8)) < 0.01 && Math.abs(metal - (def.metal ?? 0)) < 0.01,
         `${name}: material ${mat.name} carries MATS's roughness and metalness`,
         `${rough.toFixed(2)} / ${metal.toFixed(2)}, MATS has ${def.rough ?? 0.8} / ${def.metal ?? 0}`);
    } else {
      ok(rgb.every(c => c === 255), `${name}: material ${mat.name} is white, its colour in the vertices`, `#${hex(rgb)}`);
    }
  }
  const seen = new Set();
  for (const mesh of gltf.meshes || []) for (const [pi, p] of mesh.primitives.entries()) {
    const where = `${mesh.name || 'mesh'} primitive ${pi}`;
    if (!ok(p.material !== undefined, `${name}: ${where} has a material`)) continue;
    const mat = mats[p.material];
    const hasColour = p.attributes.COLOR_0 !== undefined, hasUv = p.attributes.TEXCOORD_0 !== undefined;
    if (Object.hasOwn(MATS, mat.name)) {
      ok(hasUv, `${name}: ${where} (${mat.name}) carries UVs for the game's texture`);
      ok(!hasColour, `${name}: ${where} (${mat.name}) carries no vertex colour`);
    } else {
      ok(hasColour, `${name}: ${where} (${mat.name}) carries its vertex colour`);
    }
    if (!hasColour) continue;
    for (const c of readAccessor(gltf, bin, p.attributes.COLOR_0)) seen.add(hex(c.slice(0, 3).map(toSrgb)));
  }
  for (const h of seen) {
    ok(inPalette([0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))), `${name}: vertex colour is a palette colour`, `#${h}`);
  }

  console.log(`  ${tris} triangles, ${buf.length} bytes, box ${size.map(f).join(' x ')} m, ` +
              `materials [${mats.map(m => m.name).join(', ')}], colours [${[...seen].map(h => '#' + h).join(', ')}]`);
}

// ---------------------------------------------------------------- all of it

for (const [name, item] of Object.entries(budget.items)) check(name, item);

console.log('\nevery model is named');
const named = new Set(Object.values(budget.items).map(i => path.normalize(i.file)));
const models = path.join(PROJECT, budget.models);
const walkDir = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
for (const file of walkDir(models).filter(p => /\.(glb|gltf)$/i.test(p))) {
  const rel = path.normalize(path.relative(PROJECT, file));
  ok(named.has(rel), `budget.json names every model under ${budget.models}/`, rel.split(path.sep).join('/'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
