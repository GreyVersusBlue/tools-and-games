// node tools/blender/validate.mjs [budget.json]
//
// Checks every model budget.json names against Bell to Bell's style sheet
// (WISHLIST.md "Blender assets" B1), with no dependency and no Blender, so Site
// CI's Bell to Bell entry runs it (from tests/, as `node ../tools/blender/
// validate.mjs`). Exits 1 on any failure (#13):
//
//   - the .gltf or its .bin is missing, the .gltf is not glTF 2.0, or the two
//     together are over the class's bytes
//   - triangles over the class cap, counted per mesh per node that uses it
//   - the piece's box: its base more than 1 cm off y = 0, its centre more than
//     1 cm off x = 0 or z = 0, its longest side over the class extent, or any
//     side more than 10% off the box the room gives what it replaces
//   - an image that is embedded or a data: URI rather than a loose file beside
//     the .gltf, a missing one, or one bigger than the cap (read from its PNG
//     or JPEG header)
//   - an extension the vendored GLTFLoader does not know, one it can only read
//     with a decoder this project does not vendor, or one only the meshopt
//     recipe may add (EXT_meshopt_compression) in what Blender wrote
//   - a material that is not a palette entry, or whose colour is not that
//     entry's (white where a texture carries the colour instead)
//   - a primitive with no material, one carrying a vertex colour, or one
//     carrying UVs its material has no texture to use
//   - once the recipe has run (B3), the .glb beside the .gltf: a glTF binary
//     whose only decoder-bound extension is EXT_meshopt_compression, with the
//     .gltf's triangles, materials and image URIs and its box to 1 cm
//   - a .gltf or .glb under Assets/models/blender/ that budget.json does not
//     name
//
// The optional argument points it at another budget file; paths in it still
// resolve from the project folder. That is how the guard-rails were broken on
// purpose (#34) without touching the real one.
//
// Bell to Bell's own copy of Aphelion's validator at commit b63cd05 (#643),
// reading glTF Separate and the recipe's .glb where Aphelion reads one .glb,
// and a palette where Aphelion reads M.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..', '..');
const budgetPath = path.resolve(process.argv[2] || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

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
console.log(`loader: ${known.size} extensions in ${budget.loader}, ${budget.needsDecoder.length} of them need a decoder this project lacks`);
ok(known.size > 0, 'the loader\'s EXTENSIONS table was found');
const recipeOnly = new Set(budget.recipeOnly || []);
const palette = budget.palette || {};
console.log(`palette: ${Object.keys(palette).length} entries`);
ok(Object.keys(palette).length > 0, 'budget.json carries a palette');

// Every extension a file names, each against the loader.
function extensions(name, gltf, what, allowRecipe) {
  for (const e of new Set([...(gltf.extensionsUsed || []), ...(gltf.extensionsRequired || [])])) {
    ok(known.has(e), `${name}: ${what} extension ${e} is one the vendored GLTFLoader knows`);
    ok(!budget.needsDecoder.includes(e), `${name}: ${what} extension ${e} needs no decoder this project lacks`);
    ok(allowRecipe || !recipeOnly.has(e), `${name}: ${what} extension ${e} is the meshopt recipe's to add, not Blender's`);
  }
}

// ---------------------------------------------------------------- colour

const toSrgb = c => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
};
const rgbOf = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = rgb => rgb.map(c => c.toString(16).padStart(2, '0')).join('');
const near = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= 1);

// ---------------------------------------------------------------- reading

function readGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a glTF binary (no glTF magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error(`glTF binary version ${buf.readUInt32LE(4)}, not 2`);
  let off = 12, json = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  return json;
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = {
  5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767],
  5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 1], 5126: [4, 'getFloat32', 1],
};

// Every element of an accessor in a .gltf's own buffers, as arrays of numbers.
function readAccessor(gltf, bins, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const bin = bins[view.buffer];
  const n = COMPONENTS[acc.type];
  const [size, getter, norm] = TYPES[acc.componentType];
  const stride = view.byteStride || size * n;
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0));
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const el = [];
    for (let k = 0; k < n; k++) {
      let v = dv[getter](i * stride + k * size, true);
      if (acc.normalized) v /= norm;
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

// Triangles and the box, walking the default scene. `points(p)` gives the
// positions to bound a primitive by: every vertex for the .gltf (a rotated
// node swings an accessor's corners past its geometry, #674), and the
// accessor's eight corners for the .glb, whose meshopt buffers this cannot
// decode; the pipeline applies every transform, so the two agree there.
function measure(gltf, points) {
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
        for (const v of points(p)) {
          const w = apply(m, v);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
        }
      }
    }
    for (const c of node.children || []) walk(c, m);
  };
  for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) walk(ni, IDENTITY);
  return { tris, lo, hi, size: [0, 1, 2].map(k => hi[k] - lo[k]) };
}

