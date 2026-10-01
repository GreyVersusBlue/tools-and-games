// node test/gltf-loader.mjs
//
// Proves the vendored GLTFLoader loads a model in a real browser (WISHLIST.md
// "Blender assets" B2), then loads every model tools/blender/budget.json names
// (B1 onward). Exits non-zero on any failure (#13).
//
// The Fourth Quarter's own copy of Blue Hour's test/gltf-loader.mjs, not an
// import of it (#17): each project vendors its loader separately and each proves
// its own. This one is r160, copied from Bell to Bell's, and r160's loader names
// one util, BufferGeometryUtils, so there is no SkeletonUtils here to resolve.
// Port 8163; 8161 is Golden Hour's and 8162 Blue Hour's.
//
// Borrows Tools/board-check's harness rather than copying it, the way Integer
// Foundry's browser.mjs does: bare specifiers inside that file resolve from its
// own folder, so `npm ci` there is the only install
// (.github/workflows/fourth-quarter-ci.yml carries `install: Tools/board-check`
// for this).
//
// The page is the project's README, served as plain text so no module has loaded
// yet, then rewritten with the import map lifted verbatim out of index.html. The
// loader resolves `three` through the game's own map, so "the map needs no new
// entry" is checked rather than assumed. The GLB is built byte by byte inside the
// page: one triangle as a plain TRIANGLES primitive, and one quad as a
// TRIANGLE_STRIP, which is the case GLTFLoader hands to BufferGeometryUtils'
// toTrianglesDrawMode. So the util is exercised, not only imported.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8163; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/fourth-quarter/README.md`;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const group = name => console.log(`\n${name}`);

const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
const mapTag = html.match(/<script type="importmap">[\s\S]*?<\/script>/);

group('the import map');
ok(!!mapTag, 'index.html carries an import map');
const map = mapTag ? JSON.parse(mapTag[0].replace(/<\/?script[^>]*>/g, '')) : { imports: {} };
ok(Object.keys(map.imports).join() === 'three', 'it maps `three` and nothing else',
   Object.keys(map.imports).join(', '));

