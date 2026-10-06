// assets.mjs — what assets/models/ holds, read straight off the files. Node only, no browser.
//
//   node Projects/skywings64/test/assets.mjs            (also the first thing test/browser.mjs runs)
//   node Projects/skywings64/test/assets.mjs some.glb   (hold another file to the heads' numbers)
//
// Every .glb has to parse, carry its own buffer and images (#724: nothing offsite) and be asked for
// by name somewhere in src/. heads.glb is also held to what src/world/landmarks.js expects of it,
// since that file is placed unscaled: see tools/blender/world_heads.py. Exits non-zero on a failure (#13).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(HERE, '..', 'assets', 'models');
const SRC = path.join(HERE, '..', 'src');

// heads.glb replaced a file of 8,044 triangles and 1,111,260 bytes in 12 draws; it may not grow past it
const HEADS = { tris: 8044, bytes: 1111260, draws: 3, x: 135, zBack: -59, zFront: 33, top: 165, foot: -40, at: [-84, -28, 28, 84] };

export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  if (b.readUInt32LE(4) !== 2) throw new Error('not glTF 2');
  if (b.readUInt32LE(8) !== b.length) throw new Error('length field ' + b.readUInt32LE(8) + ' is not the file size ' + b.length);
  const jl = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bo = 20 + jl;
  if (b.readUInt32LE(bo + 4) !== 0x004e4942) throw new Error('second chunk is not BIN');
  const bin = b.subarray(bo + 8, bo + 8 + b.readUInt32LE(bo));
  const prims = json.meshes.flatMap((m) => m.primitives);
  const tris = prims.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
  return { bytes: b.length, json, bin, prims, tris };
}

// every vertex of the file as [x, y, z]; only valid for a file whose nodes carry no transform
function positions(g) {
  const out = [];
  for (const p of g.prims) {
    const a = g.json.accessors[p.attributes.POSITION], v = g.json.bufferViews[a.bufferView];
    const stride = v.byteStride || 12, at = (v.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++) out.push([0, 4, 8].map((k) => g.bin.readFloatLE(at + i * stride + k)));
  }
  return out;
}

function checkHeads(file, ok) {
  const g = readGlb(file), j = g.json, n = 'heads.glb: ';
  ok(g.tris <= HEADS.tris && g.bytes <= HEADS.bytes, n + 'no bigger than the file it replaced', { tris: g.tris, bytes: g.bytes });
  ok(g.prims.length <= HEADS.draws, n + 'three draws at most', g.prims.length);
  const node = j.nodes.length === 1 && j.nodes[0];
  ok(node && node.name === 'heads' && !node.scale && !node.translation && !node.rotation && !node.matrix,
    n + 'one node, with no transform of its own (landmarks.js places it unscaled)', j.nodes.map((x) => [x.name, x.scale, x.translation]));
  const mats = j.materials.map((m) => m.name);
  // landmarks.js detailGLB() picks the stone shader by /rock/ in the material's name
  const rock = g.prims.find((p) => /rock/i.test(mats[p.material] || ''));
  ok(rock && rock.attributes.COLOR_0 !== undefined, n + 'the rock is vertex-coloured', mats);
  ok(j.materials.every((m) => m.occlusionTexture), n + 'every material carries the baked AO', mats);
  if (!node || node.scale || node.translation) return;
  const P = positions(g);
  const mn = [0, 1, 2].map((k) => Math.min(...P.map((p) => p[k]))), mx = [0, 1, 2].map((k) => Math.max(...P.map((p) => p[k])));
  const r = (v) => Math.round(v * 10) / 10;
  const E = 0.01;   // the file holds 32-bit floats
  ok(mn[0] >= -HEADS.x - E && mx[0] <= HEADS.x + E && mn[2] >= HEADS.zBack - E && mx[2] <= HEADS.zFront + E && mx[1] <= HEADS.top + E && mn[1] >= HEADS.foot - E,
    n + "inside the fallback's box", { min: mn.map(r), max: mx.map(r) });
  ok(mx[0] - mn[0] >= 250 && mx[1] >= 120, n + 'fills that box', { width: r(mx[0] - mn[0]), top: r(mx[1]), foot: r(mn[1]) });
  // the hill falls away past its flattened top (terrain.js, r 90), so the cliff needs a skirt; the boulders alone reach y = -4
  ok(mn[1] <= -30, n + 'the skirt goes at least 30 m under the ground', r(mn[1]));
  // The faces: whatever stands forward of the cliff and its ledge (z > 18) above the ledge (y > 22).
  const front = (x, w) => P.filter((p) => Math.abs(p[0] - x) <= w && p[1] > 22 && p[2] > 18);
  const noses = HEADS.at.map((x) => P.filter((p) => Math.abs(p[0] - x) <= 6 && p[1] > 22 && p[2] > 24).length);
  const heads = HEADS.at.map((x) => { const f = front(x, 20); return f.length ? { lo: r(Math.min(...f.map((p) => p[1]))), hi: r(Math.max(...f.map((p) => p[1]))) } : null; });
  ok(noses.every((c) => c > 0), n + 'a face comes 24 m forward within 6 m of each of x = -84, -28, 28, 84 (vertices there)', noses);
  ok(heads.every((h) => h && h.hi - h.lo >= 45), n + 'each face is at least 45 m from chin to brow', heads);
  const gaps = [-56, 0, 56].map((x) => front(x, 1).map((p) => p.map(r)));
  ok(gaps.every((c) => c.length === 0), n + 'and nothing stands forward within a metre of the midpoints between them', gaps);
}

export function checkAssets(headsFile) {
  const out = [];
  const ok = (cond, label, detail) => out.push({ ok: !!cond, label, detail: detail === undefined ? '' : JSON.stringify(detail) });
  const src = fs.readdirSync(SRC, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const files = fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb')).sort();
  ok(files.length >= 11, 'assets/models holds the eleven models', files.length);
  for (const f of files) {
    const name = f.slice(0, -4);
    try {
      const g = readGlb(path.join(MODELS, f));
      const offsite = [...(g.json.buffers || []), ...(g.json.images || [])].filter((x) => x.uri);
      ok(g.tris > 0 && Number.isInteger(g.tris) && offsite.length === 0, f + ': parses, with its buffer and images inside it', { tris: g.tris, bytes: g.bytes });
    } catch (e) { ok(false, f + ': parses', String(e.message)); }
    ok(src.includes("'" + name + "'"), f + ': src/ asks for it by name');
  }
  ok(/swapInAt\(headsHost, 'heads', sx, y0, sz, \{\}\)/.test(src), "landmarks.js swaps 'heads' in at the statue's ground point, unscaled");
  try { checkHeads(headsFile || path.join(MODELS, 'heads.glb'), ok); } catch (e) { ok(false, 'heads.glb: readable', String(e.message)); }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = checkAssets(process.argv[2]);
  let failures = 0;
  for (const r of results) { if (!r.ok) failures++; console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.detail ? '  ' + r.detail : ''}`); }
  console.log(`\n${results.length} checks, ${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
}