function corners(gltf, p) {
  const a = gltf.accessors[p.attributes.POSITION];
  const dq = v => (a.normalized ? v / TYPES[a.componentType][2] : v);
  const [x0, y0, z0] = a.min.map(dq), [x1, y1, z1] = a.max.map(dq);
  return [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]];
}

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

const f = v => v.toFixed(3);

function check(name, item) {
  console.log(`\n${name}  (${item.file})`);
  const cls = budget.classes[item.class];
  if (!ok(!!cls, `${name}: its class is in budget.json`, item.class)) return;
  const file = path.resolve(PROJECT, item.file);
  const dir = path.dirname(file);
  if (!ok(/\.gltf$/.test(item.file), `${name}: budget.json names a .gltf, which is what the recipe reads`, item.file)) return;
  if (!ok(fs.existsSync(file), `${name}: the .gltf exists`, item.file)) return;

  let gltf;
  try { gltf = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { ok(false, `${name}: the .gltf parses as JSON`, e.message); return; }
  if (!ok(gltf.asset?.version === '2.0', `${name}: it is glTF 2.0`, gltf.asset?.version)) return;

  // Buffers: loose .bin files beside it, counted with the .gltf.
  let bytes = fs.statSync(file).size;
  const bins = [];
  for (const [i, b] of (gltf.buffers || []).entries()) {
    const uri = b.uri || '';
    if (!ok(uri && !uri.startsWith('data:'), `${name}: buffer ${i} is a file beside the .gltf`, uri.slice(0, 40))) return;
    const bp = path.join(dir, decodeURIComponent(uri));
    if (!ok(fs.existsSync(bp), `${name}: buffer ${i} exists`, uri)) return;
    const buf = fs.readFileSync(bp);
    ok(buf.length === b.byteLength, `${name}: buffer ${i} is the ${b.byteLength} bytes the .gltf says`, `${buf.length}`);
    bytes += buf.length;
    bins.push(buf);
  }
  ok(bytes <= cls.bytes, `${name}: bytes, the .gltf and its buffers`, `${bytes} of ${cls.bytes}`);

  extensions(name, gltf, 'the .gltf\'s', false);

  const m = measure(gltf, p => readAccessor(gltf, bins, p.attributes.POSITION));
  ok(m.tris <= cls.triangles, `${name}: triangles`, `${m.tris} of ${cls.triangles}`);
  ok(Math.abs(m.lo[1]) <= 0.01, `${name}: base on y = 0`, `lowest y ${f(m.lo[1])}`);
  ok(Math.abs(m.lo[0] + m.hi[0]) / 2 <= 0.01 && Math.abs(m.lo[2] + m.hi[2]) / 2 <= 0.01,
     `${name}: centred on x = 0, z = 0`, `centre ${f((m.lo[0] + m.hi[0]) / 2)}, ${f((m.lo[2] + m.hi[2]) / 2)}`);
  ok(Math.max(...m.size) <= cls.extent, `${name}: longest side`, `${f(Math.max(...m.size))} m of ${cls.extent}`);
  if (ok(Array.isArray(item.box) && item.box.length === 3, `${name}: budget.json gives the box it replaces`)) {
    'xyz'.split('').forEach((axis, k) => {
      const off = m.size[k] / item.box[k] - 1;
      ok(Math.abs(off) <= 0.10, `${name}: ${axis} within 10% of the room's ${item.box[k]} m`,
         `${f(m.size[k])} m, ${(off * 100).toFixed(1)}%`);
    });
  }

  // Images: loose files, under the cap.
  const cap = item.texture ?? cls.texture;
  const uris = [];
  for (const [i, img] of (gltf.images || []).entries()) {
    const uri = img.uri || '';
    uris.push(uri);
    if (!ok(uri && !uri.startsWith('data:') && img.bufferView === undefined,
            `${name}: image ${i} is a loose file beside the .gltf`, uri.slice(0, 40) || 'embedded')) continue;
    const ip = path.join(dir, decodeURIComponent(uri));
    if (!ok(fs.existsSync(ip), `${name}: image ${i} exists`, uri)) continue;
    const dim = imageSize(fs.readFileSync(ip));
    if (!ok(!!dim, `${name}: image ${i} is a PNG or JPEG`, uri)) continue;
    ok(Math.max(dim.w, dim.h) <= cap, `${name}: image ${i} under ${cap} px`, `${uri} ${dim.w}x${dim.h}`);
  }

  // Materials: a palette entry each, in its colour, or white under a texture.
  const mats = gltf.materials || [];
  for (const mat of mats) {
    const want = palette[mat.name];
    if (!ok(!!want, `${name}: material ${mat.name} is a palette entry`, `the entries are ${Object.keys(palette).join(', ')}`)) continue;
    const pbr = mat.pbrMetallicRoughness || {};
    const rgb = (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map(toSrgb);
    const target = pbr.baseColorTexture ? [255, 255, 255] : rgbOf(want);
    ok(near(rgb, target), `${name}: material ${mat.name} carries ${pbr.baseColorTexture ? 'white under its texture' : 'its palette colour'}`,
       `#${hex(rgb)}, want #${hex(target)}`);
  }
  for (const mesh of gltf.meshes || []) for (const [pi, p] of mesh.primitives.entries()) {
    const where = `${mesh.name || 'mesh'} primitive ${pi}`;
    if (!ok(p.material !== undefined, `${name}: ${where} has a material`)) continue;
    ok(p.attributes.COLOR_0 === undefined, `${name}: ${where} carries no vertex colour`);
    const textured = !!mats[p.material]?.pbrMetallicRoughness?.baseColorTexture || !!mats[p.material]?.normalTexture;
    ok(textured || p.attributes.TEXCOORD_0 === undefined, `${name}: ${where} carries UVs only for a texture`);
  }

  console.log(`  ${m.tris} triangles, ${bytes} bytes, box ${m.size.map(f).join(' x ')} m, ` +
              `materials [${mats.map(x => x.name).join(', ')}]`);

  // The recipe's .glb, once there is one.
  const glbPath = file.replace(/\.gltf$/, '.glb');
  if (!fs.existsSync(glbPath)) { console.log('  no .glb beside it yet (the recipe has not run)'); return; }
  let glb;
  try { glb = readGlb(fs.readFileSync(glbPath)); }
  catch (e) { ok(false, `${name}: the .glb reads as a glTF binary`, e.message); return; }
  extensions(name, glb, 'the .glb\'s', true);
  const g = measure(glb, p => corners(glb, p));
  ok(g.tris === m.tris, `${name}: the .glb has the .gltf's triangles`, `${g.tris}, the .gltf ${m.tris}`);
  const worst = Math.max(...[0, 1, 2].flatMap(k => [Math.abs(g.lo[k] - m.lo[k]), Math.abs(g.hi[k] - m.hi[k])]));
  ok(worst <= 0.01, `${name}: the .glb's box is the .gltf's to 1 cm`, `${g.size.map(f).join(' x ')} m, worst corner ${f(worst)}`);
  const names = x => (x.materials || []).map(y => y.name).sort().join(', ');
  ok(names(glb) === names(gltf), `${name}: the .glb has the .gltf's materials`, `[${names(glb)}]`);
  const glbUris = (glb.images || []).map(i => i.uri || '').sort().join(', ');
  ok(glbUris === uris.slice().sort().join(', '), `${name}: the .glb names the .gltf's images`, `[${glbUris}]`);
  console.log(`  .glb: ${g.tris} triangles, ${fs.statSync(glbPath).size} bytes, [${(glb.extensionsUsed || []).join(', ')}]`);
}

// ---------------------------------------------------------------- all of it

for (const [name, item] of Object.entries(budget.items)) check(name, item);

console.log('\nevery model is named');
const named = new Set(Object.values(budget.items).flatMap(i => {
  const p = path.normalize(i.file);
  return [p, p.replace(/\.gltf$/, '.glb')];
}));
const models = path.join(PROJECT, budget.models);
const walkDir = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
for (const file of walkDir(models).filter(p => /\.(glb|gltf)$/i.test(p))) {
  const rel = path.normalize(path.relative(PROJECT, file));
  ok(named.has(rel), `budget.json names every model under ${budget.models}/`, rel.split(path.sep).join('/'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