const server = await serve(PORT);
const browser = await launch();
let result = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag ? mapTag[0] : ''}<body></body>`);

  result = await page.evaluate(async () => {
    const out = {};
    let THREE, GLTFLoader;
    try {
      THREE = await import('three');
      ({ GLTFLoader } = await import('./libs/addons/loaders/GLTFLoader.js'));
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    out.revision = THREE.REVISION;

    // One triangle, then a unit quad as a four-vertex strip.
    const tri = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 1]);
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const bin = new Uint8Array(tri.byteLength + quad.byteLength);
    bin.set(new Uint8Array(tri.buffer), 0);
    bin.set(new Uint8Array(quad.buffer), tri.byteLength);

    const gltf = {
      asset: { version: '2.0', generator: 'fourth-quarter test/gltf-loader.mjs' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ mesh: 0, name: 'tri' }, { mesh: 1, name: 'strip' }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] },
        { primitives: [{ attributes: { POSITION: 1 }, mode: 5 }] },
      ],
      buffers: [{ byteLength: bin.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: tri.byteLength },
        { buffer: 0, byteOffset: tri.byteLength, byteLength: quad.byteLength },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 3, 1] },
        { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      ],
    };

    // GLB: 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded
    // with zeros, every chunk a multiple of four bytes (glTF 2.0 §4.4).
    let json = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonLen = Math.ceil(json.length / 4) * 4;
    const binLen = Math.ceil(bin.length / 4) * 4;
    const total = 12 + 8 + jsonLen + 8 + binLen;
    const glb = new ArrayBuffer(total);
    const dv = new DataView(glb);
    const u8 = new Uint8Array(glb);
    dv.setUint32(0, 0x46546C67, true); // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4E4F534A, true); // 'JSON'
    u8.fill(0x20, 20, 20 + jsonLen);
    u8.set(json, 20);
    const binAt = 20 + jsonLen;
    dv.setUint32(binAt, binLen, true);
    dv.setUint32(binAt + 4, 0x004E4942, true); // 'BIN\0'
    u8.set(bin, binAt + 8);
    out.glbBytes = total;

    let parsed;
    try { parsed = await new GLTFLoader().parseAsync(glb, ''); }
    catch (e) { out.parseError = String(e && e.message || e); return out; }

    const meshes = [];
    parsed.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    out.meshes = meshes.map(m => {
      const g = m.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox;
      return {
        name: m.name,
        vertices: g.attributes.position.count,
        indices: g.index ? g.index.count : null,
        min: b.min.toArray(), max: b.max.toArray(),
      };
    });
    return out;
  });

  group('the vendored loader');
  ok(!result.importError, 'GLTFLoader imports, and every relative util it names resolves',
     result.importError || '');
  if (!result.importError) {
    ok(result.revision === '160', 'three resolves through the map to r160', `REVISION ${result.revision}`);
    ok(!result.parseError, 'a hand-built GLB parses', result.parseError || `${result.glbBytes} bytes`);
  }

  const byName = Object.fromEntries((result.meshes || []).map(m => [m.name, m]));
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

  group('the triangle');
  const tri = byName.tri;
  ok(!!tri, 'the TRIANGLES primitive comes back as a mesh');
  if (tri) {
    ok(tri.vertices === 3, 'it has three vertices', `${tri.vertices}`);
    ok(tri.indices === null, 'and no index, as written', `${tri.indices}`);
    ok(same(tri.min, [0, 0, 0]) && same(tri.max, [2, 3, 1]), 'its bounds are (0,0,0) to (2,3,1)',
       `${tri.min} .. ${tri.max}`);
  }

  group('the strip, through toTrianglesDrawMode');
  const strip = byName.strip;
  ok(!!strip, 'the TRIANGLE_STRIP primitive comes back as a mesh');
  if (strip) {
    ok(strip.vertices === 4, 'it keeps its four vertices', `${strip.vertices}`);
    // A four-vertex strip is two triangles. toTrianglesDrawMode writes them out
    // as an index of six; without it the loader has nothing to convert with.
    ok(strip.indices === 6, 'it is re-indexed as two triangles (six indices)', `${strip.indices}`);
    ok(same(strip.min, [0, 0, 0]) && same(strip.max, [1, 1, 0]), 'its bounds are (0,0,0) to (1,1,0)',
       `${strip.min} .. ${strip.max}`);
  }

  // What the Blender pipeline writes (B1 onward), through the same loader:
  // every model budget.json names, fetched from where the game will fetch it.
  // tools/blender/validate.mjs reads the files with its own parser; this is
  // three reading them. Every material must come back as the
  // MeshStandardMaterial the game's flat() and mat() make, a flat- one white
  // with vertexColors on (so the colour is the vertices', as flat() paints
  // it), a keyed one under its MATS key's name with no vertexColors (the name
  // is how the wiring row swaps mat(key) in). Three's own box must stand on
  // y = 0 and sit within 10% of world.js's box, and nothing may carry a
  // texture: a keyed slot's texture is the game's, put on at load.
  const budget = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tools', 'blender', 'budget.json'), 'utf8'));
  const { MATS } = await import(pathToFileURL(path.join(PROJECT, budget.mats)).href);
  const models = await page.evaluate(async items => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('./libs/addons/loaders/GLTFLoader.js');
    const out = {};
    for (const [name, item] of Object.entries(items)) {
      try {
        const g = await new GLTFLoader().loadAsync('./' + item.file);
        const mats = [];
        let maps = 0;
        g.scene.traverse(o => {
          if (!o.isMesh) return;
          for (const m of [].concat(o.material)) {
            mats.push({ name: m.name, type: m.type, vc: !!m.vertexColors, colour: m.color.getHex(),
                        hasColour: !!o.geometry.attributes.color });
            if (m.map) maps++;
          }
        });
        const box = new THREE.Box3().setFromObject(g.scene, true);
        out[name] = { mats, maps, min: box.min.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
      } catch (e) { out[name] = { error: String(e && e.message || e) }; }
    }
    return out;
  }, budget.items);

  group('the Blender pipeline\'s models');
  ok(Object.keys(budget.items).length > 0, 'budget.json names at least one model', Object.keys(budget.items).join(', '));
  for (const [name, item] of Object.entries(budget.items)) {
    const m = models[name];
    if (!ok(!m.error, `${name}: loads`, m.error || item.file)) continue;
    const wrong = m.mats.filter(x => x.type !== 'MeshStandardMaterial');
    ok(m.mats.length > 0 && wrong.length === 0, `${name}: every material is a MeshStandardMaterial, as flat() and mat() make`,
       m.mats.map(x => `${x.name} ${x.type}`).join(', '));
    const flatBad = m.mats.filter(x => x.name.startsWith('flat-') && !(x.vc && x.hasColour && x.colour === 0xffffff));
    ok(flatBad.length === 0, `${name}: each flat- material is white with vertexColors on and a colour attribute`,
       flatBad.map(x => `${x.name} vertexColors ${x.vc}, colour #${x.colour.toString(16)}`).join(', '));
    const keyBad = m.mats.filter(x => !x.name.startsWith('flat-') && !(Object.hasOwn(MATS, x.name) && !x.vc));
    ok(keyBad.length === 0, `${name}: every other material is a MATS key, with no vertexColors`,
       keyBad.map(x => `${x.name} vertexColors ${x.vc}`).join(', '));
    ok(Math.abs(m.min[1]) <= 0.01, `${name}: three's box stands on y = 0`, `lowest y ${m.min[1].toFixed(3)}`);
    const off = m.size.map((s, k) => s / item.box[k] - 1);
    ok(off.every(o => Math.abs(o) <= 0.10), `${name}: three's box is within 10% of world.js's ${item.box.join(' x ')}`,
       m.size.map(s => s.toFixed(3)).join(' x '));
    ok(m.maps === 0, `${name}: it carries no texture`, `${m.maps} map(s)`);
  }

  group('the page');
  ok(page.__errs.length === 0, 'no page errors or failed requests', page.__errs.join(' | '));
  ok(page.__blocked.length === 0 && page.__shimmed.length === 0, 'nothing asked for anything offsite',
     [...page.__blocked, ...page.__shimmed].join(' | '));
  await page.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
